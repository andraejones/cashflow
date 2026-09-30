// DebtSnowballUI — the analytical core: the daily-floor snowball projection,
// the historical debt snapshot (with forward interest accrual), debt
// summaries, cash-infusion allocation math, and the occurrence/date helpers
// they share. Prototype companion of DebtSnowballUI (class declared in
// debt-snowball.js); no build step — loaded as a plain script after the class
// file and before app.js (see index.html).

Object.assign(DebtSnowballUI.prototype, {

  getDaySpecificLabel(daySpecificData) {
    if (!daySpecificData) {
      return "";
    }
    const option = this.daySpecificOptions.find(
      (entry) => entry.value === daySpecificData
    );
    return option ? option.label : "";
  },

  getDateFromString(dateString) {
    if (!this.isValidDateString(dateString)) return null;
    const parts = dateString.split("-").map(Number);
    // Use noon to avoid DST shifts pushing the date across a midnight boundary.
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  },

  formatMonthDay(date) {
    if (!date) return "";
    const month = Utils.MONTH_LABELS[date.getMonth()] || "";
    return `${month} ${date.getDate()}`;
  },

  formatMonthYear(year, month) {
    const monthLabel = Utils.MONTH_LABELS[month] || "";
    if (!monthLabel || typeof year !== "number") {
      return "";
    }
    return `${monthLabel} ${year}`;
  },

  // Full payoff date when the day-by-day projection pinned an exact day
  // (e.g. "September 14, 2026"); falls back to "Month Year" when only the
  // month is known (already-paid debts, monthly history snapshots).
  formatPayoffDate(payoff) {
    if (!payoff) return "";
    const monthYear = this.formatMonthYear(payoff.year, payoff.month);
    if (!monthYear || typeof payoff.day !== "number") {
      return monthYear;
    }
    const monthLabel = Utils.MONTH_LABELS[payoff.month] || "";
    return `${monthLabel} ${payoff.day}, ${payoff.year}`;
  },

  getMonthIndex(year, month) {
    return year * 12 + month;
  },

  // Build a Set of "YYYY-MM-DD" strings for the exact days a debt is paid off.
  // Only entries the daily-floor walk pinned to a specific day are included
  // (already-paid debts and month-only history snapshots have no `day` and are
  // skipped), so the calendar only flags real, dated payoff events.
  buildPayoffDateSet(payoffByDebtId) {
    const set = new Set();
    if (!payoffByDebtId) return set;
    Object.values(payoffByDebtId).forEach((p) => {
      if (
        p &&
        typeof p.year === "number" &&
        typeof p.month === "number" &&
        typeof p.day === "number"
      ) {
        set.add(Utils.formatDateString(new Date(p.year, p.month, p.day)));
      }
    });
    return set;
  },

  // Latest set of snowball payoff days, refreshed each render by
  // ensureSnowballPaymentsForHorizon. Consumed by CalendarUI to flag the days.
  getPayoffDates() {
    return this._payoffDates || new Set();
  },

  // Convert a "YYYY-MM" extra-payment start month into a comparable month index.
  // Empty/invalid values return -Infinity so the extra payment applies from the
  // start of the projection (no restriction).
  parseExtraStartMonthIndex(startMonth) {
    if (typeof startMonth !== "string") {
      return -Infinity;
    }
    const match = startMonth.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      return -Infinity;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!year || month < 1 || month > 12) {
      return -Infinity;
    }
    return this.getMonthIndex(year, month - 1);
  },

  // Clean scheduled amounts for one month of ONE definition, isolated from the
  // real data (skips, modified instances, other series). One implementation,
  // shared with the recurring manager: see RecurringTransactionManager
  // .expandIsolated, which owns the throwaway store.
  getRecurringOccurrencesForMonth(recurringTransaction, year, month) {
    return RecurringTransactionManager.expandIsolated(
      recurringTransaction,
      year,
      month
    ).map((o) => ({ dateString: o.dateString, amount: o.amount }));
  },

  getDebtScheduleLabel(debt) {
    const recurrence = debt?.recurrence || "monthly";
    const startDateString = this.getDebtStartDateValue(debt);
    const startDate = this.getDateFromString(startDateString);
    const dueDay = Math.min(Math.max(parseInt(debt?.dueDay || 1, 10), 1), 31);
    const patternLabel =
      recurrence === "monthly"
        ? this.getDaySpecificLabel(debt?.dueDayPattern)
        : "";

    switch (recurrence) {
      case "once":
        return startDateString
          ? `One-time (${Utils.formatDisplayDate(startDateString)})`
          : "One-time";
      case "daily":
        return "Daily";
      case "weekly":
        return startDate
          ? `Weekly (${WEEKDAY_LABELS[startDate.getDay()]})`
          : "Weekly";
      case "bi-weekly":
        return startDate
          ? `Bi-weekly (${WEEKDAY_LABELS[startDate.getDay()]})`
          : "Bi-weekly";
      case "semi-monthly": {
        const firstDay = Array.isArray(debt?.semiMonthlyDays)
          ? debt.semiMonthlyDays[0]
          : 1;
        const secondDay = Array.isArray(debt?.semiMonthlyDays)
          ? debt.semiMonthlyDays[1]
          : 15;
        const secondLabel =
          debt?.semiMonthlyLastDay === true || secondDay === 31
            ? "Last day"
            : secondDay;
        return `Twice a month (${firstDay} & ${secondLabel})`;
      }
      case "quarterly":
        return startDate
          ? `Quarterly (${this.formatMonthDay(startDate)})`
          : "Quarterly";
      case "semi-annual":
        return startDate
          ? `Semi-annual (${this.formatMonthDay(startDate)})`
          : "Semi-annual";
      case "yearly":
        return startDate
          ? `Yearly (${this.formatMonthDay(startDate)})`
          : "Yearly";
      case "custom": {
        const value = debt?.customInterval?.value || 1;
        const unit = debt?.customInterval?.unit || "days";
        const unitLabel =
          value === 1 ? unit.replace(/s$/, "") : unit;
        return `Every ${value} ${unitLabel}`;
      }
      case "monthly":
      default:
        if (patternLabel) {
          return `Monthly (${patternLabel})`;
        }
        if (debt?.dueLastDay === true) {
          return "Monthly (Last day)";
        }
        return `Monthly (Day ${dueDay})`;
    }
  },

  // A debt's explicit payoff priority (1 = first), or UNRANKED_PAYOFF for the
  // default "smallest balance first" group. Typeof-guarded: the comparator
  // runs inside the calendar render, and nothing but _normalizeDebt coerces
  // the field on the way in.
  _debtPayoffRank(debt) {
    const p = debt ? debt.payoffPriority : null;
    return Number.isInteger(p) && p >= 1 && p <= 99 ? p : UNRANKED_PAYOFF;
  },

  // THE snowball payoff order — explicit payoffPriority (lower first), then
  // smallest balance, then name, then id. Every site that decides which debt
  // the snowball works on next (the projection's lump-sum sweep, its monthly
  // target and its infusion redistribution, and the historical snapshot's
  // distributeAuto) must sort with this, or the calendar pays one debt while
  // the snapshot and the infusion breakdown (read from those two) credit
  // another. Priorities are read once here; call
  // the returned function with the balance map the site is sorting by.
  makePayoffOrder() {
    const rankById = {};
    const nameById = {};
    this.store.getDebts().forEach((debt) => {
      rankById[debt.id] = this._debtPayoffRank(debt);
      nameById[debt.id] = typeof debt.name === "string" ? debt.name : "";
    });
    const rankOf = (id) =>
      rankById[id] === undefined ? UNRANKED_PAYOFF : rankById[id];
    return (balanceMap) => (a, b) => {
      const byRank = rankOf(a) - rankOf(b);
      if (byRank !== 0) return byRank;
      const byBalance =
        (Number(balanceMap[a]) || 0) - (Number(balanceMap[b]) || 0);
      if (byBalance !== 0) return byBalance;
      const byName = (nameById[a] || "").localeCompare(nameById[b] || "");
      if (byName !== 0) return byName;
      return String(a).localeCompare(String(b));
    };
  },

  // Ensure every past debt-payment occurrence is materialized before the
  // snapshot reads "paid so far" from the transaction store. Debt minimum
  // payments are recurring and expanded lazily as months are viewed, so
  // otherwise a debt whose schedule began before any rendered month would
  // report too little paid until the user navigated back. Expansion is cached,
  // so repeat calls on a stable state are cheap. Bounded by a guard for safety
  // against far-past start dates.
  ensureDebtHistoryExpanded(cutoffDate = null) {
    if (!this.recurringManager) return;
    const recurrings = this.store
      .getRecurringTransactions()
      .filter((rt) => rt && rt.debtId && rt.startDate);
    if (!recurrings.length) return;
    let earliest = null;
    recurrings.forEach((rt) => {
      const start = Utils.parseDateString(rt.startDate);
      if (start && (!earliest || start < earliest)) {
        earliest = start;
      }
    });
    if (!earliest) return;
    const cutoff = cutoffDate instanceof Date ? cutoffDate : new Date();
    let year = earliest.getFullYear();
    let month = earliest.getMonth();
    const endYear = cutoff.getFullYear();
    const endMonth = cutoff.getMonth();
    let guard = 0;
    while (
      (year < endYear || (year === endYear && month <= endMonth)) &&
      guard < 1200
    ) {
      this.recurringManager.applyRecurringTransactions(year, month);
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
      guard += 1;
    }
  },

  // THE rule for what a debt's typed balance means, read by the historical
  // snapshot and by the projection's interest schedule (the projection seeds
  // itself from the snapshot, and the "Remaining" labels, the hero, the plan,
  // the infusion breakdown and the payoff-driven endDate all read one of the
  // two). Returns:
  //
  //   asOf         — debt payments and infusions dated on/before this day are
  //                  already in the balance; only later ones come off it. null
  //                  for a debt saved before balanceAsOf, whose balance is the
  //                  one before every recorded payment.
  //   accrualStart — the first day a month's interest posts. The month it falls
  //                  in posts on it; every later month posts on its 1st — the
  //                  timing the projection has always used from its first day.
  //
  // A balanceAsOf after today (a clock-skewed device; the form refuses one)
  // reads as today. A legacy debt's interestFrom stamp is never later than the
  // projection start, which is what the old model accrued from every day.
  _debtBalanceBasis(debt, todayString, projectionStartString) {
    const valid = (value) =>
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      this.isValidDateString(value)
        ? value
        : null;
    const stated = valid(debt ? debt.balanceAsOf : null);
    if (stated) {
      const asOf = stated > todayString ? todayString : stated;
      const next = this.getDateFromString(asOf);
      next.setDate(next.getDate() + 1);
      return { asOf, accrualStart: Utils.formatDateString(next) };
    }
    const stamp = valid(debt ? debt.interestFrom : null);
    return {
      asOf: null,
      accrualStart:
        stamp && stamp < projectionStartString ? stamp : projectionStartString,
    };
  },

  getHistoricalDebtSnapshot(cutoffDate = null) {
    const debts = this.store.getDebts();
    const byPayoffOrder = this.makePayoffOrder();
    // Materialize past debt payments first so "paid"/"remaining" do not depend
    // on which months happen to have been rendered this session.
    this.ensureDebtHistoryExpanded(cutoffDate);
    const transactions = this.store.getTransactions();
    const cashInfusions = this.store.getCashInfusions();
    const cutoffDateString = cutoffDate
      ? Utils.formatDateString(cutoffDate)
      : null;
    const roundToCents = (value) =>
      Math.round((Number(value) || 0) * 100) / 100;
    const remainingByDebtId = {};
    const paidByDebtId = {};
    const eventsByDate = new Map();

    // What this snapshot applied, per infusion id → debt id: the "Applied:"
    // breakdown for every infusion before the cutoff (see
    // calculateInfusionAllocations).
    const infusionAllocations = {};

    const ensureDateBucket = (dateString) => {
      if (!eventsByDate.has(dateString)) {
        eventsByDate.set(dateString, {
          transactions: [],
          // One list, in store order — the order the projection walk
          // applies a day's infusions in.
          infusions: [],
        });
      }
      return eventsByDate.get(dateString);
    };

    // What each debt's typed balance means (_debtBalanceBasis): which
    // payments it already reflects, and when its interest starts.
    const todayNow = new Date();
    const todayString = Utils.formatDateString(todayNow);
    const projectionStartString = Utils.formatDateString(
      new Date(todayNow.getFullYear(), todayNow.getMonth(), todayNow.getDate() + 1)
    );
    const basisById = {};
    debts.forEach((debt) => {
      remainingByDebtId[debt.id] = roundToCents(Number(debt.balance) || 0);
      paidByDebtId[debt.id] = 0;
      basisById[debt.id] = this._debtBalanceBasis(
        debt,
        todayString,
        projectionStartString
      );
    });
    // May this debt take an infusion dated `dateKey`? Not one dated on/before
    // its balance date: that money is already in the balance.
    const takesEventsOn = (debtId, dateKey) => {
      const asOf = basisById[debtId] ? basisById[debtId].asOf : null;
      return !asOf || dateKey > asOf;
    };

    // The latest balance date: a day on/after the cutoff matters only up to it.
    let latestAsOf = null;
    Object.keys(basisById).forEach((debtId) => {
      const asOf = basisById[debtId].asOf;
      if (asOf && (!latestAsOf || asOf > latestAsOf)) latestAsOf = asOf;
    });

    Object.keys(transactions).forEach((dateKey) => {
      if (
        cutoffDateString &&
        dateKey >= cutoffDateString &&
        (!latestAsOf || dateKey > latestAsOf)
      ) {
        return;
      }
      transactions[dateKey].forEach((t) => {
        if (!t.debtId || t.type !== "expense") {
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(remainingByDebtId, t.debtId)) {
          return;
        }
        if (
          t.recurringId &&
          this.recurringManager &&
          this.recurringManager.isTransactionSkipped(dateKey, t.recurringId)
        ) {
          return;
        }
        if (!takesEventsOn(t.debtId, dateKey)) {
          // Already in the typed balance. A cutoff before the balance date
          // reads the balance as it stood then, so a payment made between the
          // two is added back.
          if (cutoffDateString && dateKey >= cutoffDateString) {
            const amount = roundToCents(Number(t.amount) || 0);
            if (amount > 0) {
              remainingByDebtId[t.debtId] = roundToCents(
                remainingByDebtId[t.debtId] + amount
              );
            }
          }
          return;
        }
        if (cutoffDateString && dateKey >= cutoffDateString) {
          return;
        }
        ensureDateBucket(dateKey).transactions.push(t);
      });
    });

    cashInfusions.forEach((infusion) => {
      if (!infusion.date) return;
      if (cutoffDateString && infusion.date >= cutoffDateString) return;
      const amount = roundToCents(Number(infusion.amount) || 0);
      if (amount <= 0) return;

      const targeted =
        infusion.targetDebtId &&
        Object.prototype.hasOwnProperty.call(
          remainingByDebtId,
          infusion.targetDebtId
        );
      // Aimed at a debt whose balance date is on/after it: the payment is
      // already in that balance, all of it.
      if (targeted && !takesEventsOn(infusion.targetDebtId, infusion.date)) {
        return;
      }
      ensureDateBucket(infusion.date).infusions.push({
        id: infusion.id,
        debtId: targeted ? infusion.targetDebtId : null,
        amount,
      });
    });

    // Interest accrual, per debt, from its accrualStart (_debtBalanceBasis):
    // that month's interest posts on the accrual start, every later month's on
    // its 1st, before the day's infusions and payments — exactly the day and
    // order the projection (calculateSnowballProjection) posts it, which seeds
    // itself from this snapshot at its start. So every posting day before the
    // projection start is counted here, every later one there, and none moves
    // when "today" does (a balance date is fixed; it used to be tomorrow, so
    // the current month's interest vanished overnight at every month end).
    // Interest is never materialized as a transaction, so without this the
    // inline "Remaining" would not reconcile with the interest-inclusive
    // payoff amounts. A null cutoff accrues nothing, as before.
    const monthIndexOfString = (dateString) =>
      Number(dateString.slice(0, 4)) * 12 + Number(dateString.slice(5, 7)) - 1;
    const accruedThroughIndex = {};
    debts.forEach((debt) => {
      accruedThroughIndex[debt.id] =
        monthIndexOfString(basisById[debt.id].accrualStart) - 1;
    });
    const postingDayString = (debtId, monthIndex) => {
      const firstOfMonth = `${Math.floor(monthIndex / 12)}-${String(
        (monthIndex % 12) + 1
      ).padStart(2, "0")}-01`;
      const start = basisById[debtId].accrualStart;
      return firstOfMonth > start ? firstOfMonth : start;
    };
    // Post every month whose posting day is on/before `limit` (inclusive) or
    // strictly before it.
    const accrueThrough = (limit, inclusive) => {
      debts.forEach((debt) => {
        for (;;) {
          const next = accruedThroughIndex[debt.id] + 1;
          const posting = postingDayString(debt.id, next);
          if (inclusive ? posting > limit : posting >= limit) break;
          accruedThroughIndex[debt.id] = next;
          const balance = Number(remainingByDebtId[debt.id]) || 0;
          const rate = Number(debt.interestRate) || 0;
          if (balance <= 0 || rate <= 0) continue;
          const interest = roundToCents((balance * rate) / 1200);
          if (interest <= 0) continue;
          remainingByDebtId[debt.id] = roundToCents(balance + interest);
        }
      });
    };

    // Apply up to `amount` of one infusion to one debt; returns what it took.
    const applyInfusion = (infusionId, debtId, amount) => {
      const currentBalance = Number(remainingByDebtId[debtId]) || 0;
      if (currentBalance <= 0) {
        return 0;
      }
      const applied = roundToCents(Math.min(currentBalance, amount));
      if (applied <= 0) {
        return 0;
      }
      paidByDebtId[debtId] = roundToCents(paidByDebtId[debtId] + applied);
      remainingByDebtId[debtId] = roundToCents(currentBalance - applied);
      const byDebt =
        infusionAllocations[infusionId] || (infusionAllocations[infusionId] = {});
      byDebt[debtId] = roundToCents((byDebt[debtId] || 0) + applied);
      return applied;
    };

    // Auto-distribution in snowball payoff order (makePayoffOrder). Also takes
    // a targeted infusion whose target is already paid off by its date, and
    // the excess of one larger than its target's balance — the projection's
    // daily walk redistributes both to the surviving debts, so this snapshot
    // must do the same.
    const distributeAuto = (infusionId, amount, dateKey) => {
      let remainingInfusion = roundToCents(Number(amount) || 0);
      if (remainingInfusion <= 0) {
        return;
      }
      const debtOrder = Object.keys(remainingByDebtId)
        .filter(
          (debtId) =>
            remainingByDebtId[debtId] > 0 && takesEventsOn(debtId, dateKey)
        )
        .sort(byPayoffOrder(remainingByDebtId));

      debtOrder.forEach((debtId) => {
        if (remainingInfusion <= 0) {
          return;
        }
        remainingInfusion = roundToCents(
          remainingInfusion - applyInfusion(infusionId, debtId, remainingInfusion)
        );
      });
    };

    const sortedDates = Array.from(eventsByDate.keys()).sort();
    sortedDates.forEach((dateKey) => {
      // Post the interest due by this day before the day's events.
      if (cutoffDateString) {
        accrueThrough(dateKey, true);
      }
      const bucket = eventsByDate.get(dateKey);
      // Infusions FIRST, then the day's payments — the projection walk's
      // order. Auto-distribution sorts by the balances it finds, so the other
      // order sent a same-day windfall to a different debt than the plan did,
      // and the plan then re-seeded from this snapshot once the day passed.
      bucket.infusions.forEach((infusion) => {
        let rest = infusion.amount;
        if (infusion.debtId) {
          rest = roundToCents(
            rest - applyInfusion(infusion.id, infusion.debtId, rest)
          );
        }
        distributeAuto(infusion.id, rest, dateKey);
      });

      bucket.transactions.forEach((transaction) => {
        const debtId = transaction.debtId;
        const amount = roundToCents(Number(transaction.amount) || 0);
        if (amount <= 0) {
          return;
        }
        paidByDebtId[debtId] = roundToCents(paidByDebtId[debtId] + amount);
        remainingByDebtId[debtId] = roundToCents(
          Math.max(0, remainingByDebtId[debtId] - amount)
        );
      });
    });

    // Top up interest through the cutoff for months with no events of their
    // own (a mid-month cutoff after a quiet month): every month whose interest
    // posts before the cutoff.
    if (cutoffDateString) {
      accrueThrough(cutoffDateString, false);
    }

    return { paidByDebtId, remainingByDebtId, infusionAllocations };
  },

  getDebtSummaries(cutoffDate = null) {
    const debts = this.store.getDebts();
    const snapshot = this.getHistoricalDebtSnapshot(cutoffDate);
    return debts.map((debt) => {
      const paid = Number(snapshot.paidByDebtId[debt.id]) || 0;
      const remaining = Number(snapshot.remainingByDebtId[debt.id]) || 0;
      return {
        debt,
        paid,
        remaining,
      };
    });
  },

  calculateSnowballProjection(viewYear, viewMonth, includeExtra = true, options = {}) {
    // The walk below seeds itself from the real running balance through today
    // (getRunningBalanceForDate) and consults getReservedTotalOnOrBefore at
    // every anchor. Both read CalculationService's caches, which are otherwise
    // only refreshed by updateMonthlyBalances — and CalendarUI runs this
    // projection BEFORE that call, so right after an edit the starting
    // checking balance would still be the pre-edit figure. Same reason
    // calculateMinimum invalidates on entry.
    if (this.calculationService) {
      this.calculationService.invalidateCache();
    }
    const debts = this.store.getDebts();
    const byPayoffOrder = this.makePayoffOrder();
    const settings = this.store.getDebtSnowballSettings();
    const dailyFloor = Number(settings.dailyFloor) || 0;
    const extraStartIndex = this.parseExtraStartMonthIndex(
      settings.extraPaymentStartMonth
    );
    const applySnowball = includeExtra === true;
    // Per-debt allocation breakdowns are normally captured only for the viewed
    // month (that is all renderPlan needs). When materializing a forward window
    // the caller passes captureThroughIndex so the breakdowns needed to write
    // each future month's transactions are captured in a single projection run.
    const captureThroughIndex =
      typeof options.captureThroughIndex === "number"
        ? options.captureThroughIndex
        : null;
    const roundToCents = (value) =>
      Math.round((Number(value) || 0) * 100) / 100;
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();
    const projectionStartDate = new Date(
      currentYear,
      currentMonth,
      today.getDate() + 1
    );
    const projectionStartDateString =
      Utils.formatDateString(projectionStartDate);
    const viewIndex = this.getMonthIndex(viewYear, viewMonth);
    const currentIndex = this.getMonthIndex(currentYear, currentMonth);
    const baseYear = currentYear;
    const baseMonth = currentMonth;
    const baseDate = projectionStartDate;
    const baseSummaries = this.getDebtSummaries(baseDate);

    // For past month views, get historical balances for display
    let historicalViewBalances = null;
    if (viewIndex < currentIndex) {
      const viewDate = new Date(viewYear, viewMonth + 1, 1);
      const historicalSummaries = this.getDebtSummaries(viewDate);
      historicalViewBalances = {};
      historicalSummaries.forEach(({ debt, remaining }) => {
        historicalViewBalances[debt.id] = Number(remaining) || 0;
      });
    }
    let balances = {};
    const debtById = {};
    const recurringTemplates = {};
    baseSummaries.forEach(({ debt, remaining }) => {
      balances[debt.id] = Number(remaining) || 0;
      debtById[debt.id] = debt;
    });
    debts.forEach((debt) => {
      if (!debtById[debt.id]) {
        debtById[debt.id] = debt;
        balances[debt.id] = Number(debt.balance) || 0;
      }
      const template = this.buildDebtRecurringTransaction(debt);
      template.id =
        template.id || debt.minRecurringId || debt.id || Utils.generateUniqueId();
      recurringTemplates[debt.id] = template;
    });

    // The day each debt's interest starts (_debtBalanceBasis): the snapshot
    // above posted every month due before the projection start; the walk
    // posts the rest on the same days.
    const accrualStartById = {};
    debts.forEach((debt) => {
      accrualStartById[debt.id] = this._debtBalanceBasis(
        debt,
        Utils.formatDateString(today),
        projectionStartDateString
      ).accrualStart;
    });

    const payoffByDebtId = {};
    // Monotonic counter stamped on each payoff as it is recorded, so the UI can
    // present debts in true clearance order. The daily-floor walk clears debts
    // in payoff order (priority, then smallest *running* balance), and minimum
    // payments can clear a debt ahead of that, so the snowball's real sequence
    // is when each debt clears — not which is smallest today. Pure display
    // metadata; the projection never reads it back.
    let payoffSeq = 0;
    Object.keys(balances).forEach((debtId) => {
      if (balances[debtId] <= 0) {
        payoffByDebtId[debtId] = {
          year: baseYear,
          month: baseMonth,
          alreadyPaid: true,
          seq: payoffSeq++,
        };
      }
    });

    const monthTargets = {};
    let viewBalances = null;
    // When the current month is viewed on the last day of the month, the
    // projection starts next month (projectionStartDate = tomorrow), so the
    // daily walk below never visits the view month and its end-of-view-month
    // capture never fires. Nothing in the view month remains to project in
    // that case, so its end-of-month balances are exactly the starting
    // balances. (Past months are handled by historicalViewBalances; future
    // months are always walked.)
    const projectionStartMonthIndex = this.getMonthIndex(
      projectionStartDate.getFullYear(),
      projectionStartDate.getMonth()
    );
    if (viewIndex >= currentIndex && viewIndex < projectionStartMonthIndex) {
      viewBalances = { ...balances };
    }
    const baseIndex = this.getMonthIndex(baseYear, baseMonth);
    // 600 months is the payoff horizon for a debt that clears very slowly. With
    // nothing left to pay off there is nothing to project past the view/capture
    // window — the walk below breaks the moment it reaches it — so the horizon
    // shrinks to that window rather than building a 50-year day timeline on
    // every calendar render. The result is identical.
    const hasActiveDebt = Object.keys(balances).some(
      (debtId) => (Number(balances[debtId]) || 0) > 0
    );
    const maxMonths = Math.max(
      hasActiveDebt ? 600 : 1,
      viewIndex - baseIndex + 1,
      captureThroughIndex !== null ? captureThroughIndex - baseIndex + 1 : 0
    );

    // --- Daily floor model ---------------------------------------------------
    // The user declares a minimum daily cashflow floor; whatever the projected
    // checking balance carries above that floor — durably, across the
    // look-ahead window — is swept into a full debt payoff on the exact day the
    // cash is there (not the debt's due date). Freed-up minimums of paid-off
    // debts raise that surplus naturally, so there is no separate "fund". Walk
    // the timeline day by day.
    // How far forward a payoff must keep checking above the floor. Bounded (~1yr)
    // so a single payoff decision doesn't force expanding/scanning the entire
    // multi-decade horizon, while still covering a full seasonal cycle of bills.
    const FLOOR_LOOKAHEAD_DAYS = 366;
    const epsilon = 0.005;

    // Day timeline from the projection start across the horizon.
    const projDays = [];
    {
      const horizonEnd = new Date(baseYear, baseMonth + maxMonths, 1, 12, 0, 0);
      const cursor = new Date(
        projectionStartDate.getFullYear(),
        projectionStartDate.getMonth(),
        projectionStartDate.getDate(),
        12,
        0,
        0
      );
      while (cursor < horizonEnd) {
        const y = cursor.getFullYear();
        const m = cursor.getMonth();
        projDays.push({
          ds: Utils.formatDateString(cursor),
          year: y,
          month: m,
          day: cursor.getDate(),
          monthIndex: this.getMonthIndex(y, m),
        });
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    const numDays = projDays.length;

    // Starting checking = the real running balance through today. Everything
    // before the projection start has already happened (including any real
    // minimum/snowball payments); future days layer on top.
    let startingChecking = 0;
    if (this.calculationService) {
      const todayDateString = Utils.formatDateString(
        new Date(currentYear, currentMonth, today.getDate(), 12, 0, 0)
      );
      startingChecking =
        Number(
          this.calculationService.getRunningBalanceForDate(todayDateString)
        ) || 0;
    }

    // Lazily computed base (non-debt) cashflow per day: income − expense for the
    // day EXCLUDING debt minimum payments and snowball payoffs (the sim injects
    // those itself so it controls when they stop). `anchor` is an Ending Balance
    // that overrides the running balance for the day (reconciliation anchor).
    const dayFlowCache = new Map();
    const expandedMonths = new Set();
    const getDayFlow = (ds, year, month) => {
      let cached = dayFlowCache.get(ds);
      if (cached) return cached;
      const monthKey = `${year}-${month}`;
      if (!expandedMonths.has(monthKey)) {
        this.recurringManager.applyRecurringTransactions(year, month);
        expandedMonths.add(monthKey);
        // This walk expands months lazily as it reaches them, and it reads
        // getReservedTotalOnOrBefore on every anchor day — so the reserve index
        // must not carry across an expansion that may have materialized new
        // allocation buckets, or the projected checking balance would read HIGH
        // at later anchors (the exact input the floor check uses). Same
        // contract walkDays honors. typeof-guarded like the other cross-file
        // calls in this app: sw.js caches each script separately and serves
        // network-first, so a mixed version load is possible.
        if (
          this.calculationService &&
          typeof this.calculationService.invalidateReservedIndex === "function"
        ) {
          this.calculationService.invalidateReservedIndex();
        }
      }
      const transactions = this.store.getTransactions();
      const list = transactions[ds] || [];
      let baseNet = 0;
      let anchor = null;
      // Debt-linked expenses the sim does NOT schedule itself: real payments
      // that must come off the debt as well as out of checking.
      let debtPayments = null;
      list.forEach((t) => {
        const isSkipped =
          t.recurringId &&
          this.recurringManager.isTransactionSkipped(ds, t.recurringId);
        if (isSkipped) return;
        if (t.type === "balance") {
          anchor = Number(t.amount) || 0;
          return;
        }
        // Rows the sim injects itself are excluded so they are not
        // double-counted: recurring minimum instances (injected from each
        // debt's template in ensureMinimumsForMonth), and snowball payoffs
        // while the sweep is on (it recomputes them). A snowball row with the
        // sweep off is only kept by the sync if the user force-generated it
        // (snowballForced); any other one is about to be swept, so it stays
        // excluded too.
        //
        // Everything ELSE carrying a debtId is a real payment the calendar
        // spends and the debt snapshot credits — the copy a MOVED or
        // carried-forward SETTLED minimum leaves behind (no recurringId,
        // debtRole kept), and a force-generated payoff while auto-generate is
        // off — so the projection must pay it too.
        if (
          (t.debtRole === "minimum" && t.recurringId) ||
          (t.snowballGenerated === true &&
            (applySnowball || t.snowballForced !== true))
        ) {
          return;
        }
        if (t.type === "income") {
          baseNet = roundToCents(baseNet + (Number(t.amount) || 0));
        } else if (t.type === "expense") {
          const amount = Number(t.amount) || 0;
          baseNet = roundToCents(baseNet - amount);
          if (t.debtId && amount > 0) {
            (debtPayments = debtPayments || []).push({
              debtId: t.debtId,
              amount: roundToCents(amount),
            });
          }
        }
      });
      cached = { baseNet, anchor, debtPayments };
      dayFlowCache.set(ds, cached);
      return cached;
    };

    // Lazily computed scheduled minimum occurrences per day, keyed by date.
    // Built per month from each debt's recurrence template (clean scheduled
    // amounts, independent of any materialized/adjusted instances). Current-month
    // occurrences before the projection start are skipped (already reflected in
    // the starting balances/checking).
    const minsByDate = new Map();
    const minMonthsDone = new Set();
    const monthlyScheduledByKey = {};
    const ensureMinimumsForMonth = (year, month) => {
      const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
      if (minMonthsDone.has(monthKey)) return;
      minMonthsDone.add(monthKey);
      const totals = {};
      Object.keys(recurringTemplates).forEach((debtId) => {
        const template = recurringTemplates[debtId];
        if (!template) return;
        const occurrences = this.getRecurringOccurrencesForMonth(
          template,
          year,
          month
        );
        occurrences.forEach((occ) => {
          if (occ.dateString < projectionStartDateString) return;
          // The throwaway expansion knows nothing of the real skip list, so
          // honor it here. A skipped minimum is not paid on the calendar or in
          // the debt snapshot, so injecting it would pay the debt down faster
          // than reality. (A skip that is really a MOVE leaves a non-recurring
          // copy on the new date, which getDayFlow books as a real payment.)
          if (
            this.recurringManager &&
            this.recurringManager.isTransactionSkipped(occ.dateString, template.id)
          ) {
            return;
          }
          const amount = roundToCents(occ.amount);
          if (amount <= 0) return;
          if (!minsByDate.has(occ.dateString)) {
            minsByDate.set(occ.dateString, []);
          }
          minsByDate.get(occ.dateString).push({ debtId, amount });
          totals[debtId] = roundToCents((totals[debtId] || 0) + amount);
        });
      });
      monthlyScheduledByKey[monthKey] = totals;
    };

    // Cash infusions land on their actual date (only those on/after the
    // projection start matter; earlier ones already happened). External windfalls
    // applied straight to debt — they accelerate payoff but are NOT checking
    // outflows, so they never touch the checking balance / floor.
    const infusionsByDate = new Map();
    this.store.getCashInfusions().forEach((infusion) => {
      if (!infusion || !infusion.date) return;
      if (infusion.date < projectionStartDateString) return;
      if (!infusionsByDate.has(infusion.date)) {
        infusionsByDate.set(infusion.date, []);
      }
      infusionsByDate.get(infusion.date).push(infusion);
    });
    // What the walk actually applied, per infusion id → debt id. This IS the
    // cash-infusion list's "Applied:" breakdown for infusions on/after the
    // projection start (calculateInfusionAllocations reads it; the snapshot
    // supplies the earlier ones). There is no other simulation to disagree.
    const infusionAllocations = {};
    const recordInfusion = (infusionId, debtId, applied) => {
      const byDebt =
        infusionAllocations[infusionId] || (infusionAllocations[infusionId] = {});
      byDebt[debtId] = roundToCents((byDebt[debtId] || 0) + applied);
    };

    // Credit a day's real debt payments (see getDayFlow) to the debt balances.
    // Their checking side is already in baseNet. Returns the debt ids each one
    // cleared, so the main walk can stamp the payoff day.
    const applyDebtPayments = (balanceMap, flow) => {
      const cleared = [];
      if (!flow.debtPayments) return cleared;
      flow.debtPayments.forEach(({ debtId, amount }) => {
        const b = Number(balanceMap[debtId]) || 0;
        if (b <= 0) return;
        balanceMap[debtId] = roundToCents(b - Math.min(b, amount));
        if (balanceMap[debtId] <= epsilon) cleared.push(debtId);
      });
      return cleared;
    };

    const accrueInterest = (balanceMap, debtId) => {
      const debt = debtById[debtId];
      const balance = Number(balanceMap[debtId]) || 0;
      const interestRate =
        debt && typeof debt.interestRate === "number"
          ? debt.interestRate
          : Number(debt?.interestRate) || 0;
      if (balance <= 0 || interestRate <= 0) return;
      const interest = roundToCents((balance * interestRate) / 1200);
      if (interest <= 0) return;
      balanceMap[debtId] = roundToCents(balance + interest);
    };

    // Forward-looking floor check: the lowest the checking balance reaches from
    // `startIdx` to the end of the look-ahead window, assuming NO further lump-sum
    // payoffs (debts keep paying only their minimums until cleared). Subtracting a
    // payoff lowers the whole tail uniformly and stopping that debt's minimums
    // only raises it, so a payoff is safe whenever its balance ≤ (this min −
    // floor). Conservative w.r.t. infusions (ignored here) — never violates the
    // floor. Only invoked when today's checking already clears the candidate, so
    // it runs at most once per committed payoff.
    const forwardMinChecking = (startIdx, startChecking, debtBalances) => {
      let c = startChecking;
      let minC = startChecking;
      const bal = { ...debtBalances };
      let prevMonthKey = `${projDays[startIdx].year}-${projDays[startIdx].month}`;
      const end = Math.min(numDays, startIdx + 1 + FLOOR_LOOKAHEAD_DAYS);
      for (let i = startIdx + 1; i < end; i++) {
        const day = projDays[i];
        // Materialize this month's minimums before reading them: the main loop
        // has only ensured months up to the day it has reached, but the
        // look-ahead spans up to FLOOR_LOOKAHEAD_DAYS into not-yet-ensured
        // future months. Without this their minimums would be missing and the
        // forward checking projection would overstate available surplus.
        // Idempotent — guarded by minMonthsDone.
        ensureMinimumsForMonth(day.year, day.month);
        const mk = `${day.year}-${day.month}`;
        if (mk !== prevMonthKey) {
          Object.keys(bal).forEach((debtId) => accrueInterest(bal, debtId));
          prevMonthKey = mk;
        }
        const flow = getDayFlow(day.ds, day.year, day.month);
        applyDebtPayments(bal, flow);
        if (flow.anchor !== null) {
          // Ending Balance = gross bank total; keep allocation reserves
          // reserved across the anchor (same rule as CalculationService's
          // walk, which also seeded startingChecking reserve-aware).
          c = roundToCents(
            flow.anchor -
              (this.calculationService
                ? this.calculationService.getReservedTotalOnOrBefore(day.ds)
                : 0)
          );
        } else {
          c = roundToCents(c + flow.baseNet);
          const mins = minsByDate.get(day.ds);
          if (mins) {
            mins.forEach(({ debtId, amount }) => {
              const b = Number(bal[debtId]) || 0;
              if (b <= 0) return;
              const applied = Math.min(b, amount);
              c = roundToCents(c - applied);
              bal[debtId] = roundToCents(b - applied);
            });
          }
        }
        if (c < minC) minC = c;
      }
      return minC;
    };

    // --- Forward daily walk --------------------------------------------------
    let checking = startingChecking;
    let curMonthKey = null;
    let curMonthInfo = null;
    const flushMonthInfo = () => {
      if (!curMonthKey || !curMonthInfo) return;
      const unpaid = Object.keys(balances)
        .filter((id) => balances[id] > epsilon)
        .sort(byPayoffOrder(balances));
      curMonthInfo.targetDebtId = unpaid.length ? unpaid[0] : null;
      monthTargets[curMonthKey] = curMonthInfo;
      curMonthKey = null;
      curMonthInfo = null;
    };

    for (let i = 0; i < numDays; i++) {
      const { ds, year, month, day, monthIndex } = projDays[i];
      const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;

      if (monthKey !== curMonthKey) {
        flushMonthInfo();
        curMonthKey = monthKey;
        curMonthInfo = {
          targetDebtId: null,
          minPaidByDebtId: {},
          lumpSumPaidByDebtId: {},
          lumpSumDateByDebtId: {},
          monthlyTotalsByDebtId: {},
        };
      }

      // Interest posts once per calendar month per debt: on the 1st, or on
      // the debt's accrual start in its first month. A start before the
      // projection start was posted by the snapshot this walk seeded from, so
      // the first day posts only for a debt whose interest starts today.
      Object.keys(balances).forEach((debtId) => {
        const start = accrualStartById[debtId];
        if (day === 1 || ds === start || (start === undefined && i === 0)) {
          accrueInterest(balances, debtId);
        }
      });

      ensureMinimumsForMonth(year, month);
      const scheduledThisMonth = monthlyScheduledByKey[monthKey] || {};
      curMonthInfo.monthlyTotalsByDebtId = { ...scheduledThisMonth };
      // Seed a minPaid entry (0) for every debt scheduled to pay a minimum this
      // month, so adjustMinimumPaymentTransactions reconciles even a debt whose
      // minimum is entirely suppressed by an earlier lump-sum payoff (otherwise
      // a stale minimum would linger on the calendar in the payoff month).
      Object.keys(scheduledThisMonth).forEach((debtId) => {
        if (curMonthInfo.minPaidByDebtId[debtId] === undefined) {
          curMonthInfo.minPaidByDebtId[debtId] = 0;
        }
      });

      // Cash infusions applied straight to debt balances (not checking). Same
      // day, infusions go FIRST — before the day's real debt payments and
      // minimums — and getHistoricalDebtSnapshot applies them in the same
      // order, so a day that passes reads back exactly what the plan did.
      const dayInfusions = infusionsByDate.get(ds);
      if (dayInfusions) {
        const applyInfusion = (infusionId, debtId, amount) => {
          const b = Number(balances[debtId]) || 0;
          const applied = roundToCents(Math.min(b, amount));
          if (applied <= 0) return 0;
          balances[debtId] = roundToCents(b - applied);
          recordInfusion(infusionId, debtId, applied);
          if (balances[debtId] <= epsilon && !payoffByDebtId[debtId]) {
            payoffByDebtId[debtId] = { year, month, day, seq: payoffSeq++ };
          }
          return applied;
        };
        // Snowball payoff order (makePayoffOrder). Takes an untargeted
        // infusion, one whose target is already paid or unknown, and the
        // excess of one larger than its target's balance.
        const distributeAuto = (infusionId, amount) => {
          let remaining = amount;
          const order = Object.keys(balances)
            .filter((id) => balances[id] > 0)
            .sort(byPayoffOrder(balances));
          for (const debtId of order) {
            if (remaining <= epsilon) break;
            remaining = roundToCents(
              remaining - applyInfusion(infusionId, debtId, remaining)
            );
          }
        };
        dayInfusions.forEach((infusion) => {
          const amount = roundToCents(Number(infusion.amount) || 0);
          if (amount <= 0) return;
          let rest = amount;
          if (infusion.targetDebtId && balances[infusion.targetDebtId] > 0) {
            rest = roundToCents(
              amount - applyInfusion(infusion.id, infusion.targetDebtId, amount)
            );
          }
          if (rest > epsilon) distributeAuto(infusion.id, rest);
        });
      }

      // Apply the day's base cashflow (or reconcile to an Ending Balance) and the
      // day's scheduled minimum payments. Minimums always reduce the debt balance;
      // on an anchor day the entered figure supersedes their effect on checking.
      const flow = getDayFlow(ds, year, month);
      const onAnchor = flow.anchor !== null;
      if (onAnchor) {
        // Ending Balance = gross bank total; keep allocation reserves reserved
        // across the anchor (matches every CalculationService walk path — the
        // projection's own starting checking came from the reserve-aware
        // getRunningBalanceForDate).
        checking = roundToCents(
          flow.anchor -
            (this.calculationService
              ? this.calculationService.getReservedTotalOnOrBefore(ds)
              : 0)
        );
      } else {
        checking = roundToCents(checking + flow.baseNet);
      }
      applyDebtPayments(balances, flow).forEach((debtId) => {
        if (!payoffByDebtId[debtId]) {
          payoffByDebtId[debtId] = { year, month, day, seq: payoffSeq++ };
        }
      });
      const mins = minsByDate.get(ds);
      if (mins) {
        mins.forEach(({ debtId, amount }) => {
          const b = Number(balances[debtId]) || 0;
          if (b <= 0) return;
          const applied = Math.min(b, amount);
          balances[debtId] = roundToCents(b - applied);
          curMonthInfo.minPaidByDebtId[debtId] = roundToCents(
            (curMonthInfo.minPaidByDebtId[debtId] || 0) + applied
          );
          if (!onAnchor) {
            checking = roundToCents(checking - applied);
          }
          if (balances[debtId] <= epsilon && !payoffByDebtId[debtId]) {
            payoffByDebtId[debtId] = { year, month, day, seq: payoffSeq++ };
          }
        });
      }

      // Floor-driven payoff: sweep durable surplus above the floor into full
      // payoffs, in snowball payoff order (makePayoffOrder), on this exact
      // day. Strict: when the head debt cannot be covered yet, nothing behind
      // it is paid either — the surplus waits for the prioritized debt.
      if (applySnowball && monthIndex >= extraStartIndex) {
        while (true) {
          const order = Object.keys(balances)
            .filter((id) => balances[id] > epsilon)
            .sort(byPayoffOrder(balances));
          if (!order.length) break;
          const debtId = order[0];
          const remaining = roundToCents(balances[debtId]);
          // Cheap prune: today's checking caps the forward minimum, so skip the
          // forward scan unless today alone could already cover the payoff.
          if (roundToCents(checking - dailyFloor) + epsilon < remaining) break;
          const fwdMin = forwardMinChecking(i, checking, balances);
          const surplus = roundToCents(fwdMin - dailyFloor);
          if (remaining > surplus + epsilon) break;
          checking = roundToCents(checking - remaining);
          balances[debtId] = 0;
          curMonthInfo.lumpSumPaidByDebtId[debtId] = remaining;
          curMonthInfo.lumpSumDateByDebtId[debtId] = ds;
          if (!payoffByDebtId[debtId]) {
            payoffByDebtId[debtId] = { year, month, day, seq: payoffSeq++ };
          }
        }
      }

      // Capture the view-month balances at the end of the view month.
      const isLastDayOfViewMonth =
        year === viewYear &&
        month === viewMonth &&
        (i + 1 >= numDays ||
          projDays[i + 1].month !== viewMonth ||
          projDays[i + 1].year !== viewYear);
      if (viewBalances === null && isLastDayOfViewMonth) {
        viewBalances = { ...balances };
      }

      // Stop once every debt is cleared and we are past the view/capture window.
      const anyActive = Object.keys(balances).some(
        (id) => balances[id] > epsilon
      );
      const pastNeeded =
        monthIndex >= viewIndex &&
        (captureThroughIndex === null || monthIndex >= captureThroughIndex);
      if (!anyActive && pastNeeded) {
        flushMonthInfo();
        break;
      }
    }
    flushMonthInfo();

    if (viewBalances === null) {
      viewBalances = historicalViewBalances || { ...balances };
    }

    return {
      baseYear,
      baseMonth,
      viewYear,
      viewMonth,
      viewBalances,
      payoffByDebtId,
      monthTargets,
      dailyFloor,
      applySnowball,
      projectionStartDateString,
      infusionAllocations,
    };
  },

  // The cash-infusion list's "Applied:" breakdown, per infusion id → debt id.
  // It is READ from where the money is actually applied, never re-simulated:
  // infusions dated before the projection start from the historical snapshot
  // (which the projection seeds itself from), the rest from the projection
  // walk. A third, monthly simulation used to compute this on its own and
  // disagreed with the plan — applying a month's minimums before an infusion
  // the plan applied first, crediting debts the plan had already cleared, and
  // dropping money the plan spent. Pass the plan projection the panel is
  // showing (refresh() does); without one, the advisory plan is projected
  // for the viewed month. Every infusion gets an entry — {} for one that was
  // never applied (undated, past the last payoff, or nothing left owing).
  calculateInfusionAllocations(projection = null) {
    const infusions = this.store.getCashInfusions();
    const allocations = {};
    infusions.forEach((infusion) => {
      if (infusion && infusion.id !== undefined) allocations[infusion.id] = {};
    });
    if (infusions.length === 0 || this.store.getDebts().length === 0) {
      return allocations;
    }
    if (!projection || !projection.infusionAllocations) {
      const today = new Date();
      const viewYear =
        typeof this.currentViewYear === "number"
          ? this.currentViewYear
          : today.getFullYear();
      const viewMonth =
        typeof this.currentViewMonth === "number"
          ? this.currentViewMonth
          : today.getMonth();
      projection = this.calculateSnowballProjection(viewYear, viewMonth, true);
    }
    const startString = projection.projectionStartDateString;
    const past = this.getHistoricalDebtSnapshot(
      this.getDateFromString(startString)
    ).infusionAllocations;
    const future = projection.infusionAllocations;
    Object.keys(allocations).forEach((infusionId) => {
      const applied = past[infusionId] || future[infusionId];
      if (applied) allocations[infusionId] = { ...applied };
    });
    return allocations;
  },

});
