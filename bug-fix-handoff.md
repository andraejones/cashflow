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
- [x] /Users/andraejones/Documents/CashFlow/js/recurring-manager.js (1961) — 2026-07-04, 0 fixed / 3 log-only

  Reviewed in full. Recurrence-expansion engine (once/daily/weekly/bi-weekly/
  monthly + day-specific/semi-monthly/quarterly/semi-annual/yearly/custom),
  business-day adjustment, US-banking-holiday table, variable amounts, the
  month-expansion cache, rolling-allocation supersede/collapse, and the
  edit/delete recurring paths. Verified DST-safe date stepping (noon anchors),
  maxOccurrences catch-up boundaries (0-based index → N materialized), custom-
  interval month clamping, tombstone-on-delete (_clearRecurringExpansions,
  deleteFuture), and the split-at-scheduled-date future-edit logic. All 34
  `scripts/verify-logic.js` tests pass. No confirmable HIGH/MEDIUM bugs.
  - LOW (log-only) `recurring-manager.js:1073-1103` vs `:1616-1618` — semi-monthly
    clamp asymmetry: `applySemiMonthlyRecurrence` uses raw `secondDate` in
    `new Date(year, month, secondDate)` (no month-length clamp except the
    `secondDate===31`/`semiMonthlyLastDay` special), so a second day of 29/30
    overflows Feb → the month-match filter (`getMonth()===filterMonth`) drops it →
    February silently loses its second-half occurrence AND the variable-amount
    index (via `countOccurrencesBefore`, which DOES clamp `Math.min(secondDay,
    lastDayThisMonth)`) diverges. Unreachable via UI: `buildSemiMonthlyOptions`
    (utils.js:497) only offers days 1–28 or "last day"; debt/store paths feed the
    same select and `transaction-store.js:111-114` maps `Number(day)||1`. Only
    imported JSON with `semiMonthlyDays[1]∈{29,30}` could hit it. Not fixed.
  - LOW (log-only) `recurring-manager.js:1804-1807` — future-scope edit: if
    `countOccurrencesBefore(scheduledStart) >= maxOccurrences`, the new series is
    created with NO `maxOccurrences` (→ unlimited). Unreachable: an occurrence
    already past the series' max wouldn't have been rendered/clickable. Not fixed.
  - LOW (log-only) `recurring-manager.js:944-948` (and the same pattern in the
    other month-stepped applies) — day-specific-monthly maxOccurrences gates on
    `monthsSinceStart` (calendar months) not actual materialized occurrences, so a
    rule like "5th Friday" that skips months without a 5th weekday would end one or
    more occurrences early/late. Rare (5th-weekday rules) + monthly cadence. Left.
- [x] /Users/andraejones/Documents/CashFlow/js/bank-reconcile.js (1616) — 2026-07-04, 0 fixed / 3 log-only

  Reviewed in full. Suncoast-CSV bank reconciliation: parse → 3-pass matcher
  (exact / near-amount / name-assisted) → 9 mutually-exclusive report buckets →
  Add/Settle/Move/Fix actions. Heavily hardened by prior feature sessions
  (name-coherence ranking, cross-attested payee-conflict block, share-transfer
  guard, provenance-preserving relocate, tombstone-safe delete+re-add). All 34
  `scripts/verify-logic.js` tests pass (TEST 29 pending-classification + the
  move-series test cover core paths). Additionally verified with a standalone
  harness (`/tmp/br_test.js`, `/tmp/br_run.js`, `/tmp/br_run2.js`):
  money/date/token parsing, and that the 9 report buckets classify without
  double-listing (clearedUnsettled vs dateDrifted vs reviewPairs vs
  appPendingAtBank are mutually exclusive; out-of-window app entries excluded;
  a pass-2/3 match sets `matched` but not `_match`, so it stays out of the
  `_match`-gated buckets — confirmed intentional & consistent). No confirmable
  HIGH/MEDIUM bugs.
  - LOW (log-only) `bank-reconcile.js:306-315` — `_toIsoDate` accepts any day
    1–31 regardless of month (e.g. "2/30/2026" → "2026-02-30"), which
    `Utils.parseDateString` then rolls forward to Mar 2, skewing the statement
    window / day-gaps. Unreachable in practice — bank CSV exports carry only
    valid calendar dates. Not fixed.
  - LOW (log-only) `bank-reconcile.js:1526-1540` — `_currentIndex` id-less
    fallback matches the FIRST entry by type+amount+description+recurringId; two
    identical one-time entries on the same date (same amount & description) could
    resolve a Settle/Move/Fix action to the wrong one. Effectively unreachable:
    `addTransaction` always assigns ids so the id path wins; only pre-id legacy
    or hand-crafted rows lack one. Same class as transaction-ui:1353 finding.
    Left as-is.
  - LOW (info) `bank-reconcile.js:240-244` — `_parseSuncoastCsv` returns a
    `window` field that `_run` never reads (it recomputes via `_statementWindow`
    from posted+txn ranges). Dead/duplicate output, harmless. Not fixed.
  - Verified NOT a bug: pass-2/3 near/name matches deliberately do NOT set
    `b._match`/`a._matchedBank` (only pass-1 exact does). All `_match`-gated
    buckets (clearedUnsettled, dateDrifted, pendingMatched) and the
    appPendingAtBank split therefore silently exclude near/name pairs — those
    surface only under "Needs review", which is correct because the amount
    differs (user fixes amount → re-run promotes to exact → then settleable).
