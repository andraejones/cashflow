# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CashFlow Calendar is an offline-first, single-page personal finance application built with vanilla JavaScript (ES6+). It runs directly in the browser with no build process - just open `index.html`. All data is stored in localStorage with optional GitHub Gist cloud sync and PIN-based encryption.

## Development Commands

**No build process required.** Open `index.html` directly in a browser or serve via any static server.

**Tests:** `npm test` (or run the two scripts directly with Node) — it must pass before every commit:
- `node scripts/verify-logic.js` — 132 numbered integration tests over vm-loaded sources
  (numbered up to TEST 138; the numbering has gaps where tests were merged or
  removed along with the feature they covered).
  Six of them are SWEEPS rather than scenarios, and they are the ones worth
  extending when something new is added:
    - TEST 93 puts a wrong-typed value in every field the app reads, one field
      at a time, and walks every headless surface. Nothing coerces most stored
      fields on the way in from an import or a cloud merge, so each read surface
      has to guard itself — three separate crashes (two of which took the
      calendar render down) came from one that forgot.
    - TEST 94 drives every bank-reconcile action and asserts what it leaves
      behind for the OTHER components: allocation reserves conserved, persisted
      ids intact and unique, balances stable across a re-render and a reload,
      and nothing left for the report's own re-run to re-stamp (an action that
      drops a bank status is otherwise papered over by that re-run).
    - TEST 95 injects the user's next keystroke at every await boundary of
      saveToCloud and loadFromCloud. The failure mode there is not a bad push,
      it is the edit being destroyed in memory and on disk by the merged import.
    - TEST 96 pins the one rule five different readers have to agree on: which
      instance of a rolling allocation series is live (see below), including
      across a "this and future" split of the series (case d) and a period
      re-dated from the day detail, across its turnover (case e).
    - TEST 98 is a SOURCE sweep for two shapes that read as correct and are not:
      `parseDateString(a) <= parseDateString(b)` (a null coerces to 0, so the
      comparison is always true — this blanked the calendar once) and
      `a < b ? -1 : 1` (never returns 0, so equal keys each claim to be greater
      and the engine may order them either way).
    - TEST 126 pins the recurrence window (see DebtSnowballUI, rule (2)): for
      every recurrence shape × business-day adjustment it ends a series on
      each occurrence's landing date and deletes "all future" from it, and
      asserts expansion, cleanup and the delete agree on what is left. Extend
      it when a recurrence shape or business-day rule is added.
  Each was validated by reverting the fix it guards and watching it fail; keep
  doing that, or a sweep that cannot fail pins nothing.
  A test that builds a store must `cancelPendingSave()` on every store it
  touched before it ends. The debounced save is a 500ms timer, so it fires
  after the synchronous tests finish and lands inside the async sync tests,
  overwriting their localStorage; TEST 95 flaked on TEST 118's and TEST 121's
  leftovers, depending only on how long the tests in between took. Anything
  that depends on today's date should pin its clock the way TESTs 82 and
  118–123 do: TEST 82's setup failed on every run near month end.
- `node scripts/verify-walk-parity.js` — randomized cross-path invariants for the balance walk (~140k assertions; reproduce failures with `node scripts/verify-walk-parity.js <seed>`). Includes a source guard: calendar-ui must consume `CalculationService.walkDays` and never re-implement anchor math.

**Optional browser harnesses** (both puppeteer-gated, both exit 0 with a
"skipped" note when it is absent, neither is part of `npm test`):
- `npm run test:ui` (`scripts/verify-ui.js`) boots `index.html` in headless
  Chromium and drives the real UI, including the full PIN lifecycle
  (set → reload → unlock → change → unlock → disable), checking at each step
  that the stored blob is encrypted when it should be and that the data
  survives every re-key. Its last phase shuts the server down and reloads, so
  offline-first is actually exercised — puppeteer's `setOfflineMode` gates the
  page's requests but NOT the service worker's own fetches, so it would let the
  reload be served from the network and prove nothing.
- `npm run test:sync` (`scripts/verify-sync.js`) runs two isolated browser
  contexts (= two devices) against a fake Gist served by the harness, and pins
  push/pull, merge-not-clobber, deletion tombstones, convergence, and the
  concurrent-edit race (an edit typed during an in-flight push must survive
  it). Its race scenario asserts that the merge path actually ran — a stale
  ETag answering 304 would let it pass for the wrong reason.

