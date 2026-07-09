// DebtSnowballUI — minimum-payment recurring maintenance and snowball
// transaction sync: creating/ending the per-debt minimum series at payoff,
// pruning paid-off minimums, healing orphaned/stranded modified instances,
// auto-adjusting minimum amounts, and materializing snowball payment rows.
// Prototype companion of DebtSnowballUI (class declared in debt-snowball.js);
// no build step — loaded as a plain script after the class file and before
// app.js (see index.html).

Object.assign(DebtSnowballUI.prototype, {

  ensureMinimumPaymentRecurring(debt) {
    if (!debt || !debt.id) return;
    const recurringUpdates = this.buildDebtRecurringTransaction(debt);
    if (debt.minRecurringId) {
      const updated = this.store.updateRecurringTransaction(
        debt.minRecurringId,
        recurringUpdates
      );
      if (updated) {
        this.recurringManager.invalidateCache();
        return;
      }
    }
    const recurringTransaction = {
      ...recurringUpdates,
      id: Utils.generateUniqueId(),
    };
    const recurringId = this.store.addRecurringTransaction(recurringTransaction);
    this.store.updateDebt(debt.id, { minRecurringId: recurringId });
    this.recurringManager.invalidateCache();
  },

  buildDebtRecurringTransaction(debt) {
    const recurrence = debt.recurrence || "monthly";
    const startDate = this.getDebtStartDateValue(debt);
    const dueDayPattern =
      recurrence === "monthly" && typeof debt.dueDayPattern === "string"
        ? debt.dueDayPattern
        : "";
    const recurringTransaction = {
      startDate,
      amount: debt.minPayment,
      type: "expense",
      description: `Debt Payment: ${debt.name}`,
      recurrence,
      daySpecific: Boolean(dueDayPattern),
      daySpecificData: dueDayPattern || null,
      // Preserve the legacy "due on the last day" behavior for monthly debts
      // whose start date lands on its month's last day (e.g. a day-31 due date).
      // Set explicitly — not inferred at expansion time — so a later due-day edit
      // can never leave a stale last-day flag behind.
      lastDayOfMonth:
        recurrence === "monthly" &&
        !dueDayPattern &&
        Utils.isLastCalendarDayOfMonth(startDate),
      semiMonthlyDays:
        recurrence === "semi-monthly" && Array.isArray(debt.semiMonthlyDays)
          ? [...debt.semiMonthlyDays]
          : null,
      semiMonthlyLastDay:
        recurrence === "semi-monthly" ? debt.semiMonthlyLastDay === true : null,
      customInterval:
        recurrence === "custom" && debt.customInterval
          ? { ...debt.customInterval }
          : null,
      businessDayAdjustment: debt.businessDayAdjustment || "none",
      endDate: debt.endDate || null,
      maxOccurrences:
        typeof debt.maxOccurrences === "number" && debt.maxOccurrences > 0
          ? debt.maxOccurrences
          : null,
      debtId: debt.id,
      debtRole: "minimum",
      debtName: debt.name,
    };
    return recurringTransaction;
  },

  // Resolve the actual (business-day-adjusted) date of a debt's minimum payment
  // in a given month, honoring its recurrence type. Used to anchor the recurring
  // endDate to the real payment date so an adjusted payment (e.g. a due date
  // shifted onto the next business day) is still retained, and the next month's
  // payment is excluded. Returns the latest in-month occurrence; if the payment
  // was adjusted across the month boundary, returns the spilled occurrence in
  // the following month. Null if no occurrence can be resolved.
  getMinimumPaymentPayoffDate(debt, payoffYear, payoffMonth) {
    const template = this.buildDebtRecurringTransaction(debt);
    template.id = template.id || debt.minRecurringId || debt.id || Utils.generateUniqueId();
    // Ignore any cap so the payoff-month occurrence is always resolvable.
    template.endDate = null;
    template.maxOccurrences = null;

    const inMonth = this.getRecurringOccurrencesForMonth(
      template,
      payoffYear,
      payoffMonth
    );
    if (inMonth.length) {
      return inMonth[inMonth.length - 1].dateString;
    }
    // No occurrence landed in the payoff month — a business-day adjustment may
    // have pushed it into the next month. The spilled payment is that month's
    // earliest occurrence.
    let nextYear = payoffYear;
    let nextMonth = payoffMonth + 1;
    if (nextMonth > 11) {
      nextMonth = 0;
      nextYear += 1;
    }
    const inNext = this.getRecurringOccurrencesForMonth(
      template,
      nextYear,
      nextMonth
    );
    if (inNext.length) {
      return inNext[0].dateString;
    }
    return null;
  },

  // Latest real (amount > 0) materialized minimum-payment occurrence for this
  // debt that has already happened (landed before the projection start, i.e.
  // on/before today). Compared and returned on the scheduled occurrence date
  // (originalDate when a business-day adjustment moved the landing date) so the
  // result stays consistent with the recurrence-window checks in
  // cleanupOrphanedDebtMinimums.
  getLatestPaidMinimumOccurrence(debt) {
    if (!debt || !debt.id) return null;
    const now = new Date();
    const projectionStartString = Utils.formatDateString(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    );
    const transactions = this.store.getTransactions();
    let latest = null;
    Object.keys(transactions).forEach((dateKey) => {
      if (dateKey >= projectionStartString) return;
      transactions[dateKey].forEach((t) => {
        if (t.debtRole !== "minimum" || t.debtId !== debt.id) return;
        if (!(Number(t.amount) > 0)) return;
        const occurrence = t.originalDate || dateKey;
        if (!latest || occurrence > latest) {
          latest = occurrence;
        }
      });
    });
    return latest;
  },

  // Compute the date a debt's minimum-payment recurring should stop expanding.
  // The recurrence is ended at the debt's projected payoff so the minimum
  // payment never appears after the debt is paid off. Any user-set debt.endDate
  // still applies and wins if it is earlier.
  computeMinimumPaymentEndDate(debt, payoff) {
    const userEnd = debt && debt.endDate ? debt.endDate : null;
    let payoffEnd = null;
    if (payoff && typeof payoff.year === "number" && typeof payoff.month === "number") {
      if (payoff.alreadyPaid === true) {
        // Already at zero: end the month before "now" so no payment shows in the
        // current or future months.
        let endYear = payoff.year;
        let endMonth = payoff.month - 1;
        if (endMonth < 0) {
          endMonth = 11;
          endYear -= 1;
        }
        const lastDay = new Date(endYear, endMonth + 1, 0, 12, 0, 0);
        payoffEnd = Utils.formatDateString(lastDay);
        // ...but never before a real payment already made this month. The
        // payment that cleared the debt is often days old (minimum due the
        // 3rd, today the 5th); an earlier endDate puts that historical row
        // outside the recurrence window, so cleanupOrphanedDebtMinimums
        // deletes it — erasing real spending from the balance walk and
        // flipping the debt back to unpaid, with endDate oscillating between
        // the two states on every render.
        const lastPaid = this.getLatestPaidMinimumOccurrence(debt);
        if (lastPaid && lastPaid > payoffEnd) {
          payoffEnd = lastPaid;
        }
      } else {
        // Pays off during the projection: keep the payment that clears it,
        // anchored to its real (possibly adjusted) date.
        payoffEnd = this.getMinimumPaymentPayoffDate(
          debt,
          payoff.year,
          payoff.month
        );
        if (!payoffEnd) {
          const lastDay = new Date(payoff.year, payoff.month + 1, 0, 12, 0, 0);
          payoffEnd = Utils.formatDateString(lastDay);
        }
      }
    }
    if (userEnd && payoffEnd) {
      return userEnd < payoffEnd ? userEnd : payoffEnd;
    }
    return userEnd || payoffEnd || null;
  },

  // Keep each debt's minimum-payment recurring transaction ended at its
  // projected payoff. Ending the recurrence (rather than deleting materialized
  // instances) is durable: every consumer that re-expands recurring
  // transactions — the calendar grid, the day-detail modal, balance
  // calculations, search and CSV export — naturally stops generating the
  // payment past payoff. Writes only when the value actually changes so this
  // does not churn cloud sync, and invalidates the expansion cache so the next
  // expansion reflects the new bound.
  syncMinimumPaymentEndDates(payoffByDebtId) {
    const recurrings = this.store.getRecurringTransactions();
    let changed = false;
    this.store.getDebts().forEach((debt) => {
      if (!debt || !debt.minRecurringId) {
        return;
      }
      const rt = recurrings.find((r) => r.id === debt.minRecurringId);
      if (!rt) {
        return;
      }
      const desired = this.computeMinimumPaymentEndDate(
        debt,
        payoffByDebtId ? payoffByDebtId[debt.id] : null
      );
      const current = rt.endDate ? rt.endDate : null;
      if (current !== desired) {
        rt.endDate = desired;
        rt._lastModified = new Date().toISOString();
        changed = true;
      }
    });
    if (changed) {
      this.recurringManager.invalidateCache();
    }
    return changed;
  },

  prunePaidOffDebtMinimumPayments(year, month, payoffByDebtId) {
    const transactions = this.store.getTransactions();
    const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
    const viewIndex = this.getMonthIndex(year, month);
    let changed = false;
    // Rows dated before the projection start are historical facts — payments
    // already reflected in the real running balance — and must never be pruned
    // even when the debt is already at zero (same boundary rule as
    // adjustMinimumPaymentTransactions). Without this, a debt cleared by a
    // minimum payment earlier in the current month gets that very payment
    // deleted here the moment its balance reads zero.
    const now = new Date();
    const projectionStartString = Utils.formatDateString(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    );

    Object.keys(transactions).forEach((dateKey) => {
      if (!dateKey.startsWith(monthPrefix) || dateKey < projectionStartString) {
        return;
      }
      const list = transactions[dateKey];
      const filtered = list.filter((t) => {
        if (t.debtRole !== "minimum" || !t.debtId || !t.recurringId) {
          return true;
        }
        const payoff = payoffByDebtId?.[t.debtId];
        if (!payoff) {
          return true;
        }
        const payoffIndex = this.getMonthIndex(payoff.year, payoff.month);
        const shouldPrune =
          payoff.alreadyPaid === true
            ? payoffIndex <= viewIndex
            : payoffIndex < viewIndex;
        if (shouldPrune) {
          // Tombstone persisted rows so a sync-merge doesn't resurrect them.
          this.store.trackDeletedTransaction(t.id);
          changed = true;
          return false;
        }
        return true;
      });
      if (filtered.length !== list.length) {
        if (filtered.length === 0) {
          delete transactions[dateKey];
        } else {
          transactions[dateKey] = filtered;
        }
      }
    });

    return changed;
  },

  // Remove debt minimum-payment instances that the recurrence would no longer
  // generate: occurrences that fall outside the recurring's [startDate,endDate]
  // window, or duplicate occurrences on the same date. These strand when a
  // debt's recurrence window changes — Convert-to-Debt deriving a new start
  // date, a due-date edit, or the payoff-driven endDate sync. Because the
  // snowball engine flags every minimum it adjusts (zeroed/partial/hidden) with
  // modifiedInstance, the recurring manager treats them as hand-edits and never
  // deletes or regenerates them, so they persist with stale amounts before the
  // start date or past payoff, corrupting "paid so far" and the balance walk.
  // Scans all dates (strandings can sit far outside the materialized horizon)
  // and runs once per render via ensureSnowballPaymentsForHorizon, which then
  // re-expands and re-adjusts a clean set within the current window.
  cleanupOrphanedDebtMinimums() {
    const transactions = this.store.getTransactions();
    const recurringById = new Map(
      this.store.getRecurringTransactions().map((rt) => [rt.id, rt])
    );
    let changed = false;

    // Elect one keeper per occurrence ACROSS all dates, not just within one
    // date: a schedule change (due-day edit, business-day adjustment change)
    // relocates an occurrence's landing date, so a previously adjusted
    // (modifiedInstance) copy strands at the old date while re-expansion places
    // a fresh copy at the new one — two rows for the same occurrence on
    // different days, double-counting the payment. Prefer keeping a
    // non-modified copy (it sits at the schedule's current date; the adjust
    // pass re-applies any reduction there); among equals keep the earliest.
    const keeperByOccurrence = new Map();
    Object.keys(transactions)
      .sort()
      .forEach((dateKey) => {
        const list = transactions[dateKey];
        if (!Array.isArray(list)) {
          return;
        }
        list.forEach((t) => {
          if (t.debtRole !== "minimum" || !t.debtId || !t.recurringId) {
            return;
          }
          const rt = recurringById.get(t.recurringId);
          if (!rt) {
            return;
          }
          const occurrence = t.originalDate || dateKey;
          if (
            (rt.startDate && occurrence < rt.startDate) ||
            (rt.endDate && occurrence > rt.endDate)
          ) {
            // Deleted by the sweep below — never a keeper candidate.
            return;
          }
          const key = `${t.recurringId}|${occurrence}`;
          const current = keeperByOccurrence.get(key);
          if (
            !current ||
            (current.modifiedInstance === true && t.modifiedInstance !== true)
          ) {
            keeperByOccurrence.set(key, t);
          }
        });
      });

    Object.keys(transactions).forEach((dateKey) => {
      const list = transactions[dateKey];
      if (!Array.isArray(list)) {
        return;
      }
      const filtered = list.filter((t) => {
        if (t.debtRole !== "minimum" || !t.debtId || !t.recurringId) {
          return true;
        }
        const rt = recurringById.get(t.recurringId);
        if (!rt) {
          // Recurrence definition is gone — orphaned instance. Tombstone so a
          // sync-merge doesn't resurrect the remote copy.
          this.store.trackDeletedTransaction(t.id);
          changed = true;
          return false;
        }
        // Compare on the scheduled occurrence (originalDate when a business-day
        // adjustment moved the placed date), so legitimately shifted payments
        // are judged by their real due date, not their landing date.
        const occurrence = t.originalDate || dateKey;
        if (
          (rt.startDate && occurrence < rt.startDate) ||
          (rt.endDate && occurrence > rt.endDate)
        ) {
          this.store.trackDeletedTransaction(t.id);
          changed = true;
          return false;
        }
        const occurrenceKey = `${t.recurringId}|${occurrence}`;
        // Keep only the keeper elected across all dates above; every other copy
        // of the same occurrence (a stranded modifiedInstance at an old date, a
        // re-expanded duplicate) is a double-count and gets tombstoned.
        if (keeperByOccurrence.get(occurrenceKey) !== t) {
          this.store.trackDeletedTransaction(t.id);
          changed = true;
          return false;
        }
        return true;
      });
      if (filtered.length !== list.length) {
        if (filtered.length === 0) {
          delete transactions[dateKey];
        } else {
          transactions[dateKey] = filtered;
        }
      }
    });

    return changed;
  },

  adjustMinimumPaymentTransactions(year, month, minPaidByDebtId) {
    if (!minPaidByDebtId || typeof minPaidByDebtId !== "object") {
      return false;
    }
    const transactions = this.store.getTransactions();
    const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
    const minOccurrencesByDebtId = {};

    // The projection walk only schedules and pays occurrences from its start
    // date (tomorrow) forward — anything dated earlier has already happened and
    // is baked into the starting balances/checking. So reconcile only the
    // walk's window: instances dated before the projection start are historical
    // facts (real payments already reflected in every balance) and must never
    // be zeroed or re-amounted against a future-only target. Without this
    // boundary, a multi-occurrence month (semi-monthly, weekly) straddling
    // today gets its already-made early payment trimmed away to match a target
    // that never included it.
    const now = new Date();
    const projectionStartString = Utils.formatDateString(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    );

    Object.keys(transactions).forEach((dateKey) => {
      if (!dateKey.startsWith(monthPrefix) || dateKey < projectionStartString) {
        return;
      }
      transactions[dateKey].forEach((t) => {
        if (t.debtRole !== "minimum" || !t.debtId || !t.recurringId) {
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(minPaidByDebtId, t.debtId)) {
          return;
        }
        if (!minOccurrencesByDebtId[t.debtId]) {
          minOccurrencesByDebtId[t.debtId] = [];
        }
        minOccurrencesByDebtId[t.debtId].push({ dateKey, transaction: t });
      });
    });

    const epsilon = 0.01;
    let changed = false;

    // Promoting an expanded recurring instance to a hand-edit (modifiedInstance)
    // must also assign an id + _lastModified, or the cloud merge (_mergeById)
    // drops it on the next sync — silently reverting the hide/reduce until
    // re-expansion self-heals. Mirrors setTransactionSettled /
    // autoSettleExpiredRecurring, which both promote expansions the same way.
    const markModified = (transaction) => {
      transaction.modifiedInstance = true;
      if (!transaction.id) {
        transaction.id = Utils.generateUniqueId();
      }
      transaction._lastModified = new Date().toISOString();
    };

    Object.keys(minOccurrencesByDebtId).forEach((debtId) => {
      const targetTotal = Math.max(0, Number(minPaidByDebtId[debtId]) || 0);
      const occurrences = minOccurrencesByDebtId[debtId].sort((a, b) =>
        a.dateKey.localeCompare(b.dateKey)
      );
      const currentTotal = occurrences.reduce(
        (sum, occ) => sum + (Number(occ.transaction.amount) || 0),
        0
      );
      if (currentTotal <= targetTotal + epsilon) {
        // At or below target. If strictly below AND we previously hid/reduced
        // instances, the target has since risen (e.g. a debt's projected payoff
        // moved later, so more minimums are now genuinely due). Clearing the
        // hand-edit flags lets the next re-expansion regenerate those instances
        // at their definition amount; a later adjust pass then re-reduces only
        // what's truly needed. Without this a zeroed minimum (currentTotal 0)
        // is trapped here forever and a real payment goes silently missing.
        if (currentTotal < targetTotal - epsilon) {
          occurrences.forEach(({ transaction }) => {
            if (transaction.modifiedInstance === true) {
              transaction.hidden = false;
              transaction.modifiedInstance = false;
              changed = true;
            }
          });
        }
        return;
      }
      // Allocate the target chronologically: the walk pays minimums in date
      // order until the payoff day and suppresses everything after it, so the
      // earliest occurrences are the ones that were (or will be) actually paid.
      // Allocating from the end instead would keep a minimum dated AFTER the
      // payoff and zero the pre-payoff one — payments shown on days the walk
      // never paid them.
      let remaining = targetTotal;
      for (let i = 0; i < occurrences.length; i++) {
        const { transaction } = occurrences[i];
        const amount = Number(transaction.amount) || 0;
        if (remaining <= epsilon) {
          if (amount !== 0 || transaction.hidden !== true) {
            transaction.amount = 0;
            transaction.hidden = true;
            markModified(transaction);
            changed = true;
          } else if (transaction.modifiedInstance !== true) {
            markModified(transaction);
            changed = true;
          }
          continue;
        }
        if (amount > remaining + epsilon) {
          if (Math.abs(amount - remaining) > epsilon || transaction.hidden === true) {
            transaction.amount = remaining;
            transaction.hidden = false;
            markModified(transaction);
            changed = true;
          } else if (transaction.modifiedInstance !== true) {
            markModified(transaction);
            changed = true;
          }
          remaining = 0;
        } else {
          if (transaction.hidden === true) {
            transaction.hidden = false;
            markModified(transaction);
            changed = true;
          }
          remaining -= amount;
        }
      }
    });

    return changed;
  },

  syncSnowballTransactionsForMonth(
    year,
    month,
    monthKey,
    expectedPayments,
    includeExtra,
    forced = false
  ) {
    const transactions = this.store.getTransactions();
    const expectedByDebtId = new Map();
    expectedPayments.forEach((payment) => {
      expectedByDebtId.set(payment.debtId, { ...payment, matched: false });
    });
    const epsilon = 0.01;
    let changed = false;
    let snowballAdded = false;

    // Scan every date (not just this month's) so a snowball row that drifted
    // into an adjacent month — e.g. a payoff payment pushed by a business-day
    // adjustment — is still reconciled against monthKey instead of being left
    // behind as a stray that double-counts.
    Object.keys(transactions).forEach((dateKey) => {
      const list = transactions[dateKey];
      const filtered = list.filter((t) => {
        const isSnowball =
          t.snowballGenerated === true && t.snowballMonth === monthKey;
        if (!isSnowball) {
          return true;
        }
        if (!includeExtra) {
          // A row the user force-generated ("Generate for Current Month" with
          // auto-generate off) is a deliberate one-shot materialization — keep
          // it, or the very next calendar render's horizon sweep silently
          // deletes what the button just created. It reconciles normally once
          // auto-generate is turned on.
          if (t.snowballForced === true) {
            return true;
          }
          // Tombstone persisted snowball rows so a sync-merge doesn't
          // resurrect them (they'd double-count until the next maintenance
          // pass on every device).
          this.store.trackDeletedTransaction(t.id);
          changed = true;
          return false;
        }
        const expected = expectedByDebtId.get(t.debtId);
        // Drop rows that are no longer expected, drifted to the wrong date, or
        // duplicate an expected payment we already matched. The last condition
        // self-heals previously materialized duplicate snowball rows, which
        // otherwise persist forever and double-count as real outflows.
        if (
          !expected ||
          expected.dateString !== dateKey ||
          expected.matched === true
        ) {
          this.store.trackDeletedTransaction(t.id);
          changed = true;
          return false;
        }
        const expectedDescription = `Snowball Payoff: ${expected.debtName}`;
        if (Math.abs(Number(t.amount) - expected.amount) > epsilon) {
          t.amount = expected.amount;
          changed = true;
        }
        if (t.description !== expectedDescription) {
          t.description = expectedDescription;
          changed = true;
        }
        expected.matched = true;
        return true;
      });
      if (filtered.length !== list.length) {
        if (filtered.length === 0) {
          delete transactions[dateKey];
        } else {
          transactions[dateKey] = filtered;
        }
      }
    });

    if (includeExtra) {
      expectedByDebtId.forEach((expected) => {
        if (expected.matched || expected.amount <= epsilon || !expected.dateString) {
          return;
        }
        const transaction = {
          amount: expected.amount,
          type: "expense",
          description: `Snowball Payoff: ${expected.debtName}`,
          debtId: expected.debtId,
          debtRole: "snowball",
          debtName: expected.debtName,
          snowballMonth: monthKey,
          snowballGenerated: true,
        };
        if (forced) {
          // Mark rows created by the Generate button so the auto-generate-off
          // maintenance sweep keeps them (see the !includeExtra branch above).
          transaction.snowballForced = true;
        }
        this.store.addTransaction(expected.dateString, transaction);
        snowballAdded = true;
      });
    }

    if (changed && !snowballAdded) {
      // Use saveData(false) for automatic maintenance - saves locally but doesn't trigger cloud sync
      this.store.saveData(false);
    }

    return { changed, snowballAdded };
  },

});
