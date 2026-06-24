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

// TEST 8: Paid/remaining do not depend on which past months were rendered.
// A debt whose schedule began before any viewed month must still report all
// past payments (getHistoricalDebtSnapshot expands history before reading it).
console.log("TEST 8: Debt History Is Expanded Before Snapshotting");
const historyStore = new TransactionStore();
historyStore.resetData();
const historyRecurringManager = new RecurringTransactionManager(historyStore);
const historyUI = Object.create(DebtSnowballUI.prototype);
historyUI.store = historyStore;
historyUI.recurringManager = historyRecurringManager;
historyUI.daySpecificOptions = [];

const historyDebtId = historyStore.addDebt({
  name: "Backdated Card",
  balance: 1000,
  minPayment: 100,
  dueDay: 5,
  recurrence: "monthly",
  dueStartDate: "2026-01-05",
});
historyUI.ensureMinimumPaymentRecurring(
  historyStore.getDebts().find((d) => d.id === historyDebtId)
);
// No months are pre-expanded. Cutoff = 2026-06-01 => Jan..May payments (5 x 100)
// should be counted, leaving 1000 - 500 = 500 regardless of render history.
const historySummary = historyUI
  .getDebtSummaries(new Date(2026, 5, 1))
  .find((s) => s.debt.id === historyDebtId);
if (!historySummary) throw new Error("History debt summary not found");
if (historySummary.paid !== 500 || historySummary.remaining !== 500) {
  throw new Error(
    `Expected paid 500 / remaining 500 from expanded history, got paid ${historySummary.paid} / remaining ${historySummary.remaining}`
  );
}
console.log("✅ Past debt payments are counted without pre-rendering months");

// TEST 9: The snowball is materialized across a forward window, not just the
// viewed month, so forward balances and the 30-day Minimum (which read
// materialized transactions) reflect planned snowball spend for months the user
// has not opened.
console.log("TEST 9: Snowball Materializes Across The Forward Horizon");
const horizonStore = new TransactionStore();
horizonStore.resetData();
const horizonRecurringManager = new RecurringTransactionManager(horizonStore);
const horizonUI = Object.create(DebtSnowballUI.prototype);
horizonUI.store = horizonStore;
horizonUI.recurringManager = horizonRecurringManager;
horizonUI.daySpecificOptions = [];

const horizonNow = new Date();
const horizonY = horizonNow.getFullYear();
const horizonM = horizonNow.getMonth();
const horizonStart = `${horizonY}-${String(horizonM + 1).padStart(2, "0")}-15`;
["Card X", "Card Y"].forEach((name) => {
  const id = horizonStore.addDebt({
    name,
    balance: 5000,
    minPayment: 50,
    dueDay: 15,
    recurrence: "monthly",
    dueStartDate: horizonStart,
  });
  horizonUI.ensureMinimumPaymentRecurring(
    horizonStore.getDebts().find((d) => d.id === id)
  );
});
horizonStore.setDebtSnowballSettings({
  extraPayment: 200,
  extraPaymentStartMonth: "",
  autoGenerate: true,
});

horizonRecurringManager.applyRecurringTransactions(horizonY, horizonM);
horizonUI.ensureSnowballPaymentsForHorizon(horizonY, horizonM);

// Two months ahead has not been "visited", yet its snowball must exist.
const twoAhead = new Date(horizonY, horizonM + 2, 1);
const twoAheadPrefix = `${twoAhead.getFullYear()}-${String(
  twoAhead.getMonth() + 1
).padStart(2, "0")}-`;
const horizonTxns = horizonStore.getTransactions();
let forwardSnowballCount = 0;
Object.keys(horizonTxns).forEach((dk) => {
  if (!dk.startsWith(twoAheadPrefix)) return;
  horizonTxns[dk].forEach((t) => {
    if (t.snowballGenerated === true) forwardSnowballCount += 1;
  });
});
if (forwardSnowballCount === 0) {
  throw new Error(
    "Expected snowball payments materialized two months ahead without opening that month"
  );
}
console.log("✅ Snowball is materialized for unopened forward months");

// TEST 10: Cash-infusion allocation starts its projection at the infusion's
// own month, not earlier. The previous component-wise min(year)/min(month)
// could start the projection months early when the earliest infusion was in a
// prior year with a later month than "today", over-compounding simulated
// interest so an infusion that should pay off a small debt and overflow to the
// next was instead fully consumed by the first debt.
console.log("TEST 10: Infusion Allocation Projection Starts At Infusion Month");
const RealDate = Date;
const FIXED_TODAY = new RealDate(2026, 5, 15, 12, 0, 0); // 2026-06-15
class FrozenDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) { super(FIXED_TODAY.getTime()); } else { super(...args); }
  }
  static now() { return FIXED_TODAY.getTime(); }
}
global.Date = FrozenDate;
try {
  const infStore = new TransactionStore();
  infStore.resetData();
  const infRm = new RecurringTransactionManager(infStore);
  const infUI = Object.create(DebtSnowballUI.prototype);
  infUI.store = infStore;
  infUI.recurringManager = infRm;
  infUI.daySpecificOptions = [];

  const smallId = infStore.addDebt({ name: "Small", balance: 98, minPayment: 0, dueDay: 1, recurrence: "monthly", dueStartDate: "2025-01-01", interestRate: 24 });
  const bigId = infStore.addDebt({ name: "Big", balance: 500, minPayment: 0, dueDay: 1, recurrence: "monthly", dueStartDate: "2025-01-01", interestRate: 24 });
  // Earliest infusion is in a prior year (2025) with month (Sept) after today's month (June).
  infStore.addCashInfusion({ name: "Windfall", amount: 100, date: "2025-09-01", targetDebtId: null });
  infStore.flushPendingSave();

  const allocations = infUI.calculateInfusionAllocations();
  const infId = infStore.getCashInfusions()[0].id;
  const toSmall = (allocations[infId] && allocations[infId][smallId]) || 0;
  const toBig = (allocations[infId] && allocations[infId][bigId]) || 0;
  if (!(toBig > 0) || toSmall >= 100) {
    throw new Error(
      `Projection started too early: infusion put ${toSmall} on Small / ${toBig} on Big (expected Small < 100 with a small overflow to Big)`
    );
  }
  console.log("✅ Infusion projection starts at the infusion's month, not earlier");
} finally {
  global.Date = RealDate;
}

console.log("ALL TESTS PASSED");
