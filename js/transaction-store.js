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
    this.savingsGoals = [];
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
  // draw amount) is persisted, and the house rule for persisted money is
  // Number.isFinite (see _finiteNumber / _repairWalkAmounts). Before this,
  // Number(undefined) + EPSILON produced NaN, and one NaN reaching
  // _applyAllocationDraws turned the bucket's amount into NaN for good.
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
      // existing split from the spread above, as it always has.
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


  getUnsettledTransactions() {
    const results = [];
    Object.keys(this.transactions).forEach((date) => {
      this.transactions[date].forEach((t, index) => {
        // What-if drafts ride in this same map. Today WhatIfUI.addDraft always
        // stamps settled:true, so a draft cannot reach the carried-forward
        // flow — but that makes this surface's correctness depend on a detail
        // two files away. State the opt-out here, where the rule is
        // ("every read surface must opt out or mark them").
        if (t.whatIf === true) return;
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


}