- [x] /Users/andraejones/Documents/CashFlow/js/cloud-sync.js (1547) — 2026-07-04, 0 fixed / 3 log-only

  Reviewed in full. GitHub-Gist cloud sync: AES-GCM token encryption (+ legacy
  migration), credential prompt modal, debounced/lifecycle save scheduling,
  ETag-based heartbeat change detection, and the fetch-and-merge push / one-way
  load paths with the full `_mergeData` conflict-resolution suite (id merge,
  per-date + cross-date transaction dedup, skip-event LWW, moved-txn, monthly-note
  conflict markers, snowball-settings recency). Verified the concurrency model
  against memory (`_isSyncing` sync mutex, `_heartbeatGen` guard, `_replaceRemoteOnce`
  latch, `_pendingSaveAfterSync` re-queue), the null-ETag first-push merge (TEST 30),
  replaceRemote import overwrite (TEST 32), and that tombstone lists (incl. `skips`)
  are pruned to 30 days by `transaction-store._pruneDeletedItems` (no unbounded
  growth). All 34 `scripts/verify-logic.js` tests pass. No confirmable HIGH/MEDIUM bugs.
  - LOW (log-only) `cloud-sync.js:586-588` — `_mergeById` silently drops any item
    lacking an `id` from BOTH local and remote (remote add gated on `item.id`; local
    `if (!item.id) return`). Applies to recurringTransactions/debts/cashInfusions and
    per-date transactions via `_mergeTransactions`. By design (id-keyed merge), but an
    id-less legacy row would vanish on the first merge sync. Unreachable in practice:
    add* paths all assign ids via `Utils.generateUniqueId`. Same "pre-id legacy" class
    as prior sessions' findings. Not fixed.
  - LOW (log-only) `cloud-sync.js:1073-1090` — the new-gist creation branch (empty
    gistId after credential prompt) calls `store.exportData()` BEFORE the
    `flushPendingSave()` at line 1106, so a still-queued debounced local edit could be
    omitted from the initial gist snapshot. Self-heals on the next debounced save +
    subsequent merge. Not fixed.
  - LOW (info) `cloud-sync.js:1135` — `newETag` destructured from the step-1 merge
    fetch is never read (the ETag is refreshed via a fresh GET after the PATCH at
    line 1271). Dead variable, harmless. Not fixed.
  - Verified NOT a bug: `_hasLocalChangesSinceSync` returns false when never synced
    (`_lastSyncTime` null) → Load does a one-way pull that discards local-only data.
    Documented intentional (Load = "take cloud"; merge-and-protect is Save's job).
- [ ] /Users/andraejones/Documents/CashFlow/js/calendar-ui.js (987)
- [ ] /Users/andraejones/Documents/CashFlow/js/pin-protection.js (870)
- [ ] /Users/andraejones/Documents/CashFlow/js/app.js (812)
- [ ] /Users/andraejones/Documents/CashFlow/js/utils.js (756)
- [ ] /Users/andraejones/Documents/CashFlow/js/calculation-service.js (597)
- [ ] /Users/andraejones/Documents/CashFlow/js/search-ui.js (544)
- [ ] /Users/andraejones/Documents/CashFlow/js/build.js (4)

## Cross-file leads

## Verified not bugs

- recurring-manager.js semi-monthly second-day never overflows a month: UI
  (`Utils.buildSemiMonthlyOptions`) constrains the day picker to 1–28 or a "last
  day" flag; all producer paths (transaction-ui, debt-snowball, transaction-store
  migration) feed that select, so the unclamped `secondDate` in
  `applySemiMonthlyRecurrence` never exceeds 28 in practice.
- recurring-manager.js custom-recurrence catch-up loop cannot hang: `intervalStep`
  is validated `Number.isFinite && >= 1` (line 1272-1276) before any loop, and
  `getCustomIntervalDate` always advances by ≥1 step.
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
