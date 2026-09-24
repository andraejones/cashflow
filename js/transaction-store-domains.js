// TransactionStore — domain collections: debts + snowball settings, cash
// infusions, monthly notes, and moved-transaction tracking. Each delete pushes
// a tombstone into _deletedItems so cloud merges don't resurrect removed
// entries. Prototype companion of TransactionStore (class declared in
// transaction-store.js); no build step — loaded as a plain script after the
// class file and before app.js (see index.html).

Object.assign(TransactionStore.prototype, {

  // Numeric coercion choke point for the domain collections. `Number(x) || 0`
  // passes ±Infinity straight through — and JSON.stringify writes Infinity as
  // null, so the value comes back as 0 on the next load (a debt balance reads
  // as paid off). "1e999" is valid JSON, so this arrives from imports and cloud
  // merges, not only from a form. Rounding stays at the call sites.
  _finiteNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  },

  // The snowball's minimum daily cashflow, normalized the same way wherever it
  // arrives from — the settings form, a restored backup, or a cloud merge. A
  // negative floor is refused: the projection asks whether
  // `forwardMinChecking - dailyFloor` covers a payoff, so a negative floor
  // would schedule payoffs that drive the projected balance BELOW zero.
  _normalizeDailyFloor(value) {
    const num = this._finiteNumber(value);
    return num > 0 ? num : 0;
  },

  // The domain collections (debts, infusions, dailyFloor) normalize their
  // money on the way in. The three inputs the balance walk steps through — the
  // transactions map, the recurring definitions, and the monthly anchors — are
  // assigned straight from JSON.parse by loadData and importData, so no form
  // guard covers them: "1e999" is valid JSON that parses to Infinity, and a
  // restored backup would put a non-finite amount directly into the walk.
  //
  // Only non-finite values are rewritten. A finite amount is left exactly as
  // it was, so sweeping an existing dataset can never move a balance — this
  // repairs corruption, it does not re-round anyone's data.
  _repairWalkAmounts() {
    let repaired = 0;
    // `optional` keys are left alone when absent — a monthlyBalances entry that
    // carries no endingBalance is just an incomplete derived record, and the
    // next render rebuilds it. A row's `amount` is NOT optional: an absent one
    // is corruption that would reach the walk as NaN (see
    // CalculationService._rowAmount, which contains it at read time; this
    // repairs the stored value).
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
      // A debt's name is compared with localeCompare in the payoff-order
      // tiebreaks, which run inside the calendar render, so a non-string name
      // from an import or merge must be coerced here.
      name: typeof debt.name === "string" ? debt.name : "",
      balance: Math.round(this._finiteNumber(debt.balance) * 100) / 100,
      minPayment: Math.round(this._finiteNumber(debt.minPayment) * 100) / 100,
      dueDay: this._finiteNumber(debt.dueDay) || 1,
      dueDayPattern:
        typeof debt.dueDayPattern === "string" ? debt.dueDayPattern : "",
      // Explicit "due on the last day of the month" (monthly only). null =
      // saved before the flag existed; buildDebtRecurringTransaction then
      // falls back to inferring it from the start date (legacy debts).
      dueLastDay: typeof debt.dueLastDay === "boolean" ? debt.dueLastDay : null,
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
      payoffPriority: this._normalizePayoffPriority(debt.payoffPriority),
    };
  },

  // A debt's explicit snowball payoff priority: a whole number 1–99 (1 = paid
  // first), or null for the default smallest-balance-first order. Anything
  // else — a fraction, zero, a negative, a non-numeric string from an import —
  // falls back to null rather than to some rank the user never chose. The
  // range must match what makePayoffOrder treats as ranked.
  _normalizePayoffPriority(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "number" && typeof value !== "string") return null;
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
  },

  // Normalizing on the way in keeps add/update, load, and import in
  // agreement. An infinite infusion would clear every debt in the projection
  // and then come back as 0 after JSON.stringify.
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

  // The stored text for a month, as a STRING, whatever shape the record is in:
  // the legacy bare string, the current { text, _lastModified } object, or
  // anything an import or a cloud merge left there. Both readers below go
  // through this; hasMonthlyNotes runs on every calendar render.
  _monthlyNoteText(monthKey) {
    const note = this.monthlyNotes[monthKey];
    if (!note) return "";
    const raw = typeof note === "string" ? note : note.text;
    return typeof raw === "string" ? raw : "";
  },

  getMonthlyNotes(monthKey) {
    return this._monthlyNoteText(monthKey);
  },

  setMonthlyNotes(monthKey, notes) {
    if (!monthKey) {
      console.error("Invalid monthKey for setMonthlyNotes");
      return false;
    }
    // Coerce here too: this is a public store method, and the only thing that
    // makes today's single caller safe is that it happens to pass a textarea's
    // value.
    const text = typeof notes === "string" ? notes.trim() : "";
    if (text) {
      this.monthlyNotes[monthKey] = {
        text,
        _lastModified: new Date().toISOString(),
      };
    } else {
      // Saving an empty note over a month that already has none is a no-op —
      // don't stamp a record (or a cloud push) for it. Opening Notes on a blank
      // month and pressing Save is a normal thing to do.
      if (!this.hasMonthlyNotes(monthKey)) {
        if (this.monthlyNotes[monthKey] !== undefined) {
          // A legacy empty string / stale blank: normalize it away silently.
          delete this.monthlyNotes[monthKey];
          this.debouncedSave(false);
        }
        return true;
      }
      // Clearing a REAL note keeps a TIMESTAMPED EMPTY record rather than
      // deleting the key: a deleted key is invisible to the cloud merge, which
      // would restore the remote copy. The empty record is the deletion's
      // tombstone: _mergeMonthlyNotes lets the newer side win, and drops the key
      // entirely once BOTH sides are empty. getMonthlyNotes / hasMonthlyNotes
      // read an empty text as "none".
      this.monthlyNotes[monthKey] = {
        text: "",
        _lastModified: new Date().toISOString(),
      };
    }
    this.debouncedSave();
    return true;
  },

  hasMonthlyNotes(monthKey) {
    return this._monthlyNoteText(monthKey).trim() !== "";
  },

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
    // Normalize on the way in, as addCashInfusion does.
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
      dailyFloor: this._normalizeDailyFloor(settings.dailyFloor),
      extraPaymentStartMonth: this.normalizeExtraStartMonth(
        settings.extraPaymentStartMonth
      ),
      autoGenerate: settings.autoGenerate === true,
    };
    this.debouncedSave();
    return true;
  },

});
