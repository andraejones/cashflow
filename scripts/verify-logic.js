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
  addEventListener: () => {},
  getElementById: () => null
};
global.Utils = {
  generateUniqueId: () => Math.random().toString(36).substr(2, 9),
  formatDateString: (date) => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  },
  parseDateString: (str) => {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  },
  isLastCalendarDayOfMonth: (str) => {
    if (!str || typeof str !== 'string') return false;
    const [y, m, d] = str.split('-').map(Number);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return false;
    const lastDay = new Date(y, m, 0).getDate();
    return d === lastDay;
  },
  // No-op UI helpers so headless tests can drive UI-adjacent methods
  // (e.g. BankReconcileUI._shiftSeries) that fire notifications.
  showNotification: () => {},
  formatDisplayDate: (str) => str,
  escapeHtml: (str) => String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
};
// Minimal ModalManager stub — bank-reconcile references it only in show/hide,
// which these tests never call, but the stub keeps accidental calls harmless.
global.ModalManager = {
  openModal: () => {},
  closeModal: () => {},
  topModal: () => null
};

const vm = require('vm');

// Load source files
const jsDir = path.join(__dirname, '../js');
const files = [
  'transaction-store.js',
  'recurring-manager.js',
  'calculation-service.js',
  'cloud-sync.js',
  'debt-snowball.js',
  'bank-reconcile.js'
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
// has not opened. Under the floor model a debt is paid off in full on the day
// the projected checking surplus above the floor (here $0) can cover it. With a
// healthy recurring income the surplus accrues over a couple of months and the
// payoff lands in a forward month the user never opened. Date is frozen for
// determinism.
console.log("TEST 9: Snowball Materializes Across The Forward Horizon");
const H_RealDate = Date;
const H_FIXED_TODAY = new H_RealDate(2026, 5, 15, 12, 0, 0); // 2026-06-15
class H_FrozenDate extends H_RealDate {
  constructor(...args) {
    if (args.length === 0) { super(H_FIXED_TODAY.getTime()); } else { super(...args); }
  }
  static now() { return H_FIXED_TODAY.getTime(); }
}
global.Date = H_FrozenDate;
try {
  const horizonStore = new TransactionStore();
  horizonStore.resetData();
  const horizonRecurringManager = new RecurringTransactionManager(horizonStore);
  const horizonCalc = new CalculationService(
    horizonStore,
    horizonRecurringManager
  );
  const horizonUI = Object.create(DebtSnowballUI.prototype);
  horizonUI.store = horizonStore;
  horizonUI.recurringManager = horizonRecurringManager;
  horizonUI.calculationService = horizonCalc;
  horizonUI.daySpecificOptions = [];

  const horizonY = 2026;
  const horizonM = 5; // June (0-indexed)
  // Recurring monthly income drives a steady surplus above the $0 floor.
  horizonStore.addRecurringTransaction({
    startDate: "2026-06-01",
    amount: 2000,
    type: "income",
    description: "Salary",
    recurrence: "monthly",
  });
  // A debt large enough that the surplus only covers it a couple of months out.
  const horizonDebtId = horizonStore.addDebt({
    name: "Card X",
    balance: 5000,
    minPayment: 50,
    dueDay: 15,
    recurrence: "monthly",
    interestRate: 0,
    dueStartDate: "2026-06-15",
  });
  horizonUI.ensureMinimumPaymentRecurring(
    horizonStore.getDebts().find((d) => d.id === horizonDebtId)
  );
  horizonStore.setDebtSnowballSettings({
    dailyFloor: 0,
    extraPaymentStartMonth: "",
    autoGenerate: true,
  });

  horizonRecurringManager.applyRecurringTransactions(horizonY, horizonM);
  horizonUI.ensureSnowballPaymentsForHorizon(horizonY, horizonM);

  // A forward month the user never opened must carry the materialized payoff.
  const currentPrefix = `${horizonY}-${String(horizonM + 1).padStart(2, "0")}`;
  const horizonTxns = horizonStore.getTransactions();
  let forwardSnowballCount = 0;
  Object.keys(horizonTxns).forEach((dk) => {
    if (dk.slice(0, 7) <= currentPrefix) return; // only months after June
    horizonTxns[dk].forEach((t) => {
      if (t.snowballGenerated === true) forwardSnowballCount += 1;
    });
  });
  if (forwardSnowballCount === 0) {
    throw new Error(
      "Expected snowball payoff materialized in a forward month without opening it"
    );
  }
  console.log("✅ Snowball is materialized for unopened forward months");
} finally {
  global.Date = H_RealDate;
}

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

// TEST 11: Floor model specifics — (a) a debt is paid off on the day the surplus
// above the floor can cover it, NOT on the debt's due date; (b) a floor set above
// the reachable surplus blocks the lump-sum payoff entirely (minimums only).
console.log("TEST 11: Floor-Driven Payoff Timing And Floor Blocking");
const T11_RealDate = Date;
const T11_FIXED_TODAY = new T11_RealDate(2026, 5, 15, 12, 0, 0); // 2026-06-15
class T11_FrozenDate extends T11_RealDate {
  constructor(...args) {
    if (args.length === 0) { super(T11_FIXED_TODAY.getTime()); } else { super(...args); }
  }
  static now() { return T11_FIXED_TODAY.getTime(); }
}
global.Date = T11_FrozenDate;
try {
  const makeUI = () => {
    const s = new TransactionStore();
    s.resetData();
    const rm = new RecurringTransactionManager(s);
    const calc = new CalculationService(s, rm);
    const ui = Object.create(DebtSnowballUI.prototype);
    ui.store = s;
    ui.recurringManager = rm;
    ui.calculationService = calc;
    ui.daySpecificOptions = [];
    return { s, rm, ui };
  };

  // (a) Surplus already covers the debt; payoff must land on the availability
  // day (2026-06-16, the first projected day) and never on the 28th due date.
  {
    const { s, rm, ui } = makeUI();
    s.addRecurringTransaction({
      startDate: "2026-06-01",
      amount: 2000,
      type: "income",
      description: "Salary",
      recurrence: "monthly",
    });
    const debtId = s.addDebt({
      name: "Card A",
      balance: 1500,
      minPayment: 0,
      dueDay: 28,
      recurrence: "monthly",
      interestRate: 0,
      dueStartDate: "2026-06-28",
    });
    ui.ensureMinimumPaymentRecurring(s.getDebts().find((d) => d.id === debtId));
    s.setDebtSnowballSettings({ dailyFloor: 0, extraPaymentStartMonth: "", autoGenerate: true });
    rm.applyRecurringTransactions(2026, 5);
    ui.ensureSnowballPaymentsForHorizon(2026, 5);

    const txns = s.getTransactions();
    const hasSnowballOn = (date) =>
      (txns[date] || []).some((t) => t.snowballGenerated === true);
    if (!hasSnowballOn("2026-06-16")) {
      throw new Error("Expected payoff on availability day 2026-06-16");
    }
    if (hasSnowballOn("2026-06-28")) {
      throw new Error("Payoff must not land on the due date 2026-06-28");
    }
  }
  console.log("✅ Payoff lands on the availability day, not the due date");

  // (b) Tiny net surplus and a floor above the reachable balance — no lump-sum
  // payoff should ever materialize within the horizon.
  {
    const { s, rm, ui } = makeUI();
    s.addRecurringTransaction({
      startDate: "2026-06-01",
      amount: 100,
      type: "income",
      description: "Side income",
      recurrence: "monthly",
    });
    const debtId = s.addDebt({
      name: "Card B",
      balance: 1500,
      minPayment: 50,
      dueDay: 15,
      recurrence: "monthly",
      interestRate: 0,
      dueStartDate: "2026-06-15",
    });
    ui.ensureMinimumPaymentRecurring(s.getDebts().find((d) => d.id === debtId));
    s.setDebtSnowballSettings({ dailyFloor: 1000, extraPaymentStartMonth: "", autoGenerate: true });
    rm.applyRecurringTransactions(2026, 5);
    ui.ensureSnowballPaymentsForHorizon(2026, 5);

    const txns = s.getTransactions();
    let snowballCount = 0;
    Object.keys(txns).forEach((dk) => {
      txns[dk].forEach((t) => {
        if (t.snowballGenerated === true) snowballCount += 1;
      });
    });
    if (snowballCount !== 0) {
      throw new Error(
        `Floor above reachable surplus must block payoff, found ${snowballCount} snowball payments`
      );
    }
  }
  console.log("✅ A floor above the reachable surplus blocks lump-sum payoff");

  // (c) A payoff that lands BEFORE the same-month minimum due date must suppress
  // that minimum (no stale minimum lingering on the calendar in the payoff month).
  {
    const { s, rm, ui } = makeUI();
    s.addRecurringTransaction({
      startDate: "2026-06-01",
      amount: 2000,
      type: "income",
      description: "Salary",
      recurrence: "monthly",
    });
    const debtId = s.addDebt({
      name: "Card C",
      balance: 1500,
      minPayment: 50,
      dueDay: 20,
      recurrence: "monthly",
      interestRate: 0,
      dueStartDate: "2026-06-20",
    });
    ui.ensureMinimumPaymentRecurring(s.getDebts().find((d) => d.id === debtId));
    s.setDebtSnowballSettings({ dailyFloor: 0, extraPaymentStartMonth: "", autoGenerate: true });
    rm.applyRecurringTransactions(2026, 5);
    ui.ensureSnowballPaymentsForHorizon(2026, 5);

    const txns = s.getTransactions();
    const paidEarly = (txns["2026-06-16"] || []).some(
      (t) => t.snowballGenerated === true
    );
    if (!paidEarly) {
      throw new Error("Expected early payoff on 2026-06-16");
    }
    const lingeringMin = (txns["2026-06-20"] || []).some(
      (t) => t.debtRole === "minimum" && t.debtId === debtId && Number(t.amount) > 0
    );
    if (lingeringMin) {
      throw new Error(
        "Minimum due after the same-month payoff must be suppressed, not left active"
      );
    }
  }
  console.log("✅ Minimum after a same-month payoff is suppressed");
} finally {
  global.Date = T11_RealDate;
}

// TEST 12: Cash-infusion breakdown follows the plan's lump-sum payoffs. A future
// infusion must not be credited to a debt the snowball plan has already paid off
// in an earlier month; it should flow to the next surviving debt. Without the
// plan overlay the monthly allocation sim keeps the paid-off debt alive and
// mis-attributes the infusion.
console.log("TEST 12: Infusion Breakdown Honors Plan Lump-Sum Payoffs");
const T12_RealDate = Date;
const T12_FIXED_TODAY = new T12_RealDate(2026, 5, 15, 12, 0, 0); // 2026-06-15
class T12_FrozenDate extends T12_RealDate {
  constructor(...args) {
    if (args.length === 0) { super(T12_FIXED_TODAY.getTime()); } else { super(...args); }
  }
  static now() { return T12_FIXED_TODAY.getTime(); }
}
global.Date = T12_FrozenDate;
try {
  const s = new TransactionStore();
  s.resetData();
  const rm = new RecurringTransactionManager(s);
  const calc = new CalculationService(s, rm);
  const ui = Object.create(DebtSnowballUI.prototype);
  ui.store = s;
  ui.recurringManager = rm;
  ui.calculationService = calc;
  ui.daySpecificOptions = [];

  s.addRecurringTransaction({
    startDate: "2026-06-01",
    amount: 1000,
    type: "income",
    description: "Salary",
    recurrence: "monthly",
  });
  const smallId = s.addDebt({ name: "Small", balance: 200, minPayment: 0, dueDay: 28, recurrence: "monthly", interestRate: 0, dueStartDate: "2026-06-28" });
  const bigId = s.addDebt({ name: "Big", balance: 6000, minPayment: 0, dueDay: 28, recurrence: "monthly", interestRate: 0, dueStartDate: "2026-06-28" });
  ui.ensureMinimumPaymentRecurring(s.getDebts().find((d) => d.id === smallId));
  ui.ensureMinimumPaymentRecurring(s.getDebts().find((d) => d.id === bigId));
  // Future infusion lands AFTER the plan pays Small off (June) but while Big is
  // still alive (paid much later).
  s.addCashInfusion({ name: "Windfall", amount: 100, date: "2026-09-01", targetDebtId: null });
  s.setDebtSnowballSettings({ dailyFloor: 0, extraPaymentStartMonth: "", autoGenerate: true });
  s.flushPendingSave();
  rm.applyRecurringTransactions(2026, 5);

  const projection = ui.calculateSnowballProjection(2026, 5, true);
  const infIndex = ui.getMonthIndex(2026, 8); // Sept
  const smallPaid = projection.payoffByDebtId[smallId];
  const bigPaid = projection.payoffByDebtId[bigId];
  if (!smallPaid || ui.getMonthIndex(smallPaid.year, smallPaid.month) >= infIndex) {
    throw new Error("Test setup: plan must pay Small off before the infusion month");
  }
  if (bigPaid && ui.getMonthIndex(bigPaid.year, bigPaid.month) <= infIndex) {
    throw new Error("Test setup: Big must still be alive at the infusion month");
  }

  const infId = s.getCashInfusions()[0].id;
  const withPlan = ui.calculateInfusionAllocations(projection);
  const toSmall = (withPlan[infId] && withPlan[infId][smallId]) || 0;
  const toBig = (withPlan[infId] && withPlan[infId][bigId]) || 0;
  if (toSmall !== 0 || toBig !== 100) {
    throw new Error(
      `Infusion must flow to the surviving debt: got Small ${toSmall}, Big ${toBig} (expected Small 0, Big 100)`
    );
  }

  // Without the plan overlay the bare monthly sim keeps Small alive and
  // mis-credits the infusion to it — the inconsistency the overlay fixes.
  const withoutPlan = ui.calculateInfusionAllocations();
  const oldToSmall = (withoutPlan[infId] && withoutPlan[infId][smallId]) || 0;
  if (oldToSmall !== 100) {
    throw new Error(
      `Expected the un-overlaid sim to mis-credit Small with 100, got ${oldToSmall}`
    );
  }
  console.log("✅ Infusion breakdown skips plan-paid-off debts, flows to survivors");
} finally {
  global.Date = T12_RealDate;
}

// TEST 13: Allocation auto-close-out (pinning + expiry sweep) and recurring
// drawable buckets.
console.log(
  "TEST 13: Allocation auto-close-out + recurring buckets"
);
const A_RealDate = Date;
const A_FIXED_TODAY = new A_RealDate(2026, 5, 15, 12, 0, 0); // 2026-06-15
class A_FrozenDate extends A_RealDate {
  constructor(...args) {
    if (args.length === 0) { super(A_FIXED_TODAY.getTime()); } else { super(...args); }
  }
  static now() { return A_FIXED_TODAY.getTime(); }
}
global.Date = A_FrozenDate;
try {
  const s = new TransactionStore();
  s.resetData();
  const rm = new RecurringTransactionManager(s);

  // A normal allocation rolls forward; an auto-close-out allocation is pinned.
  s.addTransaction("2026-06-10", {
    amount: 100, type: "expense", description: "Rolling", allocated: true, settled: true,
  });
  s.addTransaction("2026-06-15", {
    amount: 300, type: "expense", description: "Pinned",
    allocated: true, autoCloseout: true, settled: true,
  });
  s.rollForwardAllocations();
  // Rolling allocations now carry forward onto TODAY (2026-06-15), not a day
  // ahead, so they track the current day instead of sitting in the future.
  const movedRolling = (s.getTransactions()["2026-06-15"] || []).some(
    (t) => t.description === "Rolling"
  );
  const leftOldDate = !(s.getTransactions()["2026-06-10"] || []).some(
    (t) => t.description === "Rolling"
  );
  const pinnedStayed = (s.getTransactions()["2026-06-15"] || []).some(
    (t) => t.description === "Pinned"
  );
  if (!movedRolling || !leftOldDate) throw new Error("Normal allocation should roll forward to today");
  if (!pinnedStayed) throw new Error("Auto-close-out allocation must stay pinned to its date");
  console.log("✅ Auto-close-out allocations are pinned; normal ones roll forward");

  // The expiry sweep removes auto-close-out allocations once their date passes.
  s.addTransaction("2026-06-14", {
    amount: 50, type: "expense", description: "Expired",
    allocated: true, autoCloseout: true, settled: true,
  });
  s.closeOutExpiredAllocations();
  const expiredGone = !(s.getTransactions()["2026-06-14"] || []).some(
    (t) => t.description === "Expired"
  );
  const todayKept = (s.getTransactions()["2026-06-15"] || []).some(
    (t) => t.description === "Pinned"
  );
  if (!expiredGone) throw new Error("Past auto-close-out allocation should be swept");
  if (!todayKept) throw new Error("Today's auto-close-out allocation must survive the sweep");
  console.log("✅ Expiry sweep removes only past auto-close-out allocations");

  // An explicit closeoutDate overrides the bucket's own date for the sweep:
  // the bucket lives through the close-out date (drawable that day) and is
  // forfeited the day after. Legacy buckets without closeoutDate keep the
  // "closes when its own date passes" rule (covered by "Expired" above).
  s.addTransaction("2026-06-12", {
    amount: 40, type: "expense", description: "ClosedEarly",
    allocated: true, autoCloseout: true, settled: true, closeoutDate: "2026-06-14",
  });
  s.addTransaction("2026-06-10", {
    amount: 60, type: "expense", description: "ClosesToday",
    allocated: true, autoCloseout: true, settled: true, closeoutDate: "2026-06-15",
  });
  s.addTransaction("2026-06-10", {
    amount: 80, type: "expense", description: "ClosesLater",
    allocated: true, autoCloseout: true, settled: true, closeoutDate: "2026-06-20",
  });
  s.closeOutExpiredAllocations();
  const findByDesc = (date, desc) =>
    (s.getTransactions()[date] || []).some((t) => t.description === desc);
  if (findByDesc("2026-06-12", "ClosedEarly")) {
    throw new Error("Bucket past its closeoutDate should be swept");
  }
  if (!findByDesc("2026-06-10", "ClosesToday")) {
    throw new Error("Bucket closing today must survive the sweep (drawable through its close-out date)");
  }
  if (!findByDesc("2026-06-10", "ClosesLater")) {
    throw new Error("Bucket with a future closeoutDate must outlive its own past date");
  }
  // The future-closing bucket stays pinned to its own date (never rolls
  // forward) even though it outlives it.
  s.rollForwardAllocations();
  if (!findByDesc("2026-06-10", "ClosesLater")) {
    throw new Error("Auto-close-out bucket must stay pinned despite a future closeoutDate");
  }
  // Drawable window: offered for reference dates inside [date, closeoutDate],
  // not before its date and not after its close-out date.
  const offeredOn = (ref) =>
    s.getAllocations(ref).some((a) => a.description === "ClosesLater");
  if (offeredOn("2026-06-09")) {
    throw new Error("Bucket must not be drawable before its own date");
  }
  if (!offeredOn("2026-06-15") || !offeredOn("2026-06-20")) {
    throw new Error("Bucket must be drawable through its close-out date");
  }
  if (offeredOn("2026-06-21")) {
    throw new Error("Bucket must not be offered to expenses dated after its close-out date");
  }
  console.log("✅ closeoutDate extends a bucket's life and bounds its drawable window");

  // A recurring allocation drops a fresh drawable bucket each period; drawing
  // against it persists across re-expansion. A bucket can't be drawn before its
  // own date, so the instance is dated today (2026-06-15) to be drawable.
  const ralloc = new TransactionStore();
  ralloc.resetData();
  const rrm = new RecurringTransactionManager(ralloc);
  const rid = ralloc.addRecurringTransaction({
    startDate: "2026-06-15", amount: 400, type: "expense", description: "Groceries",
    recurrence: "monthly", allocated: true, autoCloseout: true, settled: true,
  });
  rrm.applyRecurringTransactions(2026, 5); // June
  const buckets = ralloc.getAllocations();
  const bucket = buckets.find((b) => b.description === "Groceries");
  if (!bucket || bucket.recurring !== true) {
    throw new Error("Recurring allocation should surface as a drawable bucket");
  }
  if (bucket.id !== `ralloc:${rid}:2026-06-15`) {
    throw new Error(`Unexpected synthetic bucket id: ${bucket.id}`);
  }
  // Draw $150 against it; the instance materializes and shrinks to $250.
  ralloc.addTransaction("2026-06-16", {
    amount: 150, type: "expense", description: "Store run",
    drawsFromAllocationId: bucket.id, settled: true,
  });
  const drawTxn = (ralloc.getTransactions()["2026-06-16"] || []).find(
    (t) => t.description === "Store run"
  );
  const inst = (ralloc.getTransactions()["2026-06-15"] || []).find(
    (t) => t.recurringId === rid
  );
  if (!inst || inst.modifiedInstance !== true || !inst.id) {
    throw new Error("Drawing must materialize the recurring instance (id + modifiedInstance)");
  }
  if (ralloc._roundCents(inst.amount) !== 250) {
    throw new Error(`Bucket should debit to 250, got ${inst.amount}`);
  }
  if (drawTxn.drawsFromAllocationId !== inst.id) {
    throw new Error("Draw link should be rewritten from the synthetic key to the real id");
  }
  // Re-expansion must not clobber the drawn-down (modified) instance.
  rrm.applyRecurringTransactions(2026, 5);
  const instAfter = (ralloc.getTransactions()["2026-06-15"] || []).find(
    (t) => t.recurringId === rid
  );
  if (!instAfter || ralloc._roundCents(instAfter.amount) !== 250) {
    throw new Error("Re-expansion must preserve the drawn-down recurring bucket");
  }
  console.log("✅ Recurring allocation buckets are drawable and persist across re-expansion");

  // Past auto-close-out instances are never materialized by expansion.
  const past = new TransactionStore();
  past.resetData();
  const prm = new RecurringTransactionManager(past);
  past.addRecurringTransaction({
    startDate: "2026-05-01", amount: 400, type: "expense", description: "Old budget",
    recurrence: "monthly", allocated: true, autoCloseout: true, settled: true,
  });
  prm.applyRecurringTransactions(2026, 4); // May (all before today)
  const hasPast = (past.getTransactions()["2026-05-01"] || []).some(
    (t) => t.description === "Old budget"
  );
  if (hasPast) throw new Error("Expansion must skip past auto-close-out instances");
  console.log("✅ Expansion skips already-expired recurring allocation instances");
} finally {
  global.Date = A_RealDate;
}

// TEST 14: Rolling (non-auto-close) recurring allocations. Each period's bucket
// stays live across its period and is forfeited when the next instance lands;
// the unspent remainder releases back to the balance, draws stay as expenses.
console.log("TEST 14: Rolling recurring allocations");
const B_RealDate = Date;
let B_FIXED = new B_RealDate(2026, 5, 15, 12, 0, 0); // 2026-06-15
class B_FrozenDate extends B_RealDate {
  constructor(...args) {
    if (args.length === 0) { super(B_FIXED.getTime()); } else { super(...args); }
  }
  static now() { return B_FIXED.getTime(); }
}
global.Date = B_FrozenDate;
try {
  const s = new TransactionStore();
  s.resetData();
  const rm = new RecurringTransactionManager(s);

  // Monthly rolling allocation ($200) starting 2026-06-01, NO auto close-out.
  const rid = s.addRecurringTransaction({
    startDate: "2026-06-01", amount: 200, type: "expense", description: "Spending",
    recurrence: "monthly", allocated: true, settled: true,
  });
  rm.applyRecurringTransactions(2026, 5); // June

  const junInst0 = (s.getTransactions()["2026-06-01"] || []).find((t) => t.recurringId === rid);
  if (!junInst0 || junInst0.allocated !== true || junInst0.autoCloseout !== undefined) {
    throw new Error("Live June bucket must materialize at its past period date without autoCloseout");
  }
  const active = s.getAllocations("2026-06-15").find((b) => b.description === "Spending");
  if (!active || active.date !== "2026-06-01") {
    throw new Error("Active bucket for 06-15 should be the June 1 period (latest <= ref)");
  }
  console.log("✅ Rolling bucket stays live across its period and is the active draw target");

  // Draw $150 -> bucket shrinks to $50; draw is its own expense.
  s.addTransaction("2026-06-15", {
    amount: 150, type: "expense", description: "Shopping",
    drawsFromAllocationId: active.id, settled: true,
  });
  const junDrawn = (s.getTransactions()["2026-06-01"] || []).find((t) => t.recurringId === rid);
  if (s._roundCents(junDrawn.amount) !== 50) {
    throw new Error(`June bucket should debit to 50, got ${junDrawn.amount}`);
  }
  console.log("✅ Drawing against a rolling bucket shrinks it like any allocation");

  // July still in the future on 06-15: June stays live, not yet superseded.
  rm.applyRecurringTransactions(2026, 6); // July
  if (s.closeOutExpiredAllocations()) rm.invalidateCache();
  if (!(s.getTransactions()["2026-06-01"] || []).some((t) => t.recurringId === rid)) {
    throw new Error("June bucket must stay live while July is still in the future");
  }

  // Advance to 2026-07-10: July 1 becomes live and forfeits June 1.
  B_FIXED = new B_RealDate(2026, 6, 10, 12, 0, 0);
  if (s.closeOutExpiredAllocations()) rm.invalidateCache();
  if ((s.getTransactions()["2026-06-01"] || []).some((t) => t.recurringId === rid)) {
    throw new Error("June bucket should be forfeited once July 1 is live");
  }
  const julInst = (s.getTransactions()["2026-07-01"] || []).find((t) => t.recurringId === rid);
  if (!julInst || s._roundCents(julInst.amount) !== 200) {
    throw new Error("July bucket should be the fresh $200 live envelope");
  }
  const drawKept = (s.getTransactions()["2026-06-15"] || []).find((t) => t.description === "Shopping");
  if (!drawKept || drawKept.amount !== 150) {
    throw new Error("The $150 draw must remain as a real expense after forfeit");
  }
  console.log("✅ Next instance forfeits the prior bucket (remainder released, draw kept)");

  // Re-expanding the old month must NOT resurrect the forfeited bucket.
  rm.applyRecurringTransactions(2026, 5);
  if ((s.getTransactions()["2026-06-01"] || []).some((t) => t.recurringId === rid)) {
    throw new Error("Forfeited June bucket must not reappear on re-expansion");
  }
  console.log("✅ Superseded period is not re-materialized on re-expansion");
} finally {
  global.Date = B_RealDate;
}

// TEST 15: Month-end current-month view balances. On the last day of the month
// the projection starts next month (projectionStartDate = tomorrow), so the
// daily walk never visits the view month and its end-of-view-month capture
// never fires. Before the fix, viewBalances fell through to post-walk balances
// (after next month's payments — or, with surplus, to all-zero once the walk
// runs every debt to payoff), so the snowball view understated debt / falsely
// reported everything paid off. The view month's end balances must equal the
// current balances (nothing in the view month remains to project). Frozen to a
// month-end day for determinism.
console.log("TEST 15: Month-End Current-Month View Balances");
const ME_RealDate = Date;
const ME_FIXED_TODAY = new ME_RealDate(2026, 5, 30, 12, 0, 0); // 2026-06-30 (last day of June)
class ME_FrozenDate extends ME_RealDate {
  constructor(...args) {
    if (args.length === 0) { super(ME_FIXED_TODAY.getTime()); } else { super(...args); }
  }
  static now() { return ME_FIXED_TODAY.getTime(); }
}
global.Date = ME_FrozenDate;
try {
  const s = new TransactionStore();
  s.resetData();
  const rm = new RecurringTransactionManager(s);
  const calc = new CalculationService(s, rm);
  const ui = Object.create(DebtSnowballUI.prototype);
  ui.store = s;
  ui.recurringManager = rm;
  ui.calculationService = calc;
  ui.daySpecificOptions = [];

  // Income so checking is healthy; a high floor blocks any lump-sum payoff so we
  // isolate the view-balance capture (not the snowball sweep).
  s.addRecurringTransaction({
    startDate: "2026-06-01", amount: 2000, type: "income",
    description: "Salary", recurrence: "monthly",
  });
  const debtId = s.addDebt({
    name: "Card", balance: 100, minPayment: 50, dueDay: 1,
    recurrence: "monthly", interestRate: 0, dueStartDate: "2026-06-01",
  });
  ui.ensureMinimumPaymentRecurring(s.getDebts().find((d) => d.id === debtId));
  // Materialize June so the day-1 minimum ($50, already due) is counted "paid".
  rm.applyRecurringTransactions(2026, 5);
  s.setDebtSnowballSettings({ dailyFloor: 100000, extraPaymentStartMonth: "", autoGenerate: false });

  const proj = ui.calculateSnowballProjection(2026, 5, true);
  const vb = proj.viewBalances[debtId];
  if (Math.abs(vb - 50) > 0.001) {
    throw new Error(
      `Month-end view balance must reflect this month's state (100 - 50 paid = 50), got ${vb}`
    );
  }
  console.log("✅ Month-end view shows current balances, not next-month/zeroed balances");
} finally {
  global.Date = ME_RealDate;
}

// TEST 16: Allocation reserves survive an Ending Balance. An Ending Balance is
// the gross bank total (reserved funds are still physically in the account), so
// every still-live allocation dated on/before an anchor is subtracted from the
// entered figure — keeping it reserved instead of being absorbed. The "gross"
// (balance + reserved) must equal the entered figure, and post-anchor reserves
// reduce later days normally.
console.log("TEST 16: Allocation Reserves Survive An Ending Balance");
const ER_RealDate = Date;
const ER_FIXED_TODAY = new ER_RealDate(2026, 5, 30, 12, 0, 0); // 2026-06-30
class ER_FrozenDate extends ER_RealDate {
  constructor(...args) {
    if (args.length === 0) { super(ER_FIXED_TODAY.getTime()); } else { super(...args); }
  }
  static now() { return ER_FIXED_TODAY.getTime(); }
}
global.Date = ER_FrozenDate;
try {
  const s = new TransactionStore();
  s.resetData();
  const rm = new RecurringTransactionManager(s);
  const calc = new CalculationService(s, rm);

  // $1000 reserved June 1, Ending Balance $5000 entered June 15, $300 reserved
  // June 20 (after the anchor).
  s.addTransaction("2026-06-01", {
    amount: 1000, type: "expense", description: "Reserve", allocated: true, settled: true,
  });
  s.addTransaction("2026-06-15", {
    amount: 5000, type: "balance", description: "Ending Balance",
  });
  s.addTransaction("2026-06-20", {
    amount: 300, type: "expense", description: "Later reserve", allocated: true, settled: true,
  });

  // Reserved-on/before sums only count buckets dated up to the date.
  if (calc.getReservedTotalOnOrBefore("2026-06-15") !== 1000) {
    throw new Error(`Reserved on/before anchor should be 1000, got ${calc.getReservedTotalOnOrBefore("2026-06-15")}`);
  }
  if (calc.getReservedTotalOnOrBefore("2026-06-20") !== 1300) {
    throw new Error(`Reserved on/before 06-20 should be 1300, got ${calc.getReservedTotalOnOrBefore("2026-06-20")}`);
  }

  // After the anchor (before the later reserve): balance = entered - pre-anchor
  // reserve = 5000 - 1000 = 4000. The June 1 reserve is NOT absorbed.
  const b16 = calc.getRunningBalanceForDate("2026-06-16");
  if (Math.abs(b16 - 4000) > 0.001) {
    throw new Error(`Balance after anchor should be 4000 (reserve survives), got ${b16}`);
  }
  // Gross (balance + reserved on/before) must equal the entered figure.
  if (Math.abs(b16 + calc.getReservedTotalOnOrBefore("2026-06-16") - 5000) > 0.001) {
    throw new Error("balance + reserved must equal the entered gross (5000)");
  }

  // The post-anchor reserve reduces later days normally: 5000 - 1000 - 300.
  const b21 = calc.getRunningBalanceForDate("2026-06-21");
  if (Math.abs(b21 - 3700) > 0.001) {
    throw new Error(`Balance after the later reserve should be 3700, got ${b21}`);
  }

  // Invariant: month-end running balance equals the monthly summary's ending.
  const monthEnd = calc.getRunningBalanceForDate("2026-06-30");
  const summaryEnd = calc.calculateMonthlySummary(2026, 5).endingBalance;
  if (Math.abs(monthEnd - summaryEnd) > 0.001) {
    throw new Error(`getRunningBalanceForDate(month-end)=${monthEnd} must equal summary ending=${summaryEnd}`);
  }
  console.log("✅ Reserves stay reserved across an Ending Balance; gross = entered; invariants hold");
} finally {
  global.Date = ER_RealDate;
}

// TEST 17: "Last day of every month" is an explicit flag, not inferred from the
// start date. Previously a monthly recurrence whose start date happened to be
// the last day of a short month (e.g. the 30th, or Feb 28) silently jumped to
// the 31st in longer months. Now: the flag drives last-day behavior; without it
// the day is clamped; and legacy recurrences that relied on the old inference
// are migrated to carry the flag on load so their dates never change.
console.log("TEST 17: Monthly Last-Day-Of-Month Is An Explicit Flag");
{
  const expandDates = (rt) => {
    const s = new TransactionStore();
    s.resetData();
    const rm = new RecurringTransactionManager(s);
    s.addRecurringTransaction(rt);
    // Expand June–December 2026 (June start), covering 30- and 31-day months.
    for (let mo = 5; mo <= 11; mo++) rm.applyRecurringTransactions(2026, mo);
    const t = s.getTransactions();
    return Object.keys(t)
      .filter((d) => t[d].some((x) => x.recurringId === rt.id))
      .sort()
      .join(",");
  };

  // With the flag: every month's last calendar day.
  const withFlag = expandDates({
    id: "ld-flag", amount: 10, type: "expense", description: "x",
    recurrence: "monthly", startDate: "2026-06-30", lastDayOfMonth: true,
  });
  const expectFlag =
    "2026-06-30,2026-07-31,2026-08-31,2026-09-30,2026-10-31,2026-11-30,2026-12-31";
  if (withFlag !== expectFlag) {
    throw new Error(`lastDayOfMonth flag should land on each month's last day.\n got: ${withFlag}\n exp: ${expectFlag}`);
  }

  // Without the flag: the 30th is preserved (no silent jump to the 31st).
  const noFlag = expandDates({
    id: "ld-none", amount: 10, type: "expense", description: "x",
    recurrence: "monthly", startDate: "2026-06-30",
  });
  const expectNoFlag =
    "2026-06-30,2026-07-30,2026-08-30,2026-09-30,2026-10-30,2026-11-30,2026-12-30";
  if (noFlag !== expectNoFlag) {
    throw new Error(`Without the flag a day-30 start must stay on the 30th.\n got: ${noFlag}\n exp: ${expectNoFlag}`);
  }
  console.log("✅ Flag drives last-day behavior; without it the day is clamped, not inflated");

  // Migration: a legacy stored monthly recurrence whose start date is its
  // month's last day gains lastDayOfMonth=true on load, preserving its dates.
  localStorage.setItem(
    "recurringTransactions",
    JSON.stringify([{ id: "ld-legacy", amount: 10, type: "expense", description: "x", recurrence: "monthly", startDate: "2026-06-30" }])
  );
  const migrated = new TransactionStore();
  const legacyRt = migrated.getRecurringTransactions().find((r) => r.id === "ld-legacy");
  if (!legacyRt || legacyRt.lastDayOfMonth !== true) {
    throw new Error("Legacy last-day recurrence should be migrated to carry lastDayOfMonth=true");
  }
  // A normal mid-month recurrence must NOT be stamped.
  localStorage.setItem(
    "recurringTransactions",
    JSON.stringify([{ id: "ld-mid", amount: 10, type: "expense", description: "x", recurrence: "monthly", startDate: "2026-06-15" }])
  );
  const migratedMid = new TransactionStore();
  const midRt = migratedMid.getRecurringTransactions().find((r) => r.id === "ld-mid");
  if (!midRt || midRt.lastDayOfMonth !== undefined) {
    throw new Error("A mid-month recurrence must not be stamped with lastDayOfMonth");
  }
  localStorage.removeItem("recurringTransactions");
  console.log("✅ Legacy last-day recurrences are migrated; mid-month ones are left untouched");
}

// TEST 18: Custom "every N months" recurrences don't overflow month-end starts.
// A start date on a month's last day (e.g. Jan 31) advanced by whole months must
// clamp to each target month's last day, never spill into the next month. The
// old setMonth-based math turned Sep 31 into Oct 1 — skipping September and
// duplicating an occurrence into October.
console.log("TEST 18: Custom Monthly Interval Clamps Month-End Starts");
{
  const expandDates = (rt, months) => {
    const s = new TransactionStore();
    s.resetData();
    const rm = new RecurringTransactionManager(s);
    s.addRecurringTransaction(rt);
    months.forEach(([y, mo]) => rm.applyRecurringTransactions(y, mo));
    const t = s.getTransactions();
    return Object.keys(t)
      .filter((d) => t[d].some((x) => x.recurringId === rt.id))
      .sort();
  };

  // "Every 2 months from Jan 31, 2026": Jan 31, Mar 31, May 31, Jul 31,
  // Sep 30 (clamped, NOT Oct 1), Nov 30 (clamped, NOT Dec 1).
  const rt = {
    id: "cm-2mo", amount: 10, type: "expense", description: "x",
    recurrence: "custom", startDate: "2026-01-31",
    customInterval: { unit: "months", value: 2 },
  };
  const months = [];
  for (let mo = 0; mo <= 11; mo++) months.push([2026, mo]);
  const dates = expandDates(rt, months);
  const expected = [
    "2026-01-31", "2026-03-31", "2026-05-31",
    "2026-07-31", "2026-09-30", "2026-11-30",
  ];
  if (dates.join(",") !== expected.join(",")) {
    throw new Error(`Custom every-2-months from Jan 31 should clamp, not overflow.\n got: ${dates.join(",")}\n exp: ${expected.join(",")}`);
  }
  // Guard against the old duplication bug: no month may hold two occurrences.
  const monthPrefixes = dates.map((d) => d.slice(0, 7));
  if (new Set(monthPrefixes).size !== monthPrefixes.length) {
    throw new Error(`Custom monthly interval produced two occurrences in one month: ${dates.join(",")}`);
  }
  console.log("✅ Month-end custom intervals clamp to each month's last day; no skips or duplicates");
}

// TEST 19: Future-scope recurring splits anchor on the SCHEDULED occurrence
// date, not the business-day-adjusted landing date. Splitting at the landing
// date silently rewrote the recurrence pattern (a monthly bill due the 1st,
// edited on its Fri Oct 30 landing, became "monthly on the 30th").
console.log("TEST 19: Future Split Anchors On The Scheduled Date");
{
  const s = new TransactionStore();
  s.resetData();
  const rm = new RecurringTransactionManager(s);

  // Monthly bill due the 1st, adjusted to the previous business day.
  const rtId = s.addRecurringTransaction({
    startDate: "2026-08-01",
    amount: 100,
    type: "expense",
    description: "Rent",
    recurrence: "monthly",
    businessDayAdjustment: "previous",
  });

  // Nov 1 2026 is a Sunday -> lands Fri 2026-10-30 with originalDate 2026-11-01.
  rm.applyRecurringTransactions(2026, 9); // Oct
  rm.applyRecurringTransactions(2026, 10); // Nov
  const oct30 = (s.getTransactions()["2026-10-30"] || []).findIndex(
    (t) => t.recurringId === rtId && t.originalDate === "2026-11-01"
  );
  if (oct30 === -1) throw new Error("Setup: adjusted Nov-1 instance not found on 2026-10-30");

  rm.editTransaction(
    "2026-10-30",
    oct30,
    { amount: 250, type: "expense", description: "Rent (new)" },
    "future"
  );

  const oldRt = s.getRecurringTransactions().find((r) => r.id === rtId);
  const newRt = s.getRecurringTransactions().find((r) => r.id !== rtId);
  if (!newRt || newRt.startDate !== "2026-11-01") {
    throw new Error(`New series must anchor on the scheduled date 2026-11-01, got ${newRt && newRt.startDate}`);
  }
  if (oldRt.endDate !== "2026-10-29") {
    throw new Error(`Old series must end the day before the landing date, got ${oldRt.endDate}`);
  }

  // Re-expansion: exactly one instance for the Nov-1 occurrence, on the
  // landing day, with the edit; December stays on the 1st (not the 30th).
  rm.invalidateCache();
  rm.applyRecurringTransactions(2026, 9);
  rm.applyRecurringTransactions(2026, 10);
  rm.applyRecurringTransactions(2026, 11);
  const tx = s.getTransactions();
  const nov1 = [];
  Object.keys(tx).forEach((d) => tx[d].forEach((t) => {
    if (t.recurringId && (t.originalDate || d) === "2026-11-01") nov1.push({ d, t });
  }));
  if (nov1.length !== 1) {
    throw new Error(`Expected exactly one Nov-1 occurrence, got ${nov1.length} (${nov1.map((r) => r.d).join(",")})`);
  }
  if (nov1[0].d !== "2026-10-30" || nov1[0].t.amount !== 250 || nov1[0].t.recurringId !== newRt.id) {
    throw new Error("Re-expanded Nov-1 occurrence must land on 2026-10-30 with the edited amount, from the new series");
  }
  if (!(tx["2026-12-01"] || []).some((t) => t.recurringId === newRt.id)) {
    throw new Error("December occurrence must stay on the 1st");
  }
  if ((tx["2026-12-30"] || []).some((t) => t.recurringId === newRt.id)) {
    throw new Error("Phantom December occurrence on the 30th (pre-fix landing-date anchor)");
  }
  if (!(tx["2026-10-01"] || []).some((t) => t.recurringId === rtId)) {
    throw new Error("Prior Oct-1 occurrence must still expand from the old series");
  }
  console.log("✅ Future split keeps the schedule pattern for adjusted instances");
}

// TEST 20: Bulk-delete paths tombstone persisted instances. CloudSync._mergeById
// resurrects any id-bearing remote item unless its id is in _deletedItems, so
// deleteRecurringTransaction and delete-all-future must record the persisted
// modified instances they remove; a partial legacy _deletedItems object must
// also load without breaking tombstone pushes.
console.log("TEST 20: Deletion Tombstones For Bulk-Removed Instances");
{
  const tombstoneIds = (s) => s._deletedItems.transactions.map((x) => x.id);

  // (a) Deleting a series tombstones its persisted modified instances.
  {
    const s = new TransactionStore();
    s.resetData();
    const rm = new RecurringTransactionManager(s);
    const rtId = s.addRecurringTransaction({
      startDate: "2026-06-01", amount: 50, type: "expense",
      description: "Gym", recurrence: "monthly",
    });
    rm.applyRecurringTransactions(2026, 5);
    const idx = s.getTransactions()["2026-06-01"].findIndex((t) => t.recurringId === rtId);
    s.setTransactionSettled("2026-06-01", idx, false); // promote to modified instance
    const instId = s.getTransactions()["2026-06-01"][idx].id;
    if (!instId) throw new Error("Setup: promoted instance must carry an id");

    s.deleteRecurringTransaction(rtId);
    if (!tombstoneIds(s).includes(instId)) {
      throw new Error("deleteRecurringTransaction must tombstone the removed modified instance");
    }
    if (!s._deletedItems.recurringTransactions.some((x) => x.id === rtId)) {
      throw new Error("Recurring id must still be tombstoned");
    }
  }

  // (b) Delete-all-future tombstones removed persisted instances.
  {
    const s = new TransactionStore();
    s.resetData();
    const rm = new RecurringTransactionManager(s);
    const rtId = s.addRecurringTransaction({
      startDate: "2026-06-01", amount: 25, type: "expense",
      description: "Sub", recurrence: "monthly",
    });
    rm.applyRecurringTransactions(2026, 5);
    rm.applyRecurringTransactions(2026, 6);
    const julIdx = s.getTransactions()["2026-07-01"].findIndex((t) => t.recurringId === rtId);
    s.setTransactionSettled("2026-07-01", julIdx, false);
    const julId = s.getTransactions()["2026-07-01"][julIdx].id;

    const junIdx = s.getTransactions()["2026-06-01"].findIndex((t) => t.recurringId === rtId);
    rm.deleteTransaction("2026-06-01", junIdx, true);
    if (!tombstoneIds(s).includes(julId)) {
      throw new Error("deleteFuture must tombstone the persisted July instance");
    }
    if (s.getTransactions()["2026-07-01"]) {
      throw new Error("July instance must be removed");
    }
  }

  // (c) A partial legacy deletedItems object is normalized on load.
  {
    localStorage.clear();
    localStorage.setItem(
      "deletedItems",
      JSON.stringify({ transactions: [{ id: "x", deletedAt: Date.now() }] })
    );
    const s = new TransactionStore();
    s.trackDeletedTransaction("abc");
    s._deletedItems.debts.push({ id: "d", deletedAt: Date.now() });
    s._deletedItems.recurringTransactions.push({ id: "r", deletedAt: Date.now() });
    s._deletedItems.cashInfusions.push({ id: "c", deletedAt: Date.now() });
    if (!s._deletedItems.transactions.some((x) => x.id === "x")) {
      throw new Error("Existing tombstones must be preserved through normalization");
    }
    localStorage.clear();
  }
  console.log("✅ Bulk deletions tombstone persisted instances; partial deletedItems normalizes");
}

// TEST 21: Bank reconcile "Move series" relocates a materialized MODIFIED
// instance to the bank date. Modified instances survive re-expansion, so
// leaving one at the old date duplicated the occurrence the shifted series
// regenerates on the new day (silent double-count).
console.log("TEST 21: Shift-Series Relocates Modified Instances");
{
  const s = new TransactionStore();
  s.resetData();
  const rm = new RecurringTransactionManager(s);
  const ui = new BankReconcileUI(s, rm, () => {}, () => {});

  // Monthly bill, first occurrence 2026-07-03; bank drafts it 2026-07-02.
  const rtId = s.addRecurringTransaction({
    startDate: "2026-07-03", amount: 262.21, type: "expense",
    description: "OneMain", recurrence: "monthly",
  });
  rm.applyRecurringTransactions(2026, 6);
  const idx = s.getTransactions()["2026-07-03"].findIndex((t) => t.recurringId === rtId);
  rm.editTransaction(
    "2026-07-03", idx,
    { amount: 262.21, type: "expense", description: "OneMain (edited)" },
    "this"
  );
  const inst = s.getTransactions()["2026-07-03"].find((t) => t.recurringId === rtId);
  if (inst.modifiedInstance !== true || !inst.id) {
    throw new Error("Setup: instance must be a promoted modified instance");
  }

  ui._shiftSeries({
    bank: { date: "2026-07-02", postedDate: "2026-07-02", signed: -262.21, description: "ACH ONEMAIN" },
    app: {
      date: "2026-07-03", index: idx, id: inst.id, recurringId: rtId,
      amount: 262.21, signed: -262.21, type: "expense",
      description: "OneMain (edited)", settled: inst.settled,
    },
  });

  const rec = s.getRecurringTransactions().find((r) => r.id === rtId);
  if (rec.startDate !== "2026-07-02") {
    throw new Error(`Series startDate must shift to the bank date, got ${rec.startDate}`);
  }
  rm.invalidateCache();
  rm.applyRecurringTransactions(2026, 6);
  const julyRows = [];
  const tx = s.getTransactions();
  Object.keys(tx).forEach((d) => {
    if (d.startsWith("2026-07")) tx[d].forEach((t) => { if (t.recurringId === rtId) julyRows.push({ d, t }); });
  });
  if (julyRows.length !== 1) {
    throw new Error(`Expected exactly one July occurrence after shift, got ${julyRows.length} (${julyRows.map((r) => r.d).join(",")})`);
  }
  if (julyRows[0].d !== "2026-07-02" || julyRows[0].t.description !== "OneMain (edited)" || julyRows[0].t.modifiedInstance !== true) {
    throw new Error("Relocated instance must sit on the bank date with the user's edit preserved");
  }
  rm.applyRecurringTransactions(2026, 7);
  if (!(s.getTransactions()["2026-08-02"] || []).some((t) => t.recurringId === rtId)) {
    throw new Error("August occurrence must regenerate on the shifted day");
  }
  console.log("✅ Move series keeps one occurrence, on the bank date, edit intact");
}

// TEST 22: Skip toggles merge last-write-wins. A pure union of skip lists can
// never propagate an UNskip (the other device's stale skip resurrects it), so
// setTransactionSkipped records timestamped events and the merge applies the
// newest toggle per occurrence. Legacy datasets keep union behavior.
console.log("TEST 22: Skip Merge Applies Last-Write-Wins Events");
{
  const baseData = () => ({
    transactions: {}, recurringTransactions: [], debts: [], cashInfusions: [],
    monthlyNotes: {}, movedTransactions: {},
    debtSnowballSettings: { dailyFloor: 0, autoGenerate: false },
    lastUpdated: new Date().toISOString(),
  });
  const deleted = (skips) => ({
    transactions: [], recurringTransactions: [], debts: [], cashInfusions: [],
    ...(skips ? { skips } : {}),
  });
  const s = new TransactionStore();
  s.resetData();
  const sync = new CloudSync(s, () => {});
  const RID = "rid123";
  const DATE = "2026-07-05";

  // (a) Local unskip (newer event) beats the remote's stale skip.
  {
    const local = { ...baseData(), skippedTransactions: {}, _deletedItems: deleted([{ date: DATE, recurringId: RID, skipped: false, at: 2000 }]) };
    const remote = { ...baseData(), skippedTransactions: { [DATE]: [RID] }, _deletedItems: deleted([{ date: DATE, recurringId: RID, skipped: true, at: 1000 }]) };
    const merged = sync._mergeData(local, remote);
    if (merged.skippedTransactions[DATE]) {
      throw new Error("Unskip (newer event) must win over the stale remote skip");
    }
    const evt = merged._deletedItems.skips.find((e) => e.recurringId === RID);
    if (!evt || evt.skipped !== false || evt.at !== 2000) {
      throw new Error("Merged skip events must keep the newest toggle");
    }
  }

  // (b) A genuinely newer re-skip wins back.
  {
    const local = { ...baseData(), skippedTransactions: {}, _deletedItems: deleted([{ date: DATE, recurringId: RID, skipped: false, at: 1000 }]) };
    const remote = { ...baseData(), skippedTransactions: { [DATE]: [RID] }, _deletedItems: deleted([{ date: DATE, recurringId: RID, skipped: true, at: 3000 }]) };
    const merged = sync._mergeData(local, remote);
    if (!merged.skippedTransactions[DATE] || !merged.skippedTransactions[DATE].includes(RID)) {
      throw new Error("Newer re-skip must win over the older unskip");
    }
  }

  // (c) Legacy datasets (no events) keep pure-union behavior.
  {
    const local = { ...baseData(), skippedTransactions: { [DATE]: [RID] }, _deletedItems: deleted(null) };
    const remote = { ...baseData(), skippedTransactions: { "2026-07-09": ["other"] }, _deletedItems: deleted(null) };
    const merged = sync._mergeData(local, remote);
    if (!merged.skippedTransactions[DATE] || !merged.skippedTransactions["2026-07-09"]) {
      throw new Error("Legacy union behavior must be preserved when no events exist");
    }
  }

  // (d) The store records one latest event per occurrence.
  {
    s.setTransactionSkipped(DATE, RID, true);
    s.setTransactionSkipped(DATE, RID, false);
    const events = s._deletedItems.skips.filter((e) => e.recurringId === RID);
    if (events.length !== 1 || events[0].skipped !== false) {
      throw new Error("setTransactionSkipped must keep exactly the latest toggle per occurrence");
    }
    if (s.skippedTransactions[DATE]) {
      throw new Error("Store must be unskipped after the toggle");
    }
    // Kill the debounced save so its deferred CloudSync callback doesn't hit
    // the DOM-less mock after the suite finishes.
    s.cancelPendingSave();
  }
  console.log("✅ Unskips propagate; newer re-skips win back; legacy union preserved");
}

// TEST 23: Floor-based allocation right-sizing (suggest-only). Draws against a
// recurring allocation are stamped with the series id + period date, and that
// provenance is the ONLY durable demand record — forfeited bucket instances
// are deleted outright by closeOutExpiredAllocations. The suggestion is
// max(floor, round$5(min(median(demand) * 1.1, current * 1.5))), computed from
// FULL expense amounts (overflow past the bucket must count), needs 3+
// complete periods with activity, and never writes anything.
console.log("TEST 23: Allocation floor suggestions from stamped demand history");
const F_RealDate = Date;
let F_FIXED = new F_RealDate(2026, 2, 10, 12, 0, 0); // 2026-03-10
class F_FrozenDate extends F_RealDate {
  constructor(...args) {
    if (args.length === 0) { super(F_FIXED.getTime()); } else { super(...args); }
  }
  static now() { return F_FIXED.getTime(); }
}
global.Date = F_FrozenDate;
try {
  const s = new TransactionStore();
  s.resetData();
  const rm = new RecurringTransactionManager(s);
  const rid = s.addRecurringTransaction({
    startDate: "2026-03-01", amount: 200, type: "expense", description: "Groceries",
    recurrence: "monthly", allocated: true, settled: true,
  });

  // Live one month at a time: expand, sweep close-outs (forfeits the previous
  // period's drawn bucket), then draw against the live bucket.
  const liveMonth = (monthIdx, spendDate, amounts) => {
    F_FIXED = new F_RealDate(2026, monthIdx, 10, 12, 0, 0);
    rm.invalidateCache();
    rm.applyRecurringTransactions(2026, monthIdx);
    if (s.closeOutExpiredAllocations()) rm.invalidateCache();
    if (!amounts.length) return;
    const bucket = s.getAllocations().find((b) => b.description === "Groceries");
    if (!bucket) throw new Error(`No live Groceries bucket in month ${monthIdx + 1}`);
    amounts.forEach((amt, i) => {
      s.addTransaction(spendDate, {
        amount: amt, type: "expense", description: `Spend ${monthIdx}-${i}`,
        drawsFromAllocationId: bucket.id, settled: true,
      });
    });
  };

  liveMonth(2, "2026-03-12", [210]);      // Mar: 210 (overflows the 200 bucket)
  liveMonth(3, "2026-04-12", [150, 110]); // Apr: 260 across two draws
  liveMonth(4, "2026-05-12", [240]);      // May: 240
  liveMonth(5, "2026-06-12", []);         // Jun: zero activity
  liveMonth(6, "2026-07-14", []);         // Jul: in-progress period

  // Stamps carry the series id + the bucket's period date, and survive the
  // sweep that deleted their buckets.
  const marSpend = (s.getTransactions()["2026-03-12"] || []).find(
    (t) => t.description === "Spend 2-0"
  );
  if (!marSpend || marSpend.drawsFromRecurringId !== rid || marSpend.drawsFromPeriodDate !== "2026-03-01") {
    throw new Error("Draws must be stamped with drawsFromRecurringId + drawsFromPeriodDate");
  }
  if ((s.getTransactions()["2026-03-01"] || []).some((t) => t.recurringId === rid)) {
    throw new Error("Test setup expects the March bucket to be forfeited");
  }

  // Off by default; enabling captures the current amount as the floor.
  if (s.getAllocationFloorSuggestion(rid) !== null) {
    throw new Error("Suggestions must be off until the user opts in");
  }
  s.setAllocationAutoAdjust(rid, true);
  const def = s.recurringTransactions.find((r) => r.id === rid);
  if (def.autoAdjustFloor !== true || s._roundCents(def.floorAmount) !== 200) {
    throw new Error("Enabling must capture the current amount as the floor");
  }

  // Complete periods with activity: Mar 210, Apr 260, May 240 — June (zero
  // activity) and July (in-progress) excluded. median 240 * 1.1 = 264, cap
  // min(264, 200*1.5=300), round $5 -> 265, floored at 200 -> 265. Note Mar's
  // demand reads 210 even though the bucket only covered 200 (full amounts,
  // not drawAmount).
  const sug = s.getAllocationFloorSuggestion(rid);
  if (!sug || s._roundCents(sug.suggested) !== 265) {
    throw new Error(`Expected suggestion 265, got ${sug && sug.suggested}`);
  }
  if (sug.periods.length !== 3) {
    throw new Error("Zero-activity and in-progress periods must be excluded");
  }

  // Relax-back: with the working amount raised past demand, the suggestion
  // comes back down toward (never below) the floor.
  s.updateRecurringTransaction(rid, { amount: 500 });
  const relaxed = s.getAllocationFloorSuggestion(rid);
  if (!relaxed || s._roundCents(relaxed.suggested) !== 265 || s._roundCents(relaxed.floor) !== 200) {
    throw new Error("Suggestion must relax back toward the floor when demand subsides");
  }

  // Step cap: at current=100 the jump is clamped to 1.5x (150), and the
  // effective floor follows a deliberately lowered amount (min(200,100)=100).
  s.updateRecurringTransaction(rid, { amount: 100 });
  const capped = s.getAllocationFloorSuggestion(rid);
  if (!capped || s._roundCents(capped.suggested) !== 150 || s._roundCents(capped.floor) !== 100) {
    throw new Error(`Step cap should clamp the suggestion to 150, got ${capped && capped.suggested}`);
  }
  s.updateRecurringTransaction(rid, { amount: 200 });

  // Warm-up: dropping March leaves only 2 periods with activity -> null.
  const marArr = s.getTransactions()["2026-03-12"] || [];
  s.deleteTransaction("2026-03-12", marArr.findIndex((t) => t.description === "Spend 2-0"));
  if (s.getAllocationFloorSuggestion(rid) !== null) {
    throw new Error("Warm-up requires 3 complete periods with activity");
  }

  // Disabling clears both settings.
  s.setAllocationAutoAdjust(rid, false);
  const defAfter = s.recurringTransactions.find((r) => r.id === rid);
  if (defAfter.autoAdjustFloor !== undefined || defAfter.floorAmount !== undefined) {
    throw new Error("Disabling must clear autoAdjustFloor and floorAmount");
  }
  s.cancelPendingSave();
  console.log("✅ Floor suggestions: stamped history, median+buffer, floor, step cap, warm-up, opt-out");
} finally {
  global.Date = F_RealDate;
}

// TEST 24: cleanupOrphanedDebtMinimums dedupes the same occurrence ACROSS
// dates. A schedule change (business-day adjustment edit) relocates an
// occurrence's landing date: the stranded modifiedInstance copy at the old
// date and the re-expanded fresh copy at the new date share one occurrence
// (originalDate) but sit on different days, so the old per-date dedupe never
// saw them together and the payment double-counted forever. The non-modified
// copy must win and the stranded copy must be tombstoned for sync.
console.log("TEST 24: Cross-Date Duplicate Debt Minimums Elect One Keeper");
{
  const s = new TransactionStore();
  s.resetData();
  const rm = new RecurringTransactionManager(s);
  const ui = Object.create(DebtSnowballUI.prototype);
  ui.store = s;
  ui.recurringManager = rm;
  ui.daySpecificOptions = [];

  const rid = s.addRecurringTransaction({
    startDate: "2026-01-10", amount: 50, type: "expense",
    description: "Debt Payment: X", recurrence: "monthly",
    debtId: "debtX", debtRole: "minimum",
  });
  // Stranded adjusted copy at the old landing date.
  s.addTransaction("2026-04-09", {
    id: "dup-old", amount: 25, type: "expense", description: "Debt Payment: X",
    recurringId: rid, debtId: "debtX", debtRole: "minimum",
    originalDate: "2026-04-10", modifiedInstance: true,
  });
  // Fresh re-expanded copy of the SAME occurrence at the schedule's current
  // date (pure expansion: no id).
  s.getTransactions()["2026-04-10"] = [{
    amount: 50, type: "expense", description: "Debt Payment: X",
    recurringId: rid, debtId: "debtX", debtRole: "minimum",
  }];

  if (!ui.cleanupOrphanedDebtMinimums()) {
    throw new Error("Cleanup must report a change");
  }
  const t24txns = s.getTransactions();
  if (t24txns["2026-04-09"]) {
    throw new Error("Stranded modified copy at the old date must be removed");
  }
  if (
    !(t24txns["2026-04-10"] || []).some(
      (t) => t.recurringId === rid && Number(t.amount) === 50
    )
  ) {
    throw new Error("The fresh copy at the current date must be kept");
  }
  if (!s._deletedItems.transactions.some((x) => x.id === "dup-old")) {
    throw new Error("The removed stranded copy must be tombstoned");
  }
  s.cancelPendingSave();
  console.log("✅ One keeper per occurrence across dates; stranded copy tombstoned");
}

// TEST 25: adjustMinimumPaymentTransactions reconciles only the projection's
// window (today+1 forward). (a) A minimum already paid earlier in the current
// month is a historical fact baked into every balance — it must never be
// zeroed against the walk's future-only target. (b) Within the window, the
// target is allocated chronologically (the walk pays in date order until the
// payoff and suppresses everything after), not from the end.
console.log("TEST 25: Minimum Reconcile Respects The Projection-Start Boundary");
const T25_RealDate = Date;
const T25_FIXED_TODAY = new T25_RealDate(2026, 5, 10, 12, 0, 0); // 2026-06-10
class T25_FrozenDate extends T25_RealDate {
  constructor(...args) {
    if (args.length === 0) { super(T25_FIXED_TODAY.getTime()); } else { super(...args); }
  }
  static now() { return T25_FIXED_TODAY.getTime(); }
}
global.Date = T25_FrozenDate;
try {
  // (a) Semi-monthly debt straddling today: day-5 minimum already paid (past),
  // payoff lands 2026-06-12, so only the future day-20 minimum is suppressed.
  {
    const s = new TransactionStore();
    s.resetData();
    const rm = new RecurringTransactionManager(s);
    const calc = new CalculationService(s, rm);
    const ui = Object.create(DebtSnowballUI.prototype);
    ui.store = s;
    ui.recurringManager = rm;
    ui.calculationService = calc;
    ui.daySpecificOptions = [];

    s.addRecurringTransaction({
      startDate: "2026-06-12", amount: 3000, type: "income",
      description: "Salary", recurrence: "monthly",
    });
    const debtId = s.addDebt({
      name: "Semi", balance: 1500, minPayment: 50,
      recurrence: "semi-monthly", semiMonthlyDays: [5, 20],
      dueStartDate: "2026-01-05", interestRate: 0,
    });
    ui.ensureMinimumPaymentRecurring(s.getDebts().find((d) => d.id === debtId));
    s.setDebtSnowballSettings({ dailyFloor: 0, extraPaymentStartMonth: "", autoGenerate: true });
    rm.applyRecurringTransactions(2026, 5);
    ui.ensureSnowballPaymentsForHorizon(2026, 5);

    const txns = s.getTransactions();
    const past = (txns["2026-06-05"] || []).find(
      (t) => t.debtRole === "minimum" && t.debtId === debtId
    );
    if (!past || Number(past.amount) !== 50 || past.hidden === true) {
      throw new Error(
        `Past pre-projection-start minimum must stay intact, got amount=${past && past.amount} hidden=${past && past.hidden}`
      );
    }
    const future = (txns["2026-06-20"] || []).find(
      (t) => t.debtRole === "minimum" && t.debtId === debtId
    );
    if (!future || Number(future.amount) !== 0 || future.hidden !== true) {
      throw new Error("Future minimum after the payoff must be suppressed");
    }
    if (!(txns["2026-06-12"] || []).some((t) => t.snowballGenerated === true)) {
      throw new Error("Expected the payoff on 2026-06-12");
    }
    s.cancelPendingSave();
  }
  console.log("✅ Pre-projection-start minimums are never re-amounted");

  // (b) Chronological allocation within the window: target 50 across two
  // future 50s keeps the EARLIEST and zeroes the later one.
  {
    const s2 = new TransactionStore();
    s2.resetData();
    const ui2 = Object.create(DebtSnowballUI.prototype);
    ui2.store = s2;
    ui2.daySpecificOptions = [];
    ["2026-06-15", "2026-06-25"].forEach((date) => {
      s2.addTransaction(date, {
        amount: 50, type: "expense", description: "Debt Payment: Y",
        recurringId: "ridY", debtId: "debtY", debtRole: "minimum",
      });
    });
    if (!ui2.adjustMinimumPaymentTransactions(2026, 5, { debtY: 50 })) {
      throw new Error("Adjust must report a change");
    }
    const t15 = s2.getTransactions()["2026-06-15"][0];
    const t25 = s2.getTransactions()["2026-06-25"][0];
    if (Number(t15.amount) !== 50 || t15.hidden === true) {
      throw new Error("Earliest future occurrence must keep the paid amount");
    }
    if (Number(t25.amount) !== 0 || t25.hidden !== true) {
      throw new Error("Occurrence after the payoff must be zeroed, not the earlier one");
    }
    s2.cancelPendingSave();
  }
  console.log("✅ Target allocates chronologically (earliest kept, later zeroed)");
} finally {
  global.Date = T25_RealDate;
}

// TEST 26: A snowball row created by "Generate for Current Month" with
// auto-generate OFF (snowballForced) must survive the very next render's
// horizon sweep — previously the includeExtra=false sweep silently deleted
// what the button had just created. Ordinary non-forced leftovers must still
// be swept and tombstoned.
console.log("TEST 26: Forced Snowball Rows Survive The Auto-Generate-Off Sweep");
const T26_RealDate = Date;
const T26_FIXED_TODAY = new T26_RealDate(2026, 5, 15, 12, 0, 0); // 2026-06-15
class T26_FrozenDate extends T26_RealDate {
  constructor(...args) {
    if (args.length === 0) { super(T26_FIXED_TODAY.getTime()); } else { super(...args); }
  }
  static now() { return T26_FIXED_TODAY.getTime(); }
}
global.Date = T26_FrozenDate;
try {
  const s = new TransactionStore();
  s.resetData();
  const rm = new RecurringTransactionManager(s);
  const calc = new CalculationService(s, rm);
  const ui = Object.create(DebtSnowballUI.prototype);
  ui.store = s;
  ui.recurringManager = rm;
  ui.calculationService = calc;
  ui.daySpecificOptions = [];
  ui.onUpdate = () => {};

  s.addRecurringTransaction({
    startDate: "2026-06-01", amount: 2000, type: "income",
    description: "Salary", recurrence: "monthly",
  });
  const debtId = s.addDebt({
    name: "Card F", balance: 1500, minPayment: 0, dueDay: 28,
    recurrence: "monthly", dueStartDate: "2026-06-28", interestRate: 0,
  });
  ui.ensureMinimumPaymentRecurring(s.getDebts().find((d) => d.id === debtId));
  s.setDebtSnowballSettings({ dailyFloor: 0, extraPaymentStartMonth: "", autoGenerate: false });
  rm.applyRecurringTransactions(2026, 5);

  ui.generateSnowballForCurrentMonth(true);
  const forced = (s.getTransactions()["2026-06-16"] || []).find(
    (t) => t.snowballGenerated === true
  );
  if (!forced || forced.snowballForced !== true) {
    throw new Error("Forced generate must create a snowballForced row on the availability day");
  }

  // A stale non-forced leftover (e.g. from an auto-generate-on era on another
  // device) appears before the next render's sweep.
  s.addTransaction("2026-06-03", {
    id: "stale-snow", amount: 10, type: "expense",
    description: "Snowball Payoff: Card F", debtId, debtRole: "snowball",
    debtName: "Card F", snowballMonth: "2026-06", snowballGenerated: true,
  });

  // The next calendar render sweeps the horizon with auto-generate still off.
  ui.ensureSnowballPaymentsForHorizon(2026, 5);
  if (
    !(s.getTransactions()["2026-06-16"] || []).some(
      (t) => t.snowballGenerated === true && t.snowballForced === true
    )
  ) {
    throw new Error("Auto-off sweep must keep the force-generated row");
  }
  if ((s.getTransactions()["2026-06-03"] || []).some((t) => t.id === "stale-snow")) {
    throw new Error("Stale non-forced snowball row must still be swept");
  }
  if (!s._deletedItems.transactions.some((x) => x.id === "stale-snow")) {
    throw new Error("Swept stale row must be tombstoned");
  }
  s.cancelPendingSave();
  console.log("✅ Forced rows survive the off-sweep; stale rows swept + tombstoned");
} finally {
  global.Date = T26_RealDate;
}

// TEST 27: The expansion clear pass tombstones id-bearing rows it drops. A
// persisted recurring instance whose modifiedInstance flag was cleared elsewhere
// (e.g. the snowball un-hide branch) keeps its synced id but is no longer a
// hand-edit, so re-expansion drops it. Without a tombstone, CloudSync._mergeById
// resurrects the remote copy — a sync ping-pong. Pure (id-less) expansions must
// NOT be tombstoned.
console.log("TEST 27: Expansion Clear Pass Tombstones Cleared-Flag Instances");
{
  const tombstoneIds = (s) => s._deletedItems.transactions.map((x) => x.id);

  // (a) An id-bearing, non-modified recurring row is tombstoned + dropped by a
  // full re-expansion, and stays gone through a cloud merge with the remote copy.
  {
    const s = new TransactionStore();
    s.resetData();
    const rm = new RecurringTransactionManager(s);
    const rtId = s.addRecurringTransaction({
      startDate: "2026-06-01", amount: 40, type: "expense",
      description: "Min", recurrence: "monthly", debtId: "d1", debtRole: "minimum",
    });
    rm.applyRecurringTransactions(2026, 5);
    const idx = s.getTransactions()["2026-06-01"].findIndex((t) => t.recurringId === rtId);
    // Promote to a hand-edit (assigns id), then clear the flag but keep the id —
    // exactly what the snowball un-hide branch leaves behind.
    s.setTransactionSettled("2026-06-01", idx, false);
    const anomalyId = s.getTransactions()["2026-06-01"][idx].id;
    if (!anomalyId) throw new Error("Setup: promoted instance must carry an id");
    s.getTransactions()["2026-06-01"][idx].modifiedInstance = false;

    rm.invalidateCache();
    rm.applyRecurringTransactions(2026, 5); // full re-expansion clear pass

    if (!tombstoneIds(s).includes(anomalyId)) {
      throw new Error("Cleared-flag id-bearing instance must be tombstoned when dropped");
    }
    // A fresh id-less pure expansion replaces it.
    const regenerated = s.getTransactions()["2026-06-01"].filter((t) => t.recurringId === rtId);
    if (regenerated.length !== 1 || regenerated[0].id) {
      throw new Error("Dropped instance must be replaced by exactly one id-less expansion");
    }
    // The remote still holds the anomaly; the tombstone must suppress resurrection.
    const sync = new CloudSync(s, () => {});
    const local = s.exportData();
    const remote = s.exportData();
    remote.transactions["2026-06-01"] = [
      { amount: 0, type: "expense", description: "Min", recurringId: rtId,
        id: anomalyId, hidden: true, _lastModified: new Date().toISOString() },
    ];
    const merged = sync._mergeData(local, remote);
    const survived = (merged.transactions["2026-06-01"] || []).some((t) => t.id === anomalyId);
    if (survived) {
      throw new Error("Tombstoned anomaly must not survive a cloud merge");
    }
    // Kill the debounced save from setTransactionSettled so its deferred
    // CloudSync callback doesn't hit the DOM-less mock after the suite ends.
    s.cancelPendingSave();
  }

  // (b) Pure (id-less) expansions are dropped WITHOUT polluting the tombstone list.
  {
    const s = new TransactionStore();
    s.resetData();
    const rm = new RecurringTransactionManager(s);
    s.addRecurringTransaction({
      startDate: "2026-06-01", amount: 12, type: "expense",
      description: "Plain", recurrence: "monthly",
    });
    rm.applyRecurringTransactions(2026, 5);
    const before = tombstoneIds(s).length;
    rm.invalidateCache();
    rm.applyRecurringTransactions(2026, 5);
    if (tombstoneIds(s).length !== before) {
      throw new Error("Dropping id-less expansions must not create tombstones");
    }
  }
  console.log("✅ Cleared-flag instances tombstoned; id-less expansions untouched");
}

// TEST 28: resetData clears the load-integrity block so the wipe actually
// persists. A decrypt/parse failure sets _loadFailed to protect the intact
// on-disk ciphertext — but resetData is the user's recovery action ("wipe
// everything"), replacing in-memory state with a known-good empty state. If it
// leaves _loadFailed set, saveData refuses to persist and the corrupt data that
// prompted the reset silently returns on reload.
console.log("TEST 28: resetData Clears The Load-Integrity Block");
{
  const s = new TransactionStore();
  s.resetData();
  // Seed persisted state so we can prove the reset overwrites it.
  s.addTransaction("2026-06-01", { amount: 99, type: "expense", description: "Old" });
  s.flushPendingSave();
  if (!localStorageData["transactions"] || localStorageData["transactions"] === "{}") {
    throw new Error("Setup: seeded transaction should be persisted");
  }

  // Simulate a failed load (what loadData does on a decrypt/parse failure).
  s._loadFailed = true;
  // A save must be a no-op while the block is set (guards the on-disk copy).
  s.transactions = {};
  if (s.saveData(true) === false) {
    // saveData returns false when blocked; the stored copy stays untouched.
  }
  if (localStorageData["transactions"] === "{}") {
    throw new Error("Blocked save must not overwrite the intact on-disk copy");
  }

  // resetData must clear the block and persist the empty state.
  s.resetData();
  if (s._loadFailed !== false) {
    throw new Error("resetData must clear _loadFailed");
  }
  s.flushPendingSave();
  if (localStorageData["transactions"] !== "{}") {
    throw new Error("resetData must persist the empty state (corrupt data must not return)");
  }
  console.log("✅ resetData clears _loadFailed and persists the wipe");
}

// TEST 29: Bank-CSV pending classification. A pending hold is Balance $0.00 with
// the amount in the Deposit column. A real posted debit that happens to empty
// the account (Balance $0.00 WITH a Withdrawal amount) must NOT be misread as a
// pending hold — that would suppress its Settle / date-drift actions and widen
// its match window. Sign is unchanged either way.
console.log("TEST 29: Bank CSV Pending Classification Requires Deposit Column");
{
  const s = new TransactionStore();
  s.resetData();
  const rm = new RecurringTransactionManager(s);
  const ui = new BankReconcileUI(s, rm, () => {}, () => {});

  const csv =
    "Posted Date,Transaction Date,Description,Deposit,Withdrawal,Balance\n" +
    // Real posted debit that zeroes the account — Balance 0.00, amount in Withdrawal.
    "7/2/2026,7/2/2026,ACH LANDLORD RENT,,(825.00),0.00\n" +
    // Genuine pending hold — Balance 0.00, amount in Deposit column.
    "7/3/2026,7/3/2026,VISIBLE PENDING,46.61,,0.00\n" +
    // Ordinary posted debit with a running balance.
    "7/4/2026,7/4/2026,PUBLIX,,(20.00),1500.00\n";

  const parsed = ui._parseSuncoastCsv(csv);
  if (parsed.error) throw new Error("Parse error: " + parsed.error);
  const byDesc = {};
  parsed.rows.forEach((r) => { byDesc[r.description] = r; });

  const rent = byDesc["ACH LANDLORD RENT"];
  if (!rent || rent.pending !== false) {
    throw new Error("Zero-balance WITHDRAWAL must be posted, not pending");
  }
  if (Math.abs(rent.signed - -825.0) > 0.005) {
    throw new Error(`Zero-balance withdrawal sign must stay negative, got ${rent.signed}`);
  }
  const hold = byDesc["VISIBLE PENDING"];
  if (!hold || hold.pending !== true) {
    throw new Error("Zero-balance DEPOSIT-column hold must remain pending");
  }
  if (Math.abs(hold.signed - -46.61) > 0.005) {
    throw new Error(`Pending hold must be treated as an outflow, got ${hold.signed}`);
  }
  const publix = byDesc["PUBLIX"];
  if (!publix || publix.pending !== false) {
    throw new Error("Ordinary posted debit must not be pending");
  }
  console.log("✅ Pending requires Balance $0 AND Deposit column; zero-balance debits stay posted");
}

// TEST 31: The calendar's 30-day highlight walk relies on updateMonthlyBalances
// having pre-materialized the forward horizon before it runs. Guards that
// contract: updateMonthlyBalances(viewedDate) ALWAYS expands viewedMonth..+6
// (even on an empty transactions map, because viewedDate seeds earliestDate), so
// the today-anchored 30-day window is materialized and the walk agrees with
// CalculationService.calculateMinimum without needing to expand it itself.
console.log("TEST 31: updateMonthlyBalances pre-expands the forward horizon (calendar walk contract)");
{
  const s = new TransactionStore();
  s.resetData();
  const rm = new RecurringTransactionManager(s);
  const calc = new CalculationService(s, rm);

  const today = new Date();
  // A recurring expense whose first occurrence lands 10 days out — inside the
  // 30-day window. Nothing else exists, so the materialized map is empty until
  // updateMonthlyBalances expands it.
  const occ = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 10);
  s.addRecurringTransaction({
    amount: 500,
    type: 'expense',
    description: 'Future Bill',
    recurrence: 'monthly',
    startDate: Utils.formatDateString(occ),
  });

  if (Object.keys(s.getTransactions()).length !== 0) {
    throw new Error("TEST 31 setup invalid: map should be empty before expansion");
  }

  // generateCalendar always calls this with the viewed date before its walk.
  calc.updateMonthlyBalances(today);

  // The occurrence's month must now be materialized purely by that call.
  const occStr = Utils.formatDateString(occ);
  if (!s.getTransactions()[occStr]) {
    throw new Error("updateMonthlyBalances must pre-expand the 30-day window's recurring occurrence");
  }

  // Faithful replica of calendar-ui's 30-day walk WITHOUT any expansion of its
  // own — it must still match the Minimum thanks to the pre-expansion above.
  const walk = () => {
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const mb = s.getMonthlyBalances();
    let bal = (mb[todayKey] && mb[todayKey].startingBalance) || 0;
    for (let d = 1; d <= today.getDate(); d++) {
      const ds = Utils.formatDateString(new Date(today.getFullYear(), today.getMonth(), d));
      const dt = calc.calculateDailyTotals(ds);
      bal = dt.balance !== null
        ? calc.roundToCents(dt.balance - calc.getReservedTotalOnOrBefore(ds))
        : calc.roundToCents(bal + dt.income - dt.expense);
    }
    let lowest = bal;
    for (let d = 1; d <= 30; d++) {
      const cd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + d);
      const ds = Utils.formatDateString(cd);
      const dt = calc.calculateDailyTotals(ds);
      bal = dt.balance !== null
        ? calc.roundToCents(dt.balance - calc.getReservedTotalOnOrBefore(ds))
        : calc.roundToCents(bal + dt.income - dt.expense);
      if (bal < lowest) lowest = bal;
    }
    return lowest;
  };

  const minimum = calc.calculateMinimum();
  const walkMin = walk();
  if (walkMin !== minimum) {
    throw new Error(`Calendar 30-day walk must match calculateMinimum given the pre-expanded horizon (walk=${walkMin}, minimum=${minimum})`);
  }
  console.log("✅ updateMonthlyBalances pre-expands the horizon; walk matches Minimum without self-expanding");
}

