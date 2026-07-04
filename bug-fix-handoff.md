# Bug-fix loop handoff

One file reviewed per session, in the fixed order below. Sessions share NO context except this file — keep it complete and concise.

## Checklist

- [x] /Users/andraejones/Documents/CashFlow/js/debt-snowball.js (3538) — 2026-07-04, 0 fixed / 2 log-only

  Reviewed in full. Very heavily hardened by prior feature sessions; the 34-test
  `scripts/verify-logic.js` suite covers most snowball logic and passes clean.
  No confirmable HIGH/MEDIUM bugs found.
  - LOW (log-only) `debt-snowball.js:779` — `const dueDay = !isNaN(startDay) ? startDay : 1;`
    where `getDayFromDateString` (line 458) returns `null` on invalid input, and
    `isNaN(null) === false`, so a null would pass through as `dueDay` instead of
    falling back to 1. Unreachable in practice: `normalizedStartDate` is derived
    only from an already `isValidDateString`-validated input (line 754), so the
    getter never returns null here. Dead-defensive; not fixed.
  - LOW (log-only) auto-redistribution tiebreak inconsistency across the 3 sites
    memory says must stay aligned: `distributeAuto` in `getHistoricalDebtSnapshot`
    (line ~1332) breaks exactly-equal-balance ties by debt name, but the daily-walk
    infusion redistribution (line ~1846) and `calculateInfusionAllocations` auto
    branch (line ~3283) sort by balance only (no name tiebreak). Only diverges when
    two debts share an identical cent balance — rare once interest accrues. Left as-is.
- [x] /Users/andraejones/Documents/CashFlow/js/transaction-ui.js (2423) — 2026-07-04, 0 fixed / 2 log-only

  Reviewed in full. Heavily hardened by prior feature sessions (stale-index
  re-resolution by id in saveEdit/deleteTransaction/toggleSettled, tombstone-safe
  delete+re-add, allocation-draw provenance carried across moves). All 34
  `scripts/verify-logic.js` tests pass. No confirmable HIGH/MEDIUM bugs.
  - LOW (log-only) `transaction-ui.js:136` — `setupFocusTrap` Tab handler does
    `firstElement.focus()` / `lastElement.focus()` without a null guard; if a modal
    ever had zero focusable elements these would throw. Unreachable in practice —
    both trapped modals (transactionModal, searchModal) always contain a `.close`
    button. Not fixed.
  - LOW (log-only) `transaction-ui.js:1353`, `:1554`, `:2018` — settle-toggle,
    carried-forward one-time delete, and deleteTransaction's `liveIndexOf` fall back
    to the captured positional `index` when `t.id` is missing. New transactions all
    get ids via `Utils.generateUniqueId`/`addTransaction`, so a stale index would
    only bite pre-id legacy rows that were reordered between render and click —
    effectively unreachable. Left as-is.
  - Verified NOT a bug: edit-in-place (newDate===date) passes only
    `drawsFromAllocationId` to `editTransaction`, not the `drawsFromRecurringId`/
    `drawsFromPeriodDate` provenance stamps. The store re-stamps provenance in
    `updateTransaction`→`_applyAllocationDraw` (transaction-store.js:1186-1190) and
    clears it when the draw is unset (1278-1281). The delete+re-add MOVE branches
    carry provenance manually because they bypass that path; both routes are correct.
- [x] /Users/andraejones/Documents/CashFlow/js/transaction-store.js (1979) — 2026-07-04, 0 fixed / 3 log-only

  Reviewed in full. Single source of truth for all persisted data; heavily
  hardened by prior feature sessions (tombstones on every id-bearing delete,
  load-integrity `_loadFailed` gate, allocation draw/reverse cycle). All 34
  `scripts/verify-logic.js` tests pass. Verified the allocation draw/reverse/
  re-apply money math with a standalone harness (`/tmp/alloc_test.js`): overflow
  draw, edit-down, edit-up past bucket, and delete-refund all reconcile
  byte-exact (bucket 50→0→20→0→50). No confirmable HIGH/MEDIUM bugs.
  - LOW (log-only) `transaction-store.js:1403-1412` — `deleteRecurringTransaction`
    removes the series' entries from `skippedTransactions` but does NOT emit an
    unskip event into `_deletedItems.skips`. A stale skip on another device could
    survive the union merge, but it would reference an already-tombstoned
    recurring id, so it's inert. Not fixed (harmless).
  - LOW (log-only) `transaction-store.js:1000-1044`, `:966-998` —
    `_findAllocationEntryById` / `getAllocationInfoById` do not filter
    `hidden === true`, whereas `getAllocations` (draw offering) does. A draw could
    resolve display info against a hidden bucket. Unreachable in practice —
    allocation buckets are never hidden. Left as-is.
  - LOW (log-only) `transaction-store.js:64-70,530-534` — the `_saveInProgress` /
    `_queuedSave` re-entrancy guard is effectively dead: `saveData` is fully
    synchronous (localStorage is sync), so the debounce timer callback can never
    fire mid-save. Defensive, not a bug. Note `saveData` itself has no top-level
    re-entrancy guard, but no save callback calls it synchronously. Left as-is.
- [ ] /Users/andraejones/Documents/CashFlow/js/recurring-manager.js (1961)
- [ ] /Users/andraejones/Documents/CashFlow/js/bank-reconcile.js (1616)
- [ ] /Users/andraejones/Documents/CashFlow/js/cloud-sync.js (1547)
- [ ] /Users/andraejones/Documents/CashFlow/js/calendar-ui.js (987)
- [ ] /Users/andraejones/Documents/CashFlow/js/pin-protection.js (870)
- [ ] /Users/andraejones/Documents/CashFlow/js/app.js (812)
- [ ] /Users/andraejones/Documents/CashFlow/js/utils.js (756)
- [ ] /Users/andraejones/Documents/CashFlow/js/calculation-service.js (597)
- [ ] /Users/andraejones/Documents/CashFlow/js/search-ui.js (544)
- [ ] /Users/andraejones/Documents/CashFlow/js/build.js (4)

## Cross-file leads

## Verified not bugs

- debt-snowball.js projection minimums ignore user skips: `getRecurringOccurrencesForMonth`
  builds occurrences via a dummy store whose `isTransactionSkipped: () => false`, so a
  future skipped debt-minimum instance is still simulated as paid. BY DESIGN — the
  projection uses clean scheduled amounts independent of materialized/adjusted/skipped
  instances because the snowball engine adjusts those rows itself (comment ~1657). Past
  occurrences in `getHistoricalDebtSnapshot` do honor skips (line ~1242).
- debt-snowball.js snowball-added path relies on `addTransaction`'s `debouncedSave()`
  (transaction-store.js:1245) to persist tombstones tracked in the same sync pass, rather
  than an explicit `saveData(false)`. Confirmed `addTransaction` always debounced-saves,
  which persists `deletedItems`, so no tombstone is lost.
