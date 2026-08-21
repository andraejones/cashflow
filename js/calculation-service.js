// Calculation service

class CalculationService {

  constructor(store, recurringManager) {
    this.store = store;
    this.recurringManager = recurringManager;
    this._cachedSummaries = {};
    this._cachedDailyTotals = {};
    this._cachedReservedTotals = {};
    this._reservedIndex = null;
  }

  // Round to cents to prevent floating-point drift in balance calculations
  roundToCents(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  // A single row's money, as a finite number. Anything unusable (a missing
  // `amount` key, null, a string, ±Infinity) contributes 0.
  //
  // This has to happen PER ROW, before the row joins a subtotal. roundToCents
  // maps NaN to 0 — a deliberate safety net — but `subtotal + undefined` is
  // NaN, so feeding an unusable row straight into the running sum discarded
  // every earlier row on that day too: three income rows of 1000 / (none) / 250
  // reported 250, not 1250. No error, no warning, just a wrong number on the
  // calendar. TransactionStore._repairWalkAmounts normalizes stored data on
  // load and import; this covers the same shape arriving any other way (a
  // cloud merge, a row built at runtime) and keeps the damage to the one row.
  _rowAmount(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }


  invalidateCache() {
    this._cachedSummaries = {};
    this._cachedDailyTotals = {};
    this._cachedReservedTotals = {};
    this._reservedIndex = null;
  }

  // Drop the reserve index (only) because the transactions map just grew.
  //
  // Expanding a month materializes recurring instances, and recurring
  // ALLOCATION instances are exactly what the index sums — so an index built
  // before an expansion is short by whatever that month added. Every site that
  // expands months LAZILY while a cache generation is live must call this:
  // CalculationService.walkDays({ ensureRecurringExpansion: true }) and the
  // snowball projection's getDayFlow. (updateMonthlyBalances does not need it:
  // it expands every month up front, before it walks anything.)
  //
  // The per-date cache is deliberately NOT cleared. Leaving it is the
  // pre-index behavior — an already-answered date kept its answer, an unseen
  // one was rescanned — and matching that exactly is what keeps these walks'
  // results unchanged. See TEST 78.
  invalidateReservedIndex() {
    this._reservedIndex = null;
  }

  // Prefix-summed reserve totals, built once per cache generation.
  //
  // getReservedTotalOnOrBefore used to re-scan the ENTIRE transactions map on
  // every call. walkDays calls it once per Ending Balance anchor, and
  // updateMonthlyBalances walks every month from the earliest transaction
  // forward — so the cost was (number of anchors) x (size of the whole
  // dataset), i.e. quadratic in history length for anyone who reconciles
  // regularly. On a six-year dataset it was the single largest cost of a
  // render, and it only ever gets worse, because the history only ever grows.
  // Building the index is one pass; each lookup is then a binary search.
  //
  // The fold is in SORTED date order with a round after every transaction,
  // matching the old per-transaction rounding. The old scan folded in the
  // transactions map's own key-insertion order, which is not deterministic
  // across a load/merge/runtime-add — for cent-valued money the two agree
  // exactly, and where they could differ (sub-cent amounts) sorted order is
  // the defensible one. TEST 74 pins the equivalence against a brute-force
  // reference over randomized data, sub-cent amounts included.
  _reservedTotalIndex() {
    if (this._reservedIndex) {
      return this._reservedIndex;
    }
    const transactions = this.store.getTransactions();
    const perDate = new Map();
    for (const d in transactions) {
      const list = transactions[d];
      if (!Array.isArray(list)) continue;
      let rows = null;
      list.forEach((t) => {
        if (t.type !== "expense" || t.allocated !== true) return;
        // A hypothetical must not reserve real money. Drafts never carry
        // `allocated` today, which is why this needed no guard — but
        // getAllocations already opts out here (it requires a stored id), and
        // a reserve total that disagreed with the drawable buckets would move
        // every anchor's balance with nothing on screen to explain it.
        if (t.whatIf === true) return;
        if (
          t.recurringId &&
          this.recurringManager.isTransactionSkipped(d, t.recurringId)
        ) {
          return;
        }
        (rows = rows || []).push(this._rowAmount(t.amount));
      });
      if (rows) perDate.set(d, rows);
    }
    const dates = Array.from(perDate.keys()).sort();
    const prefix = new Array(dates.length);
    let running = 0;
    for (let i = 0; i < dates.length; i++) {
      perDate.get(dates[i]).forEach((amount) => {
        running = this.roundToCents(running + amount);
      });
      prefix[i] = running;
    }
    this._reservedIndex = { dates, prefix };
    return this._reservedIndex;
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
    // Binary search for the last indexed date on/before dateString; its prefix
    // sum IS the answer. See _reservedTotalIndex for why this is an index
    // rather than a scan.
    const { dates, prefix } = this._reservedTotalIndex();
    let lo = 0;
    let hi = dates.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] <= dateString) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const total = this.roundToCents(found === -1 ? 0 : prefix[found]);
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
      // Parse through the shared guard, and skip anything it can't read. These
      // are raw MAP KEYS: nothing validates them on the way in from an import
      // or a cloud merge, so one junk key ("garbage", a truncated "2026-08")
      // used to become an Invalid Date here. Every later `<` / `>` against NaN
      // is false, so once earliestDate/latestDate held that Invalid Date they
      // never recovered — and only when the junk key happened to come FIRST in
      // key-insertion order, which makes it intermittent. The month list then
      // collapsed to the single key "NaN-NaN": every real month lost its entry,
      // so each month restarted from 0 instead of carrying the prior month's
      // close. Silent, and wrong by the whole balance.
      const transactionDate = Utils.parseDateString(dateString);
      if (!transactionDate) {
        continue;
      }
      if (earliestDate === null || transactionDate < earliestDate) {
        earliestDate = transactionDate;
      }
      if (latestDate === null || transactionDate > latestDate) {
        latestDate = transactionDate;
      }
    }
    // A recurring series can begin BEFORE the oldest row in the map, and its
    // early occurrences only exist once the month is expanded — which happens
    // here, for the months in this range. Deriving the range from map keys
    // alone therefore left those months unexpanded and their income/expense out
    // of the chain, until the user happened to page back to one: expanding it
    // then was permanent, so every balance from that month forward — including
    // today's and the 30-day Minimum — jumped. A monthly $1000 paycheck started
    // four months before the oldest entry moved the Minimum from 700 to 3700
    // just by paging back and returning. (Anchored users never saw it: an
    // Ending Balance resets the walk, so pre-anchor months can't reach today.)
    //
    // Including every series' startDate makes the range depend only on the data
    // itself, so the chain is the same however the user navigated to get here.
    // Symmetric with the map-key scan above, including its unbounded reach: a
    // 1990 startDate costs the same extra months a 1990 transaction already
    // does (~0.5 ms per empty month).
    this.store.getRecurringTransactions().forEach((rt) => {
      const start = rt && Utils.parseDateString(rt.startDate);
      if (!start) {
        return;
      }
      if (earliestDate === null || start < earliestDate) {
        earliestDate = start;
      }
      if (latestDate === null || start > latestDate) {
        latestDate = start;
      }
    });
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
      const isFirstMonth = index === 0;
      const daysInMonth = new Date(year, month, 0).getDate();
      const firstDayStr = `${monthKey}-01`;
      const lastDayStr = `${monthKey}-${String(daysInMonth).padStart(2, "0")}`;

      // A month that OPENS on an Ending Balance anchors its own starting
      // balance (the anchor-adjusted figure), instead of inheriting the prior
      // month's close.
      let firstDayBalance = null;
      const result = this.walkDays(firstDayStr, lastDayStr, {
        seedBalance: previousBalance,
        onDay: (r) => {
          if (r.day === 1 && r.isAnchor) firstDayBalance = r.balance;
        },
      });

      monthlyBalances[monthKey] = {
        startingBalance: this.roundToCents(
          firstDayBalance !== null
            ? firstDayBalance
            : isFirstMonth
              ? 0
              : previousBalance
        ),
        endingBalance: this.roundToCents(result.balance),
      };
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
          const rowAmount = this._rowAmount(t.amount);
          if (t.type === "balance") {
            balance = rowAmount;
          } else if (t.type === "income") {
            income = this.roundToCents(income + rowAmount);
          } else if (t.type === "expense") {
            expense = this.roundToCents(expense + rowAmount);
            if (t.settled === false) {
              unsettledExpense = this.roundToCents(unsettledExpense + rowAmount);
            }
            // Sum all allocated expenses (one-time + recurring) so the calendar
            // can show a "balance excluding allocations" figure that adds these
            // reserved buckets back to the running balance.
            if (t.allocated === true) {
              allocatedExpense = this.roundToCents(allocatedExpense + rowAmount);
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
            // The map just grew; anything the index already summed is stale.
            // Without this, an anchor in a later month read a reserve total
            // computed before that month existed — a walk over three months
            // with a monthly reserve reported the anchor's balance $600 too
            // high, silently.
            this.invalidateReservedIndex();
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
          unsettledCarry = this.roundToCents(
            unsettledCarry + this._rowAmount(u.transaction.amount)
          );
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
  // count, and the two holdback-release variants. `balanceWithoutUnsettled`
  // releases BOTH holdbacks (unsettled + allocation reserves) — the modal
  // labels it "Balance before holdbacks" for that reason; the field name is
  // historical. `balanceExcludingAllocations` releases only the reserves.
  // Kept here so the day-detail modal reuses the same walk instead of
  // re-deriving it. See [[balance-walk-paths]].
  getDayBalanceBreakdown(dateString) {
    const [year, month] = dateString.split("-").map(Number);
    const monthStartStr = `${year}-${String(month).padStart(2, "0")}-01`;
    const seed = this.getMonthSeed(year, month - 1, {
      trackUnsettled: true,
      trackAllocations: true,
    });
    const walk = this.walkDays(monthStartStr, dateString, {
      seedBalance: seed.balance,
      seedUnsettled: seed.unsettledCarry,
      seedAllocated: seed.allocatedCarry,
      trackUnsettled: true,
      trackAllocations: true,
    });
    const runningBalance = walk.balance;
    const runningUnsettledExpense = walk.unsettledCarry;
    const runningAllocatedExpense = walk.allocatedCarry;
    // monthStart <= dateString always holds, so the walk saw at least one day;
    // the fallback only guards malformed input.
    const dailyTotals = walk.lastDailyTotals || {
      income: 0, expense: 0, unsettledExpense: 0, allocatedExpense: 0, balance: null,
    };

    const balanceWithoutUnsettled = runningUnsettledExpense > 0
      ? this.roundToCents(
          runningBalance + runningUnsettledExpense + runningAllocatedExpense
        )
      : null;
    const balanceExcludingAllocations = runningAllocatedExpense > 0
      ? this.roundToCents(runningBalance + runningAllocatedExpense)
      : null;

    const todayStr = Utils.formatDateString(new Date());
    const isCurrentDay = dateString === todayStr;
    const { cellExpense } = this.getCellExpense(
      dailyTotals,
      runningUnsettledExpense,
      isCurrentDay
    );

    const transactions = this.store.getTransactions();
    const transactionCount = transactions[dateString]
      ? transactions[dateString].filter((t) => t.hidden !== true).length
      : 0;

    return {
      income: this.roundToCents(dailyTotals.income),
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
