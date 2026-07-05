# Bug-fix loop handoff

One file reviewed per session, in the fixed order below. Sessions share NO context except this file — keep it complete and concise.

## Checklist

- [x] /Users/andraejones/Documents/CashFlow/js/debt-snowball.js (3538) — 2026-07-05, 1 fixed / 3 log-only

  Round-2 full re-read (round-1 findings preserved in
  `bug-fix-handoff.md.archived-20260705-070447`; its 2 debt-snowball LOWs still
  stand as log-only). Found one HIGH the first pass missed, in the alreadyPaid
  maintenance path. All 35 `scripts/verify-logic.js` tests pass (suite was 34;
  this session added TEST 35).
  - HIGH (FIXED) `debt-snowball.js:2046` (computeMinimumPaymentEndDate) +
    `:2130` (prunePaidOffDebtMinimumPayments) — a debt cleared by a real minimum
    payment earlier in the CURRENT month had that payment ERASED: alreadyPaid
    endDate retreated to the previous month's end (cleanup then swept the row as
    out-of-window) and prune deleted all current-month minimums for the debt,
    including past, already-made ones. Running balance jumped by the payment
    amount (real spending gone) and the state oscillated every render
    (paid/remaining 100/0 ↔ 0/100, endDate 05-31 ↔ 06-03) as re-expansion
    recreated the row. Reproduced standalone (frozen 2026-06-15, min due the
    3rd) before fixing. Fix: (a) new `getLatestPaidMinimumOccurrence(debt)` —
    alreadyPaid endDate is clamped to never precede the latest real (amount>0)
    materialized minimum occurrence already in the past; (b) prune skips
    dateKeys before the projection start (same historical-facts boundary rule
    adjustMinimumPaymentTransactions documents). TEST 35 locks both (payment
    survives 2 renders, endDate stable, snapshot + running balance stable).
    Deliberate side effect: past-dated leftover minimums of a long-paid debt
    are now KEPT (ledger says they happened; previously pruned) — conservative,
    consistent with the reconciliation-anchor model.
  - LOW (log-only) `debt-snowball.js:3395` — saveSnowballSettings validates the
    floor start month with `/^\d{4}-\d{2}$/` only, so "2026-13" passes and
    parseExtraStartMonthIndex maps it to -Infinity (= no restriction). Browser
    `type=month` input prevents it in practice. Not fixed.
  - LOW (log-only) `debt-snowball.js:1631,1697` — when no payoff is reachable
    (payments don't outrun interest), the daily walk iterates the full
    600-month horizon and getDayFlow lazily `applyRecurringTransactions()`s
    every one of those months on the REAL store, materializing decades of
    recurring instances into the persisted transactions map (localStorage
    bloat + slower walks). Pre-existing design (expansions are id-less and
    local-only, never synced); the "Not yet on track" hero renders fine. Left.
  - LOW (log-only) `debt-snowball.js:867` — deleteDebt removes the debt + its
    minimum recurring, but a `snowballForced` payoff row for that debt survives
    the auto-generate-off sweep by design (snowballForced keep rule) and is
    never reconciled once the debt is gone → stray "Snowball Payoff: X" expense
    persists. Only reachable via Generate-button + delete-debt with
    auto-generate off. Left.
- [x] /Users/andraejones/Documents/CashFlow/js/transaction-ui.js (2423) — 2026-07-05, 2 fixed / 3 log-only

  Round-2 full re-read (round-1 entry: 0 fixed / 2 log-only, its LOWs still
  stand). Verified the manual `firstInstance` placed at the form date is NOT a
  duplication hazard when the pattern would fire elsewhere — the next
  `applyRecurringTransactions` sweeps any non-modifiedInstance recurring row
  (tombstoning ids) before re-expanding. All 36 `scripts/verify-logic.js`
  tests pass (suite was 35; this session added TEST 36).
  - MEDIUM (FIXED) `transaction-ui.js:~2180` (addTransaction) — the
    advanced-recurrence number fields persisted unvalidated: (a) custom
    interval 0/empty (`parseInt` NaN) → `applyCustomRecurrence` skips the
    series, so the just-added entry is swept on the next render and silently
    VANISHES while its invisible definition persists forever; (b) variable
    percentage cleared → NaN → every expanded amount = `base + base*(NaN/100)*n`
    = NaN → "$NaN" rows and NaN running balances for the session (JSON turns it
    to null on reload, silently disabling the feature). Only this form could
    write either (debt-snowball + store migration guard with `|| 0`). Fix:
    validate both before persisting (interval must be an integer ≥ 1;
    percentage must parse finite) with error notifications, mirroring the
    form's other validations. TEST 36 locks it (rejects both, nothing
    persisted; valid custom series still saves + expands finite amounts).
  - LOW (FIXED) `transaction-ui.js:52` — the transactionType change handler
    cleared the description on EVERY non-balance change, so toggling
    expense↔income wiped a description the user had already typed. Now clears
    only the auto-filled "Ending Balance" label.
  - LOW (log-only) `transaction-ui.js:1483` — carried-forward Settle of a
    one-time that was itself previously moved from a recurring
    (movedFrom/originalRecurringId set) drops the move linkage: the settled
    copy loses the fields and the move record still points at the old toDate.
    Consequence is metadata-only (move records only drive the "(Authorized)"
    label + skip-star suppression via toDate > dateString, still correct; the
    "move back restores recurring" affordance is lost for that row). Left.
  - LOW (log-only) `transaction-ui.js:1326` — Close Out's fallback when
    `findTransactionById(txnId)` misses deletes whatever now sits at the
    captured positional index without verifying identity; reachable only if
    the row was removed by another path between render and click with no
    re-render. Same stale-fallback class as round-1's :1353 finding. Left.
  - LOW (log-only) `transaction-ui.js:~2415` — "End after N occurrences" with
    the count left empty stores `maxOccurrences: NaN` (→ null after
    save/reload), which the expansion treats as "no limit" — the series never
    ends despite the user picking a limit. Also: a date-change edit of a
    recurring occurrence ignores the Edit-scope select (always moves just that
    occurrence). Both judgment calls; left.
