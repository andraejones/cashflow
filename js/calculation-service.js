// Calculation service

class CalculationService {
  
  constructor(store, recurringManager) {
    this.store = store;
    this.recurringManager = recurringManager;
    this._cachedSummaries = {};
    this._cachedDailyTotals = {};
  }

  
  invalidateCache() {
    this._cachedSummaries = {};
    this._cachedDailyTotals = {};
  }

  
  updateMonthlyBalances(viewedDate) {
    const transactions = this.store.getTransactions();
    const monthlyBalances = this.store.getMonthlyBalances();
    for (const key in monthlyBalances) {
      delete monthlyBalances[key];
    }
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
    if (viewedDate) {
      const viewedMonthStart = new Date(viewedDate.getFullYear(), viewedDate.getMonth(), 1);
      
      if (!latestDate || viewedMonthStart > latestDate) {
        latestDate = viewedMonthStart;
      }
      
      if (!earliestDate) {
        earliestDate = viewedMonthStart;
      }
    }
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
    const allMonths = [];
    const startYear = earliestDate.getFullYear();
    const startMonth = earliestDate.getMonth() + 1;
    const endYear = latestDate.getFullYear();
    const endMonth = latestDate.getMonth() + 1;
    for (let year = startYear; year <= endYear; year++) {
      const firstMonth = (year === startYear) ? startMonth : 1;
      const lastMonth = (year === endYear) ? endMonth : 12;
      
      for (let month = firstMonth; month <= lastMonth; month++) {
        allMonths.push(`${year}-${month}`);
      }
    }
    const lastMonthYear = endYear;
    const lastMonthMonth = endMonth;
    
    if (lastMonthMonth === 12) {
      allMonths.push(`${lastMonthYear + 1}-1`);
    } else {
      allMonths.push(`${lastMonthYear}-${lastMonthMonth + 1}`);
    }
    allMonths.sort((a, b) => {
      const [yearA, monthA] = a.split('-').map(Number);
      const [yearB, monthB] = b.split('-').map(Number);
      
      if (yearA !== yearB) {
        return yearA - yearB;
      }
      return monthA - monthB;
    });
    
    let previousBalance = 0;
    allMonths.forEach((monthKey, index) => {
      const [year, month] = monthKey.split("-").map(Number);
      let monthIncome = 0;
      let monthExpense = 0;
      let runningBalance = previousBalance;
      let lastBalanceSet = null;
      let lastBalanceDate = null;
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
              lastBalanceSet = t.amount;
              lastBalanceDate = dateString;
            }
          });
          transactions[dateString].forEach((t) => {
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
      if (lastBalanceSet !== null && lastBalanceDate === `${year}-${month.toString().padStart(2, "0")}-01`) {
        monthlyBalances[monthKey] = {
          startingBalance: lastBalanceSet,
          endingBalance: runningBalance,
        };
      } else {
        monthlyBalances[monthKey] = {
          startingBalance: isFirstMonth ? 0 : previousBalance,
          endingBalance: runningBalance,
        };
      }
      previousBalance = monthlyBalances[monthKey].endingBalance;
    });
    this.invalidateCache();
    this.store.saveData(false);
  }

  
  calculateDailyTotals(dateString) {
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
    this._cachedDailyTotals[dateString] = result;

    return result;
  }

  
  calculateMonthlySummary(year, month) {
    const monthKey = `${year}-${month + 1}`;
    if (this._cachedSummaries[monthKey]) {
      return this._cachedSummaries[monthKey];
    }
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
    if (!monthlyBalances[monthKey]) {
      const viewedDate = new Date(year, month, 1);
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
      startingBalance: startingBalance,
      endingBalance: endingBalance,
      income: monthIncome,
      expense: monthExpense,
    };
    this._cachedSummaries[monthKey] = result;

    return result;
  }
}
