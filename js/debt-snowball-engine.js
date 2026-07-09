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

  getRecurringOccurrencesForMonth(recurringTransaction, year, month) {
    if (!recurringTransaction?.startDate || !recurringTransaction?.recurrence) {
      return [];
    }
    const transactions = {};
    const dummyStore = {
      getTransactions: () => transactions,
      getRecurringTransactions: () => [recurringTransaction],
      getSkippedTransactions: () => ({}),
      isTransactionSkipped: () => false,
      saveData: () => { },
    };
    const manager = new RecurringTransactionManager(dummyStore);
    manager.applyRecurringTransactions(year, month);
    const occurrences = [];
    Object.keys(transactions).forEach((dateString) => {
      transactions[dateString].forEach((t) => {
        if (t.recurringId === recurringTransaction.id) {
          occurrences.push({
            dateString,
            amount: Number(t.amount) || 0,
          });
        }
      });
    });
    occurrences.sort((a, b) => a.dateString.localeCompare(b.dateString));
    return occurrences;
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
        return `Monthly (Day ${dueDay})`;
    }
  },

  // Ensure every past debt-payment occurrence is materialized before the
  // snapshot reads "paid so far" from the transaction store. Debt minimum
  // payments are recurring and expanded lazily as months are viewed; without
  // this a debt whose schedule began before any rendered month reports too
  // little paid (and an inflated remaining balance) until the user happens to
  // navigate back. Expansion is cached, so repeat calls on a stable state are
  // cheap. Bounded by a guard for safety against far-past start dates.
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

  getHistoricalDebtSnapshot(cutoffDate = null) {
    const debts = this.store.getDebts();
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
    const debtNameById = {};
    const eventsByDate = new Map();

    const ensureDateBucket = (dateString) => {
      if (!eventsByDate.has(dateString)) {
        eventsByDate.set(dateString, {
          transactions: [],
          targetedInfusions: [],
          autoInfusions: [],
        });
      }
      return eventsByDate.get(dateString);
    };

    debts.forEach((debt) => {
      remainingByDebtId[debt.id] = roundToCents(Number(debt.balance) || 0);
      paidByDebtId[debt.id] = 0;
      debtNameById[debt.id] = debt.name || "";
    });

    Object.keys(transactions).forEach((dateKey) => {
      if (cutoffDateString && dateKey >= cutoffDateString) {
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
        ensureDateBucket(dateKey).transactions.push(t);
      });
    });

    cashInfusions.forEach((infusion) => {
      if (!infusion.date) return;
      if (cutoffDateString && infusion.date >= cutoffDateString) return;
      const amount = roundToCents(Number(infusion.amount) || 0);
      if (amount <= 0) return;

      const bucket = ensureDateBucket(infusion.date);
      if (
        infusion.targetDebtId &&
        Object.prototype.hasOwnProperty.call(
          remainingByDebtId,
          infusion.targetDebtId
        )
      ) {
        bucket.targetedInfusions.push({
          debtId: infusion.targetDebtId,
          amount,
        });
      } else {
        bucket.autoInfusions.push({ amount });
      }
    });

    // Forward interest accrual — keeps this snapshot consistent with the
    // daily-floor projection (calculateProjection), which accrues each debt's
    // monthly interest from the projection start. Interest is never materialized
    // as a transaction, so without this the inline "Remaining" (principal only)
    // would understate the balance and never reconcile with the
    // interest-inclusive snowball payoff amounts. Accrual only begins at the
    // projection start (tomorrow) and only when a cutoff beyond it is requested,
    // so past/today figures and null-cutoff callers are unchanged.
    const todayNow = new Date();
    const projectionStart = new Date(
      todayNow.getFullYear(),
      todayNow.getMonth(),
      todayNow.getDate() + 1
    );
    const projectionStartString = Utils.formatDateString(projectionStart);
    const monthIndexOf = (date) => date.getFullYear() * 12 + date.getMonth();
    const firstAccrualMonthIndex = monthIndexOf(projectionStart);
    let accruedThroughIndex = firstAccrualMonthIndex - 1;
    // The day a month's interest posts: the projection start for the partial
    // first month, otherwise the first of the month (matching the projection,
    // which accrues on the first projected day it sees in each month).
    const accrualDayString = (monthIndex) => {
      const firstOfMonth = new Date(
        Math.floor(monthIndex / 12),
        monthIndex % 12,
        1
      );
      const day = firstOfMonth > projectionStart ? firstOfMonth : projectionStart;
      return Utils.formatDateString(day);
    };
    const accrueForwardThroughMonth = (targetMonthIndex) => {
      while (accruedThroughIndex < targetMonthIndex) {
        accruedThroughIndex += 1;
        debts.forEach((debt) => {
          const balance = Number(remainingByDebtId[debt.id]) || 0;
          const rate = Number(debt.interestRate) || 0;
          if (balance <= 0 || rate <= 0) return;
          const interest = roundToCents((balance * rate) / 1200);
          if (interest <= 0) return;
          remainingByDebtId[debt.id] = roundToCents(balance + interest);
        });
      }
    };

    // Auto-distribution: smallest remaining balance first (name tiebreak).
    // Also used for a targeted infusion whose target is already paid off by its
    // date — the projection's daily walk redistributes that windfall to the
    // surviving debts, so this snapshot must do the same or payoff dates jump
    // back once the infusion date passes into history.
    const distributeAuto = (amount) => {
      let remainingInfusion = roundToCents(Number(amount) || 0);
      if (remainingInfusion <= 0) {
        return;
      }
      const debtOrder = Object.keys(remainingByDebtId)
        .filter((debtId) => remainingByDebtId[debtId] > 0)
        .sort((leftId, rightId) => {
          if (remainingByDebtId[leftId] !== remainingByDebtId[rightId]) {
            return remainingByDebtId[leftId] - remainingByDebtId[rightId];
          }
          return debtNameById[leftId].localeCompare(debtNameById[rightId]);
        });

      debtOrder.forEach((debtId) => {
        if (remainingInfusion <= 0) {
          return;
        }
        const currentBalance = Number(remainingByDebtId[debtId]) || 0;
        if (currentBalance <= 0) {
          return;
        }
        const applied = roundToCents(
          Math.min(currentBalance, remainingInfusion)
        );
        if (applied <= 0) {
          return;
        }
        paidByDebtId[debtId] = roundToCents(paidByDebtId[debtId] + applied);
        remainingByDebtId[debtId] = roundToCents(currentBalance - applied);
        remainingInfusion = roundToCents(remainingInfusion - applied);
      });
    };

    const sortedDates = Array.from(eventsByDate.keys()).sort();
    sortedDates.forEach((dateKey) => {
      // Post each forward month's interest before that month's payments.
      if (cutoffDateString && dateKey >= projectionStartString) {
        const parsed = Utils.parseDateString(dateKey);
        if (parsed) {
          accrueForwardThroughMonth(monthIndexOf(parsed));
        }
      }
      const bucket = eventsByDate.get(dateKey);
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

      bucket.targetedInfusions.forEach((infusion) => {
        const currentBalance = Number(remainingByDebtId[infusion.debtId]) || 0;
        if (currentBalance <= 0) {
          // Target already cleared by this date — redistribute snowball-style,
          // matching the projection walk's targeted-infusion fallback.
          distributeAuto(infusion.amount);
          return;
        }
        const applied = roundToCents(
          Math.min(currentBalance, Number(infusion.amount) || 0)
        );
        if (applied <= 0) {
          return;
        }
        paidByDebtId[infusion.debtId] = roundToCents(
          paidByDebtId[infusion.debtId] + applied
        );
        remainingByDebtId[infusion.debtId] = roundToCents(
          currentBalance - applied
        );
      });

      bucket.autoInfusions.forEach((infusion) => {
        distributeAuto(infusion.amount);
      });
    });

    // Top up interest through the cutoff for months with no events of their own
    // (e.g. a mid-month cutoff after a quiet month). Accrue the cutoff month only
    // if its interest posts before the cutoff; earlier forward months always do.
    if (cutoffDateString && projectionStartString < cutoffDateString) {
      const cutoffMonthIndex = monthIndexOf(cutoffDate);
      const target =
        accrualDayString(cutoffMonthIndex) < cutoffDateString
          ? cutoffMonthIndex
          : cutoffMonthIndex - 1;
      if (target >= firstAccrualMonthIndex) {
        accrueForwardThroughMonth(target);
      }
    }

    return { paidByDebtId, remainingByDebtId };
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
    const debts = this.store.getDebts();
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

    // Group cash infusions by month
    const cashInfusions = this.store.getCashInfusions();
    const infusionsByMonthKey = {};
    cashInfusions.forEach((infusion) => {
      if (!infusion.date) return;
      const infusionDate = this.getDateFromString(infusion.date);
      if (!infusionDate) return;
      const infusionYear = infusionDate.getFullYear();
      const infusionMonth = infusionDate.getMonth();
      const key = `${infusionYear}-${String(infusionMonth + 1).padStart(2, "0")}`;
      if (!infusionsByMonthKey[key]) {
        infusionsByMonthKey[key] = [];
      }
      infusionsByMonthKey[key].push(infusion);
    });

    const payoffByDebtId = {};
    // Monotonic counter stamped on each payoff as it is recorded, so the UI can
    // present debts in true clearance order. The daily-floor walk clears the
    // smallest *running* balance first, and minimum payments reshuffle that order
    // over time, so the snowball's real sequence is when each debt clears — not
    // which is smallest today. Pure display metadata; the projection never reads
    // it back.
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
    // capture never fires — leaving viewBalances to fall through to post-walk
    // (next-month) balances, which understates every figure by next month's
    // payments. Nothing in the view month remains to project in that case, so
    // its end-of-month balances are exactly the starting balances. (Past months
    // are handled by historicalViewBalances; future months are always walked.)
    const projectionStartMonthIndex = this.getMonthIndex(
      projectionStartDate.getFullYear(),
      projectionStartDate.getMonth()
    );
    if (viewIndex >= currentIndex && viewIndex < projectionStartMonthIndex) {
      viewBalances = { ...balances };
    }
    const baseIndex = this.getMonthIndex(baseYear, baseMonth);
    const maxMonths = Math.max(
      600,
      viewIndex - baseIndex + 1,
      captureThroughIndex !== null ? captureThroughIndex - baseIndex + 1 : 0
    );

    // --- Daily floor model ---------------------------------------------------
    // The snowball no longer sets aside a fixed monthly amount. The user declares
    // a minimum daily cashflow floor; whatever the projected checking balance
    // carries above that floor — durably, across the look-ahead window — is swept
    // into a full debt payoff on the exact day the cash is there (not the debt's
    // due date). Freed-up minimums of paid-off debts raise that surplus naturally,
    // so there is no separate "fund". Walk the timeline day by day.
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
      }
      const transactions = this.store.getTransactions();
      const list = transactions[ds] || [];
      let baseNet = 0;
      let anchor = null;
      list.forEach((t) => {
        const isSkipped =
          t.recurringId &&
          this.recurringManager.isTransactionSkipped(ds, t.recurringId);
        if (isSkipped) return;
        if (t.type === "balance") {
          anchor = Number(t.amount) || 0;
          return;
        }
        // Debt minimums and snowball payoffs are injected by the sim — exclude
        // the materialized rows here so they are not double-counted.
        if (t.debtRole === "minimum" || t.snowballGenerated === true) return;
        if (t.type === "income") {
          baseNet = roundToCents(baseNet + (Number(t.amount) || 0));
        } else if (t.type === "expense") {
          baseNet = roundToCents(baseNet - (Number(t.amount) || 0));
        }
      });
      cached = { baseNet, anchor };
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
    const monthAccrued = new Set();
    let curMonthKey = null;
    let curMonthInfo = null;
    const flushMonthInfo = () => {
      if (!curMonthKey || !curMonthInfo) return;
      const unpaid = Object.keys(balances)
        .filter((id) => balances[id] > epsilon)
        .sort((a, b) => balances[a] - balances[b]);
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

      // Interest accrues once per calendar month (including the first, partial
      // month — matching the prior monthly model).
      if (!monthAccrued.has(monthKey)) {
        Object.keys(balances).forEach((debtId) =>
          accrueInterest(balances, debtId)
        );
        monthAccrued.add(monthKey);
      }

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

      // Cash infusions applied straight to debt balances (not checking).
      const dayInfusions = infusionsByDate.get(ds);
      if (dayInfusions) {
        dayInfusions.forEach((infusion) => {
          const amount = roundToCents(Number(infusion.amount) || 0);
          if (amount <= 0) return;
          if (infusion.targetDebtId && balances[infusion.targetDebtId] > 0) {
            const b = Number(balances[infusion.targetDebtId]) || 0;
            const applied = Math.min(b, amount);
            balances[infusion.targetDebtId] = roundToCents(b - applied);
            if (
              balances[infusion.targetDebtId] <= epsilon &&
              !payoffByDebtId[infusion.targetDebtId]
            ) {
              payoffByDebtId[infusion.targetDebtId] = {
                year,
                month,
                day,
                seq: payoffSeq++,
              };
            }
          } else {
            let remaining = amount;
            const order = Object.keys(balances)
              .filter((id) => balances[id] > 0)
              .sort((a, b) => balances[a] - balances[b]);
            for (const debtId of order) {
              if (remaining <= epsilon) break;
              const b = Number(balances[debtId]) || 0;
              if (b <= 0) continue;
              const applied = roundToCents(Math.min(b, remaining));
              balances[debtId] = roundToCents(b - applied);
              remaining = roundToCents(remaining - applied);
              if (balances[debtId] <= epsilon && !payoffByDebtId[debtId]) {
                payoffByDebtId[debtId] = { year, month, day, seq: payoffSeq++ };
              }
            }
          }
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
      // payoffs, smallest balance first, on this exact day.
      if (applySnowball && monthIndex >= extraStartIndex) {
        while (true) {
          const order = Object.keys(balances)
            .filter((id) => balances[id] > epsilon)
            .sort((a, b) => balances[a] - balances[b]);
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
      // For past months, use historical balances; otherwise use projected balances
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
    };
  },

  calculateInfusionAllocations(projection = null) {
    // This method calculates how each infusion is allocated to debts by running
    // a month-by-month projection and tracking infusion-specific allocations.
    // When the plan projection is supplied (the normal render path), its
    // lump-sum payoff schedule is overlaid so a debt the plan has already paid
    // off is not credited with a later infusion — keeping this breakdown's
    // surviving-debt set in step with the hero card / plan list. Past-dated
    // infusions, which the forward plan projection does not cover, still
    // reconstruct from their own month.
    const infusions = this.store.getCashInfusions();
    const debts = this.store.getDebts();
    const settings = this.store.getDebtSnowballSettings();
    const roundToCents = (value) =>
      Math.round((Number(value) || 0) * 100) / 100;

    if (infusions.length === 0 || debts.length === 0) {
      return {};
    }

    // Group infusions by month
    const infusionsByMonthKey = {};
    infusions.forEach((infusion) => {
      if (!infusion.date) return;
      const infusionDate = this.getDateFromString(infusion.date);
      if (!infusionDate) return;
      const infusionYear = infusionDate.getFullYear();
      const infusionMonth = infusionDate.getMonth();
      const key = `${infusionYear}-${String(infusionMonth + 1).padStart(2, "0")}`;
      if (!infusionsByMonthKey[key]) {
        infusionsByMonthKey[key] = [];
      }
      infusionsByMonthKey[key].push(infusion);
    });

    // Find the earliest infusion date to start projection from
    const sortedInfusions = [...infusions].sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    const earliestDate = this.getDateFromString(sortedInfusions[0].date);
    const latestDate = this.getDateFromString(sortedInfusions[sortedInfusions.length - 1].date);

    if (!earliestDate) return {};

    const today = new Date();
    // Start the projection at the earlier of the first infusion's month and the
    // current month, compared as absolute year-month indices. Component-wise
    // min(year)/min(month) is wrong when the two dates fall in different years
    // (e.g. earliest 2025-11, today 2026-06 would yield 2025-06): it can start
    // the projection before the first infusion and over-compound simulated
    // interest, skewing each infusion's allocation breakdown.
    const startIndex = Math.min(
      this.getMonthIndex(earliestDate.getFullYear(), earliestDate.getMonth()),
      this.getMonthIndex(today.getFullYear(), today.getMonth())
    );
    const startYear = Math.floor(startIndex / 12);
    const startMonth = startIndex % 12;

    const endYear = latestDate ? latestDate.getFullYear() : today.getFullYear();
    const endMonth = latestDate ? latestDate.getMonth() : today.getMonth();

    // Build initial balances
    const baseDate = new Date(startYear, startMonth, 1);
    const baseSummaries = this.getDebtSummaries(baseDate);
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
      template.id = template.id || debt.minRecurringId || debt.id || Utils.generateUniqueId();
      recurringTemplates[debt.id] = template;
    });

    const payoffByDebtId = {};
    Object.keys(balances).forEach((debtId) => {
      if (balances[debtId] <= 0) {
        payoffByDebtId[debtId] = { year: startYear, month: startMonth, alreadyPaid: true };
      }
    });

    // Track allocations per infusion
    const infusionAllocations = {};
    infusions.forEach((inf) => {
      infusionAllocations[inf.id] = {};
    });

    // Month index at which the real plan pays each debt off (lump sum, minimum
    // or infusion). Used to drop debts from the candidate set in months strictly
    // after the plan clears them, so the surviving-debt set matches the plan.
    const planPayoffIndexByDebtId = {};
    if (projection && projection.payoffByDebtId) {
      Object.keys(projection.payoffByDebtId).forEach((debtId) => {
        const p = projection.payoffByDebtId[debtId];
        if (p && typeof p.year === "number" && typeof p.month === "number") {
          planPayoffIndexByDebtId[debtId] = this.getMonthIndex(p.year, p.month);
        }
      });
    }

    // Run projection month by month
    let year = startYear;
    let month = startMonth;
    const maxMonths = (endYear - startYear) * 12 + (endMonth - startMonth) + 12; // Add buffer

    for (let i = 0; i < maxMonths; i++) {
      const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
      const monthIndex = this.getMonthIndex(year, month);

      // Calculate monthly minimums
      const monthlyTotalsByDebtId = {};
      Object.keys(recurringTemplates).forEach((debtId) => {
        const template = recurringTemplates[debtId];
        if (!template) {
          monthlyTotalsByDebtId[debtId] = 0;
          return;
        }
        const occurrences = this.getRecurringOccurrencesForMonth(template, year, month);
        const totalPayment = roundToCents(
          occurrences.reduce((sum, occ) => sum + occ.amount, 0)
        );
        monthlyTotalsByDebtId[debtId] = totalPayment;
      });

      // Apply interest
      Object.keys(balances).forEach((debtId) => {
        const debt = debtById[debtId];
        const balance = Number(balances[debtId]) || 0;
        const interestRate = debt?.interestRate || 0;
        if (balance <= 0 || interestRate <= 0) return;
        const interest = roundToCents((balance * interestRate) / 1200);
        if (interest > 0) {
          balances[debtId] = roundToCents(balance + interest);
        }
      });

      // Apply minimum payments
      Object.keys(balances).forEach((debtId) => {
        const balance = Number(balances[debtId]) || 0;
        const scheduledMin = Number(monthlyTotalsByDebtId[debtId]) || 0;
        if (balance <= 0 || scheduledMin <= 0) return;
        const actualMin = roundToCents(Math.min(balance, scheduledMin));
        balances[debtId] = roundToCents(balance - actualMin);
      });

      // Overlay the real plan's payoffs: a debt the snowball plan cleared in a
      // strictly earlier month is gone, so an infusion here must skip it and
      // flow to the next surviving debt. The payoff month itself is left active
      // so an infusion landing the same month the plan clears the debt is still
      // attributed to it (the plan applies infusions before its lump-sum sweep).
      Object.keys(planPayoffIndexByDebtId).forEach((debtId) => {
        if (
          planPayoffIndexByDebtId[debtId] < monthIndex &&
          Number(balances[debtId]) > 0
        ) {
          balances[debtId] = 0;
        }
      });

      // Get infusions for this month
      const monthInfusions = infusionsByMonthKey[monthKey] || [];

      // Process each infusion individually to track allocation
      monthInfusions.forEach((infusion) => {
        const infusionAmount = Number(infusion.amount) || 0;
        if (infusionAmount <= 0) return;

        if (infusion.targetDebtId && balances[infusion.targetDebtId] > 0) {
          // Targeted infusion
          const currentBalance = Number(balances[infusion.targetDebtId]) || 0;
          const applied = Math.min(currentBalance, infusionAmount);
          balances[infusion.targetDebtId] = roundToCents(currentBalance - applied);
          infusionAllocations[infusion.id][infusion.targetDebtId] = applied;
          if (balances[infusion.targetDebtId] === 0 && !payoffByDebtId[infusion.targetDebtId]) {
            payoffByDebtId[infusion.targetDebtId] = { year, month };
          }
        } else {
          // Auto infusion — or a targeted infusion whose target is already
          // paid off/unknown, redistributed like the projection walk and the
          // historical snapshot - apply snowball priority
          const debtOrder = Object.keys(balances)
            .filter((debtId) => balances[debtId] > 0)
            .sort((a, b) => balances[a] - balances[b]);

          let remaining = infusionAmount;
          debtOrder.forEach((debtId) => {
            if (remaining <= 0) return;
            const currentBalance = Number(balances[debtId]) || 0;
            if (currentBalance <= 0) return;
            const applied = Math.min(currentBalance, remaining);
            balances[debtId] = roundToCents(currentBalance - applied);
            infusionAllocations[infusion.id][debtId] =
              (infusionAllocations[infusion.id][debtId] || 0) + applied;
            remaining -= applied;
            if (balances[debtId] === 0 && !payoffByDebtId[debtId]) {
              payoffByDebtId[debtId] = { year, month };
            }
          });
        }
      });

      // Check if all debts are paid
      const activeDebtIds = Object.keys(balances).filter((id) => balances[id] > 0);
      if (activeDebtIds.length === 0) break;

      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }

    return infusionAllocations;
  },

});