Use the browser harnesses for anything that depends on real DOM semantics,
which the vm harnesses are structurally blind to: event phases, the modal
stack, focus. They exist because two Escape-ownership fixes read correctly and
passed both vm harnesses while still being wrong in a browser — they were
registered in the bubble phase, so the dialog on top had already popped itself
off `ModalManager`'s stack before the guard checked who owned Escape.
**Every document-level Escape handler must use the capture phase** for that
reason.

No linting exists beyond this.

## Build Number — MUST be updated before every commit and push

`js/build.js` exports a single constant, `window.APP_BUILD`, that is rendered at the bottom of the dropdown menu so the user can see which compiled version of the app is running.

**Workflow (LLMs included): immediately before staging a commit, overwrite `window.APP_BUILD` in `js/build.js` with the current local timestamp in the format `"YYYY-MM-DD HH:MM TZ"` (use the `date "+%Y-%m-%d %H:%M %Z"` shell command, or platform equivalent). Stage `js/build.js` along with the rest of the change and include it in the same commit that you push.**

This applies to every commit, even doc-only or CSS-only changes — the visible build line is the user's only signal that a deploy went through. Do not skip it; do not amend an existing commit just to avoid bumping it (create a new commit instead).

## Architecture

### Script Load Order (Critical - Sequential Dependencies)

Scripts must load in this order due to dependencies:
1. `utils.js` - Helpers, notifications, modals
2. `transaction-store.js` - Data store class (+ companions: `transaction-store-persistence.js`, `transaction-store-domains.js`, `transaction-store-allocations.js`)
3. `recurring-manager.js` - Recurrence expansion
4. `calculation-service.js` - Balance computations (owns the shared `walkDays` balance walk)
5. `transaction-ui.js` - Transaction forms (+ companions: `transaction-ui-forms.js`, `transaction-ui-daydetail.js`, `transaction-ui-edit.js`, `transaction-ui-add.js`)
6. `calendar-ui.js` - Calendar rendering
7. `search-ui.js` - Search & CSV export
8. `bank-reconcile.js` - Bank statement reconciliation
9. `debt-snowball.js` - Debt snowball modeling (+ companions: `debt-snowball-engine.js`, `debt-snowball-payments.js`, `debt-snowball-render.js`)
10. `cloud-sync.js` - GitHub Gist sync
11. `pin-protection.js` - PIN lock & encryption
12. `app.js` - Application orchestrator

**Prototype-companion pattern:** the three largest classes are split across
files with no build step. The class file declares the class; each companion
adds a cohesive method group via `Object.assign(ClassName.prototype, {...})`.
Companions MUST load after their class file and before `app.js`. When adding
or renaming a companion, update all four loaders: `index.html`,
`scripts/verify-logic.js`, `scripts/verify-walk-parity.js`, and the
`CORE_ASSETS` precache list in `sw.js`.

### Initialization Flow

```
DOMContentLoaded
  → PinProtection instantiation (check for PIN lock)
  → PinProtection.promptUnlock()
  → CashflowApp instantiation (if unlocked)
  → CashflowApp.init() (load from cloud, render calendar)
```

### Core Components

**CashflowApp** (`app.js`) - Main orchestrator that wires all components, handles import/export, and manages UI updates.

**TransactionStore** (`transaction-store.js`) - Single source of truth for all data. Manages localStorage persistence, data migrations, and optional encryption. Key data structures:
- `transactions`: Map of date strings → transaction arrays
- `recurringTransactions`: Array of recurring transaction definitions
- `monthlyBalances`: Map of month strings → balance objects
- `skippedTransactions`: Map of date strings → recurring IDs (skip list)
- `movedTransactions`: Internal tracking for transaction repositioning
- `debts`, `cashInfusions`, `monthlyNotes`, `debtSnowballSettings`

Settled/unsettled support: `setTransactionSettled(date, index, isSettled)` toggles expense settlement status. `getUnsettledTransactions()` returns expenses marked `settled: false` that carry forward until resolved.

Money display has one absolute rule: **a zero never wears a minus sign.** The
walk rounds with `Math.round(x * 100) / 100`, and a day that lands exactly on
zero by subtraction usually gets there through a tiny negative float
(`0.01 + 0.06 - 0.07` is one), which rounds to `-0`. `toLocaleString` is the
only formatter that keeps that sign — `toFixed` and `String` both normalize —
and it is what `Utils.formatAmount` and the snowball hero's `formatWhole` use,
so both collapse `-0` explicitly. TEST 81 asserts the rule, not just that the
two harness stubs agree with the real Utils.

