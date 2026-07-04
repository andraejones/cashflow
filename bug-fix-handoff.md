# Bug-fix loop handoff

One file reviewed per session, in the fixed order below. Sessions share NO context except this file — keep it complete and concise.

## Checklist

- [x] js/debt-snowball.js — 2026-07-03, 4 fixed / 3 log-only
  - Note: this session found an uncommitted WIP diff in this file (a prior session evidently died before verify/commit). The WIP was reviewed line-by-line, validated (TEST 24 fails without it), regression-tested, and shipped as part of this session's commit.
  - FIXED (MEDIUM) `cleanupOrphanedDebtMinimums` (~2145): duplicate-occurrence dedupe was per-date, so a schedule change (e.g. business-day adjustment edit) relocating an occurrence's landing date left a stranded `modifiedInstance` copy at the old date plus a fresh expansion at the new date — same occurrence, two dates, double-counted forever. Fix: elect ONE keeper per `recurringId|occurrence` across ALL dates, preferring a non-modified copy (it sits at the schedule's current date; the adjust pass re-applies reductions there), else the earliest; all other copies tombstoned. TEST 24.
  - FIXED (MEDIUM) `adjustMinimumPaymentTransactions` (~2257): reconciled the whole month against the walk's target, but the walk only schedules/pays occurrences from projection start (today+1) — a multi-occurrence month (semi-monthly/weekly) straddling today had its already-made early payment zeroed against a future-only target. Fix: instances dated < projection start are excluded (historical facts). TEST 25a.
  - FIXED (MEDIUM) same method (~2331): the target was allocated from the END of the month backwards, keeping a minimum dated AFTER the payoff day and zeroing the pre-payoff one. Fix: allocate chronologically (walk pays in date order until payoff, suppresses the rest). TEST 25b.
  - FIXED (MEDIUM) `syncSnowballTransactionsForMonth` (~2406): with auto-generate OFF, the next render's horizon sweep (includeExtra=false) silently deleted the row "Generate for Current Month" had just created. Fix: button-created rows are stamped `snowballForced: true` and kept by the off-sweep; they reconcile normally (match/re-date/delete) whenever includeExtra is true. Product choice: the forced row is user intent and is kept even though the auto-off projection doesn't model it (minimums dated after it are NOT suppressed while auto-generate stays off — accepted, self-corrects once the row's date passes into the historical snapshot). TEST 26.
  - LOG-ONLY (LOW) ~2313: the un-hide branch clears `modifiedInstance` on id-bearing rows without tombstoning; the next re-expansion's clear pass (recurring-manager) drops them untracked → remote merge resurrects a hidden $0 copy → the keeper election tombstones it a render later. Self-healing ping-pong, zero balance impact (amount 0, hidden). Real fix belongs in recurring-manager (see Cross-file leads).
  - LOG-ONLY (LOW) `computeMinimumPaymentEndDate` alreadyPaid branch (~2016) + `cleanupOrphanedDebtMinimums`: a debt whose CLEARING payment happened earlier in the current month goes `alreadyPaid` → endDate snaps to prev-month end → cleanup deletes the real clearing payment (it's past endDate) → snapshot un-pays the debt → instance regenerates → ~2-render oscillation until the month rolls over. Same family as the documented "payoff creep + flicker" quirk (memory: snowball-projection-start-monthend), which was deliberately left — locking past payoffs vs re-planning is an unresolved product call. Do not "fix" casually.
  - LOG-ONLY (INFO): `renderPlan` has an unused `settings` local (~2690). Same-day ordering differs between the projection walk (infusions before minimums) and the historical snapshot (transactions before infusions) — payoff-day attribution can differ by cents in clamped edge cases; display-only.
- [x] js/transaction-ui.js — 2026-07-03, 0 fixed / 3 log-only (INFO). Full read of all 2392 lines; suspicious spots verified against transaction-store.js + recurring-manager.js. No MEDIUM+ bugs.
  - VERIFIED-CLEAN (allocation draw provenance): edit-in-place changing the draw target leaves stale `existing.drawsFromRecurringId`/`drawsFromPeriodDate` on the merged object, but store `_applyAllocationDraw` (transaction-store.js ~1116) re-stamps them for a recurring target or deletes them for a non-recurring/dangling one — no stale provenance survives. Move branches carry provenance only when target unchanged; a changed target is re-stamped by the re-add. Correct.
  - VERIFIED-CLEAN (recurring add double-count): `addTransaction` adds a manual `firstInstance` (with recurringId) AND the definition; `addRecurringTransactionToDate` (recurring-manager.js ~1358) dedupes by `recurringId`+occurrenceKey so expansion never duplicates it.
  - VERIFIED-CLEAN (stale positional index): `saveEdit` is synchronous (no await between id-resolve and mutate); `deleteTransaction`/`toggleSettled`/close-out all re-resolve the live index by `id`. One-time txns get an `id` in `store.addTransaction`, so the id-based protection is real.
  - VERIFIED-CLEAN (innerHTML/XSS): every user string rendered via `createTextNode`/`textContent`; only numeric `toFixed` interpolation in `renderModalBalance`; `<option>.textContent` used for allocation labels.
  - LOG-ONLY (INFO) ~2134: `addTransaction` balance-dup guard tests `t.type === "balance"` without the `hidden !== true` filter used by `hasBalanceTransaction` (~779). Functionally equivalent today (balance txns are never hidden — only debt payments are). No fix.
  - LOG-ONLY (INFO) ~36: `_boundEscapeHandler` is added to `document` in the constructor and never removed (no destroy path). Single long-lived instance, negligible.
  - LOG-ONLY (INFO) ~1443-1449 + ~1862: `doSettle`'s recurring branch carries `drawsFromAllocationId`/provenance, but recurring instances can't draw (draw UI is one-time-only) so that carry is dead-but-harmless; likewise `saveEdit`'s recurring-move omits `closeoutDate` but the one-time default resolves to newDate, identical to what carrying would produce. Both intentional/inert.
- [x] js/recurring-manager.js — 2026-07-03, 1 fixed / 2 log-only. Full read of all 1952 lines.
  - FIXED (LOW→sync-correctness) clear passes in `applyRecurringTransactions` (~321) and `_applyCachedTransactions` (~549): both filtered out `recurringId && !modifiedInstance` rows to drop pure expansions, but an id-bearing row whose `modifiedInstance` flag was cleared elsewhere (debt-snowball un-hide branch, debt-snowball.js ~2317, keeps the synced `id`) was dropped WITHOUT a tombstone → CloudSync._mergeById resurrected the remote copy → sync ping-pong. Fix: extracted shared `_clearRecurringExpansions(transactions, dateString)` that calls `store.trackDeletedTransaction(t.id)` before dropping any id-bearing non-modified recurring row; id-less pure expansions are dropped untombstoned as before. Verified safe: the only producer of this anomaly is the snowball un-hide (re-hide gets a fresh id via markModified, so the tombstoned id is never reused); snowball payoff rows have no recurringId; all id-bearing minimum rows carry modifiedInstance. Closes the cross-file lead. TEST 27.
  - LOG-ONLY (INFO) `applyDaySpecificMonthlyRecurrence` (~935): `maxOccurrences` is gated on `monthsSinceStart`, which over-counts months where the Nth-weekday rule yields no occurrence (e.g. "5th Monday"); the sibling `countOccurrencesBefore` iterates months and counts real occurrences, so the two can disagree at the tail of a capped day-specific series. Pre-existing, narrow edge; not touched.
  - LOG-ONLY (INFO) `editTransaction` future-scope (~1800): `if (recurringTransaction)` is always truthy (already dereferenced above); dead guard, harmless.
  - VERIFIED-CLEAN (business-day cross-month): expansion checks month offsets [-1,0,1] only when businessDayAdjustment set; adjacent-month occurrences filtered back to the viewing month by filterYear/filterMonth. Correct.
  - VERIFIED-CLEAN (custom-interval infinite loop): non-positive/NaN customInterval guarded (~1264); month-stepped catch-up clamps month-end via getCustomIntervalDate. Correct.
- [ ] js/transaction-store.js (1716)
- [ ] js/bank-reconcile.js (1575)
- [ ] js/cloud-sync.js (1487)
- [ ] scripts/verify-logic.js (1173)
- [ ] js/calendar-ui.js (959)
- [ ] js/pin-protection.js (870)
- [ ] js/app.js (776)
- [ ] js/utils.js (756)
- [ ] js/calculation-service.js (597)
- [ ] js/search-ui.js (544)
- [ ] js/build.js (4)

## Cross-file leads

- **[RESOLVED 2026-07-03]** recurring-manager clear-pass tombstone lead — fixed via `_clearRecurringExpansions` (see recurring-manager.js checklist entry, TEST 27). The debt-snowball un-hide branch (debt-snowball.js ~2317) still clears `modifiedInstance` without tombstoning at the source, but the clear pass now catches its dropped id-bearing rows, so the ping-pong is closed. No further action needed unless a new anomaly producer appears.
- **js/transaction-store.js / js/cloud-sync.js**: new persisted transaction field `snowballForced` (boolean, on snowball rows created via the Generate button). It must survive save/load/merge like any other transaction field — verify no path strips unknown fields (JSON passthrough is assumed).
- Data contract relied on this session: occurrence identity for recurring instances is `recurringId|originalDate||placedDate` (recurring-manager keys modified instances the same way); `store.trackDeletedTransaction(id)` is a safe no-op for undefined ids.

## Verified not bugs

- debt-snowball keeper election can prefer a future non-modified copy over a PAST modified copy of the same occurrence, effectively re-dating a real payment — intentional: it only happens after the user edits the schedule, and the adjust pass re-applies reductions at the current date.
- `calculateInfusionAllocations` projection start-month math — already fixed previously (absolute month-index min), guarded by TEST 10.
- Eager ~600-month `projDays` array (~18k entries) in `calculateSnowballProjection` when debts never clear — bounded, by design (the "Not yet on track" case), acceptable perf.
- `while (true)` payoff sweep in the daily walk terminates: each iteration either breaks or zeroes a debt, strictly shrinking the active set.
- `ensureSnowballPaymentForMonth`'s save condition (`changed && !snowballAdded && !syncResult.changed`) looks odd but is right: sync saves for itself, addTransaction debounce-saves, this covers prune/adjust-only changes.
