// Calculation service

class CalculationService {

  constructor(store, recurringManager) {
    this.store = store;
    this.recurringManager = recurringManager;
    this._cachedSummaries = {};
    this._cachedDailyTotals = {};
    this._cachedReservedTotals = {};
  }

  // Round to cents to prevent floating-point drift in balance calculations
  roundToCents(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }


  invalidateCache() {
    this._cachedSummaries = {};
    this._cachedDailyTotals = {};
    this._cachedReservedTotals = {};
  }

  // Sum of currently-live allocation reserves dated on/before `dateString`.
  // An Ending Balance is the gross bank total (reserved funds are still
  // physically in the account), so at every reconciliation anchor these
  // reserves are subtracted from the entered figure — keeping them reserved
  // across the anchor instead of letting the Ending Balance absorb them.
  // Skip-aware, matching how calculateDailyTotals sums allocated expenses.
  getReservedTotalOnOrBefore(dateString) {
    if (this._cachedReservedTotals[dateString] !== undefined) {
      return this._cachedReservedTotals[dateString];
    }
    const transactions = this.store.getTransactions();
    let total = 0;
    for (const d in transactions) {
      if (d > dateString) continue;
      transactions[d].forEach((t) => {
        if (t.type !== "expense" || t.allocated !== true) return;
        if (
          t.recurringId &&
          this.recurringManager.isTransactionSkipped(d, t.recurringId)
        ) {
          return;
        }
        total = this.roundToCents(total + t.amount);
      });
    }
    total = this.roundToCents(total);
    this._cachedReservedTotals[dateString] = total;
    return total;
  }


  // The date of the most recent Ending Balance ("reconciliation anchor")
  // within the given bound, or null. An Ending Balance is authoritative: every
  // unsettled expense dated on/before the anchor is treated as reconciled and
  // no longer drags the displayed/running balance. Removing the Ending Balance
  // removes the anchor, so those items resume dragging — nothing is mutated.
  getReconciliationAnchor(boundaryDateString, { inclusive = false } = {}) {
    const transactions = this.store.getTransactions();
    let anchor = null;
    for (const date in transactions) {
      const withinBound = inclusive
        ? date <= boundaryDateString
        : date < boundaryDateString;
      if (!withinBound) continue;
      if (transactions[date].some((t) => t.type === "balance")) {
        if (anchor === null || date > anchor) {
          anchor = date;
        }
      }
    }
    return anchor;
  }