Money entering the store is normalized, never trusted: the domain collections go through `_normalizeDebt` / `_normalizeCashInfusion` (both built on `_finiteNumber`), and the three inputs the balance walk steps through — the transactions map, the recurring definitions, and the monthly anchors — are swept by `_repairWalkAmounts()` in both `loadData` and `importData`. That sweep is the only guard covering data that never passed a form: `"1e999"` is valid JSON that parses to `Infinity`, so an imported backup can otherwise put a non-finite amount straight into the walk. It rewrites non-finite values only, so finite money is never re-rounded. Use `Number.isFinite`, never bare `isNaN`, on any amount that gets persisted. A value the FORM rejects has to be rejected on every other path too: the snowball's `dailyFloor` was coerced with `_finiteNumber` in `loadData`, `importData` and `setDebtSnowballSettings`, none of which refused a negative — and a negative floor makes the projection schedule payoffs that drive the projected balance below zero. `_normalizeDailyFloor` is the single choke point now (TEST 97).

Shape is guarded per FIELD too, and that is the reader's job. Only money
(`_repairWalkAmounts`) and the domain collections (`_normalizeDebt` /
`_normalizeCashInfusion`) are coerced on the way in —
nothing else is, so **every surface that calls a string or number method on a
stored field must guard it with `typeof` first**. Three crashes came from one
that didn't: `_normalizeMerchant`'s `.replace` (bank reconciliation blamed a
perfectly good CSV), a `localeCompare` on `debt.name` and a `.trim()` in
`hasMonthlyNotes` (both took the CALENDAR RENDER down). `_normalizeDebt` now
coerces `name` like its siblings always have; TEST 93 sweeps every field in
every wrong shape across every headless surface.

Shape is guarded separately from value: `JSON.parse` accepting a stored blob is
not the same as the app being able to use it, so `loadData` runs every parsed
value through `_storedMap` / `_storedArray` / `_prunedEntries` and falls back to
the empty default for anything that isn't the declared shape (a `123` or `null`
under a map key used to surface as an uncaught throw at render time). The cloud
merge coerces the same way at the top of `_mergeData` — remote data is raw gist
JSON, and `x || []` only catches null/undefined. `saveData` returns `true` only
when the write actually landed; the PIN change flow relies on that to re-key the
data before committing a new hash.

**RecurringTransactionManager** (`recurring-manager.js`) - Expands recurring transactions into specific dates. Handles complex recurrence patterns: standard intervals, custom intervals, day-specific rules, business day adjustments, and variable amounts.

`lastDayOfMonth` must be EXPLICIT on every monthly series. An absent flag is
how `_migrateLegacyLastDayOfMonth` (run by both `loadData` and `importData`)
recognizes pre-flag legacy data, stamping `true` when the start is a month's
last day — so a new series written without the flag ran on the 30th until the
next reload and on the 31st after it. `TransactionStore._pinLastDayOfMonth`
writes `false` on add (and on an update that changes the start), covering every
writer (TEST 116). A "this and future" split on a month-end-CLAMPED occurrence
edits that occurrence in place and starts the new series at the next one
(never clamped: every month after a short month has 31 days); anchoring on the
clamped day turned a bill due the 29th into one due the 28th (TEST 115).

A "this and future" split moves every occurrence dated on/after its cutoff to
the new series id, so everything the OLD id recorded about those occurrences
has to move with them — `_migrateOccurrenceState` does it for four kinds of
state: persisted rows (modified instances, id-bearing rows), skips (written as
skip EVENTS on both ids through `setTransactionSkipped`, never spliced, so the
cloud merge follows), move records (`rekeyMovedTransaction`) and moved copies
(`originalRecurringId`, selected by `movedFrom`). Left behind, a hand-edited
later occurrence was counted twice (it stayed on the old id while the new
series expanded the same occurrence), a skipped one came back, and a moved one
was paid on both dates. Migrated rows ADOPT the split's values field by field:
an `amount` / `type` / `description` still equal to the old definition's was
never hand-edited and takes the new value; one that differs is a hand edit and
is kept; a posted row (`getBankStatus` "cleared") keeps every field (TEST 128).
"Delete all future" removes the moved copies of the occurrences it deletes
(through `store.deleteTransaction`, so they are tombstoned and refund their
buckets) together with their move records (TEST 129).