// TEST 33: getDayBalanceBreakdown shares the running-balance walk with
// getRunningBalanceForDate (both are balance-walk paths — see [[balance-walk-paths]]),
// so their `.balance` figures must agree byte-for-byte on every date. Also guards
// the reserve add-back invariant: on a day carrying allocation reserves,
// balanceExcludingAllocations === balance + getReservedTotalOnOrBefore(date)
// (the "excluding allocations" figure releases exactly the live reserves).
console.log("TEST 33: getDayBalanceBreakdown Shares The Walk And Releases Reserves Correctly");
{
  const DB_RealDate = Date;
  const DB_FIXED_TODAY = new DB_RealDate(2026, 5, 30, 12, 0, 0); // 2026-06-30
  class DB_FrozenDate extends DB_RealDate {
    constructor(...args) {
      if (args.length === 0) { super(DB_FIXED_TODAY.getTime()); } else { super(...args); }
    }
    static now() { return DB_FIXED_TODAY.getTime(); }
  }
  global.Date = DB_FrozenDate;
  try {
    const s = new TransactionStore();
    s.resetData();
    const rm = new RecurringTransactionManager(s);
    const calc = new CalculationService(s, rm);

    // $1000 reserved June 1, a normal $200 expense June 5, $3000 income June 10.
    s.addTransaction("2026-06-01", {
      amount: 1000, type: "expense", description: "Reserve", allocated: true, settled: true,
    });
    s.addTransaction("2026-06-05", {
      amount: 200, type: "expense", description: "Groceries", settled: true,
    });
    s.addTransaction("2026-06-10", {
      amount: 3000, type: "income", description: "Paycheck",
    });

    // The two balance-walk paths must produce identical running balances.
    for (const ds of ["2026-06-01", "2026-06-05", "2026-06-10", "2026-06-20"]) {
      const walk = calc.getRunningBalanceForDate(ds);
      const bd = calc.getDayBalanceBreakdown(ds).balance;
      if (Math.abs(walk - bd) > 0.001) {
        throw new Error(`getDayBalanceBreakdown(${ds}).balance=${bd} must equal getRunningBalanceForDate=${walk}`);
      }
    }

    // On June 10 the running balance is -1000 -200 +3000 = 1800, with $1000 still
    // reserved. "Excluding allocations" releases exactly that reserve.
    const bd10 = calc.getDayBalanceBreakdown("2026-06-10");
    if (Math.abs(bd10.balance - 1800) > 0.001) {
      throw new Error(`June 10 balance should be 1800, got ${bd10.balance}`);
    }
    const reserved10 = calc.getReservedTotalOnOrBefore("2026-06-10");
    if (Math.abs(bd10.balanceExcludingAllocations - (bd10.balance + reserved10)) > 0.001) {
      throw new Error(
        `balanceExcludingAllocations=${bd10.balanceExcludingAllocations} must equal balance+reserved=${bd10.balance + reserved10}`
      );
    }
    if (Math.abs(bd10.balanceExcludingAllocations - 2800) > 0.001) {
      throw new Error(`balanceExcludingAllocations should be 2800 (1800+1000 reserve), got ${bd10.balanceExcludingAllocations}`);
    }
    console.log("✅ getDayBalanceBreakdown matches getRunningBalanceForDate and releases reserves exactly");
  } finally {
    global.Date = DB_RealDate;
  }
}