  updateMonthlyBalances(viewedDate) {
    // Invalidate cache at the START to ensure fresh calculations
    this.invalidateCache();

    const transactions = this.store.getTransactions();
    const monthlyBalances = this.store.getMonthlyBalances();
    for (const key in monthlyBalances) {
      delete monthlyBalances[key];
    }
    let earliestDate = null;
    let latestDate = null;
    for (const dateString in transactions) {
      const [year, month, day] = dateString.split("-").map(Number);
      const transactionDate = new Date(year, month - 1, day, 12, 0, 0);
      if (earliestDate === null || transactionDate < earliestDate) {
        earliestDate = transactionDate;
      }
      if (latestDate === null || transactionDate > latestDate) {
        latestDate = transactionDate;
      }
    }
    if (viewedDate) {
      const viewedMonthStart = new Date(viewedDate.getFullYear(), viewedDate.getMonth(), 1, 12, 0, 0);

      if (!latestDate || viewedMonthStart > latestDate) {
        latestDate = viewedMonthStart;
      }

      // Always calculate at least 6 months ahead to ensure future month balances propagate correctly
      const futureMonthCap = new Date(viewedDate.getFullYear(), viewedDate.getMonth() + 6, 1, 12, 0, 0);
      if (futureMonthCap > latestDate) {
        latestDate = futureMonthCap;
      }

      if (!earliestDate) {
        earliestDate = viewedMonthStart;
      }
    }
    if (!earliestDate) {
      const today = new Date();
      // Use padded month format consistently: YYYY-MM
      const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

      monthlyBalances[currentMonthKey] = {
        startingBalance: 0,
        endingBalance: 0
      };

      if (viewedDate) {
        const viewedMonthKey = `${viewedDate.getFullYear()}-${String(viewedDate.getMonth() + 1).padStart(2, "0")}`;

        if (viewedMonthKey !== currentMonthKey) {
          monthlyBalances[viewedMonthKey] = {
            startingBalance: 0,
            endingBalance: 0
          };
        }
      }

      return;
    }
    const allMonths = [];
    const startYear = earliestDate.getFullYear();
    const startMonth = earliestDate.getMonth() + 1;
    const endYear = latestDate.getFullYear();
    const endMonth = latestDate.getMonth() + 1;
    for (let year = startYear; year <= endYear; year++) {
      const firstMonth = (year === startYear) ? startMonth : 1;
      const lastMonth = (year === endYear) ? endMonth : 12;

      for (let month = firstMonth; month <= lastMonth; month++) {
        // Use padded month format consistently: YYYY-MM
        allMonths.push(`${year}-${String(month).padStart(2, "0")}`);
      }
    }
    const lastMonthYear = endYear;
    const lastMonthMonth = endMonth;

    const nextMonth = lastMonthMonth === 12
      ? `${lastMonthYear + 1}-01`
      : `${lastMonthYear}-${String(lastMonthMonth + 1).padStart(2, "0")}`;
    if (!allMonths.includes(nextMonth)) {
      allMonths.push(nextMonth);
    }
    allMonths.sort((a, b) => {
      const [yearA, monthA] = a.split('-').map(Number);
      const [yearB, monthB] = b.split('-').map(Number);

      if (yearA !== yearB) {
        return yearA - yearB;
      }
      return monthA - monthB;
    });

    // Ensure recurring transactions are expanded for all months before
    // calculating balances. The cache prevents redundant expansion.
    allMonths.forEach((monthKey) => {
      const [year, month] = monthKey.split("-").map(Number);
      // month in monthKey is 1-indexed, applyRecurringTransactions expects 0-indexed
      this.recurringManager.applyRecurringTransactions(year, month - 1);
    });

    let previousBalance = 0;
    allMonths.forEach((monthKey, index) => {
      const [year, month] = monthKey.split("-").map(Number);
      let monthIncome = 0;
      let monthExpense = 0;
      let runningBalance = previousBalance;
      let firstDayBalance = null;
      const isFirstMonth = index === 0;
      const daysInMonth = new Date(year, month, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const dateString = Utils.formatDateString(new Date(year, month - 1, day, 12, 0, 0));

        if (transactions[dateString]) {
          let balanceSet = false;
          let dailyBalance = runningBalance;
          transactions[dateString].forEach((t) => {
            if (t.type === "balance") {
              balanceSet = true;
              dailyBalance = t.amount;
            }
          });
          if (balanceSet) {
            // An Ending Balance is the gross bank total, shown as-is for
            // unsettled purposes (those on/before are reconciled). Allocation
            // reserves, however, stay reserved across the anchor: subtract every
            // still-live reserve dated on/before it so the running balance is
            // available-after-reserves.
            dailyBalance = this.roundToCents(
              dailyBalance - this.getReservedTotalOnOrBefore(dateString)
            );
          }
          if (day === 1 && balanceSet) {
            firstDayBalance = dailyBalance;
          }
          // Only apply income/expense if no balance transaction was set
          // "Ending Balance" means that IS the final balance for the day
          if (!balanceSet) {
            transactions[dateString].forEach((t) => {
              const isSkipped =
                t.recurringId &&
                this.recurringManager.isTransactionSkipped(
                  dateString,
                  t.recurringId
                );

              if (!isSkipped) {
                if (t.type === "income") {
                  monthIncome = this.roundToCents(monthIncome + t.amount);
                  dailyBalance = this.roundToCents(dailyBalance + t.amount);
                } else if (t.type === "expense") {
                  monthExpense = this.roundToCents(monthExpense + t.amount);
                  dailyBalance = this.roundToCents(dailyBalance - t.amount);
                }
              }
            });
          }

          runningBalance = dailyBalance;
        }
      }
      if (firstDayBalance !== null) {
        monthlyBalances[monthKey] = {
          startingBalance: this.roundToCents(firstDayBalance),
          endingBalance: this.roundToCents(runningBalance),
        };
      } else {
        monthlyBalances[monthKey] = {
          startingBalance: this.roundToCents(isFirstMonth ? 0 : previousBalance),
          endingBalance: this.roundToCents(runningBalance),
        };
      }
      previousBalance = monthlyBalances[monthKey].endingBalance;
    });
    // derived data (monthlyBalances) is updated in memory, no need to persist to disk on every view
  }


