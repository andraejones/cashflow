// TransactionStore — domain collections: debts + snowball settings, cash
// infusions, savings goals, monthly notes, moved-transaction tracking, and
// what-if drafts. Each delete pushes a tombstone into _deletedItems so cloud
// merges don't resurrect removed entries (see [[deletion-tombstones]]).
// Prototype companion of TransactionStore (class declared in
// transaction-store.js); no build step — loaded as a plain script after the
// class file and before app.js (see index.html).

Object.assign(TransactionStore.prototype, {

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
      endDate: typeof debt.endDate === "string" ? debt.endDate : "",
      maxOccurrences: Number(debt.maxOccurrences) || null,
      interestRate: Number(debt.interestRate) || 0,
    };
  },

  _normalizeSavingsGoal(goal) {
    return {
      ...goal,
      id: goal.id || Utils.generateUniqueId(),
      _lastModified: goal._lastModified || new Date().toISOString(),
      name: typeof goal.name === "string" ? goal.name : "",
      targetAmount: Math.round((Number(goal.targetAmount) || 0) * 100) / 100,
      targetDate: typeof goal.targetDate === "string" ? goal.targetDate : "",
      saved: Math.round((Number(goal.saved) || 0) * 100) / 100,
    };
  },

  getCashInfusions() {
    return this.cashInfusions;
  },

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
  },

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
  },

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
  },

  getSavingsGoals() {
    return this.savingsGoals;
  },

  addSavingsGoal(goal) {
    if (!goal) {
      console.error("Invalid savings goal data");
      return null;
    }
    const normalized = this._normalizeSavingsGoal(goal);
    normalized._lastModified = new Date().toISOString();
    this.savingsGoals.push(normalized);
    this.debouncedSave();
    return normalized.id;
  },

  updateSavingsGoal(id, updates) {
    if (!id || !updates) {
      console.error("Invalid parameters for updateSavingsGoal");
      return false;
    }
    const index = this.savingsGoals.findIndex((g) => g.id === id);
    if (index === -1) {
      return false;
    }
    this.savingsGoals[index] = this._normalizeSavingsGoal({
      ...this.savingsGoals[index],
      ...updates,
      id,
      _lastModified: new Date().toISOString(),
    });
    this.debouncedSave();
    return true;
  },

  deleteSavingsGoal(id) {
    if (!id) {
      console.error("Invalid ID for deleteSavingsGoal");
      return false;
    }
    const index = this.savingsGoals.findIndex((g) => g.id === id);
    if (index === -1) {
      return false;
    }
    // Track deleted ID for merge conflict resolution (with timestamp for pruning)
    this._deletedItems.savingsGoals.push({ id, deletedAt: Date.now() });
    this.savingsGoals.splice(index, 1);
    this.debouncedSave();
    return true;
  },

  addWhatIfTransaction(date, transaction) {
    if (!date || !transaction) return false;
    if (!this.transactions[date]) {
      this.transactions[date] = [];
    }
    this.transactions[date].push({ ...transaction, whatIf: true });
    return true;
  },

  getWhatIfTransactions() {
    const drafts = [];
    Object.keys(this.transactions).forEach((date) => {
      this.transactions[date].forEach((t) => {
        if (t.whatIf === true) drafts.push({ date, transaction: t });
      });
    });
    drafts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return drafts;
  },

  clearWhatIfTransactions() {
    let removed = 0;
    Object.keys(this.transactions).forEach((date) => {
      const before = this.transactions[date].length;
      this.transactions[date] = this.transactions[date].filter(
        (t) => t.whatIf !== true
      );
      removed += before - this.transactions[date].length;
      if (this.transactions[date].length === 0) {
        delete this.transactions[date];
      }
    });
    return removed;
  },

  // Commit every draft as a real transaction (id + timestamp via
  // addTransaction, which also persists and syncs). Returns the count.
  applyWhatIfTransactions() {
    const drafts = this.getWhatIfTransactions();
    this.clearWhatIfTransactions();
    drafts.forEach(({ date, transaction }) => {
      const real = { ...transaction };
      delete real.whatIf;
      delete real.id;
      delete real._lastModified;
      this.addTransaction(date, real);
    });
    return drafts.length;
  },

  getMonthlyNotes(monthKey) {
    const note = this.monthlyNotes[monthKey];
    if (!note) return "";
    // Handle both old format (string) and new format (object with text)
    return typeof note === "string" ? note : (note.text || "");
  },

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
  },

  hasMonthlyNotes(monthKey) {
    const note = this.monthlyNotes[monthKey];
    if (!note) return false;
    // Handle both old format (string) and new format (object with text)
    const text = typeof note === "string" ? note : (note.text || "");
    return !!(text && text.trim());
  },

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
  },

  // Cancel a move (restore transaction to original date)
  cancelMoveTransaction(recurringId, fromDate) {
    const key = `${recurringId}-${fromDate}`;
    if (this.movedTransactions[key]) {
      delete this.movedTransactions[key];
      this.debouncedSave();
      return true;
    }
    return false;
  },

  // Return the move record for a recurring occurrence relocated FROM this date,
  // or null. Lets the UI distinguish a payment that was authorized on its
  // scheduled date but settled later (moved) from a genuinely skipped one.
  getMoveForRecurring(recurringId, fromDate) {
    if (!recurringId || !fromDate) {
      return null;
    }
    return this.movedTransactions[`${recurringId}-${fromDate}`] || null;
  },

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
  },

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
  },

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
  },

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
  },

  // Normalize an extra-payment start month to a "YYYY-MM" string or "" (none).
  normalizeExtraStartMonth(value) {
    return typeof value === "string" && /^\d{4}-\d{2}$/.test(value)
      ? value
      : "";
  },

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
  },

});
