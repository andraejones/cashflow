// TransactionStore — persistence: localStorage load (with migrations and
// PIN decryption), save (with encryption), debounced-save orchestration,
// tombstone pruning, the what-if persistence filter, reset, and whole-DB
// import/export. Prototype companion of TransactionStore (class declared in
// transaction-store.js); no build step — loaded as a plain script after the
// class file and before app.js (see index.html).

Object.assign(TransactionStore.prototype, {

  // The tombstone collections tracked for merge conflict resolution: one key
  // per synced collection, plus `skips` for timestamped skip-toggle events.
  // Every construction site (constructor, loadData, importData, resetData)
  // derives its object from this one list, so adding a synced collection means
  // adding its key here and nowhere else. Sites used to hand-maintain their own
  // copies and drifted: loadData omitted `savingsGoals`, so after any reload
  // (saveData writes the `deletedItems` key on every save, so the stored blob
  // is always present) deleteSavingsGoal's unguarded push threw, the delete
  // silently failed, and an untombstoned goal would resurrect on the next merge.
  _TOMBSTONE_KEYS: [
    "transactions",
    "recurringTransactions",
    "debts",
    "cashInfusions",
    "savingsGoals",
    "skips",
  ],

  // A fresh tombstone record with every collection present and empty.
  _emptyDeletedItems() {
    const empty = {};
    this._TOMBSTONE_KEYS.forEach((key) => {
      empty[key] = [];
    });
    return empty;
  },

  // True for a tombstone entry the rest of the code can actually read: either
  // the legacy bare-id string or an object carrying an id. `skips` events are a
  // different shape ({date, recurringId, skipped, at}) and are kept as long as
  // they are objects. Everything else (null, numbers, nested arrays) is dropped.
  // `typeof null === "object"`, so a null entry passed every `typeof d ===
  // "object"` guard and then threw on `.id` — see _normalizeDeletedItems.
  _isUsableTombstone(entry, key) {
    if (key === "skips") {
      return !!entry && typeof entry === "object" && !Array.isArray(entry);
    }
    if (typeof entry === "string") return entry !== "";
    return (
      !!entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      !!entry.id
    );
  },

  // Coerce a persisted or imported tombstone record into the canonical shape.
  // Anything missing or malformed becomes an empty array, so every later
  // trackDeleted* push lands on a real array — and unusable ENTRIES are dropped
  // too, not just unusable collections. A single null in the list used to throw
  // inside _pruneDeletedItems, which runs inside saveData's try: the throw
  // skipped triggerSaveCallbacks, so CloudSync stopped scheduling pushes for the
  // rest of the session with nothing shown to the user. Only external data can
  // carry such an entry (a hand-edited export, a truncated gist) — every
  // in-app writer pushes a complete record.
  _normalizeDeletedItems(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const normalized = {};
    this._TOMBSTONE_KEYS.forEach((key) => {
      normalized[key] = Array.isArray(source[key])
        ? source[key].filter((entry) => this._isUsableTombstone(entry, key))
        : [];
    });
    return normalized;
  },

  // ---- Stored-shape guards -------------------------------------------------
  // JSON.parse accepting a value is not the same as the app being able to use
  // it. A truncated write, another tool touching the key, or a hand-edited
  // backup can leave `123`, `true`, `null` or `"text"` under a key the rest of
  // the code reads as a map or a list. loadData used to assign those straight
  // through, and the failure surfaced far away and uncaught — updateMonthlyBalances
  // writing a property onto a number, hasMoveAnomaly reading .fromDate off
  // null — leaving a blank app with no way back. Treat an unusable shape as
  // missing data instead: keep the empty default, warn, and let the user
  // restore from cloud or a backup.
  _storedMap(parsed, label) {
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    console.warn(`Stored "${label}" has an unusable shape; ignoring it.`);
    return null;
  },

  _storedArray(parsed, label) {
    if (Array.isArray(parsed)) {
      return parsed;
    }
    console.warn(`Stored "${label}" has an unusable shape; ignoring it.`);
    return null;
  },

  // Same idea one level down: every day of the transactions map must be an
  // array, every skip list must be an array, every move record an object.
  // One bad entry otherwise throws inside a forEach the moment it is walked.
  _prunedEntries(map, keep) {
    let dropped = 0;
    Object.keys(map).forEach((key) => {
      if (!keep(map[key])) {
        delete map[key];
        dropped++;
      }
    });
    if (dropped > 0) {
      console.warn(`Dropped ${dropped} unusable stored entr${dropped === 1 ? "y" : "ies"}.`);
    }
    return map;
  },

  // Debounced save method - batches multiple rapid changes into a single save
  debouncedSave(isDataModified = true) {
    // Track if any pending save has data modification
    if (isDataModified) {
      this._pendingIsDataModified = true;
    }

    // Clear existing timer
    if (this._saveDebounceTimer) {
      clearTimeout(this._saveDebounceTimer);
    }

    // Set new timer
    this._saveDebounceTimer = setTimeout(() => {
      this._saveDebounceTimer = null;
      const wasModified = this._pendingIsDataModified;
      this._pendingIsDataModified = false;

      // If a save is in progress, queue this one
      if (this._saveInProgress) {
        this._queuedSave = this._queuedSave || wasModified;
        return;
      }

      this.saveData(wasModified);
    }, this._saveDebounceDelay);
  },

  // Force immediate save (useful when app is closing or for critical operations)
  flushPendingSave() {
    if (this._saveDebounceTimer) {
      clearTimeout(this._saveDebounceTimer);
      this._saveDebounceTimer = null;
      const wasModified = this._pendingIsDataModified;
      this._pendingIsDataModified = false;
      this.saveData(wasModified);
    }
  },

  // Cancel pending save without saving
  cancelPendingSave() {
    if (this._saveDebounceTimer) {
      clearTimeout(this._saveDebounceTimer);
      this._saveDebounceTimer = null;
      this._pendingIsDataModified = false;
    }
  },

  registerSaveCallback(callback) {
    if (typeof callback === 'function') {
      this.onSaveCallbacks.push(callback);
    }
  },

  triggerSaveCallbacks(isDataModified = false) {
    this.onSaveCallbacks.forEach(callback => {
      try {
        callback(isDataModified);
      } catch (error) {
        console.error("Error in save callback:", error);
      }
    });
  },

  loadData() {
    let loadFailed = false;
    try {
      const decrypt = (val, structured = false) => {
        if (
          this.pinProtection &&
          this.pinProtection.getCurrentPin() &&
          val
        ) {
          const out = this.pinProtection.decrypt(val);
          // decrypt() returns "" only from its own catch — a genuine failure
          // (wrong PIN that passed the hash, or corrupt ciphertext). For
          // structured keys, legit-empty data still encodes to "{}"/"[]", so a
          // non-empty ciphertext decrypting to empty means the value is
          // unrecoverable. Flag it so saveData refuses to overwrite the intact
          // on-disk copy with the empty in-memory fallback.
          if (structured && !out) {
            loadFailed = true;
          }
          return out;
        }
        return val;
      };

      const storedTransactions = decrypt(this.storage.getItem("transactions"), true);
      const storedMonthlyBalances = decrypt(this.storage.getItem("monthlyBalances"), true);
      const storedRecurringTransactions = decrypt(
        this.storage.getItem("recurringTransactions"), true
      );
      const storedSkippedTransactions = decrypt(
        this.storage.getItem("skippedTransactions"), true
      );
      const storedDebts = decrypt(this.storage.getItem("debts"), true);
      const storedCashInfusions = decrypt(
        this.storage.getItem("cashInfusions"), true
      );
      const storedSavingsGoals = decrypt(
        this.storage.getItem("savingsGoals"), true
      );
      const storedSnowballSettings = decrypt(
        this.storage.getItem("debtSnowballSettings"), true
      );
      const storedMonthlyNotes = decrypt(
        this.storage.getItem("monthlyNotes"), true
      );
      const storedMovedTransactions = decrypt(
        this.storage.getItem("movedTransactions"), true
      );
      // lastUpdated can legitimately be an empty string, so it isn't "structured".
      const storedLastUpdated = decrypt(
        this.storage.getItem("lastUpdated")
      );
      const storedDeletedItems = decrypt(
        this.storage.getItem("deletedItems"), true
      );

      if (storedTransactions) {
        const parsedTransactions = this._storedMap(
          JSON.parse(storedTransactions), "transactions"
        );
        if (parsedTransactions) {
          // Prune inside each day too: a null or a bare number among the rows
          // throws on the very next `t.id` read, and the catch below would then
          // discard the ENTIRE dataset (and block saves) over one junk entry.
          Object.keys(parsedTransactions).forEach((date) => {
            if (Array.isArray(parsedTransactions[date])) {
              parsedTransactions[date] = parsedTransactions[date].filter(
                (t) => t && typeof t === "object" && !Array.isArray(t)
              );
            }
          });
          this.transactions = this._prunedEntries(
            parsedTransactions,
            (day) => Array.isArray(day) && day.length > 0
          );
        }
        // Migration: assign IDs and timestamps to transactions without them
        let needsMigration = false;
        Object.keys(this.transactions).forEach((date) => {
          this.transactions[date].forEach((t) => {
            if (!t.id) {
              t.id = Utils.generateUniqueId();
              needsMigration = true;
            }
            if (!t._lastModified) {
              t._lastModified = new Date().toISOString();
              needsMigration = true;
            }
          });
        });
        if (needsMigration) {
          console.log("Migrated transactions to include IDs and timestamps");
          // Mark for save after load completes (encrypt() is only defined in saveData())
          this._needsMigrationSave = true;
        }
      }

      if (storedMonthlyBalances) {
        const parsedBalances = this._storedMap(
          JSON.parse(storedMonthlyBalances), "monthlyBalances"
        );
        // Derived data — an unusable copy just gets rebuilt on the next render.
        this.monthlyBalances = parsedBalances || {};
      }

      if (storedRecurringTransactions) {
        this.recurringTransactions =
          this._storedArray(
            JSON.parse(storedRecurringTransactions), "recurringTransactions"
          ) || [];
        this.recurringTransactions = this.recurringTransactions.filter(
          (rt) => rt && typeof rt === "object" && !Array.isArray(rt)
        );
        this.recurringTransactions.forEach((rt) => {
          if (!rt.id) {
            rt.id = Utils.generateUniqueId();
          }
          if (!rt._lastModified) {
            rt._lastModified = new Date().toISOString();
          }
          if (rt.recurrence === "biweekly") {
            rt.recurrence = "bi-weekly";
          } else if (rt.recurrence === "semimonthly") {
            rt.recurrence = "semi-monthly";
          } else if (rt.recurrence === "semiannual") {
            rt.recurrence = "semi-annual";
          }
          // Migration: "last day of every month" used to be inferred from a
          // start date that landed on its month's last day. It is now an
          // explicit flag, so stamp it on any legacy monthly recurrence that
          // relied on the old inference — preserving its dates exactly (the
          // user can turn it off if the start date was a coincidence).
          if (
            rt.recurrence === "monthly" &&
            !rt.daySpecific &&
            rt.lastDayOfMonth === undefined &&
            Utils.isLastCalendarDayOfMonth(rt.startDate)
          ) {
            rt.lastDayOfMonth = true;
            // Persist the stamped flag (encrypt() is only available in
            // saveData(), so defer like the other load-time migrations).
            this._needsMigrationSave = true;
          }
        });
      }

      // Transactions, recurring definitions and monthly anchors are all parsed
      // straight from storage above. Repair any non-finite money before the
      // first walk reads it — a stored `null` (how JSON.stringify renders an
      // Infinity that got in before this guard existed) lands here too. No
      // migration save is forced: the repair is idempotent, so it rides the
      // next ordinary save instead of pushing on load.
      this._repairWalkAmounts();

      if (storedSkippedTransactions) {
        const parsedSkips = this._storedMap(
          JSON.parse(storedSkippedTransactions), "skippedTransactions"
        );
        if (parsedSkips) {
          Object.keys(parsedSkips).forEach((date) => {
            if (Array.isArray(parsedSkips[date])) {
              parsedSkips[date] = parsedSkips[date].filter(
                (id) => typeof id === "string" && id
              );
            }
          });
          this.skippedTransactions = this._prunedEntries(
            parsedSkips,
            (list) => Array.isArray(list) && list.length > 0
          );
        }
      }

      if (storedDebts) {
        const parsedDebts = this._storedArray(JSON.parse(storedDebts), "debts") || [];
        this.debts = parsedDebts
          .filter((debt) => debt && typeof debt === "object" && !Array.isArray(debt))
          .map((debt) => this._normalizeDebt(debt));
      }

      if (storedCashInfusions) {
        const parsedInfusions =
          this._storedArray(JSON.parse(storedCashInfusions), "cashInfusions") || [];
        this.cashInfusions = parsedInfusions
          .filter((inf) => inf && typeof inf === "object" && !Array.isArray(inf))
          .map((infusion) => this._normalizeCashInfusion(infusion));
      }

      if (storedSavingsGoals) {
        const parsedGoals =
          this._storedArray(JSON.parse(storedSavingsGoals), "savingsGoals") || [];
        this.savingsGoals = parsedGoals
          .filter((goal) => goal && typeof goal === "object" && !Array.isArray(goal))
          .map((goal) => this._normalizeSavingsGoal(goal));
      }

      if (storedSnowballSettings) {
        const parsedSettings =
          this._storedMap(
            JSON.parse(storedSnowballSettings), "debtSnowballSettings"
          ) || {};
        this.debtSnowballSettings = {
          dailyFloor: this._finiteNumber(parsedSettings.dailyFloor),
          extraPaymentStartMonth: this.normalizeExtraStartMonth(
            parsedSettings.extraPaymentStartMonth
          ),
          autoGenerate: parsedSettings.autoGenerate === true,
        };
      }

      if (storedMonthlyNotes) {
        this.monthlyNotes =
          this._storedMap(JSON.parse(storedMonthlyNotes), "monthlyNotes") || {};
      }

      if (storedMovedTransactions) {
        const parsedMoves = this._storedMap(
          JSON.parse(storedMovedTransactions), "movedTransactions"
        );
        this.movedTransactions = parsedMoves
          ? this._prunedEntries(
              parsedMoves,
              (move) => move && typeof move === "object" && !Array.isArray(move)
            )
          : {};

        // Clean up stale entries where fromDate equals toDate
        // (transaction was moved back to original date)
        let hasStaleEntries = false;
        Object.keys(this.movedTransactions).forEach(key => {
          const move = this.movedTransactions[key];
          if (move.fromDate === move.toDate) {
            delete this.movedTransactions[key];
            hasStaleEntries = true;
          }
        });
        if (hasStaleEntries) {
          console.log("Cleaned up stale movedTransactions entries");
          // Defer save so encryption (only available in saveData()) is applied
          this._needsMigrationSave = true;
        }
      }

      if (typeof storedLastUpdated === "string" && storedLastUpdated) {
        this.lastUpdated = storedLastUpdated;
      }

      // Load deleted items tracking for merge conflict resolution. Normalize
      // the shape — a legacy/partial object missing any key would make that
      // collection's later tombstone push throw.
      if (storedDeletedItems) {
        this._deletedItems = this._normalizeDeletedItems(
          JSON.parse(storedDeletedItems)
        );
      }

      if (this.debts.length > 0 && this.recurringTransactions.length > 0) {
        const recurringIds = new Set(
          this.recurringTransactions.map((rt) => rt.id)
        );
        this.debts.forEach((debt) => {
          if (debt.minRecurringId && !recurringIds.has(debt.minRecurringId)) {
            debt.minRecurringId = null;
          }
        });
      }

      if (loadFailed) {
        // A structured key failed to decrypt. Block persistence so a later save
        // can't overwrite the still-intact ciphertext with the empty in-memory
        // fallback. Recovers on reload with the correct PIN / fixed storage.
        this._loadFailed = true;
        console.error(
          "Data load integrity check failed — saves disabled to protect on-disk data"
        );
      }

      // Handle deferred migration save (encrypt() is only defined in saveData())
      if (this._needsMigrationSave && !this._loadFailed) {
        delete this._needsMigrationSave;
        this.saveData(false); // Don't trigger cloud sync for migration
      }
    } catch (error) {
      console.error("Error loading data from storage:", error);
      // Decrypt/parse threw mid-load. Reset in-memory to a consistent empty
      // state so the app stays usable, but flag the failure so saveData refuses
      // to persist — otherwise the next debounced save overwrites the intact
      // on-disk ciphertext with this empty state, making the loss permanent.
      this._loadFailed = true;
      this.transactions = {};
      this.monthlyBalances = {};
      this.recurringTransactions = [];
      this.skippedTransactions = {};
      this.debts = [];
      this.cashInfusions = [];
      this.savingsGoals = [];
      this.lastUpdated = null;
      this.debtSnowballSettings = {
        dailyFloor: 0,
        extraPaymentStartMonth: "",
        autoGenerate: false,
      };
    }
  },

  _pruneDeletedItems() {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    // Every id-tombstone collection ages out the same way; `skips` holds a
    // different shape ({date, recurringId, skipped, at}) and is pruned below.
    const keys = this._TOMBSTONE_KEYS.filter((key) => key !== "skips");

    keys.forEach(key => {
      if (Array.isArray(this._deletedItems[key])) {
        this._deletedItems[key] = this._deletedItems[key].filter(item => {
          // New format: object with id and deletedAt. `item &&` matters —
          // typeof null is "object", and reading .deletedAt off it threw here,
          // inside saveData's try, before triggerSaveCallbacks could run.
          if (item && typeof item === 'object' && item.deletedAt) {
            return item.deletedAt > thirtyDaysAgo;
          }
          // Old format: just keep (will be replaced on next delete)
          return true;
        });
      }
    });

    // Skip-toggle events age out the same way once every device has converged.
    if (Array.isArray(this._deletedItems.skips)) {
      this._deletedItems.skips = this._deletedItems.skips.filter(
        (e) => e && typeof e.at === "number" && e.at > thirtyDaysAgo
      );
    }
  },

  _filterPersistedTransactions(transactions) {
    const filtered = {};
    for (const date in transactions) {
      // What-if drafts (whatIf: true) are preview-only overlays on the balance
      // walk — never persisted to storage, exports, or cloud sync.
      const kept = transactions[date].filter(t =>
        t.whatIf !== true &&
        (!t.recurringId || t.modifiedInstance || t.movedFrom !== undefined)
      );
      if (kept.length > 0) {
        filtered[date] = kept;
      }
    }
    return filtered;
  },

  saveData(isDataModified = true) {
    // A failed/partial load (decrypt error or parse throw) leaves in-memory
    // state empty or incomplete. Refuse to persist over the intact on-disk
    // ciphertext — saving here would make the data loss permanent. The flag
    // clears on the next clean load (page reload with the correct PIN).
    if (this._loadFailed) {
      console.warn(
        "saveData skipped: load integrity failed, preserving on-disk data"
      );
      return false;
    }

    // Cancel any pending debounced save since we're saving now — but absorb
    // its modified flag instead of discarding it. A maintenance saveData(false)
    // (snowball materialization, allocation sweeps) can land while a user
    // edit's debounced save is still queued; dropping the flag here would skip
    // the lastUpdated bump and the cloud-sync scheduling for that edit.
    if (this._saveDebounceTimer) {
      clearTimeout(this._saveDebounceTimer);
      this._saveDebounceTimer = null;
    }
    if (this._pendingIsDataModified) {
      isDataModified = true;
      this._pendingIsDataModified = false;
    }

    // Mark save as in progress
    this._saveInProgress = true;
    // Reported to callers so a step that depends on the write landing (the PIN
    // change flow re-keying every value) can back out instead of committing.
    let wrote = false;

    try {
      const encrypt = (val) => {
        if (
          this.pinProtection &&
          this.pinProtection.getCurrentPin()
        ) {
          return this.pinProtection.encrypt(val);
        }
        return val;
      };

      if (isDataModified || !this.lastUpdated) {
        this.lastUpdated = new Date().toISOString();
      }

      this.storage.setItem(
        "transactions",
        encrypt(JSON.stringify(this._filterPersistedTransactions(this.transactions)))
      );
      this.storage.setItem(
        "monthlyBalances",
        encrypt(JSON.stringify(this.monthlyBalances))
      );
      this.storage.setItem(
        "recurringTransactions",
        encrypt(JSON.stringify(this.recurringTransactions))
      );
      this.storage.setItem(
        "skippedTransactions",
        encrypt(JSON.stringify(this.skippedTransactions))
      );
      this.storage.setItem("debts", encrypt(JSON.stringify(this.debts)));
      this.storage.setItem(
        "cashInfusions",
        encrypt(JSON.stringify(this.cashInfusions))
      );
      this.storage.setItem(
        "savingsGoals",
        encrypt(JSON.stringify(this.savingsGoals))
      );
      this.storage.setItem(
        "debtSnowballSettings",
        encrypt(JSON.stringify(this.debtSnowballSettings))
      );
      this.storage.setItem(
        "monthlyNotes",
        encrypt(JSON.stringify(this.monthlyNotes))
      );
      this.storage.setItem(
        "movedTransactions",
        encrypt(JSON.stringify(this.movedTransactions))
      );
      this.storage.setItem(
        "lastUpdated",
        encrypt(this.lastUpdated || "")
      );
      // Prune old deleted items before saving
      this._pruneDeletedItems();
      this.storage.setItem(
        "deletedItems",
        encrypt(JSON.stringify(this._deletedItems))
      );
      this._storageWriteFailed = false;
      wrote = true;
    } catch (error) {
      // A write that throws part-way through (localStorage over quota is the
      // realistic case — the dataset plus its PIN-encrypted base64 plus
      // cloud-sync's _backup_before_merge copy add up) used to be swallowed
      // here: some keys were written and some weren't, the save callbacks
      // below never ran so CloudSync stopped scheduling a push, and the user
      // was told nothing. The in-memory data is still correct, so let the
      // callbacks run anyway — the change can still reach the cloud — and say
      // out loud that this device's storage is failing.
      console.error("Error saving data to storage:", error);
      if (!this._storageWriteFailed) {
        this._storageWriteFailed = true;
        if (typeof Utils !== "undefined" && Utils.showNotification) {
          Utils.showNotification(
            "Couldn't save to this device's storage — your changes may not survive a reload. Save to Cloud now.",
            "error"
          );
        }
      }
    } finally {
      // In the finally, not the try: cloud sync must be notified whether or not
      // localStorage accepted the data, and _saveInProgress must always clear.
      // triggerSaveCallbacks isolates each callback itself.
      this.triggerSaveCallbacks(isDataModified);
      this._saveInProgress = false;

      // Process queued save if any
      if (this._queuedSave !== null) {
        const queuedModified = this._queuedSave;
        this._queuedSave = null;
        this.saveData(queuedModified);
      }
    }

    return wrote;
  },

  resetData() {
    this.transactions = {};
    this.monthlyBalances = {};
    this.recurringTransactions = [];
    this.skippedTransactions = {};
    this.debts = [];
    this.cashInfusions = [];
    this.savingsGoals = [];
    this.monthlyNotes = {};
    this.movedTransactions = {};
    this.lastUpdated = null;
    this.debtSnowballSettings = {
      dailyFloor: 0,
      extraPaymentStartMonth: "",
      autoGenerate: false,
    };
    this._deletedItems = this._emptyDeletedItems();
    // Reset replaces in-memory state with a known-good empty state, so any
    // prior load-integrity failure no longer applies — clear it (as importData
    // does) or saveData refuses to persist and the corrupt on-disk data that
    // prompted the reset silently returns on the next reload.
    this._loadFailed = false;
    this.saveData();
    return true;
  },

  exportData() {
    return {
      transactions: this._filterPersistedTransactions(this.transactions),
      monthlyBalances: this.monthlyBalances,
      recurringTransactions: this.recurringTransactions,
      skippedTransactions: this.skippedTransactions,
      movedTransactions: this.movedTransactions,
      debts: this.debts,
      cashInfusions: this.cashInfusions,
      savingsGoals: this.savingsGoals,
      monthlyNotes: this.monthlyNotes,
      debtSnowballSettings: this.debtSnowballSettings,
      _deletedItems: this._deletedItems,
      lastUpdated: this.lastUpdated,
      lastExported: new Date().toISOString(),
      appVersion: "2.0.0"
    };
  },

  importData(data) {
    if (!data || typeof data !== 'object') {
      console.error("Invalid data format for import");
      return false;
    }

    if (
      !data.transactions ||
      !data.monthlyBalances ||
      !data.recurringTransactions
    ) {
      console.error("Missing required data properties for import");
      return false;
    }

    // Create backup of current data before import for recovery
    const backup = {
      transactions: this.transactions,
      monthlyBalances: this.monthlyBalances,
      recurringTransactions: this.recurringTransactions,
      skippedTransactions: this.skippedTransactions,
      movedTransactions: this.movedTransactions,
      debts: this.debts,
      cashInfusions: this.cashInfusions,
      savingsGoals: this.savingsGoals,
      monthlyNotes: this.monthlyNotes,
      debtSnowballSettings: this.debtSnowballSettings,
      _deletedItems: this._deletedItems,
      lastUpdated: this.lastUpdated
    };

    try {
      // Validate the payload as a whole before any assignment. Individual
      // collections are coerced (not rejected) below; this only refuses a file
      // that could not be one of our exports at all.
      if (typeof data.transactions !== 'object') {
        throw new Error("Invalid transactions format");
      }
      if (typeof data.monthlyBalances !== 'object') {
        throw new Error("Invalid monthlyBalances format");
      }
      if (!Array.isArray(data.recurringTransactions)) {
        throw new Error("Invalid recurringTransactions format");
      }

      // Coerce shapes exactly as loadData does. `x || []` only catches
      // null/undefined, so one malformed collection in an otherwise good
      // backup — `"debts": 0` from a truncated write or a hand edit — threw
      // inside .map, hit the catch below, restored the backup and reported
      // "Invalid file format". The user lost the WHOLE restore over one bad
      // key, when loadData's rule for the same data is "treat an unusable
      // shape as missing, keep the empty default, and warn". Same rule here:
      // salvage everything that is usable.
      this.transactions = this._prunedEntries(
        this._storedMap(data.transactions, "imported transactions") || {},
        (day) => Array.isArray(day) && day.length > 0
      );
      Object.keys(this.transactions).forEach((date) => {
        this.transactions[date] = this.transactions[date].filter(
          (t) => t && typeof t === "object" && !Array.isArray(t)
        );
        if (this.transactions[date].length === 0) delete this.transactions[date];
      });
      // Derived data — an unusable copy is just rebuilt on the next render.
      this.monthlyBalances =
        this._storedMap(data.monthlyBalances, "imported monthlyBalances") || {};
      this.recurringTransactions = (
        this._storedArray(
          data.recurringTransactions, "imported recurringTransactions"
        ) || []
      ).filter((rt) => rt && typeof rt === "object" && !Array.isArray(rt));
      // These three are assigned raw from the parsed file — the only inputs to
      // the balance walk that no form guard ever sees. Repair them before
      // anything walks them (see _repairWalkAmounts).
      this._repairWalkAmounts();
      this.skippedTransactions = this._prunedEntries(
        this._storedMap(data.skippedTransactions, "imported skippedTransactions") || {},
        (list) => Array.isArray(list) && list.length > 0
      );
      const importedList = (value, label) =>
        (this._storedArray(value, label) || []).filter(
          (item) => item && typeof item === "object" && !Array.isArray(item)
        );
      this.debts = importedList(data.debts, "imported debts").map((debt) =>
        this._normalizeDebt(debt)
      );
      this.cashInfusions = importedList(
        data.cashInfusions, "imported cashInfusions"
      ).map((infusion) => this._normalizeCashInfusion(infusion));
      this.savingsGoals = importedList(
        data.savingsGoals, "imported savingsGoals"
      ).map((goal) => this._normalizeSavingsGoal(goal));
      this.debtSnowballSettings = {
        dailyFloor: this._finiteNumber(data.debtSnowballSettings?.dailyFloor),
        extraPaymentStartMonth: this.normalizeExtraStartMonth(
          data.debtSnowballSettings?.extraPaymentStartMonth
        ),
        autoGenerate: data.debtSnowballSettings?.autoGenerate === true,
      };
      this.monthlyNotes =
        this._storedMap(data.monthlyNotes, "imported monthlyNotes") || {};
      this.movedTransactions = this._prunedEntries(
        this._storedMap(data.movedTransactions, "imported movedTransactions") || {},
        (move) => move && typeof move === "object" && !Array.isArray(move)
      );
      this.lastUpdated =
        typeof data.lastUpdated === "string" ? data.lastUpdated : this.lastUpdated;

      // Import deleted items tracking for merge conflict resolution
      // (normalized per-key — a partial object would break tombstone pushes).
      this._deletedItems = this._normalizeDeletedItems(data._deletedItems);

      // Clean up stale movedTransactions entries where fromDate equals toDate
      Object.keys(this.movedTransactions).forEach(key => {
        const move = this.movedTransactions[key];
        if (move.fromDate === move.toDate) {
          delete this.movedTransactions[key];
        }
      });

      // Clean up expanded recurring transactions that will be re-generated
      // Only keep: manual transactions (no recurringId) and modified instances
      Object.keys(this.transactions).forEach((date) => {
        this.transactions[date] = this.transactions[date].filter((t) => {
          // Keep if no recurringId (manual transaction)
          if (!t.recurringId) {
            return true;
          }
          // Keep if it's a modified instance
          if (t.modifiedInstance) {
            return true;
          }
          // Keep if it was moved (has movedFrom property)
          if (t.movedFrom !== undefined) {
            return true;
          }
          // Otherwise, it's an expanded recurring transaction - remove it
          return false;
        });
        // Remove empty date entries
        if (this.transactions[date].length === 0) {
          delete this.transactions[date];
        }
      });

      // Migration: ensure all transactions have IDs and timestamps
      Object.keys(this.transactions).forEach((date) => {
        this.transactions[date].forEach((t) => {
          if (!t.id) {
            t.id = Utils.generateUniqueId();
          }
          if (!t._lastModified) {
            t._lastModified = new Date().toISOString();
          }
        });
      });

      this.recurringTransactions.forEach((rt) => {
        if (!rt.id) {
          rt.id = Utils.generateUniqueId();
        }
        if (!rt._lastModified) {
          rt._lastModified = new Date().toISOString();
        }
        if (rt.recurrence === "biweekly") {
          rt.recurrence = "bi-weekly";
        } else if (rt.recurrence === "semimonthly") {
          rt.recurrence = "semi-monthly";
        } else if (rt.recurrence === "semiannual") {
          rt.recurrence = "semi-annual";
        }
      });

      // Ensure debts have _lastModified
      this.debts.forEach((debt) => {
        if (!debt._lastModified) {
          debt._lastModified = new Date().toISOString();
        }
      });

      // Ensure cashInfusions have _lastModified
      this.cashInfusions.forEach((infusion) => {
        if (!infusion._lastModified) {
          infusion._lastModified = new Date().toISOString();
        }
      });

      const recurringIds = new Set(
        this.recurringTransactions.map((rt) => rt.id)
      );
      this.debts.forEach((debt) => {
        if (debt.minRecurringId && !recurringIds.has(debt.minRecurringId)) {
          debt.minRecurringId = null;
        }
      });
      Object.keys(this.transactions).forEach((date) => {
        this.transactions[date].forEach((t, index) => {
          if (t.isRecurring) {
            const matchingRt = this.recurringTransactions.find(
              (rt) =>
                rt.amount === (t.originalAmount || t.amount) &&
                rt.type === (t.originalType || t.type) &&
                rt.description === (t.originalDescription || t.description) &&
                Utils.parseDateString(rt.startDate) <= Utils.parseDateString(date)
            );

            if (matchingRt) {
              this.transactions[date][index] = {
                amount: t.amount,
                type: t.type,
                description: t.description,
                recurringId: matchingRt.id,
                modifiedInstance: t.modifiedRecurring || false,
                id: t.id || Utils.generateUniqueId(),
                _lastModified: t._lastModified || new Date().toISOString(),
              };
              if (t.skipped) {
                this.setTransactionSkipped(date, matchingRt.id, true, false);
              }
            }
          }
        });
      });

      // A successful import replaces in-memory state with valid data, so any
      // prior load-integrity failure no longer applies — re-enable persistence.
      this._loadFailed = false;
      this.saveData(true);
      return true;
    } catch (error) {
      console.error("Error during import:", error);
      // Restore from backup on failure
      this.transactions = backup.transactions;
      this.monthlyBalances = backup.monthlyBalances;
      this.recurringTransactions = backup.recurringTransactions;
      this.skippedTransactions = backup.skippedTransactions;
      this.movedTransactions = backup.movedTransactions;
      this.debts = backup.debts;
      this.cashInfusions = backup.cashInfusions;
      this.savingsGoals = backup.savingsGoals;
      this.monthlyNotes = backup.monthlyNotes;
      this.debtSnowballSettings = backup.debtSnowballSettings;
      this._deletedItems = backup._deletedItems;
      this.lastUpdated = backup.lastUpdated;
      return false;
    }
  },

});