A series-scope edit ("future" / "all") on a drawn recurring-allocation bucket
keeps the DEFINITION's amount unless the amount field was changed: the bucket's
`amount` is its remainder and the form is pre-filled with it, so a rename wrote
the remainder into the definition and shrank every later period
(`_seriesAmountForEdit`). "Edit all occurrences" also applies the edit to the
clicked row even when it is a modified instance (any bank stamp or settle makes
it one); other modified instances stay as history (TEST 130, and TEST 96 (d)
for the live bucket across a split).

**CalculationService** (`calculation-service.js`) - Computes daily running balances and monthly summaries with caching. `walkDays(start, end, opts)` is THE single day-by-day balance walk (anchor resets to entered − reserves, unsettled/allocation accumulators); every balance path — monthly balances, running balance, day breakdown, 30-day minimum, and both calendar loops — steps through it. Companion helpers: `getMonthSeed`, `getCellExpense`, `getCarriedUnsettledList`. Never re-implement the walk; the parity harness fails if calendar-ui forks it.

`getReservedTotalOnOrBefore` answers from a prefix-summed index built once per
cache generation, not a scan (the scan was anchors × dataset — quadratic in
history). **Any code that expands recurring months LAZILY while a cache
generation is live must call `invalidateReservedIndex()` right after**, because
expansion can materialize new allocation buckets and the index would otherwise
be short — the anchor then resets the balance too HIGH, silently. Two sites do
this today: `walkDays({ ensureRecurringExpansion: true })` and the snowball
projection's `getDayFlow`. `updateMonthlyBalances` does not need it (it expands
every month up front, before walking). TEST 78 pins both.

`updateMonthlyBalances` derives its month range from the transactions map's keys
**and every recurring definition's `startDate`** — both parsed through
`Utils.parseDateString`, skipping anything unreadable. Both halves are
load-bearing. A series can begin before the oldest row in the map, and its early
occurrences only exist once their month is expanded HERE; deriving the range
from keys alone left those months out of the chain until the user happened to
page back to one, which materialized them permanently and moved every later
balance (TEST 86). And a single unparseable KEY used to become an Invalid Date,
which every later `<`/`>` silently ignored, collapsing the whole table to one
`"NaN-NaN"` entry (TEST 84).

"Which instance of a rolling allocation series is LIVE?" is really two
questions, and conflating them is what went wrong twice. **Which period is
CURRENT is decided by the calendar advancing: the latest occurrence dated
on/before today, skipped or not. Whether that period HOLDS money is decided by
the skip: a skipped period set nothing aside, so it reserves nothing and offers
no draws — and it does not fall back to the period before it, which ended when
this occurrence arrived.** Six readers must apply both halves identically:
`getAllocations` (the drawable list), `_reservedTotalIndex` (what the anchors
hold back), `closeOutExpiredAllocations` and
`_collapseSupersededRollingAllocations` (the sweeps that retire old periods),
`addRecurringTransactionToDate` (which must not re-materialize a retired
period), and the Allocated modal's list.

The first version had the sweeps electing the latest occurrence and the readers
electing the latest UNSKIPPED one, so skipping this period made the sweeps
forfeit the previous bucket while `getAllocations` was still offering it for
draws — deleted and tombstoned on every device, its reserve released, its
drawers dangling. The fix moved everything to "latest unskipped", which agreed
but answered the wrong question: a skip then handed the role BACK to last
period's bucket, silently extending its reserve into a period the user had
explicitly declined, and skipping that one promoted the one before it, at full
definition amount, back to the start date. Hence the split above. Whatever was
already drawn from a retired bucket stays a real expense, exactly as on an
ordinary turnover. TEST 96.

A period re-dated from the day detail becomes a one-time copy, and a one-time
bucket with no close-out rolls forward forever — from the next turnover on, two
periods were reserved. So `saveEdit` pins the copy to its period: it becomes an
auto-close-out bucket whose `closeoutDate` is the day before the series' next
occurrence lands (`RecurringTransactionManager.nextOccurrenceAfter`, read from
the schedule through `expandIsolated`), and a move onto or past that next
occurrence — or past an ended series' `endDate` — is refused before anything
changes. The skipped original keeps marking the period as current and holds
nothing, so none of the six readers needs a special case. A series with no
next occurrence and no `endDate` (capped by `maxOccurrences`) keeps rolling, as
its last bucket already does. Known limitation: while a free-funds series'
period is moved, free funds reads 0 for that period (TESTs 96 (e), 132).

