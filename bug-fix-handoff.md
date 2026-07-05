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
- [x] /Users/andraejones/Documents/CashFlow/js/calendar-ui.js (987) — 2026-07-04, 0 fixed / 2 log-only

  Reviewed in full. Calendar rendering (grid + agenda views), the app menu,
  notes modal, biometrics toggle, and TWO independent balance walks: the 30-day
  minimum/lowest-balance HIGHLIGHT walk (lines 318-386) and the per-day RENDER
  walk (lines 392-529). Verified both mirror the authoritative CalculationService
  walks: the highlight walk is byte-parity with `calculateMinimum` (same seed —
  `monthlyBalances[todayMonthKey].startingBalance` == `summary.startingBalance`;
  same anchor reset + `getReservedTotalOnOrBefore` subtraction; today seeded as a
  candidate per the 342-352 comment), and this exact "walk matches Minimum without
  self-expanding" contract is locked by TEST 31 (updateMonthlyBalances at line 252
  pre-expands 6 months ahead, so the highlight walk's future-month
  calculateDailyTotals see expanded recurring). Render walk's reconciliation-anchor
  carry (lines 284-294, 429-432) + carriedForwardUnsettled (448-460) match
  CalculationService's getDayBalanceBreakdown (TEST 33). Agenda descriptions/
  carried-forward labels go through `Utils.escapeHtml`; grid template interpolates
  only numerics + internal labels (no XSS). Event delegation attached once in the
  constructor (no per-render leak); IntersectionObserver disconnected+recreated
  each render. Free-funds display gated correctly (TEST 34). Grid trailing-fill
  `42 - (firstDay+daysInMonth)` is always >=5 (max 6+31=37), no negative loop. All
  34 `scripts/verify-logic.js` tests pass. No confirmable HIGH/MEDIUM bugs.
  - LOW (log-only) `calendar-ui.js:508-512` (grid) / `:820-824` (agenda) —
    free-funds mode, current day: when `getFreeFundsAllocation()` returns null
    (bucket not yet materialized on/before today), the current day renders NO
    balance figure at all (empty string), rather than falling back to the running
    balance. Cosmetic gap in an edge case (free-funds designated but its recurring
    instance hasn't landed yet); documented design leans to showing the bucket
    remaining. Not fixed.
  - LOW (log-only) `calendar-ui.js:843-854` `_getDayIndicatorHtml` — indicator
    priority collapses ending-balance / move-anomaly / skipped to a single star
    (first match wins). A day that is an Ending Balance anchor AND also has a move
    anomaly or a skipped recurring shows only the ending-balance star, so the
    concurrent move/skip cue is hidden. All three use the same star glyph (differ by
    class/title), so it's a purely cosmetic tooltip/label loss. Intentional-looking
    priority; not fixed.
  - Verified NOT a bug: the agenda's `carriedUnsettled` LIST (direct filter of
    allUnsettled by `date < today && date > reconAnchor(today, inclusive)`, lines
    473-477) and the render walk's `carriedForwardUnsettled` AMOUNT (from the
    `runningUnsettledExpense` accumulator, 448-453) are two computations of the same
    carried-forward set; they reconcile because the accumulator's in-month anchor
    resets (line 429) + the prior-month carry seed (287-294, gated by
    `getReconciliationAnchor(monthStart, {inclusive:false})`) together floor the
    accumulator at the same anchor `reconAnchor(today, {inclusive:true})` uses.
