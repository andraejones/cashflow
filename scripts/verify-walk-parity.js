// Balance-walk parity harness.
//
// The day-by-day running-balance walk (prev + income − expense; on an Ending
// Balance day the balance RESETS to entered − reservedOnOrBefore and the
// carried-unsettled accumulator resets to 0) is implemented in several places
// that must agree:
//   - CalculationService.updateMonthlyBalances / getRunningBalanceForDate /
//     getDayBalanceBreakdown / calculateMinimum / getMinimumBalanceThrough
//   - CalendarUI.generateCalendar's per-day display loop and its today→+30
//     min/crisis loop (transcribed below — DOM-free copies of the exact math,
//     see the calendar-ui.js line references at each transcription).
//
// This script generates randomized scenarios plus a fixed edge corpus and
// asserts cross-path invariants with exact equality on cent-rounded numbers.
// It must pass BEFORE and AFTER any refactor of the walk. On failure it prints
// the PRNG seed and the full scenario JSON; re-run with
//   node scripts/verify-walk-parity.js <seed>
// to reproduce.

const fs = require('fs');
const path = require('path');

// ---- Mock browser environment (same pattern as verify-logic.js) -----------
const localStorageData = {};
global.localStorage = {
  getItem: (key) => localStorageData[key] || null,
  setItem: (key, val) => { localStorageData[key] = val; },
  removeItem: (key) => { delete localStorageData[key]; },
  clear: () => { for (const k in localStorageData) delete localStorageData[k]; }
};
global.window = { localStorage: global.localStorage };
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
  showNotification: () => {},
  formatDisplayDate: (str) => str,
  escapeHtml: (str) => String(str)
};
global.ModalManager = { openModal: () => {}, closeModal: () => {}, topModal: () => null };

const vm = require('vm');
const jsDir = path.join(__dirname, '../js');
['transaction-store.js', 'recurring-manager.js', 'calculation-service.js'].forEach((file) => {
  vm.runInThisContext(fs.readFileSync(path.join(jsDir, file), 'utf8'));
});

// ---- PRNG ------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = process.argv[2] ? Number(process.argv[2]) : (Date.now() % 2147483647);
console.log(`Parity harness seed: ${SEED}`);

// ---- Helpers ----------------------------------------------------------------
const round = (v) => Math.round((Number(v) || 0) * 100) / 100;
const TODAY = new Date();
const TODAY_STR = Utils.formatDateString(TODAY);

function offsetDateStr(days) {
  return Utils.formatDateString(
    new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + days, 12, 0, 0)
  );
}

// Adversarial cent amounts mixed with round figures.
function randAmount(rng) {
  const pool = [0.01, 0.33, 10.33, 99.99, 1234.56, 5, 20, 100, 250, 1000];
  if (rng() < 0.5) return pool[Math.floor(rng() * pool.length)];
  return round(rng() * 2000 + 0.01);
}

function randOffset(rng) {
  // [-90, +90], biased toward day-1 / month-end / today
  const r = rng();
  if (r < 0.1) return 0; // today
  if (r < 0.2) {
    // first or last day of a nearby month
    const monthDelta = Math.floor(rng() * 5) - 2;
    const d = rng() < 0.5
      ? new Date(TODAY.getFullYear(), TODAY.getMonth() + monthDelta, 1, 12, 0, 0)
      : new Date(TODAY.getFullYear(), TODAY.getMonth() + monthDelta + 1, 0, 12, 0, 0);
    return Math.round((d - new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate(), 12, 0, 0)) / 86400000);
  }
  return Math.floor(rng() * 181) - 90;
}

// ---- Scenario construction ---------------------------------------------------
// Returns { store, rm, calc, log } with data applied. `log` records every
// mutation so failures can be reproduced/reported.
function freshWorld() {
  global.localStorage.clear();
  const store = new TransactionStore();
  store.resetData();
  const rm = new RecurringTransactionManager(store);
  const calc = new CalculationService(store, rm);
  return { store, rm, calc };
}

