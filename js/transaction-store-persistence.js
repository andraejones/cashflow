// TransactionStore — persistence: localStorage load (with migrations and
// PIN decryption), save (with encryption), debounced-save orchestration,
// tombstone pruning, the what-if persistence filter, reset, and whole-DB
// import/export. Prototype companion of TransactionStore (class declared in
// transaction-store.js); no build step — loaded as a plain script after the
// class file and before app.js (see index.html).

Object.assign(TransactionStore.prototype, {

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

      if (storedSavingsGoals) {
        const parsedGoals = JSON.parse(storedSavingsGoals);
        this.savingsGoals = parsedGoals.map((goal) =>
          this._normalizeSavingsGoal(goal)
        );
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
          skips: Array.isArray(parsedDeleted.skips) ? parsedDeleted.skips : [],
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
    const keys = ['transactions', 'recurringTransactions', 'debts', 'cashInfusions', 'savingsGoals'];

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
    this._deletedItems = {
      transactions: [],
      recurringTransactions: [],
      debts: [],
      cashInfusions: [],
      savingsGoals: [],
      skips: []
    };
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
      this.savingsGoals = (data.savingsGoals || []).map((goal) =>
        this._normalizeSavingsGoal(goal)
      );
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
        savingsGoals: Array.isArray(importedDeleted.savingsGoals)
          ? importedDeleted.savingsGoals
          : [],
        skips: Array.isArray(importedDeleted.skips) ? importedDeleted.skips : [],
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
      this.savingsGoals = backup.savingsGoals;
      this.monthlyNotes = backup.monthlyNotes;
      this.debtSnowballSettings = backup.debtSnowballSettings;
      this._deletedItems = backup._deletedItems;
      this.lastUpdated = backup.lastUpdated;
      return false;
    }
  },

});