  calculateDailyTotals(dateString) {
    if (this._cachedDailyTotals[dateString]) {
      return this._cachedDailyTotals[dateString];
    }

    const transactions = this.store.getTransactions();
    let income = 0;
    let expense = 0;
    let unsettledExpense = 0;
    let allocatedExpense = 0;
    let balance = null;
    let hasSkippedTransactions = false;
    let hasAllocated = false;

    if (transactions[dateString]) {
      const dailyTransactions = transactions[dateString];

      hasSkippedTransactions = dailyTransactions.some((t) => {
        if (
          !t.recurringId ||
          !this.recurringManager.isTransactionSkipped(dateString, t.recurringId)
        ) {
          return false;
        }
        // A skipped occurrence that was moved to a later date is an
        // "(Authorized)" payment that clears later, not a real skip — don't
        // flag the day with a skip star.
        const move = this.store.getMoveForRecurring(t.recurringId, dateString);
        return !(move && move.toDate > dateString);
      });

      dailyTransactions.forEach((t) => {
        const isSkipped =
          t.recurringId &&
          this.recurringManager.isTransactionSkipped(dateString, t.recurringId);

        if (!isSkipped) {
          // INTENTIONAL: income/expense are summed independently of `balance`.
          // On a day that also carries an Ending Balance (reconciliation anchor),
          // the balance-walk paths (updateMonthlyBalances / getRunningBalanceForDate
          // / calculateMinimum) deliberately do NOT re-apply that day's income/
          // expense — the entered figure already reconciles same-day activity. The
          // gross income/expense are still reported here so the calendar day cell
          // and Monthly Summary can show the activity for the record. The day cell
          // showing +income/-expense while the balance equals the anchor is the
          // expected, by-design result — not a bug to reconcile.
          if (t.type === "balance") {
            balance = t.amount;
          } else if (t.type === "income") {
            income = this.roundToCents(income + t.amount);
          } else if (t.type === "expense") {
            expense = this.roundToCents(expense + t.amount);
            if (t.settled === false) {
              unsettledExpense = this.roundToCents(unsettledExpense + t.amount);
            }
            // Sum all allocated expenses (one-time + recurring) so the calendar
            // can show a "balance excluding allocations" figure that adds these
            // reserved buckets back to the running balance.
            if (t.allocated === true) {
              allocatedExpense = this.roundToCents(allocatedExpense + t.amount);
            }
            // Only one-time allocated expenses tint the day purple. Recurring
            // allocated instances (carry a recurringId) repeat often enough that
            // shading every occurrence is noise, not signal.
            if (t.allocated === true && !t.recurringId) {
              hasAllocated = true;
            }
          }
        }
      });
    }

    const result = {
      income: this.roundToCents(income),
      expense: this.roundToCents(expense),
      unsettledExpense: this.roundToCents(unsettledExpense),
      allocatedExpense: this.roundToCents(allocatedExpense),
      balance: balance !== null ? this.roundToCents(balance) : null,
      hasSkippedTransactions,
      hasAllocated,
    };
    this._cachedDailyTotals[dateString] = result;

    return result;
  }

