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

console.log("ALL TESTS PASSED");