// TEST 32: An explicit replaceRemote push (import restore) SKIPS the fetch-and-
// merge step and PATCHes local data as the authoritative copy. Session 6 removed
// the _lastKnownETag gate so every ordinary push now merges (TEST 30); that
// silently broke the import-restore path, which had relied on nulling the ETag to
// force a blind overwrite. saveToCloud(quiet, replaceRemote=true) restores the
// replace intent via a one-shot _replaceRemoteOnce latch. A merge here would
// resurrect remote items the import intentionally dropped, leaving a partial
// restore.
console.log("TEST 32: replaceRemote Push Skips Merge (Import Restore Overwrites Cloud)");
function runReplaceRemoteTest() {
  const s = new TransactionStore();
  s.resetData();
  // Imported (local) data — the restore the user just loaded.
  s.debts = [{ id: "L", name: "Imported Card", balance: 100, _lastModified: new Date().toISOString() }];

  const sync = new CloudSync(s, () => {});
  // A device that HAS synced before (stored ETag), to prove replace ignores merge
  // regardless of ETag state — not merely the null-ETag case.
  sync._lastKnownETag = '"etag-old"';
  sync.getCloudCredentialsAsync = async () => ({ token: "tok", gistId: "gid" });

  // Remote holds a debt NOT in the import (added on another device after the
  // backup, or an item deleted before exporting). A merge resurrects it; a
  // replace must drop it.
  const remoteData = {
    transactions: {}, monthlyBalances: {}, recurringTransactions: [],
    skippedTransactions: {}, movedTransactions: {},
    debts: [{ id: "R", name: "Stale Remote Card", balance: 200, _lastModified: new Date().toISOString() }],
    cashInfusions: [], monthlyNotes: {},
    debtSnowballSettings: { dailyFloor: 0, autoGenerate: false },
    _deletedItems: {}, lastUpdated: new Date().toISOString(),
  };

  const prevFetch = global.fetch;
  const prevDoc = global.document;
  const prevHide = Utils.hideLoading, prevShow = Utils.showLoading;
  Utils.hideLoading = () => {};
  Utils.showLoading = () => {};
  global.document = {
    addEventListener: () => {},
    querySelector: () => null,
    getElementById: () => null,
  };

  let patchBody = null;
  // Count GETs that land BEFORE the PATCH — a replace push must issue none (the
  // only legitimate GET is _refreshStoredETag, which runs AFTER the PATCH).
  let preGetCount = 0;
  const etagHeaders = { get: () => '"etag-x"' };
  global.fetch = async (url, opts) => {
    if (opts && opts.method === "PATCH") {
      patchBody = JSON.parse(opts.body);
      return { ok: true, status: 200, headers: etagHeaders };
    }
    if (!patchBody) preGetCount++;
    return {
      ok: true,
      status: 200,
      headers: etagHeaders,
      json: async () => ({
        files: { "cashflow_data.json": { content: JSON.stringify(remoteData), truncated: false } },
      }),
    };
  };

  const restore = () => {
    global.fetch = prevFetch;
    global.document = prevDoc;
    Utils.hideLoading = prevHide;
    Utils.showLoading = prevShow;
    s.cancelPendingSave();
  };

  return sync.saveToCloud(false, true).then(() => {
    restore();
    if (!patchBody) throw new Error("replaceRemote saveToCloud did not issue a PATCH");
    const savedData = JSON.parse(patchBody.files["cashflow_data.json"].content);
    const ids = (savedData.debts || []).map((d) => d.id).sort();
    if (ids.join(",") !== "L") {
      throw new Error(
        "replaceRemote push must REPLACE (local L only, no remote R), got: " + ids.join(",")
      );
    }
    if (preGetCount !== 0) {
      throw new Error(
        "replaceRemote push must skip the pre-PATCH merge GET, saw " + preGetCount + " GET(s) before PATCH"
      );
    }
    if (sync._replaceRemoteOnce !== false) {
      throw new Error("replaceRemote latch must be consumed after the push");
    }
    console.log("✅ replaceRemote push skips merge and overwrites cloud with local import");
  });
}