function buildRandomScenario(rng) {
  const world = freshWorld();
  const { store, rm } = world;
  const log = { transactions: [], recurring: [], skips: [] };

  const nTxn = 5 + Math.floor(rng() * 36);
  for (let i = 0; i < nTxn; i++) {
    const off = randOffset(rng);
    const date = offsetDateStr(off);
    const roll = rng();
    let txn;
    if (roll < 0.45) {
      txn = { amount: randAmount(rng), type: 'expense', description: `Exp ${i}` };
      if (rng() < 0.3) txn.settled = false;       // unsettled expense
      if (rng() < 0.15) txn.allocated = true;      // allocation bucket (reserve)
      if (rng() < 0.1) txn.hidden = true;          // hidden still counts in balances
    } else if (roll < 0.85) {
      txn = { amount: randAmount(rng), type: 'income', description: `Inc ${i}` };
      if (rng() < 0.1) txn.hidden = true;
    } else {
      txn = { amount: randAmount(rng), type: 'balance', description: 'Ending Balance' };
    }
    store.addTransaction(date, { ...txn });
    log.transactions.push({ date, ...txn });
  }

  const nRec = Math.floor(rng() * 4);
  const recurrences = ['monthly', 'weekly', 'bi-weekly'];
  for (let i = 0; i < nRec; i++) {
    const def = {
      amount: randAmount(rng),
      type: rng() < 0.6 ? 'expense' : 'income',
      description: `Rec ${i}`,
      recurrence: recurrences[Math.floor(rng() * recurrences.length)],
      startDate: offsetDateStr(Math.floor(rng() * 121) - 90),
    };
    if (rng() < 0.25) def.endDate = offsetDateStr(30 + Math.floor(rng() * 60));
    const id = store.addRecurringTransaction({ ...def });
    log.recurring.push({ id, ...def });
    // Occasionally skip one expanded occurrence of this series.
    if (rng() < 0.4) {
      // Expand a nearby month, find an instance, skip it.
      const mDelta = Math.floor(rng() * 3) - 1;
      const y = TODAY.getFullYear();
      const m = TODAY.getMonth() + mDelta;
      rm.applyRecurringTransactions(new Date(y, m, 1).getFullYear(), new Date(y, m, 1).getMonth());
      const txns = store.getTransactions();
      const dates = Object.keys(txns).filter((d) =>
        txns[d].some((t) => t.recurringId === id)
      );
      if (dates.length > 0) {
        const skipDate = dates[Math.floor(rng() * dates.length)];
        store.setTransactionSkipped(skipDate, id, true);
        log.skips.push({ date: skipDate, recurringId: id });
      }
    }
  }
  return { ...world, log };
}

