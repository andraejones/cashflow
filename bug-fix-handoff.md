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