- [x] /Users/andraejones/Documents/CashFlow/js/transaction-store.js (1979) — 2026-07-05, 1 fixed / 3 log-only

  Round-2 full re-read (round-1 entry: 0 fixed / 3 log-only, its LOWs still
  stand). Focus areas: allocation lifecycle (draw/reverse, roll-forward,
  close-out sweep, free-funds), load/save integrity gate, tombstones, import.
  All 37 `scripts/verify-logic.js` tests pass (suite was 36; this session
  added TEST 37, proven to fail without the fix via stash/run/pop).
  - MEDIUM (FIXED) `transaction-store.js:882` (getAllocations) — a SKIPPED
    recurring allocation occurrence was still offered as the live bucket.
    Skipped instances stay materialized in the transactions map but are
    non-events in the balance walk (calculation-service excludes them), so the
    bucket held NO reserve — yet the draw dropdown sold it as "$X remaining"
    and, if it was the free-funds series, getFreeFundsAllocation showed the
    family an unbacked spendable figure (running balance sits $X higher than
    the model implies). One click reachable: the Skip button renders on every
    recurring row incl. allocation instances (transaction-ui.js:1004).
    getUnsettledTransactions already had the skip check; getAllocations didn't.
    Fix: skip-listed instances are never offered (same `skippedTransactions[
    date].includes(recurringId)` guard). Existing draws already linked to a
    bucket that later gets skipped are unaffected by design — the resolver is
    deliberately id-based/ungated and the edit form re-adds a linked bucket
    (documented gate model). Deliberate semantics choice: the close-out
    sweep's liveRollingDate still counts a skipped instance as superseding, so
    skipping a period means "no bucket this period", not "keep last period's
    bucket rolling" — matches the no-carryforward model. TEST 37 locks offer/
    free-funds hiding + restore-on-unskip.
  - LOW (log-only) `transaction-store.js:383-394` — loadData's catch resets
    transactions/balances/recurring/etc. but not monthlyNotes,
    movedTransactions, or _deletedItems, leaving partially-parsed stale state
    in memory after a mid-load throw. Harmless: `_loadFailed` blocks all
    saves, so it's display-only until reload. Left.
  - LOW (log-only) `transaction-store.js:925` — setFreeFundsAllocation doesn't
    validate the target series is `allocated === true`; a non-allocation id
    gets flagged (inert — getFreeFundsRecurringId filters on allocated — but
    the stray flag persists/syncs). Caller-gated today. Left.
  - LOW (log-only) `transaction-store.js:350` — loadData's minRecurringId
    cleanup only runs when BOTH debts and recurringTransactions are non-empty,
    so a legitimately-empty recurring list leaves stale `debt.minRecurringId`
    pointers (importData's equivalent at :1920 nulls them). Consumers
    find() → undefined, harmless. Left.
- [ ] /Users/andraejones/Documents/CashFlow/js/recurring-manager.js (1961)
- [ ] /Users/andraejones/Documents/CashFlow/js/bank-reconcile.js (1616)
- [ ] /Users/andraejones/Documents/CashFlow/js/cloud-sync.js (1547)
- [ ] /Users/andraejones/Documents/CashFlow/js/calendar-ui.js (987)
- [ ] /Users/andraejones/Documents/CashFlow/js/pin-protection.js (870)
- [ ] /Users/andraejones/Documents/CashFlow/js/app.js (812)
- [ ] /Users/andraejones/Documents/CashFlow/js/utils.js (756)
- [ ] /Users/andraejones/Documents/CashFlow/js/calculation-service.js (597)
- [ ] /Users/andraejones/Documents/CashFlow/js/search-ui.js (550)
- [ ] /Users/andraejones/Documents/CashFlow/js/build.js (4)

## Cross-file leads

- Round-1 (completed 2026-07-05) findings live in
  `bug-fix-handoff.md.archived-20260705-070447` — read your file's entry there
  before re-litigating; its "Verified not bugs" list still applies.
- scripts/verify-logic.js: session 1 (round 2) added TEST 35 (already-paid debt
  keeps its current-month clearing payment). Session 2 (round 2) added TEST 36
  (add-form advanced-recurrence validation), which loads `transaction-ui.js`
  into the harness for the first time behind a per-id DOM element stub — reuse
  that pattern if a later session needs to drive UI methods. Suite is now 36
  tests.
- utils.js `buildEndConditionOptions`: the maxOccurrences input can be left
  empty → transaction-ui stores NaN (treated as no-limit). If utils.js's
  session wants to fix it at the source (e.g. default value), coordinate with
  the log-only note under transaction-ui.js.
- scripts/verify-logic.js suite is now 37 tests (session 3 round 2 added TEST
  37: skipped allocation buckets hidden from draws + free-funds).
- transaction-store.js getAllocationFloorSuggestion still counts a skipped
  live instance as the live-period boundary (cutoff). Harmless once the
  getAllocations skip guard exists (no draws can be stamped to a skipped
  period), so left unchanged — noting in case calculation-service/search
  sessions see period-boundary oddities.

## Verified not bugs

- transaction-ui.js addTransaction's manual `firstInstance` at the form date is
  not a double-count even when the recurrence pattern/business-day adjustment
  would place the first occurrence elsewhere: `_clearRecurringExpansions`
  removes every non-modifiedInstance recurring row (tombstoning id-bearing
  ones) before each month's re-expansion, so the placeholder self-heals on the
  next render.
- transaction-ui.js carried-forward filter (`u.date < date`, `u.date >
  reconAnchor` with inclusive anchor) matches the reconciliation-anchor model:
  an Ending Balance on/before the viewed date absorbs everything dated
  on/before it.

- transaction-store.js getAllocations' recurring branch not gating on
  autoCloseout/closeoutDate (unlike the one-time branch) is documented design:
  recurring auto-close-out instances never carry closeoutDate and are
  effectively drawable only on their own date (allocation-draw-gate memory,
  user decision 2026-07-01).
- transaction-store.js updateTransaction's refund-then-redraw can grow a draw
  on an unrelated edit if the bucket was refilled in between — intended
  re-reconcile ("re-debit based on the merged amount/target" comment).
- debt-snowball.js targeted-infusion excess above the target debt's balance is
  DROPPED, not redistributed — but identically in all 3 sites that must stay
  aligned (projection walk :1827, snapshot :1381, allocation breakdown :3268),
  so it's a consistent product semantic (only a fully-cleared/unknown target
  redistributes), not a divergence bug.