// TEST 30: saveToCloud merges with an existing remote gist even when this
// device has never synced it (no stored ETag). Gating the fetch-and-merge on
// _lastKnownETag meant a fresh device pointed at a populated gist blind-
// overwrote it on its first push, destroying the other device's data. The push
// path is the documented merge-and-protect path; a null ETag just means the GET
// carries no If-None-Match and returns 200 with the remote data to merge.
//
// Terminal test: both TEST 32 and TEST 30 drive saveToCloud through the shared
// global.fetch mock, so they must run SEQUENTIALLY (never concurrent chains that
// clobber each other's mocks). TEST 32 runs first and chains into this one, which
// prints the final banner. Any new async network test must join this chain.
function runTest30Final() {
  console.log("TEST 30: First Push With No ETag Merges, Not Overwrites");
  const s = new TransactionStore();
  s.resetData();
  // Local-only debt that has never reached the cloud.
  s.debts = [{ id: "L", name: "Local Card", balance: 100, _lastModified: new Date().toISOString() }];

  const sync = new CloudSync(s, () => {});
  // Never synced this gist on this device.
  sync._lastKnownETag = null;
  // Skip real credential/crypto plumbing.
  sync.getCloudCredentialsAsync = async () => ({ token: "tok", gistId: "gid" });

  // Remote gist already holds a DIFFERENT debt from another device.
  const remoteData = {
    transactions: {}, monthlyBalances: {}, recurringTransactions: [],
    skippedTransactions: {}, movedTransactions: {},
    debts: [{ id: "R", name: "Remote Card", balance: 200, _lastModified: new Date().toISOString() }],
    cashInfusions: [], monthlyNotes: {},
    debtSnowballSettings: { dailyFloor: 0, autoGenerate: false },
    _deletedItems: {}, lastUpdated: new Date().toISOString(),
  };

  // Minimal DOM + fetch mocks for the network path.
  const prevFetch = global.fetch;
  const prevDoc = global.document;
  const prevHide = Utils.hideLoading, prevShow = Utils.showLoading;
  Utils.hideLoading = () => {};
  Utils.showLoading = () => {};
  global.document = {
    addEventListener: () => {},
    querySelector: () => null,
    getElementById: () => null,
  };

  let patchBody = null;
  const etagHeaders = { get: () => '"etag-x"' };
  global.fetch = async (url, opts) => {
    if (opts && opts.method === "PATCH") {
      patchBody = JSON.parse(opts.body);
      return { ok: true, status: 200, headers: etagHeaders };
    }
    // GET (ETag check + _refreshStoredETag): return the populated remote gist.
    return {
      ok: true,
      status: 200,
      headers: etagHeaders,
      json: async () => ({
        files: { "cashflow_data.json": { content: JSON.stringify(remoteData), truncated: false } },
      }),
    };
  };

  const restore = () => {
    global.fetch = prevFetch;
    global.document = prevDoc;
    Utils.hideLoading = prevHide;
    Utils.showLoading = prevShow;
    s.cancelPendingSave();
  };

  // saveToCloud is async; this is the last test, so print the final banner from
  // inside the resolution so ordering stays correct in a CommonJS script (no
  // top-level await available).
  sync.saveToCloud(true).then(() => {
    restore();
    if (!patchBody) throw new Error("saveToCloud did not issue a PATCH");
    // patchBody is the PATCH request body {description, files:{...}}; the merged
    // app data lives inside files["cashflow_data.json"].content.
    const savedData = JSON.parse(patchBody.files["cashflow_data.json"].content);
    const ids = (savedData.debts || []).map((d) => d.id).sort();
    if (ids.join(",") !== "L,R") {
      throw new Error(
        "First push with no ETag must MERGE (keep both L and R), got: " + ids.join(",")
      );
    }
    console.log("✅ First push with no stored ETag merges remote data instead of overwriting");
    console.log("ALL TESTS PASSED");
  }).catch((err) => {
    restore();
    console.error(err);
    process.exit(1);
  });
}