- [x] /Users/andraejones/Documents/CashFlow/js/pin-protection.js (870) — 2026-07-04, 0 fixed / 2 log-only

  Reviewed in full. PIN lifecycle (SHA-256+salt secure hash + legacy-format
  detection/migration, constant-time compare), byte-level XOR encrypt/decrypt of
  the store payload (xor2: / legacy xor: / prefixless), WebAuthn register/auth,
  device-bound AES-GCM biometric-PIN storage (+ legacy-size migration), the
  same-method-re-unlock `promptUnlock` state machine, reset-with-DELETE, and the
  120s inactivity monitor (lock overlay, modal teardown). Verified the hash
  salt-roundtrip (stored `saltB64:hashB64`; verify re-derives salt via
  base64ToArrayBuffer → identical saltB64 → hash matches only on correct PIN), the
  XOR byte math (Uint8Array.map keeps 0-255, latin1 btoa/atob, TextEncoder pin
  bytes), and the decrypt→"" failure path is caught upstream by transaction-store's
  `_loadFailed` structured-empty gate (store.js:164-172). Cross-checked callers:
  encrypt/decrypt only via store load/save (gated on getCurrentPin), callbacks via
  app.js:94/106, promptUnlock via app.js:756. Duplicate startInactivityMonitoring
  calls are idempotent (same `boundResetTimer` ref → addEventListener dedup). All
  34 `scripts/verify-logic.js` tests pass. No confirmable HIGH/MEDIUM bugs.
  - LOW (log-only) `pin-protection.js:536-540` — after a biometric-originated
    unlock (`lastUnlockMethod==="biometric"`), an inactivity re-lock sets
    `requireBiometric` and, on every biometric failure/cancel, recurses
    `return this.promptUnlock()` with NO PIN fallback and NO reset button, so a user
    whose biometric hardware fails is stuck in a biometric-only prompt loop.
    Documented intentional (comment 536-537) AND self-escaping: `lastUnlockMethod`
    is in-memory only, so a page reload resets it to null → first-time
    "biometric-then-PIN" behavior. Session-scoped, not a permanent lockout. Not fixed.
  - LOW (log-only) `pin-protection.js:390` — `retrievePinForBiometrics` legacy
    detection uses a byte-length heuristic (`< SALT+IV+17 == 45`). A long-enough
    LEGACY biometric blob could exceed 45 bytes and be misread as modern AES-GCM →
    decrypt throws → returns null → graceful fall-through to the PIN dialog (no data
    loss, just the biometric convenience miss for that one legacy blob). Boundary is
    correct for the modern format (1-char PIN → exactly 45 → treated as modern).
    Legacy biometric format is pre-migration only. Not fixed.
- [x] /Users/andraejones/Documents/CashFlow/js/app.js (812) — 2026-07-04, 0 fixed / 3 log-only

  Reviewed in full. Orchestrator: wires all components, owns the shared
  `_syncPendingOrLoad` push-if-pending/pull sync entry point (startup init,
  PIN-unlock callback, foreground-resume), the operation-locked `safeCloudLoad`,
  the Recent/Allocated transaction list modals (DOM built via textContent — no
  XSS; user descriptions never innerHTML'd), free-funds star toggle, day-navigation
  from Recent/Reconcile, import/export/reset, and the visibilitychange/pagehide/
  pageshow/online/beforeunload lifecycle handlers. Verified `isLocked` exists and
  is maintained (pin-protection.js:6,781); `lockApp` does NOT wipe the in-memory
  store (just overlay + stopHeartbeat), so a hide-time push while locked pushes
  real data, not empty. `flushPendingSave` runs `saveData` → fires the callback
  that sets `_pendingCloudSave`, so `_syncPendingOrLoad` correctly detects a
  just-flushed edit and pushes (matches sync-lifecycle memory). All 34
  `scripts/verify-logic.js` tests pass. No confirmable HIGH/MEDIUM bugs.
  - LOW (info) `app.js:768` `flushAppOnHide` does NOT gate on
    `pinProtection.isLocked` (whereas `syncOnResume` at :135 does). Verified
    data-safe: lock leaves the in-memory store intact, and the handler returns
    early when `window.app` is undefined (locked-at-startup, app not yet created),
    so a locked hide-push always pushes real data. Asymmetry is intentional
    (hide must still flush pending local work). Not a bug.
  - LOW (info) `app.js:121` `_syncPendingOrLoad`'s `saveToCloud(quiet)` branch does
    not take `_operationLock` (only `safeCloudLoad` does). `saveToCloud` has its own
    `_isSyncing` mutex so concurrent pushes are guarded, but a store-mutating
    `updateUI` (autoSettle/closeOut/rollForward, triggered by a save callback) could
    in principle run during the async GET-merge-PATCH window. Pre-existing pattern,
    not shown reachable/harmful (updateUI is deferred under the lock elsewhere).
    Left as-is.
  - LOW (info) `app.js:636` `importData` calls `cancelPendingCloudSave()` up-front,
    before the async file-picker; if the user cancels the picker a queued cloud push
    is cancelled. Verified NOT data-loss: localStorage already holds the change, and
    `hasPendingCloudSave()` falls back to `_hasLocalChangesSinceSync` (cloud-sync.js:477),
    so resume/next-edit re-detects and re-pushes. `exportData` deliberately does NOT
    cancel (comment :600); import's upfront cancel is benign given the fallback. Left.
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