  // THE shared day-by-day running-balance walk. Every balance path in the app
  // (monthly balances, running balance, day breakdown, 30-day minimum, the
  // calendar's display and min/crisis loops) must step through days via this
  // method so the canonical rules live in exactly one place:
  //   - normal day:  balance += income − expense
  //   - Ending Balance day (reconciliation anchor): balance RESETS to the
  //     entered figure minus getReservedTotalOnOrBefore(date) (allocation
  //     reserves stay reserved across the anchor), the carried-unsettled
  //     accumulator resets to 0, and the allocation accumulator resets to the
  //     reserved total. The day's own income/expense are NOT re-applied — the
  //     entered figure already reconciles same-day activity.
  // Walks [startDateString, endDateString] inclusive; if start > end it runs
  // zero iterations and returns the seeds unchanged. Never invalidates caches;
  // callers own invalidation. `ensureRecurringExpansion` expands each month
  // once, immediately before computing that month's first day.
  // See [[balance-walk-paths]].
  walkDays(startDateString, endDateString, {
    seedBalance,
    seedUnsettled = 0,
    seedAllocated = 0,
    trackUnsettled = false,
    trackAllocations = false,
    ensureRecurringExpansion = false,
    onDay = null,
  }) {
    let balance = this.roundToCents(seedBalance);
    let unsettledCarry = this.roundToCents(seedUnsettled);
    let allocatedCarry = this.roundToCents(seedAllocated);
    let lastDailyTotals = null;

    if (startDateString <= endDateString) {
      const [sy, sm, sd] = startDateString.split("-").map(Number);
      const [ey, em, ed] = endDateString.split("-").map(Number);
      const startMid = new Date(sy, sm - 1, sd, 12, 0, 0);
      const endMid = new Date(ey, em - 1, ed, 12, 0, 0);
      const dayCount = Math.round((endMid - startMid) / 86400000);
      const expandedMonths = ensureRecurringExpansion ? new Set() : null;

      for (let i = 0; i <= dayCount; i++) {
        const cursor = new Date(sy, sm - 1, sd + i, 12, 0, 0);
        const year = cursor.getFullYear();
        const month = cursor.getMonth() + 1;
        const day = cursor.getDate();
        const dateString = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

        if (expandedMonths) {
          const monthKey = `${year}-${month}`;
          if (!expandedMonths.has(monthKey)) {
            this.recurringManager.applyRecurringTransactions(year, month - 1);
            expandedMonths.add(monthKey);
          }
        }

        const dailyTotals = this.calculateDailyTotals(dateString);
        lastDailyTotals = dailyTotals;
        const isAnchor = dailyTotals.balance !== null;
        let reservedOnOrBefore = null;
        if (isAnchor) {
          reservedOnOrBefore = this.getReservedTotalOnOrBefore(dateString);
          balance = this.roundToCents(dailyTotals.balance - reservedOnOrBefore);
          if (trackUnsettled) unsettledCarry = 0;
          if (trackAllocations) allocatedCarry = reservedOnOrBefore;
        } else {
          balance = this.roundToCents(balance + dailyTotals.income - dailyTotals.expense);
          if (trackUnsettled) {
            unsettledCarry = this.roundToCents(unsettledCarry + dailyTotals.unsettledExpense);
          }
          if (trackAllocations) {
            allocatedCarry = this.roundToCents(allocatedCarry + dailyTotals.allocatedExpense);
          }
        }

        if (onDay) {
          const keepGoing = onDay({
            dateString, year, month, day,
            dailyTotals, isAnchor, reservedOnOrBefore,
            balance, unsettledCarry, allocatedCarry,
          });
          if (keepGoing === false) break;
        }
      }
    }

    return { balance, unsettledCarry, allocatedCarry, lastDailyTotals };
  }

  // Seeds for walking a month from its first day: the month's starting balance
  // plus (optionally) the carried-forward accumulators. Unsettled carry counts
  // only unsettled items after the most recent anchor strictly before the
  // month (an Ending Balance reconciles everything on/before it); allocation
  // reserves persist across anchors, so their carry is every live bucket dated
  // before the month regardless of anchors.
  getMonthSeed(year, month0, { trackUnsettled = false, trackAllocations = false } = {}) {
    const summary = this.calculateMonthlySummary(year, month0);
    const monthStartStr = `${year}-${String(month0 + 1).padStart(2, "0")}-01`;

    let unsettledCarry = 0;
    if (trackUnsettled) {
      const carryAnchor = this.getReconciliationAnchor(monthStartStr, { inclusive: false });
      for (const u of this.store.getUnsettledTransactions()) {
        if (u.date < monthStartStr && (carryAnchor === null || u.date > carryAnchor)) {
          unsettledCarry = this.roundToCents(unsettledCarry + u.transaction.amount);
        }
      }
    }

    let allocatedCarry = 0;
    if (trackAllocations) {
      const prevMonthLastDay = Utils.formatDateString(new Date(year, month0, 0, 12, 0, 0));
      allocatedCarry = this.getReservedTotalOnOrBefore(prevMonthLastDay);
    }

    return { balance: summary.startingBalance, unsettledCarry, allocatedCarry };
  }