// TEST 34: Free-funds designation. Exactly one recurring allocation series can
// hold the `freeFunds` flag (designating another clears the first), and the
// display helper resolves the series' live bucket — the latest instance dated
// on/before today — ignoring future instances. A designated series with no
// live bucket yet yields null (calendar shows nothing, balances stay hidden).
console.log("TEST 34: Free-Funds Designation Is Exclusive And Resolves The Live Bucket");
{
  const s = new TransactionStore();
  s.resetData();

  const t33 = new Date();
  const day = (offset) =>
    Utils.formatDateString(
      new Date(t33.getFullYear(), t33.getMonth(), t33.getDate() + offset)
    );

  const groceriesId = s.addRecurringTransaction({
    startDate: day(-1), amount: 400, type: "expense", description: "Groceries",
    recurrence: "monthly", allocated: true, settled: true,
  });
  const funId = s.addRecurringTransaction({
    startDate: day(7), amount: 150, type: "expense", description: "Fun money",
    recurrence: "monthly", allocated: true, settled: true,
  });

  // Live groceries bucket (yesterday, partially drawn down to 250), plus a
  // future instance that must NOT be the one displayed.
  s.addTransaction(day(-1), {
    amount: 250, type: "expense", description: "Groceries",
    recurringId: groceriesId, allocated: true, settled: true,
  });
  s.addTransaction(day(30), {
    amount: 400, type: "expense", description: "Groceries",
    recurringId: groceriesId, allocated: true, settled: true,
  });
  // Fun money's first instance is still upcoming — no live bucket.
  s.addTransaction(day(7), {
    amount: 150, type: "expense", description: "Fun money",
    recurringId: funId, allocated: true, settled: true,
  });

  s.setFreeFundsAllocation(groceriesId);
  if (s.getFreeFundsRecurringId() !== groceriesId) {
    throw new Error("Designating groceries should set it as the free-funds series");
  }
  const bucket = s.getFreeFundsAllocation();
  if (!bucket || bucket.remaining !== 250 || bucket.date !== day(-1)) {
    throw new Error(
      "Free-funds bucket should be the live (latest on/before today) instance at 250, got: " +
        JSON.stringify(bucket)
    );
  }

  // Redesignating moves the flag — the store enforces the one-holder rule.
  s.setFreeFundsAllocation(funId);
  if (s.getFreeFundsRecurringId() !== funId) {
    throw new Error("Redesignating should hand the flag to the fun-money series");
  }
  const flagged = s.recurringTransactions.filter((rt) => rt.freeFunds === true);
  if (flagged.length !== 1 || flagged[0].id !== funId) {
    throw new Error("Exactly one series may hold the freeFunds flag");
  }
  if (s.getFreeFundsAllocation() !== null) {
    throw new Error(
      "A designated series with no live bucket yet should resolve to null"
    );
  }

  // Clearing removes the designation entirely.
  s.setFreeFundsAllocation(null);
  if (s.getFreeFundsRecurringId() !== null) {
    throw new Error("Passing null should clear the free-funds designation");
  }
  s.cancelPendingSave();
  console.log("✅ Free-funds designation is exclusive and resolves the live bucket");
}