A series whose `endDate` is already past has **no live bucket at all** — every
occurrence it still owns is behind us, so nothing will ever arrive to supersede
the newest one and its reserve would be held forever. Two sites enforce that:
`addRecurringTransactionToDate` refuses to materialize such a period, and
`closeOutExpiredAllocations` forfeits the ones already stored. Both are needed,
and the guard is `endDate < today`, never "has an endDate" — ending a series
ahead of today must leave the current period live and drawable. This is what
"delete all future occurrences" walks into: it ends the series the day BEFORE
the deleted occurrence, which un-supersedes the previous period, and expansion
then rebuilt that period from the definition — so a bucket the user had already
spent down and watched close out came back at FULL price, drawable, listed in
the Allocated modal, reserving money against every balance. Deleting that one
walked the resurrection back another period. TEST 104.

An expense's draw is a LIST, not a link. `allocationDraws` holds one row per
bucket — `{ allocationId, amount, drawn, recurringId?, periodDate? }` — so one
$200 run can take $130 from Groceries and $70 from Household. Three things about
that shape are load-bearing:

- **`amount: null` means "the whole rest of the expense."** That is the
  pre-split shape, and it is why editing an expense's amount still flows
  straight through to its bucket (bank reconciliation's "fix amount" depends on
  it). The editor writes null when ONE row covers the whole expense and an
  explicit figure for every row of a real split.
  `_resolveAllocationDrawShares` is the single resolver — the debit, the demand
  history and the UI all read shares from it, so they cannot disagree.
- **The legacy fields are mirrors of the primary row, not a second source of
  truth.** `drawsFromAllocationId` / `drawAmount` / `drawsFromRecurringId` /
  `drawsFromPeriodDate` are still written so an older build (and any reader
  that just asks "which bucket is this billed against?") degrades to the main
  bucket rather than seeing no draw. `allocationDraws` wins whenever it is an
  array — **including an empty one**, which is how an explicit unlink is
  expressed; only a MISSING array falls back to the mirrors.
- **Demand for the floor suggester is each row's share, plus whatever the split
  left uncovered, booked on the LAST row.** With one row that is exactly the old
  rule (the whole expense counts, not the capped `drawn`) — the signal that a
  bucket is too small to cover its own spending. TESTs 99–101 cover the split
  end to end, including the editor's refusals in a real browser (`test:ui`).

Anything that copies a transaction to re-add it elsewhere (settle, move,
relocate on a bank-statement date fix, undo-delete) must call
`store.carryAllocationDraws(source, target)`. Deleting the original refunds
every bucket, so a copy that carries only the first row leaves the spend
standing while the other buckets are quietly credited back. It must also call
`store.carryBankStatus(source, target)` unless it deliberately sets the status
itself (the settle paths stamp "cleared"): a copy rebuilt without its
`bankStatus` falls back to `getBankStatus`'s defaults, so a Cleared recurring
bill came back "Not in bank" and a Not-in-bank purchase came back Pending on a
mere re-date (TESTs 94, 131). And when the copy is itself an allocation BUCKET,
it lands under a fresh id, so its drawers must be re-pointed at it with
`repointAllocationDraws` — a date move does that, and so does undo-delete, which
passes the deleted row's id to `_restoreDeletedTransaction` (TEST 133).

The expansion cache and the rolling-allocation collapse are coupled, in both
directions. A superseded bucket can only be collapsed once its SUPERSEDOR has
been materialized — which happens when a LATER month is expanded, after the
earlier month's cache entry was already captured with the bucket still in it. So
`_collapseSupersededRollingAllocations` drops the cache entry of every month it
took a row out of, AND `_applyCachedTransactions` re-runs the collapse whenever
replaying a cached month re-adds a live-eligible rolling bucket (gated on an
O(cached rows) check, so the full-dataset pass does not return to every render).
Without the first, the dead bucket came back on render 2 and stayed; without the
second, it came back on the first render after any path that replaces the
transactions map wholesale — i.e. after every auto-sync push, which imports the
merged copy. Either way its reserve was subtracted from every projected balance
with nothing on screen to explain it. TEST 87 pins both halves.