  // The calendar cell's expense figure. The current day is "live": it shows its
  // own activity (settled + pending) PLUS every unsettled item carried forward
  // from earlier days, which sit on today until settled. Every other day counts
  // settled spend only. `unsettledCarryAfterDay` is the walk's accumulator
  // AFTER the day (it already includes the day's own unsettled, so the day's
  // portion is subtracted to isolate the carried-forward slice; the clamp
  // guards the reconciliation-anchor reset case).
  getCellExpense(dailyTotals, unsettledCarryAfterDay, isCurrentDay) {
    const carriedForwardUnsettled = Math.max(
      0,
      this.roundToCents(unsettledCarryAfterDay - dailyTotals.unsettledExpense)
    );
    const cellExpense = isCurrentDay
      ? this.roundToCents(dailyTotals.expense + carriedForwardUnsettled)
      : this.roundToCents(dailyTotals.expense - dailyTotals.unsettledExpense);
    return { carriedForwardUnsettled, cellExpense };
  }

  // Unsettled expenses carried forward onto `boundaryDateString`: everything
  // unsettled dated before it and after the most recent anchor on/before it
  // (inclusive bound — an anchor ON the boundary reconciles the whole past).
  // Shared by the calendar agenda's carried list and the day-detail modal's
  // "UNSETTLED (CARRIED FORWARD)" section.
  getCarriedUnsettledList(boundaryDateString) {
    const anchor = this.getReconciliationAnchor(boundaryDateString, { inclusive: true });
    return this.store.getUnsettledTransactions().filter(
      (u) => u.date < boundaryDateString && (anchor === null || u.date > anchor)
    );
  }

  getRunningBalanceForDate(dateString) {
    const [year, month] = dateString.split("-").map(Number);
    const summary = this.calculateMonthlySummary(year, month - 1);
    const monthStartStr = `${year}-${String(month).padStart(2, "0")}-01`;
    return this.walkDays(monthStartStr, dateString, {
      seedBalance: summary.startingBalance,
    }).balance;
  }

  // Full per-day balance breakdown for a single date, mirroring the figures the
  // calendar cell renders (see CalendarUI.generateCalendar): running balance,
  // the day's income, the cell's expense figure (which on the current day folds
  // in unsettled items carried forward from earlier days), the transaction
  // count, and the "without unsettled" / "excluding allocations" variants.
  // Kept here so the day-detail modal reuses the same walk instead of
  // re-deriving it. See [[balance-walk-paths]].
  getDayBalanceBreakdown(dateString) {
    const [year, month, day] = dateString.split("-").map(Number);
    const summary = this.calculateMonthlySummary(year, month - 1);
    let runningBalance = summary.startingBalance;

    // Carry unsettled expenses forward from prior months. An Ending Balance
    // reconciles everything dated on/before it, so only unsettled items after
    // the most recent anchor before this month still carry in.
    const monthStartStr = `${year}-${String(month).padStart(2, "0")}-01`;
    const allUnsettled = this.store.getUnsettledTransactions();
    const carryAnchor = this.getReconciliationAnchor(monthStartStr, { inclusive: false });
    let runningUnsettledExpense = 0;
    for (const u of allUnsettled) {
      if (u.date < monthStartStr && (carryAnchor === null || u.date > carryAnchor)) {
        runningUnsettledExpense = this.roundToCents(
          runningUnsettledExpense + u.transaction.amount
        );
      }
    }

    // Carry allocation reserves forward from prior months. Unlike unsettled,
    // reserves persist across Ending Balances, so include every live bucket
    // regardless of anchors (skip-aware, matching calculateDailyTotals).
    let runningAllocatedExpense = 0;
    const allTransactions = this.store.getTransactions();
    Object.keys(allTransactions).forEach((d) => {
      if (d >= monthStartStr) return;
      allTransactions[d].forEach((t) => {
        if (t.type !== "expense" || t.allocated !== true) return;
        if (
          t.recurringId &&
          this.recurringManager.isTransactionSkipped(d, t.recurringId)
        ) {
          return;
        }
        runningAllocatedExpense = this.roundToCents(
          runningAllocatedExpense + t.amount
        );
      });
    });

    let dailyTotals = null;
    for (let d = 1; d <= day; d++) {
      const ds = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      dailyTotals = this.calculateDailyTotals(ds);
      if (dailyTotals.balance !== null) {
        const reservedOnOrBefore = this.getReservedTotalOnOrBefore(ds);
        runningBalance = this.roundToCents(dailyTotals.balance - reservedOnOrBefore);
        runningUnsettledExpense = 0;
        runningAllocatedExpense = reservedOnOrBefore;
      } else {
        runningBalance = this.roundToCents(runningBalance + dailyTotals.income - dailyTotals.expense);
        runningUnsettledExpense = this.roundToCents(runningUnsettledExpense + dailyTotals.unsettledExpense);
        runningAllocatedExpense = this.roundToCents(runningAllocatedExpense + dailyTotals.allocatedExpense);
      }
    }

    const balanceWithoutUnsettled = runningUnsettledExpense > 0
      ? this.roundToCents(
          runningBalance + runningUnsettledExpense + runningAllocatedExpense
        )
      : null;
    const balanceExcludingAllocations = runningAllocatedExpense > 0
      ? this.roundToCents(runningBalance + runningAllocatedExpense)
      : null;

    // On the current day the cell's expense figure folds in unsettled items
    // carried forward from earlier days (they sit on today until settled);
    // every other day shows settled spend only.
    const todayStr = Utils.formatDateString(new Date());
    const isCurrentDay = dateString === todayStr;
    const carriedForwardUnsettled = Math.max(
      0,
      this.roundToCents(runningUnsettledExpense - (dailyTotals ? dailyTotals.unsettledExpense : 0))
    );
    const cellExpense = isCurrentDay
      ? this.roundToCents((dailyTotals ? dailyTotals.expense : 0) + carriedForwardUnsettled)
      : this.roundToCents(
          (dailyTotals ? dailyTotals.expense : 0) - (dailyTotals ? dailyTotals.unsettledExpense : 0)
        );

    const transactions = this.store.getTransactions();
    const transactionCount = transactions[dateString]
      ? transactions[dateString].filter((t) => t.hidden !== true).length
      : 0;

    return {
      income: this.roundToCents(dailyTotals ? dailyTotals.income : 0),
      expense: cellExpense,
      balance: runningBalance,
      balanceWithoutUnsettled,
      balanceExcludingAllocations,
      transactionCount,
    };
  }