// TEST 35: A debt cleared by a real minimum payment earlier in the CURRENT
// month keeps that payment. The alreadyPaid maintenance path used to end the
// recurrence at the previous month's end and prune all current-month minimums,
// deleting the very payment that cleared the debt — erasing real spending from
// the balance walk and oscillating (paid 100/remaining 0 ↔ paid 0/remaining
// 100, endDate flip-flopping) on every render.
console.log("TEST 35: Already-Paid Debt Keeps Its Current-Month Clearing Payment");
{
  const T35_RealDate = Date;
  const T35_FIXED_TODAY = new T35_RealDate(2026, 5, 15, 12, 0, 0); // 2026-06-15
  class T35_FrozenDate extends T35_RealDate {
    constructor(...args) {
      if (args.length === 0) { super(T35_FIXED_TODAY.getTime()); } else { super(...args); }
    }
    static now() { return T35_FIXED_TODAY.getTime(); }
  }
  global.Date = T35_FrozenDate;
  try {
    const s = new TransactionStore();
    s.resetData();
    const rm = new RecurringTransactionManager(s);
    const calc = new CalculationService(s, rm);
    const ui = Object.create(DebtSnowballUI.prototype);
    ui.store = s;
    ui.recurringManager = rm;
    ui.calculationService = calc;
    ui.daySpecificOptions = [];

    s.addRecurringTransaction({
      startDate: "2026-06-01", amount: 2000, type: "income",
      description: "Salary", recurrence: "monthly",
    });
    // $100 debt whose $100 minimum (due the 3rd) already cleared it in full.
    const debtId = s.addDebt({
      name: "Small Card", balance: 100, minPayment: 100, dueDay: 3,
      recurrence: "monthly", interestRate: 0, dueStartDate: "2026-06-03",
    });
    ui.ensureMinimumPaymentRecurring(s.getDebts().find((d) => d.id === debtId));
    s.setDebtSnowballSettings({ dailyFloor: 0, extraPaymentStartMonth: "", autoGenerate: true });
    rm.applyRecurringTransactions(2026, 5); // materialize June like the calendar

    const june3Row = () =>
      (s.getTransactions()["2026-06-03"] || []).find(
        (t) => t.debtId === debtId && t.debtRole === "minimum"
      ) || null;
    const endDateOf = () => {
      const d = s.getDebts().find((x) => x.id === debtId);
      return s.getRecurringTransactions().find((r) => r.id === d.minRecurringId).endDate;
    };

    // Two renders: the first must not delete the payment; the second must not
    // oscillate the recurrence end date or the snapshot.
    for (let pass = 1; pass <= 2; pass++) {
      ui.ensureSnowballPaymentsForHorizon(2026, 5);
      const row = june3Row();
      if (!row || Number(row.amount) !== 100) {
        throw new Error(
          `Render ${pass}: the June 3 clearing payment was deleted/changed (${JSON.stringify(row)})`
        );
      }
      if (endDateOf() !== "2026-06-03") {
        throw new Error(
          `Render ${pass}: expected endDate 2026-06-03 (the clearing payment), got ${endDateOf()}`
        );
      }
      const snap = ui.getHistoricalDebtSnapshot(new Date(2026, 5, 16));
      if (snap.paidByDebtId[debtId] !== 100 || snap.remainingByDebtId[debtId] !== 0) {
        throw new Error(
          `Render ${pass}: snapshot oscillated — paid ${snap.paidByDebtId[debtId]} / remaining ${snap.remainingByDebtId[debtId]}`
        );
      }
      calc.invalidateCache();
      const balance = calc.getRunningBalanceForDate("2026-06-15");
      if (balance !== 1900) {
        throw new Error(
          `Render ${pass}: running balance should stay 1900 (2000 income − 100 real payment), got ${balance}`
        );
      }
    }
    s.cancelPendingSave();
    console.log("✅ Already-paid debt keeps its current-month clearing payment (no oscillation)");
  } finally {
    global.Date = T35_RealDate;
  }
}

