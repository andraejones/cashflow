const fs = require('fs');
const path = require('path');

// Mock Browser Environment
const localStorageData = {};
global.localStorage = {
  getItem: (key) => localStorageData[key] || null,
  setItem: (key, val) => { localStorageData[key] = val; },
  removeItem: (key) => { delete localStorageData[key]; },
  clear: () => { for (const k in localStorageData) delete localStorageData[k]; }
};

global.window = {
  localStorage: global.localStorage
};
global.document = {
  addEventListener: () => {}
};
global.Utils = {
  generateUniqueId: () => Math.random().toString(36).substr(2, 9),
  formatDateString: (date) => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  },
  parseDateString: (str) => {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }
};

const vm = require('vm');

// Load source files
const jsDir = path.join(__dirname, '../js');
const files = [
  'transaction-store.js',
  'recurring-manager.js',
  'calculation-service.js',
  'cloud-sync.js',
  'debt-snowball.js'
];

files.forEach(file => {
  const content = fs.readFileSync(path.join(jsDir, file), 'utf8');
  vm.runInThisContext(content);
});

// TEST 1: Basic Transaction Logic
console.log("TEST 1: Basic Transaction Logic");
const store = new TransactionStore();
store.resetData();

const today = new Date();
const dateStr = Utils.formatDateString(today);

store.addTransaction(dateStr, {
  amount: 100,
  type: 'income',
  description: 'Salary'
});

store.addTransaction(dateStr, {
  amount: 50,
  type: 'expense',
  description: 'Groceries'
});

const txns = store.getTransactions()[dateStr];
if (txns.length !== 2) throw new Error("Transactions not added");
console.log("✅ Transactions added");

// TEST 2: Calculation Service
console.log("TEST 2: Calculation Service");
const recurringManager = new RecurringTransactionManager(store);
const calcService = new CalculationService(store, recurringManager);

calcService.updateMonthlyBalances(today);
const totals = calcService.calculateDailyTotals(dateStr);

if (totals.income !== 100) throw new Error(`Expected income 100, got ${totals.income}`);
if (totals.expense !== 50) throw new Error(`Expected expense 50, got ${totals.expense}`);
console.log("✅ Daily totals correct");

// TEST 3: Recurring Logic (Expansion)
console.log("TEST 3: Recurring Logic");
const nextMonth = new Date(today);
nextMonth.setMonth(nextMonth.getMonth() + 1);
const nextMonthStr = Utils.formatDateString(nextMonth);
const nextMonthKey = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;

recurringManager.addRecurringTransaction({
  amount: 200,
  type: 'expense',
  description: 'Rent',
  recurrence: 'monthly',
  startDate: dateStr
});

// Force expansion for next month
recurringManager.applyRecurringTransactions(nextMonth.getFullYear(), nextMonth.getMonth());

// Check cache
const cached = recurringManager.getCached(nextMonth.getFullYear(), nextMonth.getMonth());
if (!cached || cached.length === 0) throw new Error("Recurring transactions not expanded/cached");

// Verify content
const rentTxn = cached.find(item => item.transaction.description === 'Rent');
if (!rentTxn) throw new Error("Rent transaction not found in next month");
console.log("✅ Recurring transactions expanded");

// TEST 4: Editing future recurring transactions preserves recurrence metadata
console.log("TEST 4: Future Edit Preserves Recurrence Metadata");
const metadataStore = new TransactionStore();
metadataStore.resetData();
const metadataRecurringManager = new RecurringTransactionManager(metadataStore);

const recurringId = metadataStore.addRecurringTransaction({
  id: "semi-last-day-recurring",
  amount: 75,
  type: "expense",
  description: "Debt Minimum",
  recurrence: "semi-monthly",
  startDate: "2026-01-31",
  semiMonthlyDays: [1, 31],
  semiMonthlyLastDay: true,
  debtId: "debt-1",
  debtRole: "minimum",
  debtName: "Visa",
});

metadataStore.addTransaction("2026-01-31", {
  amount: 75,
  type: "expense",
  description: "Debt Minimum",
  recurringId,
  settled: true
});

const edited = metadataRecurringManager.editTransaction(
  "2026-01-31",
  0,
  { amount: 80, type: "expense", description: "Updated Debt Minimum" },
  "future"
);

if (!edited) throw new Error("Future recurring edit failed");

const updatedRecurring = metadataStore
  .getRecurringTransactions()
  .find((rt) => rt.id !== recurringId);