  calculateMonthlySummary(year, month) {
    // Use padded month format consistently: YYYY-MM
    const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
    if (this._cachedSummaries[monthKey]) {
      return this._cachedSummaries[monthKey];
    }
    let monthIncome = 0;
    let monthExpense = 0;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const dateString = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dailyTotals = this.calculateDailyTotals(dateString);
      monthIncome = this.roundToCents(monthIncome + dailyTotals.income);
      monthExpense = this.roundToCents(monthExpense + dailyTotals.expense);
    }

    let monthlyBalances = this.store.getMonthlyBalances();
    if (!monthlyBalances[monthKey]) {
      const viewedDate = new Date(year, month, 1, 12, 0, 0);
      this.updateMonthlyBalances(viewedDate);
      monthlyBalances = this.store.getMonthlyBalances();
    }
    let startingBalance = 0;
    let endingBalance = 0;

    if (monthlyBalances[monthKey]) {
      startingBalance = monthlyBalances[monthKey].startingBalance;
      endingBalance = monthlyBalances[monthKey].endingBalance;
    } else {
      // Defensive fallback: monthlyBalances[monthKey] should normally exist
      // after updateMonthlyBalances; if not, carry the prior month's ending
      // balance forward instead of pretending the year started at zero.
      const prevMonthDate = new Date(year, month - 1, 1, 12, 0, 0);
      const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
      if (monthlyBalances[prevMonthKey]) {
        startingBalance = Number(monthlyBalances[prevMonthKey].endingBalance) || 0;
      }
      endingBalance = this.roundToCents(startingBalance + monthIncome - monthExpense);
    }

    const result = {
      startingBalance: this.roundToCents(startingBalance),
      endingBalance: this.roundToCents(endingBalance),
      income: this.roundToCents(monthIncome),
      expense: this.roundToCents(monthExpense),
    };
    this._cachedSummaries[monthKey] = result;

