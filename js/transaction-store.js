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
    this.debtSnowballSettings = {
      extraPayment: 0,
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
        this._queuedSave = wasModified;
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

  // Alias for flushPendingSave
  flushSave() {
    this.flushPendingSave();
  }

  // Alias for flushPendingSave
  saveImmediately() {
    this.flushPendingSave();
  }

  // Cancel pending save without saving
  cancelPendingSave() {
    if (this._saveDebounceTimer) {
      clearTimeout(this._saveDebounceTimer);
      this._saveDebounceTimer = null;
      this._pendingIsDataModified = false;
    }
  }

  // Getter for debounce delay
  get debounceDelay() {
    return this._saveDebounceDelay;
  }

  // Getter to check if there's a pending save
  get pendingSave() {
    return !!this._saveDebounceTimer;
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
    try {
      const decrypt = (val) => {
        if (
          this.pinProtection &&
          this.pinProtection.getCurrentPin() &&
          val
        ) {
          return this.pinProtection.decrypt(val);
        }
        return val;
      };

      const storedTransactions = decrypt(this.storage.getItem("transactions"));
      const storedMonthlyBalances = decrypt(this.storage.getItem("monthlyBalances"));
      const storedRecurringTransactions = decrypt(
        this.storage.getItem("recurringTransactions")
      );
      const storedSkippedTransactions = decrypt(
        this.storage.getItem("skippedTransactions")
      );
      const storedDebts = decrypt(this.storage.getItem("debts"));
      const storedCashInfusions = decrypt(
        this.storage.getItem("cashInfusions")
      );
      const storedSnowballSettings = decrypt(
        this.storage.getItem("debtSnowballSettings")
      );
      const storedMonthlyNotes = decrypt(
        this.storage.getItem("monthlyNotes")
      );
      const storedMovedTransactions = decrypt(
        this.storage.getItem("movedTransactions")
      );
      const storedDeletedItems = decrypt(
        this.storage.getItem("deletedItems")
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
        });
      }

      if (storedSkippedTransactions) {
        this.skippedTransactions = JSON.parse(storedSkippedTransactions);
      }

      if (storedDebts) {
        const parsedDebts = JSON.parse(storedDebts);
        this.debts = parsedDebts.map((debt) => ({
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
        }));
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
          extraPayment: Number(parsedSettings.extraPayment) || 0,
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
          // Save the cleaned data back to storage
          this.storage.setItem(
            "movedTransactions",
            JSON.stringify(this.movedTransactions)
          );
        }
      }

      // Load deleted items tracking for merge conflict resolution
      if (storedDeletedItems) {
        this._deletedItems = JSON.parse(storedDeletedItems);
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

      // Handle deferred migration save (encrypt() is only defined in saveData())
      if (this._needsMigrationSave) {
        delete this._needsMigrationSave;
        this.saveData(false); // Don't trigger cloud sync for migration
      }
    } catch (error) {
      console.error("Error loading data from storage:", error);
      this.transactions = {};
      this.monthlyBalances = {};
      this.recurringTransactions = [];
      this.skippedTransactions = {};
      this.debts = [];
      this.cashInfusions = [];
      this.debtSnowballSettings = {
        extraPayment: 0,
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
    this.debtSnowballSettings = {
      extraPayment: 0,
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


  getMovedTransactions() {
    return this.movedTransactions;
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

  // Check if a recurring transaction occurrence was moved from a specific date
  getMoveInfoFromDate(recurringId, date) {
    const key = `${recurringId}-${date}`;
    return this.movedTransactions[key] || null;
  }

  // Check if there's a moved transaction TO this date
  getMoveInfoToDate(date) {
    const moves = [];
    Object.values(this.movedTransactions).forEach(move => {
      if (move.toDate === date) {
        moves.push(move);
      }
    });
    return moves;
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

  // Check if a date has any move anomaly (either moved from or moved to)
  hasMoveAnomaly(date) {
    // Check if any transaction was moved FROM this date
    for (const move of Object.values(this.movedTransactions)) {
      if (move.fromDate === date || move.toDate === date) {
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


  setDebtSnowballSettings(settings) {
    if (!settings || typeof settings !== "object") {
      console.error("Invalid settings for debt snowball");
      return false;
    }
    this.debtSnowballSettings = {
      ...this.debtSnowballSettings,
      extraPayment: Number(settings.extraPayment) || 0,
      autoGenerate: settings.autoGenerate === true,
    };
    this.debouncedSave();
    return true;
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
      const existingId = this.transactions[date][index].id;
      this.transactions[date][index] = {
        ...this.transactions[date][index],
        ...updatedTransaction,
        id: existingId || Utils.generateUniqueId(),
        _lastModified: new Date().toISOString(),
      };
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
      this.transactions[dateKey] = this.transactions[dateKey].filter(
        t => !t.recurringId || t.recurringId !== id
      );

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
      this.transactions[date][index].settled = isSettled;
      this.transactions[date][index]._lastModified = new Date().toISOString();
      if (this.transactions[date][index].recurringId) {
        this.transactions[date][index].modifiedInstance = true;
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
        if (t.settled === false && t.type === "expense") {
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
          const dates = recurringDates[t.recurringId] || [];
          // Check if a later occurrence exists on or before today
          const hasLaterOccurrence = dates.some((d) => d > date && d <= todayStr);
          if (hasLaterOccurrence) {
            t.settled = true;
            t.modifiedInstance = true;
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
      _deletedItems: this._deletedItems
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
      this.debts = (data.debts || []).map((debt) => ({
        ...debt,
        id: debt.id || Utils.generateUniqueId(),
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
      }));
      this.cashInfusions = (data.cashInfusions || []).map((infusion) => ({
        ...infusion,
        id: infusion.id || Utils.generateUniqueId(),
        name: typeof infusion.name === "string" ? infusion.name : "",
        amount: Number(infusion.amount) || 0,
        date: typeof infusion.date === "string" ? infusion.date : "",
        targetDebtId: infusion.targetDebtId || null,
      }));
      this.debtSnowballSettings = {
        extraPayment: Number(data.debtSnowballSettings?.extraPayment) || 0,
        autoGenerate: data.debtSnowballSettings?.autoGenerate === true,
      };
      this.monthlyNotes = data.monthlyNotes || {};
      this.movedTransactions = data.movedTransactions || {};

      // Import deleted items tracking for merge conflict resolution
      this._deletedItems = data._deletedItems || {
        transactions: [],
        recurringTransactions: [],
        debts: [],
        cashInfusions: []
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
      return false;
    }
  }
}