// Fixed edge corpus — deterministic scenarios for the cases that have bitten
// before. Each returns a world.
const EDGE_SCENARIOS = {
  'anchor-on-day-1': () => {
    const w = freshWorld();
    const monthStart = Utils.formatDateString(new Date(TODAY.getFullYear(), TODAY.getMonth(), 1, 12, 0, 0));
    w.store.addTransaction(offsetDateStr(-40), { amount: 500, type: 'income', description: 'Prior income' });
    w.store.addTransaction(monthStart, { amount: 1000, type: 'balance', description: 'Ending Balance' });
    w.store.addTransaction(monthStart, { amount: 50, type: 'expense', description: 'Same-day exp' });
    w.store.addTransaction(offsetDateStr(5), { amount: 25.33, type: 'expense', description: 'Later exp' });
    return w;
  },
  'anchor-on-today-with-unsettled': () => {
    const w = freshWorld();
    w.store.addTransaction(offsetDateStr(-10), { amount: 60, type: 'expense', description: 'Old unsettled', settled: false });
    w.store.addTransaction(TODAY_STR, { amount: 40, type: 'expense', description: 'Today unsettled', settled: false });
    w.store.addTransaction(TODAY_STR, { amount: 15, type: 'income', description: 'Today income' });
    w.store.addTransaction(TODAY_STR, { amount: 800, type: 'balance', description: 'Ending Balance' });
    return w;
  },
  'two-balances-same-day': () => {
    const w = freshWorld();
    w.store.addTransaction(offsetDateStr(-3), { amount: 100, type: 'balance', description: 'First' });
    w.store.addTransaction(offsetDateStr(-3), { amount: 200, type: 'balance', description: 'Second (wins)' });
    w.store.addTransaction(offsetDateStr(-1), { amount: 10, type: 'expense', description: 'Exp' });
    return w;
  },
  'future-anchor-with-reserve': () => {
    const w = freshWorld();
    w.store.addTransaction(offsetDateStr(-5), { amount: 300, type: 'expense', description: 'Bucket', allocated: true });
    w.store.addTransaction(offsetDateStr(10), { amount: 2000, type: 'balance', description: 'Future anchor' });
    w.store.addTransaction(offsetDateStr(15), { amount: 75, type: 'expense', description: 'After anchor' });
    return w;
  },
  'unsettled-straddles-month-anchor-between': () => {
    const w = freshWorld();
    const prevMonthMid = Utils.formatDateString(new Date(TODAY.getFullYear(), TODAY.getMonth() - 1, 12, 12, 0, 0));
    const prevMonthLate = Utils.formatDateString(new Date(TODAY.getFullYear(), TODAY.getMonth() - 1, 20, 12, 0, 0));
    const prevMonthEnd = Utils.formatDateString(new Date(TODAY.getFullYear(), TODAY.getMonth(), 0, 12, 0, 0));
    w.store.addTransaction(prevMonthMid, { amount: 45, type: 'expense', description: 'Unsettled pre-anchor', settled: false });
    w.store.addTransaction(prevMonthLate, { amount: 900, type: 'balance', description: 'Anchor between' });
    w.store.addTransaction(prevMonthEnd, { amount: 30, type: 'expense', description: 'Unsettled post-anchor', settled: false });
    w.store.addTransaction(offsetDateStr(2), { amount: 20, type: 'expense', description: 'This month' });
    return w;
  },
  'allocation-before-anchor': () => {
    const w = freshWorld();
    w.store.addTransaction(offsetDateStr(-20), { amount: 150, type: 'expense', description: 'Bucket', allocated: true });
    w.store.addTransaction(offsetDateStr(-8), { amount: 1000, type: 'balance', description: 'Anchor' });
    w.store.addTransaction(offsetDateStr(-2), { amount: 60, type: 'expense', description: 'Exp' });
    return w;
  },
  'hidden-unsettled-asymmetry': () => {
    // A hidden unsettled expense counts in dailyTotals.unsettledExpense but is
    // excluded from getUnsettledTransactions(). This scenario pins the CURRENT
    // interaction so a refactor can't silently change it.
    const w = freshWorld();
    w.store.addTransaction(offsetDateStr(-4), { amount: 55, type: 'expense', description: 'Hidden unsettled', settled: false, hidden: true });
    w.store.addTransaction(offsetDateStr(-3), { amount: 22, type: 'expense', description: 'Visible unsettled', settled: false });
    w.store.addTransaction(offsetDateStr(1), { amount: 10, type: 'income', description: 'Inc' });
    return w;
  },
  'empty-month-gap': () => {
    const w = freshWorld();
    const farBack = Utils.formatDateString(new Date(TODAY.getFullYear(), TODAY.getMonth() - 3, 10, 12, 0, 0));
    w.store.addTransaction(farBack, { amount: 400, type: 'income', description: 'Old income' });
    w.store.addTransaction(offsetDateStr(1), { amount: 35, type: 'expense', description: 'Recent exp' });
    return w;
  },
  'five-year-span': () => {
    const w = freshWorld();
    const old = Utils.formatDateString(new Date(TODAY.getFullYear() - 5, TODAY.getMonth(), 15, 12, 0, 0));
    w.store.addTransaction(old, { amount: 1000, type: 'income', description: 'Ancient income' });
    w.store.addTransaction(TODAY_STR, { amount: 50, type: 'expense', description: 'Today exp' });
    return w;
  },
  'monthly-31st-with-skip': () => {
    const w = freshWorld();
    const start = Utils.formatDateString(new Date(TODAY.getFullYear(), TODAY.getMonth() - 2, 1, 12, 0, 0));
    const id = w.store.addRecurringTransaction({
      amount: 120, type: 'expense', description: 'Rent-ish', recurrence: 'monthly',
      startDate: start, lastDayOfMonth: true,
    });
    w.rm.applyRecurringTransactions(TODAY.getFullYear(), TODAY.getMonth());
    const txns = w.store.getTransactions();
    const inst = Object.keys(txns).find((d) => txns[d].some((t) => t.recurringId === id));
    if (inst) w.store.setTransactionSkipped(inst, id, true);
    w.store.addTransaction(offsetDateStr(-1), { amount: 10, type: 'income', description: 'Inc' });
    return w;
  },
};

