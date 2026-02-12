// Calculation service

class CalculationService {

  constructor(store, recurringManager) {
    this.store = store;
    this.recurringManager = recurringManager;
    this._cachedSummaries = {};
    this._cachedDailyTotals = {};
  }

  // Round to cents to prevent floating-point drift in balance calculations
  roundToCents(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }


  invalidateCache() {
    this._cachedSummaries = {};
    this._cachedDailyTotals = {};
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

    if (lastMonthMonth === 12) {
      allMonths.push(`${lastMonthYear + 1}-01`);
    } else {
      allMonths.push(`${lastMonthYear}-${String(lastMonthMonth + 1).padStart(2, "0")}`);
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
        const dateString = `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

        if (transactions[dateString]) {
          let balanceSet = false;
          let dailyBalance = runningBalance;
          transactions[dateString].forEach((t) => {
            if (t.type === "balance") {
              balanceSet = true;
              dailyBalance = t.amount;
            }
          });
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
    let balance = null;
    let hasSkippedTransactions = false;

    if (transactions[dateString]) {
      const dailyTransactions = transactions[dateString];

      hasSkippedTransactions = dailyTransactions.some(
        (t) =>
          t.recurringId &&
          this.recurringManager.isTransactionSkipped(dateString, t.recurringId)
      );

      dailyTransactions.forEach((t) => {
        const isSkipped =
          t.recurringId &&
          this.recurringManager.isTransactionSkipped(dateString, t.recurringId);

        if (!isSkipped) {
          if (t.type === "balance") {
            balance = t.amount;
          } else if (t.type === "income") {
            income = this.roundToCents(income + t.amount);
          } else if (t.type === "expense") {
            expense = this.roundToCents(expense + t.amount);
            if (t.settled === false) {
              unsettledExpense = this.roundToCents(unsettledExpense + t.amount);
            }
          }
        }
      });
    }

    const result = {
      income: this.roundToCents(income),
      expense: this.roundToCents(expense),
      unsettledExpense: this.roundToCents(unsettledExpense),
      balance: balance !== null ? this.roundToCents(balance) : null,
      hasSkippedTransactions,
    };
    this._cachedDailyTotals[dateString] = result;

    return result;
  }

  getRunningBalanceForDate(dateString) {
    const [year, month, day] = dateString.split("-").map(Number);
    const summary = this.calculateMonthlySummary(year, month - 1);
    let runningBalance = summary.startingBalance;

    for (let d = 1; d <= day; d++) {
      const ds = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dailyTotals = this.calculateDailyTotals(ds);
      if (dailyTotals.balance !== null) {
        runningBalance = dailyTotals.balance;
      } else {
        runningBalance += dailyTotals.income - dailyTotals.expense;
      }
    }
    return this.roundToCents(runningBalance);
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
      endingBalance = startingBalance + monthIncome - monthExpense;
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

  calculateUnallocated() {
    // Calculate the minimum running balance from today through the next 30 days
    // This should match how the calendar displays running balances

    // Clear all caches to ensure fresh calculations after applying recurring transactions
    this.invalidateCache();

    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    const todayDay = today.getDate();

    // Get the starting balance for the current month using the same method as the calendar
    const summary = this.calculateMonthlySummary(todayYear, todayMonth);
    let runningBalance = summary.startingBalance;

    // Calculate running balance up to and including today
    for (let day = 1; day <= todayDay; day++) {
      const dateString = `${todayYear}-${String(todayMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dailyTotals = this.calculateDailyTotals(dateString);

      if (dailyTotals.balance !== null) {
        runningBalance = dailyTotals.balance;
      } else {
        runningBalance = this.roundToCents(runningBalance + dailyTotals.income - dailyTotals.expense);
      }
    }

    // Track minimum balance from today through next 30 days
    let minBalance = runningBalance;
    // Track the first time balance hits zero or negative
    let firstCrisis = null;

    // Now iterate through the next 30 days (starting from tomorrow)
    for (let i = 1; i <= 30; i++) {
      const futureDate = new Date(todayYear, todayMonth, todayDay + i);
      const futureYear = futureDate.getFullYear();
      const futureMonth = futureDate.getMonth();
      const futureDay = futureDate.getDate();

      // If we've crossed into a new month, we need to properly continue the running balance
      // The running balance carries over from the previous day, we just add income/expense for each day
      const dateString = `${futureYear}-${String(futureMonth + 1).padStart(2, "0")}-${String(futureDay).padStart(2, "0")}`;

      // Make sure recurring transactions are applied for this month
      this.recurringManager.applyRecurringTransactions(futureYear, futureMonth);

      const dailyTotals = this.calculateDailyTotals(dateString);

      if (dailyTotals.balance !== null) {
        runningBalance = dailyTotals.balance;
      } else {
        runningBalance = this.roundToCents(runningBalance + dailyTotals.income - dailyTotals.expense);
      }

      // Capture the first time balance goes to zero or negative
      if (firstCrisis === null && runningBalance <= 0) {
        firstCrisis = runningBalance;
      }

      if (runningBalance < minBalance) {
        minBalance = runningBalance;
      }
    }

    // Return first crisis if one occurred, otherwise return minimum balance
    return firstCrisis !== null ? firstCrisis : minBalance;
  }
}
