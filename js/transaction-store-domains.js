// TransactionStore — domain collections: debts + snowball settings, cash
// infusions, savings goals, monthly notes, moved-transaction tracking, and
// what-if drafts. Each delete pushes a tombstone into _deletedItems so cloud
// merges don't resurrect removed entries (see [[deletion-tombstones]]).
// Prototype companion of TransactionStore (class declared in
// transaction-store.js); no build step — loaded as a plain script after the
// class file and before app.js (see index.html).

Object.assign(TransactionStore.prototype, {

  // Numeric coercion choke point for the domain collections. `Number(x) || 0`
  // was the intent at every site below, but it passes ±Infinity straight
  // through — and JSON.stringify writes Infinity as null, so the value comes
  // back as 0 on the next load: a debt balance silently reads as paid off, a
  // savings goal loses recorded progress. "1e999" is valid JSON, so this
  // arrives from imports and cloud merges, not only from a form (see
  // [[finite-amount-guards]]; dd93807 fixed the form paths it could reach).
  // Rounding stays at the call sites so finite values behave exactly as before.
  _finiteNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  },

  // The domain collections (debts, infusions, goals, dailyFloor) normalize
  // their money on the way in. The three inputs the balance walk actually
  // steps through — the transactions map, the recurring definitions, and the
  // monthly anchors — never did: loadData and importData assign them straight
  // from JSON.parse. The form guards can't cover that, because the value never
  // passes through a form: "1e999" is valid JSON that parses to Infinity, so
  // restoring a backup puts a non-finite amount directly into the walk. The
  // 30-day Minimum then reads -Infinity and every balance after that day is
  // garbage; saving writes the amount back as null (JSON.stringify's rendering
  // of Infinity), so the next load quietly shows a third set of numbers.
  //
  // Only non-finite values are rewritten. A finite amount is left exactly as
  // it was, so sweeping an existing dataset can never move a balance — this
  // repairs corruption, it does not re-round anyone's data.
  // See [[finite-amount-guards]].
  _repairWalkAmounts() {
    let repaired = 0;
    // `optional` keys are left alone when absent — a monthlyBalances entry that
    // carries no endingBalance is just an incomplete derived record, and the
    // next render rebuilds it. A row's `amount` is NOT optional: an absent one
    // is corruption, and it used to slip through this sweep untouched because
    // `undefined` short-circuited here. It then reached the walk as
    // `subtotal + undefined` → NaN → 0, wiping every earlier row in that day's
    // subtotal (see CalculationService._rowAmount, which contains the blast
    // radius at read time; this repairs the stored value so it stops recurring).
    const fix = (obj, key, { optional = false } = {}) => {
      if (!obj) return;
      if (optional && obj[key] === undefined) return;
      if (Number.isFinite(obj[key])) return;
      obj[key] = this._finiteNumber(obj[key]);
      repaired++;
    };

    Object.keys(this.transactions || {}).forEach((date) => {
      const list = this.transactions[date];
      if (Array.isArray(list)) list.forEach((t) => fix(t, "amount"));
    });
    (this.recurringTransactions || []).forEach((rt) => fix(rt, "amount"));
    Object.keys(this.monthlyBalances || {}).forEach((monthKey) => {
      const entry = this.monthlyBalances[monthKey];
      fix(entry, "startingBalance", { optional: true });
      fix(entry, "endingBalance", { optional: true });
    });

    if (repaired > 0) {
      console.warn(
        `Repaired ${repaired} non-finite amount(s) — they were reset to 0.`
      );
    }
    return repaired;
  },

  _normalizeDebt(debt) {
    return {
      ...debt,
      id: debt.id || Utils.generateUniqueId(),
      _lastModified: debt._lastModified || new Date().toISOString(),
      balance: Math.round(this._finiteNumber(debt.balance) * 100) / 100,
      minPayment: Math.round(this._finiteNumber(debt.minPayment) * 100) / 100,
      dueDay: this._finiteNumber(debt.dueDay) || 1,
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
        ? debt.semiMonthlyDays.map((day) => this._finiteNumber(day) || 1)
        : null,
      semiMonthlyLastDay: debt.semiMonthlyLastDay === true,
      customInterval:
        debt.customInterval && typeof debt.customInterval === "object"
          ? {
            value: this._finiteNumber(debt.customInterval.value) || 1,
            unit:
              debt.customInterval.unit === "weeks" ||
                debt.customInterval.unit === "months"
                ? debt.customInterval.unit
                : "days",
          }
          : null,
      endDate: typeof debt.endDate === "string" ? debt.endDate : "",
      maxOccurrences: this._finiteNumber(debt.maxOccurrences) || null,
      interestRate: this._finiteNumber(debt.interestRate),
    };
  },

  _normalizeSavingsGoal(goal) {
    return {
      ...goal,
      id: goal.id || Utils.generateUniqueId(),
      _lastModified: goal._lastModified || new Date().toISOString(),
      name: typeof goal.name === "string" ? goal.name : "",
      targetAmount: Math.round(this._finiteNumber(goal.targetAmount) * 100) / 100,
      targetDate: typeof goal.targetDate === "string" ? goal.targetDate : "",
      saved: Math.round(this._finiteNumber(goal.saved) * 100) / 100,
    };
  },

  // Cash infusions were the last domain collection still coercing with
  // `Number(x) || 0` — the exact pattern _finiteNumber exists to replace, and
  // the one loadData/importData applied by hand at two sites that drifted from
  // their siblings. An infinite infusion clears every debt in the snowball
  // projection (Math.min(balance, Infinity) pays each one in full), then
  // JSON.stringify writes it as null so the next load reads 0 and the plan
  // changes again. Normalizing on the way in matches _normalizeDebt /
  // _normalizeSavingsGoal, so add/update, load, and import all agree.
  _normalizeCashInfusion(infusion) {
    return {
      ...infusion,
      id: infusion.id || Utils.generateUniqueId(),
      _lastModified: infusion._lastModified || new Date().toISOString(),
      name: typeof infusion.name === "string" ? infusion.name : "",
      amount: Math.round(this._finiteNumber(infusion.amount) * 100) / 100,
      date: typeof infusion.date === "string" ? infusion.date : "",
      targetDebtId: infusion.targetDebtId || null,
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
    const normalized = this._normalizeCashInfusion(infusion);
    normalized._lastModified = new Date().toISOString();
    this.cashInfusions.push(normalized);
    this.debouncedSave();
    return normalized.id;
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
    this.cashInfusions[index] = this._normalizeCashInfusion({
      ...this.cashInfusions[index],
      ...updates,
      id,
      _lastModified: new Date().toISOString(),
    });
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
    // Normalize on the way in, as addSavingsGoal does. Debts used to be
    // normalized only on load, so an in-session debt kept whatever the caller
    // passed — and a non-finite balance was "normalized" only after
    // JSON.stringify had already turned it into null, i.e. into 0.
    this.debts.push(this._normalizeDebt(debt));
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
    this.debts[index] = this._normalizeDebt({
      ...this.debts[index],
      ...updates,
      _lastModified: new Date().toISOString(),
    });
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
      dailyFloor: this._finiteNumber(settings.dailyFloor),
      extraPaymentStartMonth: this.normalizeExtraStartMonth(
        settings.extraPaymentStartMonth
      ),
      autoGenerate: settings.autoGenerate === true,
    };
    this.debouncedSave();
    return true;
  },

});
