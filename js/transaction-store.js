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
    // Track deleted item IDs for merge conflict resolution. `skips` holds
    // timestamped skip-toggle events ({date, recurringId, skipped, at}) so the
    // cloud merge can apply last-write-wins — a plain union of skip lists can
    // never propagate an unskip (the other device's stale skip resurrects it).
    // Shape comes from _TOMBSTONE_KEYS (persistence companion) so every
    // construction site agrees; loadData() below may replace this wholesale.
    this._deletedItems = this._emptyDeletedItems();
    this.onSaveCallbacks = [];

    this._saveDebounceTimer = null;
    this._saveDebounceDelay = 500; // 500ms debounce delay
    this._pendingIsDataModified = false;
    this._saveInProgress = false;
    this._queuedSave = null;

    this.loadData();
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


  // Cent rounding for the allocation engine. Non-finite input collapses to 0
  // rather than propagating: every value this touches (a bucket's remaining, a
  // draw amount) is persisted, and persisted money must be Number.isFinite
  // (see _finiteNumber / _repairWalkAmounts).
  _roundCents(value) {
    const num = Number(value);
    return Math.round(((Number.isFinite(num) ? num : 0) + Number.EPSILON) * 100) / 100;
  }

  _todayString() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  addTransaction(date, transaction) {
    if (!date || !transaction) {
      console.error("Invalid date or transaction data");
      return null;
    }

    if (!this.transactions[date]) {
      this.transactions[date] = [];
    }

    if (!transaction.id) {
      transaction.id = Utils.generateUniqueId();
    }
    transaction._lastModified = new Date().toISOString();

    // If this expense draws from allocations, debit each bucket now and record
    // how much was actually drawn from each (so the draws can be reversed
    // exactly when the expense is later edited, moved, or deleted).
    this._applyAllocationDraws(transaction);

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
      const existing = this.transactions[date][index];
      const existingId = existing.id;
      const merged = {
        ...existing,
        ...updatedTransaction,
        id: existingId || Utils.generateUniqueId(),
        _lastModified: new Date().toISOString(),
      };

      // Reconcile the allocation split: refund every old draw, then re-debit
      // from the merged amount/rows. Covers amount edits (re-draws against the
      // new amount), split edits, and type changes away from expense.
      //
      // An edit that clears the split hands us `allocationDraws: []`, which is
      // authoritative: _applyAllocationDraws writes no rows and clears the
      // legacy mirrors with them, so an explicit unlink drops the period
      // provenance too (unlike the dangling-bucket case, where the row keeps it
      // as history). A caller that passes no draw fields at all inherits the
      // existing split from the spread above.
      this._reverseAllocationDraws(existing);
      if (merged.type === "expense") {
        this._applyAllocationDraws(merged);
      } else {
        this._writeAllocationDraws(merged, null);
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
      const deletedTxn = this.transactions[date][index];
      if (deletedTxn.id) {
        // Track deleted ID for merge conflict resolution (with timestamp for pruning)
        this._deletedItems.transactions.push({ id: deletedTxn.id, deletedAt: Date.now() });
      }

      // Refund every allocation this expense was drawing from before removing it.
      this._reverseAllocationDraws(deletedTxn);

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
    this._pinLastDayOfMonth(recurringTransaction);

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
      // A new start date (bank reconcile's "Move series") can land on a
      // month's last day just as a new series can — see _pinLastDayOfMonth.
      if (updates.startDate !== undefined || updates.recurrence !== undefined) {
        this._pinLastDayOfMonth(this.recurringTransactions[index]);
      }
      this.debouncedSave();
      return true;
    }

    return false;
  }


  // Give a monthly series an explicit `lastDayOfMonth` when it has none.
  //
  // loadData's migration reads an ABSENT flag as a pre-flag legacy series and
  // stamps `true` on any whose start date is its month's last day. The writers
  // only set the flag when it is true, so without pinning `false` here a
  // series started on a 30th would flip to "last day of every month" on the
  // next reload. The expansion treats absent as false, so this records what
  // the series actually does and the migration only ever sees legacy data.
  _pinLastDayOfMonth(recurringTransaction) {
    if (
      recurringTransaction &&
      recurringTransaction.recurrence === "monthly" &&
      recurringTransaction.lastDayOfMonth === undefined
    ) {
      recurringTransaction.lastDayOfMonth = false;
    }
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

      // Record the toggle as a timestamped skip event (latest per occurrence)
      // so the cloud merge can apply last-write-wins. Without it, the merge's
      // plain union of skip lists resurrects any unskip as soon as another
      // device that still holds the old skip syncs (see
      // CloudSync._mergeSkippedTransactions).
      if (!Array.isArray(this._deletedItems.skips)) {
        this._deletedItems.skips = [];
      }
      this._deletedItems.skips = this._deletedItems.skips.filter(
        (e) => !(e && e.date === date && e.recurringId === recurringId)
      );
      this._deletedItems.skips.push({
        date,
        recurringId,
        skipped: isSkipped === true,
        at: Date.now(),
      });

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


  // Where the bank is with a row: "cleared" (posted), "pending" (a hold), or
  // "expected" (not in the bank yet). THE one rule — the day-detail bank
  // figures, the status chip and statement reconcile all read it from here.
  // An explicit `bankStatus` wins. Without one: an unsettled expense is a hold,
  // a one-time row the user entered is posted (they enter what the bank
  // shows), and a scheduled row — a recurring occurrence, a moved copy of one,
  // a snowball payoff — hasn't reached the bank yet.
  // Setting a status (setTransactionBankStatus) keeps an expense's `settled`
  // in step: only a cleared expense is settled. Pending and not-in-bank both
  // mean the money hasn't left yet, so both carry forward until it clears.
  getBankStatus(t) {
    if (!t || typeof t !== "object") return "expected";
    if (TransactionStore.BANK_STATUSES.includes(t.bankStatus)) return t.bankStatus;
    if (t.type === "expense" && t.settled === false) return "pending";
    if (!t.recurringId && t.movedFrom === undefined && t.snowballGenerated !== true) {
      return "cleared";
    }
    return "expected";
  }


  setTransactionBankStatus(date, index, status) {
    if (!date || index === undefined || !TransactionStore.BANK_STATUSES.includes(status)) {
      console.error("Invalid parameters for setTransactionBankStatus");
      return false;
    }
    const target = this.transactions[date] && this.transactions[date][index];
    if (!target) return false;
    target.bankStatus = status;
    if (target.type === "expense" && target.allocated !== true) {
      target.settled = status === "cleared";
    }
    target._lastModified = new Date().toISOString();
    // Same persistence rules as setTransactionSettled: a recurring occurrence
    // only survives re-expansion as a modified instance, and the cloud merge
    // drops any persisted row without an id.
    if (target.recurringId) {
      target.modifiedInstance = true;
    }
    if (!target.id) {
      target.id = Utils.generateUniqueId();
    }
    this.debouncedSave();
    return true;
  }

  // Copy a row's explicit bank status onto a fresh copy that is about to be
  // re-added elsewhere (a date edit in the day detail, a reconcile "Move").
  // Those paths rebuild the row field by field, and a copy without the stamp
  // falls back to getBankStatus's defaults: a Cleared recurring bill came back
  // "Not in bank" (a moved copy is scheduled) and a Not-in-bank purchase came
  // back Pending, so the day detail's posted/available figures moved on a mere
  // re-date. `settled` follows the status exactly as setTransactionBankStatus
  // pairs them. No explicit status means nothing to carry: the copy's defaults
  // already describe it the way the original's did. Paths that SETTLE the copy
  // (the carried-forward Settle, reconcile's Mark settled) stamp "cleared"
  // themselves instead.
  carryBankStatus(source, target) {
    if (!source || !target) return target;
    const status = source.bankStatus;
    if (!TransactionStore.BANK_STATUSES.includes(status)) return target;
    target.bankStatus = status;
    if (target.type === "expense" && target.allocated !== true) {
      target.settled = status === "cleared";
    }
    return target;
  }


  // Date of the latest Ending Balance on/before `dateString`, or null. Skip-
  // aware the way calculateDailyTotals is, so it names the anchor the walk uses.
  getLatestAnchorDate(dateString) {
    let latest = null;
    Object.keys(this.transactions).forEach((date) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > dateString) return;
      if (latest !== null && date <= latest) return;
      const list = this.transactions[date];
      if (!Array.isArray(list)) return;
      const hasAnchor = list.some(
        (t) =>
          t &&
          t.type === "balance" &&
          !(t.recurringId && this.isTransactionSkipped(date, t.recurringId))
      );
      if (hasAnchor) latest = date;
    });
    return latest;
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
          // A row with an explicit bank status is the bank's (or the user's)
          // word on it, not a guess: only Cleared is settled, and Pending or
          // Not in bank carries forward until it clears. Settling it here
          // without touching the status left a "Not in bank" row settled —
          // off the carried list while the bank view still listed it — and
          // the next reconcile un-settled it again, so every run wrote and
          // pushed (TEST 146).
          if (TransactionStore.BANK_STATUSES.includes(t.bankStatus)) return;
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
    return changed;
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


}

// Stored values of a row's `bankStatus` (see getBankStatus).
TransactionStore.BANK_STATUSES = ["cleared", "pending", "expected"];