The sweeps in `updateUI` (`autoSettleExpiredRecurring`,
`closeOutExpiredAllocations`) run **again after `generateCalendar`**, and the
calendar re-renders only if that second pass changed something. Pure expansions
are never persisted, so on a cold start (or after a sync imports a merged copy)
the "later occurrence on/before today" both sweeps elect on usually does not
exist until the render expands its month. Without the second pass, a DRAWN
rolling bucket whose period turned over while the app was closed was reserved
alongside its supersedor for the whole first render. TEST 112. Relatedly,
`updateMonthlyBalances` derives its month range from rows that exist in their
own right, never from pure expansions — those are its own output, and counting
them grew the range (and the persisted `monthlyBalances`) by a month per render
(TEST 113).

"What should the bank show today?" is a separate question from every balance
above, which are projections and already count today's scheduled bills.
`CalculationService.getBankView(date)` answers it for the day-detail modal's
"In bank — posted / available / Not in bank yet" rows: the latest Ending
Balance plus every CLEARED row after it is posted, PENDING rows come off that
for available, and everything else is EXPECTED and itemized, so
`available + expectedNet` equals `balanceExcludingAllocations`. It answers only
in the open window (on/after the latest anchor on or before today, never after
today) and returns null otherwise. A row's status comes from one rule,
`TransactionStore.getBankStatus`: an explicit `bankStatus` ("cleared" /
"pending" / "expected") wins; otherwise an unsettled expense is pending, a
one-time row the user entered is cleared, and a recurring occurrence, a moved
copy of one, or a snowball payoff is expected. Statement reconcile
(`BankReconcileUI._stampBankStatuses`, called from `_run`) stamps every exact
match in the open window with the bank's side, and every in-window entry the
statement doesn't match at all "expected" (Not in bank), writing only when
something actually changes; a stamp that wrote re-runs the report once. Its
exact matching ranks an entry on/before the latest anchor LAST for a line
posted after it: that entry was absorbed by the anchor, so it is only a
fallback when nothing after the anchor fits (TEST 136). The
day-detail chip cycles the status by hand, and where it shows it REPLACES the
Mark Settled/Unsettled toggle. All of them go through
`setTransactionBankStatus`, which promotes a recurring occurrence to a
modified instance with an id, the same way settling does, AND keeps an
expense's `settled` in step: **only a cleared expense is settled** — Pending
(a hold) and Not in bank (nothing on the statement) both carry forward until
it clears. A cleared entry lives on the day it cleared, so reconcile never
clears an UNSETTLED expense in place: its "Cleared at bank — still unsettled"
Mark settled moves it to the posted date, and the carried-forward Settle moves
it to the viewed day, both as cleared. The add form's matching checkbox is
"Pending", default off (TESTs 123, 125).

**CalendarUI** (`calendar-ui.js`) - Renders monthly calendar grid with daily balances, month navigation, and highlighting (lowest balance, negative balance, minimum balance ranges). The per-day balance-variant figures ("Balance before holdbacks", "Balance excluding allocations") live in the day-detail modal via `CalculationService.getDayBalanceBreakdown`, not in the calendar cells.

**TransactionUI** (`transaction-ui.js`) - Add/edit transaction modals and recurrence form UI. Supports settle/unsettle toggling for one-time expenses and displays carried-forward unsettled transactions on today's date. The allocation-draw editor (`renderAllocationDrawEditor` / `collectAllocationDraws` in `transaction-ui-forms.js`) is shared by the add modal and the day-detail inline edit form; it enforces what the store can only clamp — one row per bucket, no row over what its bucket has available to this expense, no split totalling more than the expense.

**DebtSnowballUI** (`debt-snowball.js`) - Debt entry management, snowball payment generation, and plan timeline.

