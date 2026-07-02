// Transaction storage

class TransactionStore {

  constructor(storage = localStorage, pinProtection = null) {
    this.storage = storage;
    this.pinProtection = pinProtection;
    this.transactions = {};
    this.monthlyBalances = {};
    this.recurringTransactions = [];
    this.skippedTransactions = {};
    this.movedTransactions = {};
    this.debts = [];
    this.cashInfusions = [];
    this.monthlyNotes = {};
    this.lastUpdated = null;
    this.debtSnowballSettings = {
      dailyFloor: 0,
      extraPaymentStartMonth: "",
      autoGenerate: false,
    };
    // Track deleted item IDs for merge conflict resolution
    this._deletedItems = {
      transactions: [],
      recurringTransactions: [],
      debts: [],
      cashInfusions: []
    };
    this.onSaveCallbacks = [];

    // Debounce settings for batching rapid saves
    this._saveDebounceTimer = null;
    this._saveDebounceDelay = 500; // 500ms debounce delay
    this._pendingIsDataModified = false;
    this._saveInProgress = false;
    this._queuedSave = null;

    this.loadData();
  }

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
  }

  // Force immediate save (useful when app is closing or for critical operations)
  flushPendingSave() {
    if (this._saveDebounceTimer) {
      clearTimeout(this._saveDebounceTimer);
      this._saveDebounceTimer = null;
      const wasModified = this._pendingIsDataModified;
      this._pendingIsDataModified = false;
      this.saveData(wasModified);
    }
  }

  // Cancel pending save without saving
  cancelPendingSave() {
    if (this._saveDebounceTimer) {
      clearTimeout(this._saveDebounceTimer);
      this._saveDebounceTimer = null;
      this._pendingIsDataModified = false;
    }
  }

  _normalizeDebt(debt) {
    return {
      ...debt,
      id: debt.id || Utils.generateUniqueId(),
      _lastModified: debt._lastModified || new Date().toISOString(),
      balance: Math.round((Number(debt.balance) || 0) * 100) / 100,
      minPayment: Math.round((Number(debt.minPayment) || 0) * 100) / 100,
      dueDay: Number(debt.dueDay) || 1,
      dueDayPattern:
        typeof debt.dueDayPattern === "string" ? debt.dueDayPattern : "",
      recurrence:
        typeof debt.recurrence === "string" ? debt.recurrence : "monthly",
      dueStartDate:
        typeof debt.dueStartDate === "string" ? debt.dueStartDate : "",
      businessDayAdjustment:
        typeof debt.businessDayAdjustment === "string"
          ? debt.businessDayAdjustment
          : "none",
      semiMonthlyDays: Array.isArray(debt.semiMonthlyDays)
        ? debt.semiMonthlyDays.map((day) => Number(day) || 1)
        : null,
      semiMonthlyLastDay: debt.semiMonthlyLastDay === true,
      customInterval:
        debt.customInterval && typeof debt.customInterval === "object"
          ? {
            value: Number(debt.customInterval.value) || 1,
            unit:
              debt.customInterval.unit === "weeks" ||
                debt.customInterval.unit === "months"
                ? debt.customInterval.unit
                : "days",
          }
          : null,
      variableAmount: debt.variableAmount === true,
      variableType:
        debt.variableType === "percentage" ? "percentage" : "fixed",
      variablePercentage: Number(debt.variablePercentage) || 0,
      endDate: typeof debt.endDate === "string" ? debt.endDate : "",
      maxOccurrences: Number(debt.maxOccurrences) || null,
      interestRate: Number(debt.interestRate) || 0,
    };
  }

  registerSaveCallback(callback) {
    if (typeof callback === 'function') {
      this.onSaveCallbacks.push(callback);
    }
  }


  triggerSaveCallbacks(isDataModified = false) {
    this.onSaveCallbacks.forEach(callback => {
      try {
        callback(isDataModified);
      } catch (error) {
        console.error("Error in save callback:", error);
      }
    });
  }


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
        this.transactions = JSON.parse(storedTransactions);
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
        this.monthlyBalances = JSON.parse(storedMonthlyBalances);
      }

      if (storedRecurringTransactions) {
        this.recurringTransactions = JSON.parse(storedRecurringTransactions);
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

      if (storedSkippedTransactions) {
        this.skippedTransactions = JSON.parse(storedSkippedTransactions);
      }

      if (storedDebts) {
        const parsedDebts = JSON.parse(storedDebts);
        this.debts = parsedDebts.map((debt) => this._normalizeDebt(debt));
      }

      if (storedCashInfusions) {
        const parsedInfusions = JSON.parse(storedCashInfusions);
        this.cashInfusions = parsedInfusions.map((infusion) => ({
          ...infusion,
          id: infusion.id || Utils.generateUniqueId(),
          _lastModified: infusion._lastModified || new Date().toISOString(),
          name: typeof infusion.name === "string" ? infusion.name : "",
          amount: Number(infusion.amount) || 0,
          date: typeof infusion.date === "string" ? infusion.date : "",
          targetDebtId: infusion.targetDebtId || null,
        }));
      }

      if (storedSnowballSettings) {
        const parsedSettings = JSON.parse(storedSnowballSettings);
        this.debtSnowballSettings = {
          dailyFloor: Number(parsedSettings.dailyFloor) || 0,
          extraPaymentStartMonth: this.normalizeExtraStartMonth(
            parsedSettings.extraPaymentStartMonth
          ),
          autoGenerate: parsedSettings.autoGenerate === true,
        };
      }

      if (storedMonthlyNotes) {
        this.monthlyNotes = JSON.parse(storedMonthlyNotes);
      }

      if (storedMovedTransactions) {
        this.movedTransactions = JSON.parse(storedMovedTransactions);

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
      // the shape — a legacy/partial object missing any of the four keys would
      // make every later tombstone push throw.
      if (storedDeletedItems) {
        const parsedDeleted = JSON.parse(storedDeletedItems);
        this._deletedItems = {
          transactions: Array.isArray(parsedDeleted.transactions)
            ? parsedDeleted.transactions
            : [],
          recurringTransactions: Array.isArray(parsedDeleted.recurringTransactions)
            ? parsedDeleted.recurringTransactions
            : [],
          debts: Array.isArray(parsedDeleted.debts) ? parsedDeleted.debts : [],
          cashInfusions: Array.isArray(parsedDeleted.cashInfusions)
            ? parsedDeleted.cashInfusions
            : [],
        };
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
      this.lastUpdated = null;
      this.debtSnowballSettings = {
        dailyFloor: 0,
        extraPaymentStartMonth: "",
        autoGenerate: false,
      };
    }
  }


  /**
   * Prune deleted items older than 30 days to prevent unbounded growth.
   * Supports both old format (just ID string) and new format (object with deletedAt).
   */
  _pruneDeletedItems() {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const keys = ['transactions', 'recurringTransactions', 'debts', 'cashInfusions'];

    keys.forEach(key => {
      if (Array.isArray(this._deletedItems[key])) {
        this._deletedItems[key] = this._deletedItems[key].filter(item => {
          // New format: object with id and deletedAt
          if (typeof item === 'object' && item.deletedAt) {
            return item.deletedAt > thirtyDaysAgo;
          }
          // Old format: just keep (will be replaced on next delete)
          return true;
        });
      }
    });
  }


  _filterPersistedTransactions(transactions) {
    const filtered = {};
    for (const date in transactions) {
      const kept = transactions[date].filter(t =>
        !t.recurringId || t.modifiedInstance || t.movedFrom !== undefined
      );
      if (kept.length > 0) {
        filtered[date] = kept;
      }
    }
    return filtered;
  }


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

    // Cancel any pending debounced save since we're saving now
    if (this._saveDebounceTimer) {
      clearTimeout(this._saveDebounceTimer);
      this._saveDebounceTimer = null;
      this._pendingIsDataModified = false;
    }

    // Mark save as in progress
    this._saveInProgress = true;

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
      this.triggerSaveCallbacks(isDataModified);
    } catch (error) {
      console.error("Error saving data to storage:", error);
    } finally {
      this._saveInProgress = false;

      // Process queued save if any
      if (this._queuedSave !== null) {
        const queuedModified = this._queuedSave;
        this._queuedSave = null;
        this.saveData(queuedModified);
      }
    }
  }


  resetData() {
    this.transactions = {};
    this.monthlyBalances = {};
    this.recurringTransactions = [];
    this.skippedTransactions = {};
    this.debts = [];
    this.cashInfusions = [];
    this.monthlyNotes = {};
    this.movedTransactions = {};
    this.lastUpdated = null;
    this.debtSnowballSettings = {
      dailyFloor: 0,
      extraPaymentStartMonth: "",
      autoGenerate: false,
    };
    this._deletedItems = {
      transactions: [],
      recurringTransactions: [],
      debts: [],
      cashInfusions: []
    };
    this.saveData();
    return true;
  }


  getTransactions() {
    return this.transactions;
  }


  getMonthlyBalances() {
    return this.monthlyBalances;
  }


  getRecurringTransactions() {
    return this.recurringTransactions;
  }


  getSkippedTransactions() {
    return this.skippedTransactions;
  }


  getDebts() {
    return this.debts;
  }


  getDebtSnowballSettings() {
    return this.debtSnowballSettings;
  }


  getCashInfusions() {
    return this.cashInfusions;
  }


  addCashInfusion(infusion) {
    if (!infusion) {
      console.error("Invalid cash infusion data");
      return null;
    }
    if (!infusion.id) {
      infusion.id = Utils.generateUniqueId();
    }
    infusion._lastModified = new Date().toISOString();
    this.cashInfusions.push(infusion);
    this.debouncedSave();
    return infusion.id;
  }


  updateCashInfusion(id, updates) {
    if (!id || !updates) {
      console.error("Invalid parameters for updateCashInfusion");
      return false;
    }
    const index = this.cashInfusions.findIndex((inf) => inf.id === id);
    if (index === -1) {
      return false;
    }
    this.cashInfusions[index] = {
      ...this.cashInfusions[index],
      ...updates,
      _lastModified: new Date().toISOString(),
    };
    this.debouncedSave();
    return true;
  }


  deleteCashInfusion(id) {
    if (!id) {
      console.error("Invalid ID for deleteCashInfusion");
      return false;
    }
    const index = this.cashInfusions.findIndex((inf) => inf.id === id);
    if (index === -1) {
      return false;
    }
    // Track deleted ID for merge conflict resolution (with timestamp for pruning)
    this._deletedItems.cashInfusions.push({ id, deletedAt: Date.now() });
    this.cashInfusions.splice(index, 1);
    this.debouncedSave();
    return true;
  }


  getMonthlyNotes(monthKey) {
    const note = this.monthlyNotes[monthKey];
    if (!note) return "";
    // Handle both old format (string) and new format (object with text)
    return typeof note === "string" ? note : (note.text || "");
  }

  setMonthlyNotes(monthKey, notes) {
    if (!monthKey) {
      console.error("Invalid monthKey for setMonthlyNotes");
      return false;
    }
    if (notes && notes.trim()) {
      this.monthlyNotes[monthKey] = {
        text: notes.trim(),
        _lastModified: new Date().toISOString(),
      };
    } else {
      // Remove empty notes
      delete this.monthlyNotes[monthKey];
    }
    this.debouncedSave();
    return true;
  }

  hasMonthlyNotes(monthKey) {
    const note = this.monthlyNotes[monthKey];
    if (!note) return false;
    // Handle both old format (string) and new format (object with text)
    const text = typeof note === "string" ? note : (note.text || "");
    return !!(text && text.trim());
  }


  // Move a transaction from one date to another
  // For recurring transactions, this creates an exception for that specific occurrence
  moveTransaction(recurringId, fromDate, toDate) {
    if (!recurringId || !fromDate || !toDate) {
      console.error("Invalid parameters for moveTransaction");
      return false;
    }

    const key = `${recurringId}-${fromDate}`;
    this.movedTransactions[key] = {
      recurringId,
      fromDate,
      toDate,
      movedAt: new Date().toISOString()
    };

    this.debouncedSave();
    return true;
  }

  // Cancel a move (restore transaction to original date)
  cancelMoveTransaction(recurringId, fromDate) {
    const key = `${recurringId}-${fromDate}`;
    if (this.movedTransactions[key]) {
      delete this.movedTransactions[key];
      this.debouncedSave();
      return true;
    }
    return false;
  }

  // Return the move record for a recurring occurrence relocated FROM this date,
  // or null. Lets the UI distinguish a payment that was authorized on its
  // scheduled date but settled later (moved) from a genuinely skipped one.
  getMoveForRecurring(recurringId, fromDate) {
    if (!recurringId || !fromDate) {
      return null;
    }
    return this.movedTransactions[`${recurringId}-${fromDate}`] || null;
  }

  // Check if a date has any move anomaly (either moved from or moved to)
  hasMoveAnomaly(date) {
    // Check if any transaction was moved FROM this date
    for (const move of Object.values(this.movedTransactions)) {
      if (move.fromDate === date || move.toDate === date) {
        // A forward move is an "authorized then cleared later" payment
        // (see getMoveForRecurring / the "(Authorized)" label) — expected
        // behavior, not an anomaly worth flagging with a star.
        if (move.toDate > move.fromDate) {
          continue;
        }
        return true;
      }
    }
    return false;
  }


  addDebt(debt) {
    if (!debt) {
      console.error("Invalid debt data");
      return null;
    }
    if (!debt.id) {
      debt.id = Utils.generateUniqueId();
    }
    debt._lastModified = new Date().toISOString();
    this.debts.push(debt);
    this.debouncedSave();
    return debt.id;
  }


  updateDebt(id, updates) {
    if (!id || !updates) {
      console.error("Invalid parameters for updateDebt");
      return false;
    }
    const index = this.debts.findIndex((debt) => debt.id === id);
    if (index === -1) {
      return false;
    }
    this.debts[index] = {
      ...this.debts[index],
      ...updates,
      _lastModified: new Date().toISOString(),
    };
    this.debouncedSave();
    return true;
  }


  deleteDebt(id) {
    if (!id) {
      console.error("Invalid ID for deleteDebt");
      return false;
    }
    const index = this.debts.findIndex((debt) => debt.id === id);
    if (index === -1) {
      return false;
    }
    // Track deleted ID for merge conflict resolution (with timestamp for pruning)
    this._deletedItems.debts.push({ id, deletedAt: Date.now() });
    this.debts.splice(index, 1);
    this.debouncedSave();
    return true;
  }


  // Normalize an extra-payment start month to a "YYYY-MM" string or "" (none).
  normalizeExtraStartMonth(value) {
    return typeof value === "string" && /^\d{4}-\d{2}$/.test(value)
      ? value
      : "";
  }

  setDebtSnowballSettings(settings) {
    if (!settings || typeof settings !== "object") {
      console.error("Invalid settings for debt snowball");
      return false;
    }
    this.debtSnowballSettings = {
      ...this.debtSnowballSettings,
      dailyFloor: Number(settings.dailyFloor) || 0,
      extraPaymentStartMonth: this.normalizeExtraStartMonth(
        settings.extraPaymentStartMonth
      ),
      autoGenerate: settings.autoGenerate === true,
    };
    this.debouncedSave();
    return true;
  }


  _roundCents(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  _todayString() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  // Allocations are `allocated:true` expenses that act as set-aside "buckets".
  // Each allocation's `amount` IS its remaining balance, so spending against it
  // simply shrinks that amount. Returns the buckets a regular expense can draw
  // from, soonest first. A bucket can't be drawn against before its own date, so
  // only allocations dated on/before `referenceDate` are offered. Two flavors:
  //   - One-time allocations: a plain `allocated:true` expense, listed as-is.
  //   - Recurring allocations: each period's instance is its own bucket; the
  //     latest instance per series dated on/before `referenceDate` is offered,
  //     so the dropdown shows the bucket active for the transaction being
  //     entered rather than every future month. `referenceDate` defaults to
  //     today; pass the transaction's own date to bill against that period.
  getAllocations(referenceDate) {
    const oneTime = [];
    const recurringBySeries = new Map();
    const refStr = referenceDate || this._todayString();
    Object.keys(this.transactions).forEach((date) => {
      this.transactions[date].forEach((t) => {
        if (t.allocated !== true || t.type !== "expense" || t.hidden === true) {
          return;
        }
        const description =
          typeof t.description === "string" && t.description
            ? t.description
            : "(no description)";
        if (!t.recurringId) {
          if (!t.id) return;
          // Can't draw against a bucket before its own date.
          if (date > refStr) return;
          // An auto-close-out bucket is only drawable through its close-out
          // date (its own date for legacy entries) — don't offer it to an
          // expense dated after the bucket will have been forfeited.
          if (t.autoCloseout === true && (t.closeoutDate || date) < refStr) {
            return;
          }
          oneTime.push({
            id: t.id,
            date,
            description,
            remaining: this._roundCents(t.amount),
            recurring: false,
          });
          return;
        }
        // Recurring allocation instance — only the bucket active for the
        // reference date is drawable, and (like all allocations) it can't be
        // drawn before its own date. So for both flavors the active instance is
        // the latest one dated on/before refStr.
        if (date > refStr) return;
        const existing = recurringBySeries.get(t.recurringId);
        const candidate = {
          // Un-materialized instances have no id yet — use a synthetic key the
          // draw resolver can locate; the first draw assigns it a real id.
          id: t.id || `ralloc:${t.recurringId}:${date}`,
          date,
          description,
          remaining: this._roundCents(t.amount),
          recurring: true,
        };
        if (!existing || date > existing.date) {
          recurringBySeries.set(t.recurringId, candidate);
        }
      });
    });
    const result = oneTime.concat(Array.from(recurringBySeries.values()));
    result.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return result;
  }

  // Resolves a transaction's `drawsFromAllocationId` to the allocation it draws
  // from, returning its `{ description, date }` for display. Handles both real
  // ids (one-time / materialized recurring) and the synthetic
  // "ralloc:<recurringId>:<date>" key. Returns null if the bucket is gone.
  getAllocationInfoById(id) {
    if (!id) return null;
    let recurringId = null;
    let targetDate = null;
    if (typeof id === "string" && id.startsWith("ralloc:")) {
      const rest = id.slice("ralloc:".length);
      const sep = rest.lastIndexOf(":");
      if (sep === -1) return null;
      recurringId = rest.slice(0, sep);
      targetDate = rest.slice(sep + 1);
    }
    const dates = targetDate ? [targetDate] : Object.keys(this.transactions);
    for (let d = 0; d < dates.length; d++) {
      const date = dates[d];
      const arr = this.transactions[date];
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const t = arr[i];
        if (t.allocated !== true || t.type !== "expense") continue;
        const match = recurringId ? t.recurringId === recurringId : t.id === id;
        if (match) {
          return {
            description:
              typeof t.description === "string" && t.description
                ? t.description
                : "(no description)",
            date,
          };
        }
      }
    }
    return null;
  }

  _findAllocationById(id) {
    if (!id) return null;
    // Synthetic key for an un-materialized recurring allocation instance:
    // "ralloc:<recurringId>:<date>". The date never contains a colon, so the
    // last colon separates the recurringId from the date.
    if (typeof id === "string" && id.startsWith("ralloc:")) {
      const rest = id.slice("ralloc:".length);
      const sep = rest.lastIndexOf(":");
      if (sep === -1) return null;
      const recurringId = rest.slice(0, sep);
      const date = rest.slice(sep + 1);
      const arr = this.transactions[date];
      if (!arr) return null;
      for (let i = 0; i < arr.length; i++) {
        const t = arr[i];
        if (
          t.recurringId === recurringId &&
          t.allocated === true &&
          t.type === "expense"
        ) {
          return t;
        }
      }
      return null;
    }
    const dates = Object.keys(this.transactions);
    for (let d = 0; d < dates.length; d++) {
      const arr = this.transactions[dates[d]];
      for (let i = 0; i < arr.length; i++) {
        const t = arr[i];
        // Matches one-time allocations and materialized recurring instances.
        if (t.id === id && t.allocated === true && t.type === "expense") {
          return t;
        }
      }
    }
    return null;
  }

  // Debit the linked allocation by as much of the expense as it can cover.
  // Overflow (spend > remaining) drains the allocation to 0 and leaves the
  // excess as normal spending. Stores drawAmount for exact reversal later.
  _applyAllocationDraw(transaction) {
    if (
      !transaction ||
      transaction.type !== "expense" ||
      !transaction.drawsFromAllocationId
    ) {
      return;
    }
    const allocation = this._findAllocationById(
      transaction.drawsFromAllocationId
    );
    if (!allocation) {
      // Allocation no longer exists — drop the dangling link.
      delete transaction.drawsFromAllocationId;
      delete transaction.drawAmount;
      return;
    }
    // Drawing from a recurring allocation instance: freeze that one instance as
    // a persisted modified instance (with a stable id) so the debit survives
    // re-expansion, and rewrite the link from the synthetic key to the real id.
    if (allocation.recurringId) {
      if (!allocation.id) {
        allocation.id = Utils.generateUniqueId();
      }
      allocation.modifiedInstance = true;
      transaction.drawsFromAllocationId = allocation.id;
    }
    const remaining = Math.max(0, this._roundCents(allocation.amount));
    const draw = this._roundCents(
      Math.min(remaining, Math.max(0, Number(transaction.amount) || 0))
    );
    transaction.drawAmount = draw;
    allocation.amount = this._roundCents(allocation.amount - draw);
    allocation._lastModified = new Date().toISOString();
  }

  // Refund a previously-applied draw back to its allocation.
  _reverseAllocationDraw(transaction) {
    if (
      !transaction ||
      !transaction.drawsFromAllocationId ||
      !transaction.drawAmount
    ) {
      return;
    }
    const allocation = this._findAllocationById(
      transaction.drawsFromAllocationId
    );
    if (allocation) {
      allocation.amount = this._roundCents(
        allocation.amount + transaction.drawAmount
      );
      allocation._lastModified = new Date().toISOString();
    }
  }

  addTransaction(date, transaction) {
    if (!date || !transaction) {
      console.error("Invalid date or transaction data");
      return null;
    }

    if (!this.transactions[date]) {
      this.transactions[date] = [];
    }

    // Assign ID and timestamp if not present
    if (!transaction.id) {
      transaction.id = Utils.generateUniqueId();
    }
    transaction._lastModified = new Date().toISOString();

    // If this expense draws from an allocation, debit that allocation now and
    // record how much was actually drawn (so the draw can be reversed exactly
    // when the expense is later edited, moved, or deleted).
    if (transaction.drawsFromAllocationId) {
      this._applyAllocationDraw(transaction);
    }

    this.transactions[date].push(transaction);
    this.debouncedSave();
    return transaction.id;
  }


  updateTransaction(date, index, updatedTransaction) {
    if (!date || index === undefined || !updatedTransaction) {
      console.error("Invalid parameters for updateTransaction");
      return false;
    }

    if (this.transactions[date] && this.transactions[date][index]) {
      // Preserve existing ID, update timestamp
      const existing = this.transactions[date][index];
      const existingId = existing.id;
      const merged = {
        ...existing,
        ...updatedTransaction,
        id: existingId || Utils.generateUniqueId(),
        _lastModified: new Date().toISOString(),
      };

      // Reconcile any allocation draw: refund the old draw, then re-debit based
      // on the merged amount/target. Covers amount edits (re-draws the new
      // amount) and type changes away from expense (drops the link entirely).
      this._reverseAllocationDraw(existing);
      if (merged.type === "expense" && merged.drawsFromAllocationId) {
        delete merged.drawAmount;
        this._applyAllocationDraw(merged);
      } else {
        delete merged.drawsFromAllocationId;
        delete merged.drawAmount;
      }

      this.transactions[date][index] = merged;
      this.debouncedSave();
      return true;
    }
    return false;
  }


  deleteTransaction(date, index) {
    if (!date || index === undefined) {
      console.error("Invalid parameters for deleteTransaction");
      return false;
    }

    if (this.transactions[date] && this.transactions[date][index]) {
      // Track deleted ID for merge conflict resolution
      const deletedTxn = this.transactions[date][index];
      if (deletedTxn.id) {
        // Track deleted ID for merge conflict resolution (with timestamp for pruning)
        this._deletedItems.transactions.push({ id: deletedTxn.id, deletedAt: Date.now() });
      }

      // Refund any allocation this expense was drawing from before removing it.
      this._reverseAllocationDraw(deletedTxn);

      this.transactions[date].splice(index, 1);

      if (this.transactions[date].length === 0) {
        delete this.transactions[date];
      }

      this.debouncedSave();
      return true;
    }
    return false;
  }


  addRecurringTransaction(recurringTransaction) {
    if (!recurringTransaction) {
      console.error("Invalid recurring transaction data");
      return null;
    }
    if (!recurringTransaction.id) {
      recurringTransaction.id = Utils.generateUniqueId();
    }
    recurringTransaction._lastModified = new Date().toISOString();

    this.recurringTransactions.push(recurringTransaction);
    this.debouncedSave();

    return recurringTransaction.id;
  }


  updateRecurringTransaction(id, updates) {
    if (!id || !updates) {
      console.error("Invalid parameters for updateRecurringTransaction");
      return false;
    }

    const index = this.recurringTransactions.findIndex((rt) => rt.id === id);

    if (index !== -1) {
      this.recurringTransactions[index] = {
        ...this.recurringTransactions[index],
        ...updates,
        _lastModified: new Date().toISOString(),
      };
      this.debouncedSave();
      return true;
    }

    return false;
  }


  // Record a transaction id as deleted so cloud merges don't resurrect the
  // remote copy (see CloudSync._mergeById). No-op for id-less expansions,
  // which are never persisted or synced.
  trackDeletedTransaction(id) {
    if (!id) return;
    this._deletedItems.transactions.push({ id, deletedAt: Date.now() });
  }


  deleteRecurringTransaction(id) {
    if (!id) {
      console.error("Invalid ID for deleteRecurringTransaction");
      return false;
    }

    const index = this.recurringTransactions.findIndex(rt => rt.id === id);

    if (index === -1) {
      return false;
    }

    // Track deleted ID for merge conflict resolution (with timestamp for pruning)
    this._deletedItems.recurringTransactions.push({ id, deletedAt: Date.now() });

    this.recurringTransactions.splice(index, 1);
    for (const dateKey in this.transactions) {
      this.transactions[dateKey] = this.transactions[dateKey].filter((t) => {
        if (!t.recurringId || t.recurringId !== id) {
          return true;
        }
        // Persisted instances of the series (modified/settled hand-edits)
        // carry ids and exist in the synced copy — tombstone them, or the
        // next sync-merge resurrects them as ghost rows for a series that no
        // longer exists (nothing re-expands or cleans non-debt orphans).
        this.trackDeletedTransaction(t.id);
        return false;
      });

      if (this.transactions[dateKey].length === 0) {
        delete this.transactions[dateKey];
      }
    }
    for (const dateKey in this.skippedTransactions) {
      const skipIndex = this.skippedTransactions[dateKey].indexOf(id);
      if (skipIndex > -1) {
        this.skippedTransactions[dateKey].splice(skipIndex, 1);

        if (this.skippedTransactions[dateKey].length === 0) {
          delete this.skippedTransactions[dateKey];
        }
      }
    }
    // Clean up movedTransactions for this recurring ID
    for (const dateKey in this.movedTransactions) {
      if (this.movedTransactions[dateKey] &&
          this.movedTransactions[dateKey].recurringId === id) {
        delete this.movedTransactions[dateKey];
      }
    }

    this.debouncedSave();
    return true;
  }


  setTransactionSkipped(date, recurringId, isSkipped, isDataModified = true) {
    if (!date || !recurringId) {
      console.error("Invalid parameters for setTransactionSkipped");
      return false;
    }

    try {
      if (isSkipped) {
        if (!this.skippedTransactions[date]) {
          this.skippedTransactions[date] = [];
        }

        if (!this.skippedTransactions[date].includes(recurringId)) {
          this.skippedTransactions[date].push(recurringId);
        }
      } else {
        if (this.skippedTransactions[date]) {
          const index = this.skippedTransactions[date].indexOf(recurringId);

          if (index > -1) {
            this.skippedTransactions[date].splice(index, 1);

            if (this.skippedTransactions[date].length === 0) {
              delete this.skippedTransactions[date];
            }
          }
        }
      }

      this.debouncedSave(isDataModified);
      return true;
    } catch (error) {
      console.error("Error in setTransactionSkipped:", error);
      return false;
    }
  }


  isTransactionSkipped(date, recurringId) {
    if (!date || !recurringId) {
      return false;
    }

    return (
      this.skippedTransactions[date] &&
      this.skippedTransactions[date].includes(recurringId)
    );
  }


  setTransactionSettled(date, index, isSettled) {
    if (!date || index === undefined) {
      console.error("Invalid parameters for setTransactionSettled");
      return false;
    }

    if (this.transactions[date] && this.transactions[date][index]) {
      const target = this.transactions[date][index];
      target.settled = isSettled;
      target._lastModified = new Date().toISOString();
      if (target.recurringId) {
        target.modifiedInstance = true;
      }
      // A persisted transaction (one-time, or a now-modified recurring
      // instance) must carry a stable id, or the cloud merge (_mergeById)
      // silently drops it and the settle/unsettle change is lost on sync.
      if (!target.id) {
        target.id = Utils.generateUniqueId();
      }
      this.debouncedSave();
      return true;
    }
    return false;
  }


  getUnsettledTransactions() {
    const results = [];
    Object.keys(this.transactions).forEach((date) => {
      this.transactions[date].forEach((t, index) => {
        if (t.settled === false && t.type === "expense" && t.hidden !== true) {
          if (t.recurringId) {
            const skippedIds = this.skippedTransactions[date];
            if (skippedIds && skippedIds.includes(t.recurringId)) {
              return;
            }
          }
          results.push({ date, index, transaction: t });
        }
      });
    });
    return results;
  }


  autoSettleExpiredRecurring() {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // Build map of recurringId → sorted list of dates where it appears
    const recurringDates = {};
    Object.keys(this.transactions).forEach((date) => {
      this.transactions[date].forEach((t) => {
        if (t.recurringId && t.type === "expense") {
          const skippedIds = this.skippedTransactions[date];
          if (skippedIds && skippedIds.includes(t.recurringId)) {
            return;
          }
          if (!recurringDates[t.recurringId]) {
            recurringDates[t.recurringId] = [];
          }
          recurringDates[t.recurringId].push(date);
        }
      });
    });

    // Sort each recurring ID's dates
    Object.keys(recurringDates).forEach((id) => {
      recurringDates[id].sort();
    });

    let changed = false;
    Object.keys(this.transactions).forEach((date) => {
      this.transactions[date].forEach((t) => {
        if (t.settled === false && t.recurringId && t.type === "expense") {
          const skippedIds = this.skippedTransactions[date];
          if (skippedIds && skippedIds.includes(t.recurringId)) return;
          const dates = recurringDates[t.recurringId] || [];
          // Check if a later occurrence exists on or before today
          const hasLaterOccurrence = dates.some((d) => d > date && d <= todayStr);
          if (hasLaterOccurrence) {
            t.settled = true;
            t.modifiedInstance = true;
            // Promoting an expansion to a persisted modified instance: it
            // needs a stable id so the cloud merge keeps it (see
            // setTransactionSettled / _mergeById).
            if (!t.id) {
              t.id = Utils.generateUniqueId();
            }
            t._lastModified = new Date().toISOString();
            changed = true;
          }
        }
      });
    });

    if (changed) {
      this.debouncedSave();
    }
  }


  // Locate a transaction by id across all dates. Allocations roll forward day
  // by day, so callers that hold only an id (e.g. the Close Out button) must
  // resolve the current date/index rather than assume a fixed one.
  findTransactionById(id) {
    if (!id) return null;
    const dates = Object.keys(this.transactions);
    for (let d = 0; d < dates.length; d++) {
      const arr = this.transactions[dates[d]];
      const idx = arr.findIndex((x) => x.id === id);
      if (idx !== -1) {
        return { date: dates[d], index: idx, transaction: arr[idx] };
      }
    }
    return null;
  }


  // Allocations are rolling reserved cushions: once an allocation's date falls
  // behind the current day and it still holds a balance, it moves up to today
  // so it tracks the current day (rather than sitting a day ahead). Future-dated
  // allocations wait until time catches up; allocations already dated today and
  // fully-drawn ($0) allocations stay put (the user clears $0 ones with Close
  // Out). The id is preserved so any expenses drawing from the allocation stay
  // linked.
  rollForwardAllocations() {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const moves = [];
    Object.keys(this.transactions).forEach((date) => {
      if (date >= todayStr) return;
      this.transactions[date].forEach((t) => {
        if (
          t.allocated === true &&
          t.type === "expense" &&
          !t.recurringId &&
          t.autoCloseout !== true &&
          this._roundCents(t.amount) > 0
        ) {
          // Auto-close-out allocations are pinned to their date (use-it-or-
          // lose-it by that deadline), so they never roll forward.
          moves.push({ fromDate: date, id: t.id, transaction: t });
        }
      });
    });

    if (moves.length === 0) {
      return false;
    }

    moves.forEach(({ fromDate, id, transaction }) => {
      const arr = this.transactions[fromDate];
      if (!arr) return;
      const idx = id
        ? arr.findIndex((x) => x.id === id)
        : arr.indexOf(transaction);
      if (idx === -1) return;
      arr.splice(idx, 1);
      if (arr.length === 0) {
        delete this.transactions[fromDate];
      }
      transaction._lastModified = new Date().toISOString();
      if (!this.transactions[todayStr]) {
        this.transactions[todayStr] = [];
      }
      this.transactions[todayStr].push(transaction);
    });

    this.debouncedSave();
    return true;
  }

  // Forfeit allocations that have closed out. Two flavors:
  //   - Auto close-out: a pinned use-it-or-lose-it bucket closes once its own
  //     date has fully passed.
  //   - Rolling recurring (allocated, no auto close-out): each period's bucket
  //     stays live until the next same-series instance lands; once a newer
  //     instance is live (dated on/before today), the older one is forfeited.
  // Forfeiting deletes the bucket, releasing any unspent remainder back to the
  // running balance (draws already recorded against it stay as real expenses).
  // Covers one-time allocations and materialized recurring instances; the
  // expansion engine won't re-create a superseded period, so the two together
  // keep closed buckets from lingering or reappearing.
  closeOutExpiredAllocations() {
    const todayStr = this._todayString();
    let changed = false;

    // Per rolling series, the live bucket is the latest instance dated on/before
    // today. Earlier instances of that series are superseded.
    const liveRollingDate = new Map();
    Object.keys(this.transactions).forEach((date) => {
      if (date > todayStr) return;
      this.transactions[date].forEach((t) => {
        if (
          t.allocated === true &&
          t.autoCloseout !== true &&
          t.recurringId &&
          t.type === "expense"
        ) {
          const cur = liveRollingDate.get(t.recurringId);
          if (!cur || date > cur) {
            liveRollingDate.set(t.recurringId, date);
          }
        }
      });
    });

    Object.keys(this.transactions).forEach((date) => {
      const arr = this.transactions[date];
      for (let i = arr.length - 1; i >= 0; i--) {
        const t = arr[i];
        if (t.type !== "expense" || t.allocated !== true) continue;

        let forfeit = false;
        if (t.autoCloseout === true) {
          // The bucket lives through its close-out date — drawable on that
          // day, forfeited the day after. Legacy entries (and recurring
          // instances, which never carry closeoutDate) fall back to the
          // bucket's own date, preserving the original behavior.
          forfeit = (t.closeoutDate || date) < todayStr;
        } else if (t.recurringId) {
          const live = liveRollingDate.get(t.recurringId);
          forfeit = !!live && date < live;
        }
        if (!forfeit) continue;

        if (t.id) {
          this._deletedItems.transactions.push({
            id: t.id,
            deletedAt: Date.now(),
          });
        }
        arr.splice(i, 1);
        changed = true;
      }
      if (arr.length === 0) {
        delete this.transactions[date];
      }
    });
    if (changed) {
      this.debouncedSave();
    }
    return changed;
  }


  exportData() {
    return {
      transactions: this._filterPersistedTransactions(this.transactions),
      monthlyBalances: this.monthlyBalances,
      recurringTransactions: this.recurringTransactions,
      skippedTransactions: this.skippedTransactions,
      movedTransactions: this.movedTransactions,
      debts: this.debts,
      cashInfusions: this.cashInfusions,
      monthlyNotes: this.monthlyNotes,
      debtSnowballSettings: this.debtSnowballSettings,
      _deletedItems: this._deletedItems,
      lastUpdated: this.lastUpdated,
      lastExported: new Date().toISOString(),
      appVersion: "2.0.0"
    };
  }


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
      monthlyNotes: this.monthlyNotes,
      debtSnowballSettings: this.debtSnowballSettings,
      _deletedItems: this._deletedItems,
      lastUpdated: this.lastUpdated
    };

    try {
      // Validate data structure before any assignment
      if (typeof data.transactions !== 'object') {
        throw new Error("Invalid transactions format");
      }
      if (typeof data.monthlyBalances !== 'object') {
        throw new Error("Invalid monthlyBalances format");
      }
      if (!Array.isArray(data.recurringTransactions)) {
        throw new Error("Invalid recurringTransactions format");
      }

      this.transactions = data.transactions;
      this.monthlyBalances = data.monthlyBalances;
      this.recurringTransactions = data.recurringTransactions;
      this.skippedTransactions = data.skippedTransactions || {};
      this.debts = (data.debts || []).map((debt) => this._normalizeDebt(debt));
      this.cashInfusions = (data.cashInfusions || []).map((infusion) => ({
        ...infusion,
        id: infusion.id || Utils.generateUniqueId(),
        name: typeof infusion.name === "string" ? infusion.name : "",
        amount: Number(infusion.amount) || 0,
        date: typeof infusion.date === "string" ? infusion.date : "",
        targetDebtId: infusion.targetDebtId || null,
      }));
      this.debtSnowballSettings = {
        dailyFloor: Number(data.debtSnowballSettings?.dailyFloor) || 0,
        extraPaymentStartMonth: this.normalizeExtraStartMonth(
          data.debtSnowballSettings?.extraPaymentStartMonth
        ),
        autoGenerate: data.debtSnowballSettings?.autoGenerate === true,
      };
      this.monthlyNotes = data.monthlyNotes || {};
      this.movedTransactions = data.movedTransactions || {};
      this.lastUpdated =
        typeof data.lastUpdated === "string" ? data.lastUpdated : this.lastUpdated;

      // Import deleted items tracking for merge conflict resolution
      // (normalized per-key — a partial object would break tombstone pushes).
      const importedDeleted = data._deletedItems || {};
      this._deletedItems = {
        transactions: Array.isArray(importedDeleted.transactions)
          ? importedDeleted.transactions
          : [],
        recurringTransactions: Array.isArray(importedDeleted.recurringTransactions)
          ? importedDeleted.recurringTransactions
          : [],
        debts: Array.isArray(importedDeleted.debts) ? importedDeleted.debts : [],
        cashInfusions: Array.isArray(importedDeleted.cashInfusions)
          ? importedDeleted.cashInfusions
          : [],
      };

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
      this.monthlyNotes = backup.monthlyNotes;
      this.debtSnowballSettings = backup.debtSnowballSettings;
      this._deletedItems = backup._deletedItems;
      this.lastUpdated = backup.lastUpdated;
      return false;
    }
  }
}
