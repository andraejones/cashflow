/**
 * CalculationService - Handles financial calculations
 */
class CalculationService {
  /**
   * Create a new CalculationService
   * @param {TransactionStore} store - The transaction store
   * @param {RecurringTransactionManager} recurringManager - Recurring transaction manager
   */
  constructor(store, recurringManager) {
    this.store = store;
    this.recurringManager = recurringManager;
    this._cachedSummaries = {};
    this._cachedDailyTotals = {};
  }

  /**
   * Invalidate all calculation caches
   */
  invalidateCache() {
    this._cachedSummaries = {};
    this._cachedDailyTotals = {};
  }

  /**
   * Update monthly balances based on transactions
   * @param {Date} viewedDate - Optional: Date being viewed in the calendar
   */
  updateMonthlyBalances(viewedDate) {
    const transactions = this.store.getTransactions();
    const monthlyBalances = this.store.getMonthlyBalances();

    // Clear all monthly balances to recalculate from scratch
    for (const key in monthlyBalances) {
      delete monthlyBalances[key];
    }
    
    // Find the earliest and latest transaction dates
    let earliestDate = null;
    let latestDate = null;
    for (const dateString in transactions) {
      const transactionDate = new Date(dateString);
      if (earliestDate === null || transactionDate < earliestDate) {
        earliestDate = transactionDate;
      }
      if (latestDate === null || transactionDate > latestDate) {
        latestDate = transactionDate;
      }
    }
    
    // If viewing a date beyond latest transaction or with no transactions, include it
    if (viewedDate) {
      // Create first day of viewed month
      const viewedMonthStart = new Date(viewedDate.getFullYear(), viewedDate.getMonth(), 1);
      
      if (!latestDate || viewedMonthStart > latestDate) {
        latestDate = viewedMonthStart;
      }
      
      if (!earliestDate) {
        earliestDate = viewedMonthStart;
      }
    }
    
    // If still no transactions, add entry for current month and viewed month
    if (!earliestDate) {
      const today = new Date();
      const currentMonthKey = `${today.getFullYear()}-${today.getMonth() + 1}`;
      
      monthlyBalances[currentMonthKey] = {
        startingBalance: 0,
        endingBalance: 0
      };
      
      if (viewedDate) {
        const viewedMonthKey = `${viewedDate.getFullYear()}-${viewedDate.getMonth() + 1}`;
        
        if (viewedMonthKey !== currentMonthKey) {
          monthlyBalances[viewedMonthKey] = {
            startingBalance: 0,
            endingBalance: 0
          };
        }
      }
      
      return;
    }
    
    // Generate a complete list of months from earliest to latest date
    const allMonths = [];
    const startYear = earliestDate.getFullYear();
    const startMonth = earliestDate.getMonth() + 1;
    const endYear = latestDate.getFullYear();
    const endMonth = latestDate.getMonth() + 1;
    
    // Create a continuous range of months
    for (let year = startYear; year <= endYear; year++) {
      const firstMonth = (year === startYear) ? startMonth : 1;
      const lastMonth = (year === endYear) ? endMonth : 12;
      
      for (let month = firstMonth; month <= lastMonth; month++) {
        allMonths.push(`${year}-${month}`);
      }
    }
    
    // Add one month after the last month for proper balance propagation
    const lastMonthYear = endYear;
    const lastMonthMonth = endMonth;
    
    if (lastMonthMonth === 12) {
      allMonths.push(`${lastMonthYear + 1}-1`);
    } else {
      allMonths.push(`${lastMonthYear}-${lastMonthMonth + 1}`);
    }
    
    // Sort the months (should already be in order but just to be safe)
    allMonths.sort((a, b) => {
      const [yearA, monthA] = a.split('-').map(Number);
      const [yearB, monthB] = b.split('-').map(Number);
      
      if (yearA !== yearB) {
        return yearA - yearB;
      }
      return monthA - monthB;
    });
    
    let previousBalance = 0;
    
    // Process each month in sequence
    allMonths.forEach((monthKey, index) => {
      const [year, month] = monthKey.split("-").map(Number);
      let monthIncome = 0;
      let monthExpense = 0;
      let runningBalance = previousBalance;
      let lastBalanceSet = null;
      let lastBalanceDate = null;
      
      // First month always starts with 0 balance
      const isFirstMonth = index === 0;
      
      // Process each day of the month
      const daysInMonth = new Date(year, month, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const dateString = `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

        if (transactions[dateString]) {
          let balanceSet = false;
          let dailyBalance = runningBalance;

          // First pass: Look for balance transactions
          transactions[dateString].forEach((t) => {
            if (t.type === "balance") {
              balanceSet = true;
              dailyBalance = t.amount;
              lastBalanceSet = t.amount;
              lastBalanceDate = dateString;
            }
          });

          // Second pass: Process income and expenses
          transactions[dateString].forEach((t) => {
            // Check if recurring transaction is skipped
            const isSkipped =
              t.recurringId &&
              this.recurringManager.isTransactionSkipped(
                dateString,
                t.recurringId
              );

            if (!isSkipped) {
              if (t.type === "income") {
                monthIncome += t.amount;
                if (!balanceSet) {
                  dailyBalance += t.amount;
                }
              } else if (t.type === "expense") {
                monthExpense += t.amount;
                if (!balanceSet) {
                  dailyBalance -= t.amount;
                }
              }
            }
          });

          runningBalance = dailyBalance;
        }
      }

      // Calculate the month's starting and ending balances
      if (lastBalanceSet !== null && lastBalanceDate === `${year}-${month.toString().padStart(2, "0")}-01`) {
        // Balance transaction on the first day of month overrides the starting balance
        monthlyBalances[monthKey] = {
          startingBalance: lastBalanceSet,
          endingBalance: runningBalance,
        };
      } else {
        // Normal calculation: first month starts at 0, others use previous month's ending balance
        monthlyBalances[monthKey] = {
          startingBalance: isFirstMonth ? 0 : previousBalance,
          endingBalance: runningBalance,
        };
      }

      // Set the previous balance for the next month
      previousBalance = monthlyBalances[monthKey].endingBalance;
    });

    // Force recalculation of summaries
    this.invalidateCache();

    // Save the updated balances WITHOUT marking as a data modification
    // This is a calculated value, not a user-entered transaction
    this.store.saveData(false);
  }

  /**
   * Calculate daily totals for a specific date
   * @param {string} dateString - Date in YYYY-MM-DD format
   * @returns {Object} Daily totals
   */
  calculateDailyTotals(dateString) {
    // Check cache first
    if (this._cachedDailyTotals[dateString]) {
      return this._cachedDailyTotals[dateString];
    }

    const transactions = this.store.getTransactions();
    let income = 0;
    let expense = 0;
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
            income += t.amount;
          } else if (t.type === "expense") {
            expense += t.amount;
          }
        }
      });
    }

    const result = {
      income,
      expense,
      balance,
      hasSkippedTransactions,
    };

    // Store in cache
    this._cachedDailyTotals[dateString] = result;

    return result;
  }

  /**
   * Calculate monthly summary for a specific month
   * @param {number} year - Year
   * @param {number} month - Month (0-11)
   * @returns {Object} Monthly summary
   */
  calculateMonthlySummary(year, month) {
    const monthKey = `${year}-${month + 1}`;

    // Check cache first
    if (this._cachedSummaries[monthKey]) {
      return this._cachedSummaries[monthKey];
    }

    // Calculate transaction totals for the month
    let monthIncome = 0;
    let monthExpense = 0;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    for (let day = 1; day <= daysInMonth; day++) {
      const dateString = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dailyTotals = this.calculateDailyTotals(dateString);
      monthIncome += dailyTotals.income;
      monthExpense += dailyTotals.expense;
    }

    let monthlyBalances = this.store.getMonthlyBalances();

    // Ensure monthly balance exists by running updateMonthlyBalances if needed
    if (!monthlyBalances[monthKey]) {
      // Pass the current month's date to ensure proper balance calculation for viewed months
      const viewedDate = new Date(year, month, 1);
      this.updateMonthlyBalances(viewedDate);
      // Re-fetch the updated monthly balances
      monthlyBalances = this.store.getMonthlyBalances();
    }

    // Get the balance information for this month
    let startingBalance = 0;
    let endingBalance = 0;
    
    if (monthlyBalances[monthKey]) {
      startingBalance = monthlyBalances[monthKey].startingBalance;
      endingBalance = monthlyBalances[monthKey].endingBalance;
    } else {
      // If still no monthly balance entry, use calculated totals
      endingBalance = startingBalance + monthIncome - monthExpense;
    }

    const result = {
      startingBalance: startingBalance,
      endingBalance: endingBalance,
      income: monthIncome,
      expense: monthExpense,
    };

    // Store in cache
    this._cachedSummaries[monthKey] = result;

    return result;
  }
}