Three ordering rules the shared transactions map depends on. (1)
`ensureSnowballPaymentsForHorizon` sweeps orphaned minimums, THEN projects, THEN
tightens each minimum series' `endDate` to its projected payoff — so it must
sweep **again** after that tightening, or a due-date edit leaves phantom
minimums past the payoff for a whole render (TEST 82). (2) The recurrence window
is judged on two DIFFERENT dates, and `_outsideRecurrenceWindow` owns that
asymmetry: `startDate` against the SCHEDULED occurrence (`originalDate`), and
`endDate` against the LANDING date. Using one date for both made expansion and
cleanup fight forever over a business-day-adjusted final payment (TEST 83).
The landing rule holds on every side. **Every `endDate` writer produces a
landing date**: the payoff sync (`getMinimumPaymentPayoffDate` — the payoff
month's last landing occurrence, or the payoff month's LAST DAY when none lands
there, never next month's occurrence, which became a phantom full minimum after
the payoff), the already-paid bound (`getLatestPaidMinimumOccurrence` returns
the landing date; the scheduled date put a forward-adjusted clearing payment
outside its own window and flipped the debt paid/unpaid every render), and
"delete all future" / the split (the day before the occurrence's landing date).
**And every expansion gate honours it**: the loops and month gates step through
SCHEDULED dates, so each one that compares a scheduled date or a month start to
`endDate` allows `RecurringTransactionManager.END_GATE_SLACK_DAYS` (7) of slack
via `_endGate`, and only the post-adjustment `<= endDate` check on the landing
date decides. Without the slack, a final payment adjusted BACKWARD onto the end
date (due Sun Nov 1, "previous" → Fri Oct 30) was never generated. TESTs 126
(sweep) and 127.
(3) `ensureSnowballPaymentsForHorizon` iterates projection → `endDate` sync →
re-expand the window (from the month before it) → re-project until the end
dates are stable, at most three projections, and only then adjusts and
materializes each month. The projection expanded the horizon, and seeded its
starting snapshot, under the OLD end dates; a payoff that moved LATER found no
row in its new final month to trim, so `updateMonthlyBalances` expanded it at
the full minimum and the plan and the first render disagreed until a second
render (TEST 137). The loop runs only when a sync changed something. And the
horizon projection renders the plan list **only when auto-generate is on**:
with it off that projection is minimums-only, while the hero, the infusion list
and the plan list belong to `refresh()`'s advisory `includeExtra = true`
projection, which every path that changes the panel's inputs already calls. A
calendar render re-drawing the list put a minimums-only plan under the
snowball hero (TEST 138).

The projection must pay exactly the debt payments the calendar pays.
`getDayFlow` excludes only the rows the sim schedules itself — recurring
minimum instances (injected from each debt's template, **skip-aware**: the
throwaway template expansion never sees the real skip list) and snowball rows
while the sweep is on. Every OTHER debt-linked expense — a moved or
carried-forward-settled minimum's copy, a force-generated payoff with
auto-generate off — is a real payment: it leaves checking AND comes off the
debt. Getting this wrong moves the payoff, and the payoff drives the minimum
series' `endDate`, so the calendar then drops a real final payment or keeps
phantom ones after the debt is cleared. `adjustMinimumPaymentTransactions`
leaves skipped rows out of a month's total for the same reason (TEST 114).

A debt's minimum series must stay on the DEBT's schedule, because the
projection and the payoff `endDate` schedule minimums from
`buildDebtRecurringTransaction(debt)` while the calendar expands the stored
series. `reconcileMinimumSeriesSchedules` (run at the top of
`ensureSnowballPaymentsForHorizon`) repairs drift left by older builds: a
start-date-only difference is adopted INTO the debt (the series start never
moves — that would push paid history out of the cleanup window), anything
else is rewritten from the debt (TEST 122). "Last day of the month" is the
debt's explicit `dueLastDay`, decided in `saveDebt` from the due day the user
typed (31, or a day the first due month is too short for); `null` = saved
before the flag, which keeps the old start-date inference (TEST 121).

Payoff ORDER is one rule with one implementation: `makePayoffOrder()` (engine
companion) — a debt's optional `payoffPriority` (whole 1–99, lower first;
`null` = auto, ranked `UNRANKED_PAYOFF`), then smallest balance, then name,
then id. Five sites decide "which debt next" and all must sort with it: the
floor sweep, the monthly `targetDebtId`, the projection's untargeted-infusion
redistribution, `calculateInfusionAllocations`, and the snapshot's
`distributeAuto`; the plan list uses it as the fallback for debts that never
clear. The sweep is STRICT — if the head debt cannot be covered yet, nothing
behind it is paid, so surplus waits for the prioritized debt. A hand-rolled
smallest-first sort at any one site lets the calendar pay one debt while the
snapshot or infusion breakdown credits another (TEST 118 fails on each).
`_normalizePayoffPriority` coerces the field on the way in.

**CloudSync** (`cloud-sync.js`) - GitHub Gist integration with bi-directional sync and debounced saves. Also owns the GitHub token at rest: it encrypts/decrypts `github_token_encrypted` with an AES-GCM key derived from the plaintext `_device_id` (PinProtection is not involved in token storage).