if (!updatedRecurring) throw new Error("New future recurring transaction was not created");
if (updatedRecurring.semiMonthlyLastDay !== true) {
  throw new Error("semiMonthlyLastDay was not preserved on future edit");
}
if (updatedRecurring.debtId !== "debt-1") {
  throw new Error("debtId was not preserved on future edit");
}
if (updatedRecurring.debtRole !== "minimum") {
  throw new Error("debtRole was not preserved on future edit");
}
if (updatedRecurring.debtName !== "Visa") {
  throw new Error("debtName was not preserved on future edit");
}
console.log("✅ Future recurring edit keeps debt and semi-monthly metadata");

// TEST 5: Cloud sync detects generic local changes via lastUpdated
console.log("TEST 5: Cloud Sync Local Change Detection");
const syncStore = new TransactionStore();
syncStore.resetData();
syncStore.addTransaction("2026-04-02", {
  amount: 10,
  type: "expense",
  description: "Coffee"
});
syncStore.flushPendingSave();

const cloudSync = new CloudSync(syncStore, () => {});
cloudSync._lastSyncTime = new Date(Date.now() - 60000);

if (!cloudSync._hasLocalChangesSinceSync(syncStore.exportData())) {
  throw new Error("Cloud sync failed to detect recent local changes");
}

cloudSync._lastSyncTime = new Date(Date.now() + 60000);
if (cloudSync._hasLocalChangesSinceSync(syncStore.exportData())) {
  throw new Error("Cloud sync reported local changes after sync time");
}
console.log("✅ Cloud sync detects local changes using lastUpdated");

// TEST 6: Debt summaries include auto-infusions before cutoff
console.log("TEST 6: Debt Summaries Include Auto Infusions");
const debtStore = new TransactionStore();
debtStore.resetData();
const debtRecurringManager = new RecurringTransactionManager(debtStore);
const debtUI = Object.create(DebtSnowballUI.prototype);
debtUI.store = debtStore;
debtUI.recurringManager = debtRecurringManager;
debtUI.daySpecificOptions = [];

const debtOneId = debtStore.addDebt({
  name: "Card A",
  balance: 100,
  minPayment: 10,
  dueDay: 1,
  recurrence: "monthly",
  dueStartDate: "2026-03-01"
});
debtStore.addDebt({
  name: "Card B",
  balance: 200,
  minPayment: 20,
  dueDay: 1,
  recurrence: "monthly",
  dueStartDate: "2026-03-01"
});
debtStore.addCashInfusion({
  name: "Windfall",
  amount: 60,
  date: "2026-03-10",
  targetDebtId: null
});

const debtSummaries = debtUI.getDebtSummaries(new Date(2026, 3, 1));
const debtOneSummary = debtSummaries.find((summary) => summary.debt.id === debtOneId);
if (!debtOneSummary) throw new Error("Debt summary not found");
if (debtOneSummary.remaining !== 40) {
  throw new Error(`Expected auto infusion to reduce balance to 40, got ${debtOneSummary.remaining}`);
}
console.log("✅ Auto infusions are included in debt summaries");

// TEST 7: Current month projection respects payments already made this month
console.log("TEST 7: Current Month Projection Uses Completed Payments");
const currentMonthStore = new TransactionStore();
currentMonthStore.resetData();
const currentMonthRecurringManager = new RecurringTransactionManager(currentMonthStore);
const currentMonthDebtUI = Object.create(DebtSnowballUI.prototype);
currentMonthDebtUI.store = currentMonthStore;
currentMonthDebtUI.recurringManager = currentMonthRecurringManager;
currentMonthDebtUI.daySpecificOptions = [];

const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth();
const currentMonthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
const firstOfCurrentMonth = `${currentMonthKey}-01`;
const currentDebtId = currentMonthStore.addDebt({
  name: "Current Month Card",
  balance: 100,
  minPayment: 50,
  dueDay: 1,
  recurrence: "monthly",
  dueStartDate: firstOfCurrentMonth
});
currentMonthStore.addTransaction(firstOfCurrentMonth, {
  amount: 50,
  type: "expense",
  description: "Debt Payment: Current Month Card",
  debtId: currentDebtId,
  debtRole: "minimum"
});

const currentProjection = currentMonthDebtUI.calculateSnowballProjection(
  currentYear,
  currentMonth,
  true
);
if (currentProjection.viewBalances[currentDebtId] !== 50) {
  throw new Error(
    `Expected current month projection balance 50 after completed payment, got ${currentProjection.viewBalances[currentDebtId]}`
  );
}
if ((currentProjection.monthTargets[currentMonthKey]?.monthlyTotalsByDebtId?.[currentDebtId] || 0) !== 0) {
  throw new Error("Current month projection still counts minimum payments that already occurred");
}
console.log("✅ Current month projection excludes completed payments");

console.log("ALL TESTS PASSED");