// ---- Assertions ---------------------------------------------------------------
let checks = 0;
let currentLabel = '';
function assertEq(actual, expected, what) {
  checks++;
  if (actual !== expected) {
    throw new Error(`[${currentLabel}] ${what}: actual=${actual} expected=${expected}`);
  }
}

// ---- Invariant runner -----------------------------------------------------------
function monthKeysInRange(store) {
  // Earliest transaction month through today+2 months.
  const txns = store.getTransactions();
  let earliest = null;
  for (const d in txns) {
    if (earliest === null || d < earliest) earliest = d;
  }
  const startDate = earliest ? Utils.parseDateString(earliest) : TODAY;
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), 1, 12, 0, 0);
  const end = new Date(TODAY.getFullYear(), TODAY.getMonth() + 2, 1, 12, 0, 0);
  const keys = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    keys.push([cursor.getFullYear(), cursor.getMonth()]);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

function runInvariants(world) {
  const { store, rm, calc } = world;

  const months = monthKeysInRange(store);
  // Mirror generateCalendar: expand every month we'll walk, then refresh the
  // monthly balances for "today's" viewed date (calendar-ui.js:244,252).
  months.forEach(([y, m0]) => rm.applyRecurringTransactions(y, m0));
  calc.updateMonthlyBalances(TODAY);

  // --- Invariant (b): month-boundary continuity --------------------------------
  const mb = store.getMonthlyBalances();
  const sortedKeys = Object.keys(mb).sort();
  for (let i = 0; i + 1 < sortedKeys.length; i++) {
    const [ny, nm] = sortedKeys[i + 1].split('-').map(Number);
    // Consecutive months only.
    const expectedNext = nm === 1 ? `${ny - 1}-12` : `${ny}-${String(nm - 1).padStart(2, '0')}`;
    if (sortedKeys[i] !== expectedNext) continue;
    const day1 = `${sortedKeys[i + 1]}-01`;
    const dt = calc.calculateDailyTotals(day1);
    if (dt.balance !== null) {
      // Day-1 anchor: startingBalance is the anchor-adjusted figure.
      const expected = round(dt.balance - calc.getReservedTotalOnOrBefore(day1));
      assertEq(mb[sortedKeys[i + 1]].startingBalance, expected, `(b) day-1-anchor start ${sortedKeys[i + 1]}`);
    } else {
      assertEq(
        mb[sortedKeys[i + 1]].startingBalance,
        mb[sortedKeys[i]].endingBalance,
        `(b) continuity ${sortedKeys[i]} -> ${sortedKeys[i + 1]}`
      );
    }
  }
  // calculateMonthlySummary must agree with the stored map.
  months.forEach(([y, m0]) => {
    const key = `${y}-${String(m0 + 1).padStart(2, '0')}`;
    if (mb[key]) {
      const s = calc.calculateMonthlySummary(y, m0);
      assertEq(s.startingBalance, mb[key].startingBalance, `(b) summary start ${key}`);
      assertEq(s.endingBalance, mb[key].endingBalance, `(b) summary end ${key}`);
    }
  });

  // --- Invariants (a), (d), (e): calendar display-loop transcription ------------
  // Transcribed from calendar-ui.js generateCalendar: seed 277-294, anchor
  // handling 438-454, cellExpense fold 469-481. Kept in exact sync with the
  // source until the walk is unified; afterwards this remains the reference
  // semantics the shared walk must produce.
  months.forEach(([y, m0]) => {
    const summary = calc.calculateMonthlySummary(y, m0);
    let running = summary.startingBalance;

    const monthStartStr = Utils.formatDateString(new Date(y, m0, 1, 12, 0, 0));
    const allUnsettled = store.getUnsettledTransactions();
    const carryAnchor = calc.getReconciliationAnchor(monthStartStr, { inclusive: false });
    let runningUnsettled = 0;
    for (const u of allUnsettled) {
      if (u.date < monthStartStr && (carryAnchor === null || u.date > carryAnchor)) {
        runningUnsettled = round(runningUnsettled + u.transaction.amount);
      }
    }
    // Allocation-reserve carry (getDayBalanceBreakdown 395-411): every live
    // bucket dated before this month, skip-aware, regardless of anchors.
    let runningAllocated = 0;
    const allTxns = store.getTransactions();
    Object.keys(allTxns).forEach((d) => {
      if (d >= monthStartStr) return;
      allTxns[d].forEach((t) => {
        if (t.type !== 'expense' || t.allocated !== true) return;
        if (t.recurringId && rm.isTransactionSkipped(d, t.recurringId)) return;
        runningAllocated = round(runningAllocated + t.amount);
      });
    });

    const daysInMonth = new Date(y, m0 + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const ds = `${y}-${String(m0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dt = calc.calculateDailyTotals(ds);
      if (dt.balance !== null) {
        const reserved = calc.getReservedTotalOnOrBefore(ds);
        running = round(dt.balance - reserved);
        runningUnsettled = 0;
        runningAllocated = reserved;
      } else {
        running = round(running + dt.income - dt.expense);
        runningUnsettled = round(runningUnsettled + dt.unsettledExpense);
        runningAllocated = round(runningAllocated + dt.allocatedExpense);
      }

      // (a) calendar walk == getRunningBalanceForDate
      assertEq(calc.getRunningBalanceForDate(ds), running, `(a) running ${ds}`);

      // (d)/(e) breakdown parity for every day of the current & adjacent months
      // (full range would be O(n^2)-heavy; adjacency covers the seams).
      const monthDelta = (y - TODAY.getFullYear()) * 12 + (m0 - TODAY.getMonth());
      if (Math.abs(monthDelta) <= 1) {
        const bd = calc.getDayBalanceBreakdown(ds);
        assertEq(bd.balance, running, `(d) breakdown balance ${ds}`);

        const isCurrentDay = ds === TODAY_STR;
        const carried = Math.max(0, round(runningUnsettled - dt.unsettledExpense));
        const cellExpense = isCurrentDay
          ? round(dt.expense + carried)
          : round(dt.expense - dt.unsettledExpense);
        assertEq(bd.expense, cellExpense, `(e) cellExpense ${ds}`);
        assertEq(bd.income, dt.income, `(e) income ${ds}`);

        const expectedBwu = runningUnsettled > 0
          ? round(running + runningUnsettled + runningAllocated)
          : null;
        assertEq(bd.balanceWithoutUnsettled, expectedBwu, `(e) balanceWithoutUnsettled ${ds}`);
        const expectedBea = runningAllocated > 0
          ? round(running + runningAllocated)
          : null;
        assertEq(bd.balanceExcludingAllocations, expectedBea, `(e) balanceExcludingAllocations ${ds}`);
      }
    }
  });

  // --- Invariant (c): the three "minimum" computations agree --------------------
  const min = calc.calculateMinimum();

  // Reference: min of getRunningBalanceForDate over today..+30. calculateMinimum
  // just expanded the horizon months and invalidated caches; refresh the
  // monthly-balance map so getRunningBalanceForDate sees consistent seeds.
  calc.updateMonthlyBalances(TODAY);
  const warmTodayBalance = calc.getRunningBalanceForDate(TODAY_STR);
  let refMin = warmTodayBalance;
  for (let i = 1; i <= 30; i++) {
    const b = calc.getRunningBalanceForDate(offsetDateStr(i));
    if (b < refMin) refMin = b;
  }
  assertEq(min, refMin, '(c) calculateMinimum == min(getRunningBalanceForDate)');

  // Transcription of calendar-ui's min/crisis loop (calendar-ui.js:318-386):
  // seeds from the stored monthlyBalances map directly, walks 1..today then
  // 30 days forward, seeding today as a candidate.
  const todayMonthKey = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}`;
  const mbNow = store.getMonthlyBalances();
  let currentBalance = (mbNow[todayMonthKey] && mbNow[todayMonthKey].startingBalance) || 0;
  for (let d = 1; d <= TODAY.getDate(); d++) {
    const dsr = Utils.formatDateString(new Date(TODAY.getFullYear(), TODAY.getMonth(), d));
    const dt = calc.calculateDailyTotals(dsr);
    if (dt.balance !== null) {
      currentBalance = round(dt.balance - calc.getReservedTotalOnOrBefore(dsr));
    } else {
      currentBalance = round(currentBalance + dt.income - dt.expense);
    }
  }
  let lowest = currentBalance;
  for (let d = 1; d <= 30; d++) {
    const dsr = offsetDateStr(d);
    const dt = calc.calculateDailyTotals(dsr);
    if (dt.balance !== null) {
      currentBalance = round(dt.balance - calc.getReservedTotalOnOrBefore(dsr));
    } else {
      currentBalance = round(currentBalance + dt.income - dt.expense);
    }
    if (currentBalance < lowest) lowest = currentBalance;
  }
  assertEq(lowest, min, '(c) calendar min/crisis transcription == calculateMinimum');

  // getMinimumBalanceThrough over the same 30-day horizon must agree too.
  const mbt = calc.getMinimumBalanceThrough(offsetDateStr(30));
  assertEq(mbt, min, '(c) getMinimumBalanceThrough(+30) == calculateMinimum');

  // --- Cold-cache re-check: results must not depend on warm caches --------------
  calc.invalidateCache();
  const coldBalance = calc.getRunningBalanceForDate(TODAY_STR);
  assertEq(coldBalance, warmTodayBalance, '(cache) cold running == warm running');
  calc.invalidateCache();
  const bdCold = calc.getDayBalanceBreakdown(TODAY_STR);
  assertEq(bdCold.balance, coldBalance, '(cache) cold breakdown == cold running');

  store.cancelPendingSave();
}

// ---- Source guard ----------------------------------------------------------------
// The walk is unified: calendar-ui must CONSUME CalculationService.walkDays
// rather than re-implement it. Re-implementing the anchor rule requires
// subtracting reserves, so any getReservedTotalOnOrBefore call in calendar-ui
// means the walk has been forked again. (`dailyTotals.balance !== null` alone
// is a legitimate display check — "does this day carry an anchor" — so it is
// not part of the guard.)
function sourceGuard() {
  const src = fs.readFileSync(path.join(jsDir, 'calendar-ui.js'), 'utf8');
  if (!src.includes('walkDays(')) {
    throw new Error('source guard: calendar-ui.js no longer delegates to CalculationService.walkDays');
  }
  if (src.includes('getReservedTotalOnOrBefore(')) {
    throw new Error('source guard: calendar-ui.js re-implements anchor math (getReservedTotalOnOrBefore call found) — use walkDays instead');
  }
  console.log('Source guard: calendar-ui delegates to the shared walk ✅');
}

// ---- Main -----------------------------------------------------------------------
try {
  // Edge corpus first (deterministic).
  for (const [name, build] of Object.entries(EDGE_SCENARIOS)) {
    currentLabel = `edge:${name}`;
    const world = build();
    runInvariants(world);
  }
  console.log(`Edge corpus passed (${Object.keys(EDGE_SCENARIOS).length} scenarios)`);

  // Randomized scenarios.
  const N = 200;
  const rng = mulberry32(SEED);
  let lastLog = null;
  for (let i = 0; i < N; i++) {
    currentLabel = `random:${i}`;
    const world = buildRandomScenario(rng);
    lastLog = world.log;
    try {
      runInvariants(world);
    } catch (err) {
      console.error(`\nScenario ${i} failed. Seed: ${SEED}`);
      console.error('Scenario data:', JSON.stringify(lastLog, null, 2));
      throw err;
    }
  }
  console.log(`Random scenarios passed (${N} scenarios, seed ${SEED})`);

  sourceGuard();

  console.log(`\nALL PARITY CHECKS PASSED (${checks} assertions)`);
  process.exit(0);
} catch (err) {
  console.error('\nPARITY FAILURE:', err.message);
  process.exit(1);
}