    return result;
  }

  // Minimum projected running balance from today (inclusive) through
  // `endDateString`, walking the same per-day balance math as calculateMinimum
  // but over an arbitrary horizon. Used by savings goals to answer "how much
  // could leave the account before this date without dipping below the floor".
  // Horizon is capped at ~2 years; returns null for past/invalid dates.
  getMinimumBalanceThrough(endDateString) {
    if (!endDateString) return null;
    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    const todayDay = today.getDate();
    const end = Utils.parseDateString(endDateString);
    const todayMidday = new Date(todayYear, todayMonth, todayDay, 12, 0, 0);
    const horizonDays = Math.min(
      730,
      Math.round((end - todayMidday) / 86400000)
    );
    if (isNaN(horizonDays) || horizonDays < 0) return null;

    this.invalidateCache();

    const summary = this.calculateMonthlySummary(todayYear, todayMonth);
    const monthStartStr = `${todayYear}-${String(todayMonth + 1).padStart(2, "0")}-01`;
    const todayStr = Utils.formatDateString(todayMidday);
    const balanceToday = this.walkDays(monthStartStr, todayStr, {
      seedBalance: summary.startingBalance,
    }).balance;

    let minBalance = balanceToday;
    const tomorrowStr = Utils.formatDateString(
      new Date(todayYear, todayMonth, todayDay + 1, 12, 0, 0)
    );
    const horizonEndStr = Utils.formatDateString(
      new Date(todayYear, todayMonth, todayDay + horizonDays, 12, 0, 0)
    );
    this.walkDays(tomorrowStr, horizonEndStr, {
      seedBalance: balanceToday,
      ensureRecurringExpansion: true,
      onDay: (r) => {
        if (r.balance < minBalance) minBalance = r.balance;
      },
    });

    return minBalance;
  }

  // Free-funds shortfall cushion (pure math, derived at render — nothing is
  // persisted). The designated bucket's reserve is already carved out of
  // every projected balance, so spending the bucket never moves the 30-day
  // trough; a NEGATIVE trough means the plan can't fully cash-back the
  // reserve. Treat that shortfall as already drawn from the bucket:
  // `cushion` is the slice held back to cover the trough, `display` is what
  // remains to advertise as spendable. Displayed future balances lift by
  // `cushion`, so the shown 30-day low bottoms out at 0 while the bucket can
  // cover it, and goes negative only by the uncovered excess. Self-reverses
  // when the dip resolves (income lands, anchor entered, day exits the
  // window); real draws against the bucket are unaffected.
  getFreeFundsCushion(bucketRemaining, lowestBalance) {
    const remaining = Math.max(0, Number(bucketRemaining) || 0);
    const shortfall = Math.max(0, -(Number(lowestBalance) || 0));
    const cushion = this.roundToCents(Math.min(remaining, shortfall));
    return { cushion, display: this.roundToCents(remaining - cushion) };
  }

  calculateMinimum() {
    // Calculate the minimum running balance from today through the next 30 days
    // This should match how the calendar displays running balances

    // Clear all caches to ensure fresh calculations after applying recurring transactions
    this.invalidateCache();

    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    const todayDay = today.getDate();

    // Balance at end of today (walked from the month start), then track the
    // minimum from today (inclusive) through the next 30 days. The forward leg
    // expands recurring transactions month-by-month as it crosses them.
    const summary = this.calculateMonthlySummary(todayYear, todayMonth);
    const monthStartStr = `${todayYear}-${String(todayMonth + 1).padStart(2, "0")}-01`;
    const todayStr = Utils.formatDateString(
      new Date(todayYear, todayMonth, todayDay, 12, 0, 0)
    );
    const balanceToday = this.walkDays(monthStartStr, todayStr, {
      seedBalance: summary.startingBalance,
    }).balance;

    let minBalance = balanceToday;
    const tomorrowStr = Utils.formatDateString(
      new Date(todayYear, todayMonth, todayDay + 1, 12, 0, 0)
    );
    const endStr = Utils.formatDateString(
      new Date(todayYear, todayMonth, todayDay + 30, 12, 0, 0)
    );
    this.walkDays(tomorrowStr, endStr, {
      seedBalance: balanceToday,
      ensureRecurringExpansion: true,
      onDay: (r) => {
        if (r.balance < minBalance) minBalance = r.balance;
      },
    });

    return minBalance;
  }
}