// TEST 36: The add form rejects advanced-recurrence values the expansion
// engine can't honor. A custom interval < 1 makes applyCustomRecurrence skip
// the series (the freshly-added entry is swept by _clearRecurringExpansions on
// the next render and never re-expanded — it silently vanishes while the
// definition lingers invisibly), and a NaN variable percentage expands every
// occurrence amount — and the running balances — to NaN. Both were persisted
// unvalidated by TransactionUI.addTransaction.
console.log("TEST 36: Add Form Rejects Unexpandable Custom Interval / NaN Variable Percentage");
{
  // Minimal DOM stub: getElementById returns one persistent element per id so
  // test-set values survive; everything else is inert.
  const T36_elements = new Map();
  const T36_makeElement = (id) => ({
    id,
    value: "",
    checked: false,
    disabled: false,
    innerHTML: "",
    placeholder: "",
    style: {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    addEventListener: () => {},
    setAttribute: () => {},
    removeAttribute: () => {},
    appendChild: () => {},
    remove: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
  });
  const T36_getEl = (id) => {
    if (!T36_elements.has(id)) T36_elements.set(id, T36_makeElement(id));
    return T36_elements.get(id);
  };
  const prevDoc = global.document;
  global.document = {
    addEventListener: () => {},
    getElementById: T36_getEl,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => T36_makeElement(null),
    activeElement: null,
  };
  try {
    vm.runInThisContext(
      fs.readFileSync(path.join(jsDir, "transaction-ui.js"), "utf8")
    );
    const s = new TransactionStore();
    s.resetData();
    const rm = new RecurringTransactionManager(s);
    const tui = new TransactionUI(s, rm, () => {}, null, null);

    const setForm = (fields) => {
      Object.entries(fields).forEach(([id, props]) => {
        Object.assign(T36_getEl(id), props);
      });
    };
    const baseForm = {
      transactionDate: { value: "2026-07-10" },
      transactionAmount: { value: "50" },
      transactionType: { value: "expense" },
      transactionDescription: { value: "Sub" },
      transactionSettled: { checked: true },
    };

    // Case 1: custom recurrence with interval 0 must be rejected, nothing saved.
    setForm({
      ...baseForm,
      transactionRecurrence: { value: "custom" },
      customIntervalValue: { value: "0" },
      customIntervalUnit: { value: "days" },
    });
    if (tui.addTransaction() !== false) {
      throw new Error("Custom interval 0 was accepted");
    }
    if (s.getRecurringTransactions().length !== 0) {
      throw new Error("Custom interval 0 persisted a recurring definition");
    }

    // Case 2: a valid custom series still saves, expands, and keeps a finite amount.
    setForm({
      ...baseForm,
      transactionRecurrence: { value: "custom" },
      customIntervalValue: { value: "2" },
      customIntervalUnit: { value: "weeks" },
    });
    if (tui.addTransaction() !== true) {
      throw new Error("Valid custom recurrence was rejected");
    }
    const defs = s.getRecurringTransactions();
    if (defs.length !== 1 || defs[0].customInterval.value !== 2) {
      throw new Error(
        `Valid custom recurrence saved wrong definition: ${JSON.stringify(defs)}`
      );
    }
    rm.applyRecurringTransactions(2026, 6); // July 2026
    const t36July = s.getTransactions();
    const t36Instances = Object.keys(t36July)
      .filter((d) => d.startsWith("2026-07"))
      .flatMap((d) => t36July[d])
      .filter((t) => t.recurringId === defs[0].id);
    if (t36Instances.length === 0) {
      throw new Error("Valid custom series produced no July instances");
    }
    if (t36Instances.some((t) => !Number.isFinite(t.amount))) {
      throw new Error("Valid custom series expanded a non-finite amount");
    }
    s.cancelPendingSave();
    console.log("✅ Add form rejects unexpandable recurrence inputs; valid series still expands");
  } finally {
    global.document = prevDoc;
  }
}

// TEST 37: A skipped recurring allocation occurrence holds no reserve (the
// balance walk excludes skipped instances), so getAllocations must not offer
// its bucket for draws — and the free-funds figure, which resolves through
// getAllocations, must not display it as spendable money. Unskipping restores
// the bucket.
console.log("TEST 37: Skipped Recurring Allocation Bucket Is Not Offered Or Displayed");
{
  const s = new TransactionStore();
  s.resetData();

  const t37 = new Date();
  const day = (offset) =>
    Utils.formatDateString(
      new Date(t37.getFullYear(), t37.getMonth(), t37.getDate() + offset)
    );

  const seriesId = s.addRecurringTransaction({
    startDate: day(-2), amount: 200, type: "expense", description: "Groceries",
    recurrence: "weekly", allocated: true, settled: true,
  });
  // The live instance for this period, materialized at its anchor date.
  s.addTransaction(day(-2), {
    amount: 200, type: "expense", description: "Groceries",
    recurringId: seriesId, allocated: true, settled: true,
  });

  const offeredBefore = s.getAllocations().find(
    (a) => a.recurring === true && a.recurringId === seriesId
  );
  if (!offeredBefore || offeredBefore.remaining !== 200) {
    throw new Error(
      "Live allocation bucket should be offered before the skip: " +
        JSON.stringify(offeredBefore)
    );
  }

  // User skips this period's allocation — the instance stays in the map but
  // is a non-event for balances, so no reserve exists behind the bucket.
  s.setTransactionSkipped(day(-2), seriesId, true);
  if (
    s.getAllocations().some(
      (a) => a.recurring === true && a.recurringId === seriesId
    )
  ) {
    throw new Error("Skipped allocation bucket must not be offered for draws");
  }
  s.setFreeFundsAllocation(seriesId);
  if (s.getFreeFundsAllocation() !== null) {
    throw new Error(
      "Free-funds display must not show a skipped (unreserved) bucket"
    );
  }

  // Unskipping restores the bucket to both surfaces.
  s.setTransactionSkipped(day(-2), seriesId, false);
  const restored = s.getFreeFundsAllocation();
  if (!restored || restored.remaining !== 200 || restored.date !== day(-2)) {
    throw new Error(
      "Unskipping should restore the live bucket, got: " + JSON.stringify(restored)
    );
  }
  s.setFreeFundsAllocation(null);
  s.cancelPendingSave();
  console.log("✅ Skipped allocation buckets are hidden from draws and free-funds until unskipped");
}

// TEST 38: What-if drafts (whatIf: true) overlay the in-memory transactions
// map so every balance walk sees them, but they must never reach localStorage,
// exports, or cloud sync. Applying commits them as real transactions;
// discarding removes them without a trace.
console.log("TEST 38: What-If Drafts Affect The Walk But Never Persist Until Applied");
{
  const s = new TransactionStore();
  s.resetData();
  const t38 = new Date();
  const day = (offset) =>
    Utils.formatDateString(
      new Date(t38.getFullYear(), t38.getMonth(), t38.getDate() + offset)
    );

  s.addTransaction(day(0), { amount: 500, type: "income", description: "Pay" });
  s.addWhatIfTransaction(day(1), {
    amount: 120, type: "expense", description: "New tires", settled: true,
  });

  // The walk sees the draft.
  const rm = new RecurringTransactionManager(s);
  const cs = new CalculationService(s, rm);
  const totals = cs.calculateDailyTotals(day(1));
  if (totals.expense !== 120) {
    throw new Error(`Draft not visible to the balance walk: ${JSON.stringify(totals)}`);
  }

  // Persistence and export never see it.
  s.saveData(false);
  const raw = JSON.parse(global.localStorage.getItem("transactions"));
  const rawHasDraft = Object.keys(raw).some((d) =>
    raw[d].some((t) => t.whatIf === true || t.description === "New tires")
  );
  if (rawHasDraft) throw new Error("What-if draft leaked into localStorage");
  const exported = s.exportData();
  const exportHasDraft = Object.keys(exported.transactions).some((d) =>
    exported.transactions[d].some((t) => t.whatIf === true)
  );
  if (exportHasDraft) throw new Error("What-if draft leaked into exportData");

  // Discard removes it from the live map.
  if (s.clearWhatIfTransactions() !== 1) {
    throw new Error("clearWhatIfTransactions should report 1 removed draft");
  }
  if ((s.getTransactions()[day(1)] || []).length !== 0 && s.getTransactions()[day(1)]) {
    throw new Error("Discarded draft still present");
  }

  // Apply commits the draft as a real, persisted transaction.
  s.addWhatIfTransaction(day(2), {
    amount: 75, type: "expense", description: "Committed", settled: true,
  });
  if (s.applyWhatIfTransactions() !== 1) {
    throw new Error("applyWhatIfTransactions should report 1 committed draft");
  }
  const committed = (s.getTransactions()[day(2)] || []).find(
    (t) => t.description === "Committed"
  );
  if (!committed || committed.whatIf !== undefined || !committed.id) {
    throw new Error(`Applied draft is not a real transaction: ${JSON.stringify(committed)}`);
  }
  const exported2 = s.exportData();
  const exportedCommitted = (exported2.transactions[day(2)] || []).some(
    (t) => t.description === "Committed"
  );
  if (!exportedCommitted) throw new Error("Applied draft missing from exportData");
  s.cancelPendingSave();
  console.log("✅ What-if drafts overlay the walk, never persist, and commit cleanly on apply");
}

// TEST 39: Savings goals are a first-class synced collection: CRUD +
// normalization, persistence round-trip, export/import, and tombstoned
// deletion that survives a cloud merge (the remote copy must not resurrect).
console.log("TEST 39: Savings Goals CRUD, Round-Trip, And Tombstoned Merge");
{
  const s = new TransactionStore();
  s.resetData();
  const goalId = s.addSavingsGoal({
    name: "Vacation", targetAmount: 1200, targetDate: "2027-03-01", saved: 100,
  });
  s.updateSavingsGoal(goalId, { saved: 250 });
  s.flushPendingSave();

  // Reload from the same mock storage.
  const reloaded = new TransactionStore();
  const rGoal = reloaded.getSavingsGoals().find((g) => g.id === goalId);
  if (!rGoal || rGoal.saved !== 250 || rGoal.name !== "Vacation") {
    throw new Error(`Goal did not round-trip storage: ${JSON.stringify(rGoal)}`);
  }

  // Export/import round-trip.
  const exported = s.exportData();
  const s2 = new TransactionStore();
  s2.resetData();
  if (!s2.importData(JSON.parse(JSON.stringify(exported)))) {
    throw new Error("importData rejected an export containing savingsGoals");
  }
  if (s2.getSavingsGoals().length !== 1) {
    throw new Error("Imported data lost the savings goal");
  }
  s2.cancelPendingSave();

  // Delete tombstones the goal; a merge with a remote that still has it must
  // not resurrect it — while a different remote-only goal still comes through.
  s.deleteSavingsGoal(goalId);
  if (!s._deletedItems.savingsGoals.some((d) => d.id === goalId)) {
    throw new Error("deleteSavingsGoal did not record a tombstone");
  }
  const sync = new CloudSync(s, () => {});
  const merged = sync._mergeData(s.exportData(), JSON.parse(JSON.stringify(exported)));
  if (merged.savingsGoals.length !== 0) {
    throw new Error("Cloud merge resurrected a deleted savings goal");
  }
  const remoteWithNew = JSON.parse(JSON.stringify(exported));
  remoteWithNew.savingsGoals = [{
    id: "t39-remote-goal", name: "Roof", targetAmount: 5000,
    targetDate: "2027-06-01", saved: 0, _lastModified: new Date().toISOString(),
  }];
  const merged2 = sync._mergeData(s.exportData(), remoteWithNew);
  if (merged2.savingsGoals.length !== 1 || merged2.savingsGoals[0].id !== "t39-remote-goal") {
    throw new Error(`Remote-only goal should merge in: ${JSON.stringify(merged2.savingsGoals)}`);
  }
  s.cancelPendingSave();
  console.log("✅ Savings goals persist, export, import, and merge with tombstones");
}

// TEST 40: Bank-reconcile suggests a recurring series for a payee that repeats
// at a steady interval with steady amounts and no covering series — and stays
// quiet for irregular spend or payees an existing series already covers.
// Accepting a suggestion creates a definition starting at the NEXT expected
// date so past statement lines aren't double-counted.
console.log("TEST 40: Statement Recurring-Pattern Detection And Series Creation");
{
  const s = new TransactionStore();
  s.resetData();
  const rm = new RecurringTransactionManager(s);
  const br = new BankReconcileUI(s, rm, () => {}, () => {});
  const mkRow = (date, signed, description) => ({
    date, postedDate: date, signed, description, pending: false,
    matched: false, _match: null,
  });
  const rows = [
    mkRow("2026-06-05", -15.99, "Recurring Withdrawal SPOTIFY USA"),
    mkRow("2026-06-12", -15.99, "Recurring Withdrawal SPOTIFY USA"),
    mkRow("2026-06-19", -15.99, "Recurring Withdrawal SPOTIFY USA"),
    // Irregular spend at one merchant: 1-day gap, wild amounts — no schedule.
    mkRow("2026-06-03", -42.10, "POS Withdrawal HOMETOWN DELI FL"),
    mkRow("2026-06-04", -8.77, "POS Withdrawal HOMETOWN DELI FL"),
  ];

  const suggestions = br._detectRecurringCandidates(rows);
  if (suggestions.length !== 1) {
    throw new Error(`Expected exactly 1 suggestion, got: ${JSON.stringify(suggestions)}`);
  }
  const sug = suggestions[0];
  if (sug.recurrence !== "weekly" || sug.amount !== 15.99 || sug.type !== "expense") {
    throw new Error(`Wrong suggestion shape: ${JSON.stringify(sug)}`);
  }
  const todayIso = Utils.formatDateString(new Date());
  if (sug.nextDate <= todayIso) {
    throw new Error(`Suggested start date must be in the future: ${sug.nextDate}`);
  }

  // Accepting creates the series at the next expected date.
  br._createRecurringFromSuggestion(sug);
  const defs = s.getRecurringTransactions();
  if (defs.length !== 1 || defs[0].startDate !== sug.nextDate || defs[0].recurrence !== "weekly") {
    throw new Error(`Created definition is wrong: ${JSON.stringify(defs)}`);
  }
  if (sug.created !== true) {
    throw new Error("Suggestion not marked created");
  }

  // With the series in place (payee now in the recurring vocabulary), the
  // same statement no longer suggests it.
  const again = br._detectRecurringCandidates(rows);
  if (again.length !== 0) {
    throw new Error(`Covered payee was re-suggested: ${JSON.stringify(again)}`);
  }
  s.cancelPendingSave();
  console.log("✅ Steady statement patterns are suggested once and start at the next expected date");
}

// TEST 41: Undo-delete semantics. The undo toast restores a deleted one-time
// transaction under a FRESH id (via addTransaction) because the old id is
// tombstoned for sync — a merge with a remote that still carries the old copy
// must keep it dead while the restored copy survives.
console.log("TEST 41: Undo Restore Uses A Fresh Id That Survives The Merge");
{
  const s = new TransactionStore();
  s.resetData();
  const d41 = "2026-07-10";
  const oldId = s.addTransaction(d41, {
    amount: 40, type: "expense", description: "Mistake", settled: true,
  });
  const remote = JSON.parse(JSON.stringify(s.exportData())); // synced copy pre-delete

  s.deleteTransaction(d41, 0);
  if (!s._deletedItems.transactions.some((x) => x.id === oldId)) {
    throw new Error("Delete did not tombstone the transaction id");
  }

  // The undo path re-adds a cleaned clone (no id/_lastModified), as
  // TransactionUI._restoreDeletedTransaction does.
  const newId = s.addTransaction(d41, {
    amount: 40, type: "expense", description: "Mistake", settled: true,
  });
  if (newId === oldId) {
    throw new Error("Restored transaction must get a fresh id");
  }

  const sync = new CloudSync(s, () => {});
  const merged = sync._mergeData(s.exportData(), remote);
  const mergedList = merged.transactions[d41] || [];
  if (mergedList.length !== 1 || mergedList[0].id !== newId) {
    throw new Error(
      `Merge should keep only the restored copy: ${JSON.stringify(mergedList)}`
    );
  }
  s.cancelPendingSave();
  console.log("✅ Undo-restored transactions survive the merge; the old id stays dead");
}

// TEST 42: Name-assisted date-window stretch in pass 1. Settled entries
// normally match only within toleranceDays (2), but an ACH draft due before a
// holiday weekend posts 3-4 days late (due Fri 7/3 — July 4th observed — posts
// Mon 7/6). When the bank line and the app entry share a distinctive payee
// word AND the amount is exact, the window stretches to unsettledToleranceDays
// so the pair reconciles and surfaces as date drift, instead of a false
// "Missing from app" + "Settled, no bank record" double report. A name-neutral
// entry at the same 3-day gap must NOT stretch.
console.log("TEST 42: Shared Payee Name Stretches Pass-1 Date Window");
{
  // The anchor line keeps the statement's reporting window open back to 6/29
  // (a one-line statement would clamp reporting to 7/6 and hide the 7/3 entry).
  const csv =
    "Posted Date,Transaction Date,Description,Deposit,Withdrawal,Balance\n" +
    "7/6/2026,7/6/2026,Withdrawal ACH CAPITAL ONE,,($73.00),$1295.81\n" +
    "6/29/2026,6/29/2026,Withdrawal Debit Card JASON'S DELI FORT MYERS FL,,($53.25),$2073.30\n";
  const addAnchor = (s) =>
    s.addTransaction("2026-06-29", {
      amount: 53.25, type: "expense",
      description: "Jasons Deli", settled: true,
    });

  // Same payee: exact amount, 3-day gap — must match and report date drift.
  {
    const s = new TransactionStore();
    s.resetData();
    const rm = new RecurringTransactionManager(s);
    const ui = new BankReconcileUI(s, rm, () => {}, () => {});
    addAnchor(s);
    s.addTransaction("2026-07-03", {
      amount: 73, type: "expense",
      description: "Debt Payment: Capital One", settled: true,
    });

    const parsed = ui._parseSuncoastCsv(csv);
    if (parsed.error) throw new Error("Parse error: " + parsed.error);
    ui._run(parsed.rows);

    const r = ui.result;
    if (r.matchedCount !== 2 || r.missingFromApp.length !== 0) {
      throw new Error(
        `Same-payee holiday drift must match: matched=${r.matchedCount}, missing=${r.missingFromApp.length}`
      );
    }
    if (r.dateDrifted.length !== 1 || r.dateDrifted[0].app.date !== "2026-07-03") {
      throw new Error(`Pair must surface as date drift: ${JSON.stringify(r.dateDrifted)}`);
    }
    if (r.appOnlyUnmatched.length !== 0) {
      throw new Error("Matched entry must not also report as unmatched");
    }
    s.cancelPendingSave();
  }

  // Name-neutral entry: same amount and gap, but no shared payee word — the
  // settled 2-day window holds and both sides report as discrepancies.
  {
    const s = new TransactionStore();
    s.resetData();
    const rm = new RecurringTransactionManager(s);
    const ui = new BankReconcileUI(s, rm, () => {}, () => {});
    addAnchor(s);
    s.addTransaction("2026-07-03", {
      amount: 73, type: "expense",
      description: "Monthly subscription", settled: true,
    });

    const parsed = ui._parseSuncoastCsv(csv);
    if (parsed.error) throw new Error("Parse error: " + parsed.error);
    ui._run(parsed.rows);

    const r = ui.result;
    if (r.matchedCount !== 1 || r.missingFromApp.length !== 1) {
      throw new Error(
        `Name-neutral 3-day gap must NOT match: matched=${r.matchedCount}, missing=${r.missingFromApp.length}`
      );
    }
    if (r.appOnlyUnmatched.length !== 1) {
      throw new Error("Unmatched settled entry must still be reported");
    }
    s.cancelPendingSave();
  }
  console.log("✅ Exact amount + shared payee bridges holiday ACH drift; neutral names keep the 2-day window");
}

// TEST 43: Free-funds shortfall cushion. The bucket's reserve is already
// carved out of every projected balance, so a healthy (≥0) 30-day trough must
// never shrink the advertised free funds — the old display cap
// min(remaining, trough) double-counted the reserve. A NEGATIVE trough means
// the plan can't fully cash-back the reserve: that shortfall is held back
// from the bucket (cushion) and the displayed low, lifted by the cushion,
// bottoms out at 0 while the bucket covers it.
console.log("TEST 43: Free-Funds Cushion Absorbs The 30-Day Shortfall, Never Double-Counts");
{
  const s = new TransactionStore();
  s.resetData();
  const rm = new RecurringTransactionManager(s);
  const calc = new CalculationService(s, rm);

  const cases = [
    // [remaining, trough, expCushion, expDisplay] — expected shown low = trough + cushion
    [100, 50, 0, 100],   // healthy trough: full bucket advertised (no double-count)
    [100, -5, 5, 95],    // user's scenario: spend 55 past a 50 low → hold back 5, show 95, low reads 0
    [100, 0, 0, 100],    // exactly-zero trough: nothing to absorb
    [100, -100, 100, 0], // shortfall consumes the whole bucket
    [100, -150, 100, 0], // shortfall exceeds bucket: display floors at 0, low reads -50
    [0, -25, 0, 0],      // empty bucket cushions nothing
    [500, 200, 0, 500],  // old cap would have shown 200 here — must show 500
    [10.005, -0.004, 0, 10.01], // cent rounding on both figures
  ];
  for (const [remaining, trough, expCushion, expDisplay] of cases) {
    const { cushion, display } = calc.getFreeFundsCushion(remaining, trough);
    if (cushion !== expCushion || display !== expDisplay) {
      throw new Error(
        `getFreeFundsCushion(${remaining}, ${trough}) = {cushion:${cushion}, display:${display}}, expected {cushion:${expCushion}, display:${expDisplay}}`
      );
    }
    // Invariants: shown low (trough + cushion) never overshoots past 0, and
    // bucket + balances stay conserved (display + cushion = remaining, cents).
    const shownLow = calc.roundToCents(trough + cushion);
    if (trough < 0 && shownLow > 0) {
      throw new Error(`Cushion overshoots: trough ${trough} + cushion ${cushion} = ${shownLow} > 0`);
    }
    if (calc.roundToCents(display + cushion) !== calc.roundToCents(Math.max(0, Number(remaining) || 0))) {
      throw new Error(`Cushion + display must equal remaining: ${display} + ${cushion} != ${remaining}`);
    }
  }
  s.cancelPendingSave();
  console.log("✅ Healthy trough leaves free funds untouched; negative trough is held back so the shown low bottoms at 0");
}

// TEST 44: Snowball projection subtracts allocation reserves at Ending Balance
// anchors, matching every CalculationService walk path. Previously the
// projection reset checking to the RAW entered figure, silently un-reserving
// allocation buckets and (with a future-dated anchor) pulling payoffs earlier.
console.log("TEST 44: Snowball Projection Reserves Survive A Future Anchor");
{
  const SA_RealDate = Date;
  const SA_FIXED_TODAY = new SA_RealDate(2026, 5, 10, 12, 0, 0); // 2026-06-10
  class SA_FrozenDate extends SA_RealDate {
    constructor(...args) {
      if (args.length === 0) { super(SA_FIXED_TODAY.getTime()); } else { super(...args); }
    }
    static now() { return SA_FIXED_TODAY.getTime(); }
  }
  global.Date = SA_FrozenDate;
  try {
    const s = new TransactionStore();
    s.resetData();
    const rm = new RecurringTransactionManager(s);
    const calc = new CalculationService(s, rm);
    const ui = Object.create(DebtSnowballUI.prototype);
    ui.store = s;
    ui.recurringManager = rm;
    ui.calculationService = calc;
    ui.daySpecificOptions = [];

    // $500 reserved before the projection window; a $5000 Ending Balance lands
    // mid-projection (2026-06-20 > projection start 06-11). Salary keeps the
    // account funded so the payoff eventually happens.
    s.addTransaction("2026-06-05", {
      amount: 500, type: "expense", description: "Reserve", allocated: true, settled: true,
    });
    s.addTransaction("2026-06-20", {
      amount: 5000, type: "balance", description: "Ending Balance",
    });
    s.addRecurringTransaction({
      startDate: "2026-06-01", amount: 2000, type: "income",
      description: "Salary", recurrence: "monthly",
    });
    const debtId = s.addDebt({
      name: "Card", balance: 4600, minPayment: 50, dueDay: 25,
      recurrence: "monthly", interestRate: 0, dueStartDate: "2026-06-25",
    });
    ui.ensureMinimumPaymentRecurring(s.getDebts().find((d) => d.id === debtId));
    s.setDebtSnowballSettings({ dailyFloor: 0, extraPaymentStartMonth: "", autoGenerate: false });

    const proj = ui.calculateSnowballProjection(2026, 5, true);
    const p = proj.payoffByDebtId[debtId];
    if (!p) throw new Error("Debt should eventually be paid off in the projection");
    // With reserves surviving the anchor, checking on 06-20 is 4500 — NOT
    // enough for the $4,600 payoff (raw-anchor behavior paid off in June).
    // July's salary tops it up, so the payoff lands in July.
    if (p.year === 2026 && p.month === 5) {
      throw new Error(
        "Payoff landed in June: the projection used the raw anchor figure (reserves were absorbed)"
      );
    }
    if (!(p.year === 2026 && p.month === 6)) {
      throw new Error(`Payoff expected July 2026, got ${p.year}-${p.month + 1}-${p.day}`);
    }
    s.cancelPendingSave();
    console.log("✅ Projection keeps allocation reserves reserved across a future Ending Balance");
  } finally {
    global.Date = SA_RealDate;
  }
}

// Run the async network tests sequentially (shared global.fetch mock): TEST 32
// first, then TEST 30, which prints the final banner.
runReplaceRemoteTest()
  .then(runTest30Final)
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
