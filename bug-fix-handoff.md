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
- [ ] /Users/andraejones/Documents/CashFlow/js/transaction-ui.js (2423)
- [ ] /Users/andraejones/Documents/CashFlow/js/transaction-store.js (1979)
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
  keeps its current-month clearing payment). Suite is now 35 tests.

## Verified not bugs

- debt-snowball.js targeted-infusion excess above the target debt's balance is
  DROPPED, not redistributed — but identically in all 3 sites that must stay
  aligned (projection walk :1827, snapshot :1381, allocation breakdown :3268),
  so it's a consistent product semantic (only a fully-cleared/unknown target
  redistributes), not a divergence bug.