An allocation bucket's `amount` is its REMAINDER, debited in place, while the
merge is last-write-wins per row — so a draw made on another device between
syncs would vanish from the bucket while its expense survived.
`_reconcileAllocationRemainders` re-derives every bucket after the per-row
merge (winning copy's amount + its own side's draws = the original; minus every
merged draw), collapses two devices' first-draw materializations of one
recurring period onto the smallest id (tombstoning the other), and re-points
draws at a vanished bucket through their series/period provenance (TEST 117).
When two devices over-draw a bucket between syncs, clamping it at 0 is not
enough: the overflow is trimmed off the drawers' `drawn`, newest draw first
(the one a single device would have capped), or a later refund credits the
bucket past what it ever held (TEST 135).

The same race exists for ordinary rows. Promoting a recurring occurrence to a
modified instance (bank chip, reconcile stamp, settle, autoSettle) MINTS an id,
so two devices promoting one occurrence left two rows and the bill paid twice.
`_collapseDuplicateOccurrences` runs right after the per-row merge, before the
remainder pass, and elects one keeper per `recurringId|originalDate||date` and
per moved copy (`originalRecurringId|movedFrom`) — newest `_lastModified`, ties
to the smallest id, so both merge directions agree — and tombstones the rest.
Buckets are left to the remainder pass's own collapse (TEST 134).

**PinProtection** (`pin-protection.js`) - PIN setup/verification, XOR encryption of the TransactionStore data (transactions, debts, etc.) keyed by the current PIN, and session inactivity monitoring (120s timeout). It does **not** read or write `github_token_encrypted` — that is CloudSync's, encrypted separately via `_device_id`.

`showUnlockDialog` drives the shared `#appModal` directly rather than through
`Utils.showModalDialog`, so it has to join that element's hand-off protocol:
it publishes its teardown as `Utils._activeModalClose` and resolves the
`PinProtection.UNLOCK_PREEMPTED` sentinel when a newer dialog takes the modal.
`promptUnlock` then waits for the modal to be free and re-prompts. Without it, a
dialog raised while the lock was up (an in-flight cloud push coming back 404)
stacked its listeners on the same buttons and, once answered, left the modal
CLOSED with no unlock prompt — the lock overlay with no way in short of a
reload. It must not PREEMPT what it finds, only publish: every path reaches it
with `#appModal` already free.

### Key Patterns

- **Callback Pattern**: TransactionStore triggers save callbacks → CloudSync schedules syncs → CalendarUI re-renders
- **Service Layer**: CalculationService and RecurringTransactionManager compute derived data consumed by UI classes
- **Modal Pattern**: Utils.showModalDialog handles all modal interactions with Promise-based async results

### PWA Shell

The app installs as a standalone PWA: `manifest.webmanifest` (+ `icons/`) and
the Apple meta tags in `index.html` give it a home-screen identity, and
`sw.js` is a network-first service worker (registered inline at the bottom of
`index.html`). Network-first means deploys are picked up immediately while
online and the cache only serves when offline — there is no cache version to
bump per deploy. `sw.js` precaches every script in `CORE_ASSETS`; keep that
list in sync with the `index.html` script tags. Only same-origin assets and
Google Fonts are intercepted — GitHub API sync traffic is never cached. Note:
on iOS a standalone home-screen app has its own localStorage container,
separate from Safari's; data moves between them via Gist sync, not
automatically.

### localStorage Keys

```
transactions, monthlyBalances, recurringTransactions, skippedTransactions,
debts, cashInfusions, debtSnowballSettings, monthlyNotes,
movedTransactions, deletedItems, pin_hash, github_token_encrypted, gist_id, auto_sync_enabled,
webauthn_credential_id, biometric_pin, _device_id, gist_etag,
local_last_sync, _backup_before_merge, calendar_view_mode
```

## Important Files

- `styles.css` - CSS variables for theming (primary, accent, error colors)
- `README.md` - Project documentation and feature overview
- `scripts/verify-logic.js` - Standalone logic verification utility (132 tests)
- `scripts/verify-walk-parity.js` - Randomized balance-walk parity harness + source guard
- `scripts/verify-ui.js` - Optional headless-Chromium UI harness (`npm run test:ui`)
- `scripts/verify-sync.js` - Optional two-device cloud-sync harness (`npm run test:sync`)
