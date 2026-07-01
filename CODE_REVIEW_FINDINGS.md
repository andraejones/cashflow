# Code Review Findings — 2026-06-30

Full-codebase bug review (no fixes applied). Ranked roughly by severity within each section.

## Money-affecting bugs (high confidence)

### 1. Targeted cash infusions vanish if their target debt is already paid off
- **Files:** `js/debt-snowball.js:1334-1351` (`getHistoricalDebtSnapshot`) vs `js/debt-snowball.js:1801-1822` (`calculateSnowballProjection`)
- **Defect:** The live projection redistributes a targeted infusion to another debt when its target balance is already ≤0. The historical snapshot instead discards the infusion amount entirely (`return;` with no redistribution).
- **Failure scenario:** Debt A ($200 balance) is paid off by its minimum payment before a $500 infusion targeted at Debt A arrives. The live engine redirects the $500 to Debt B. Any historical snapshot/summary computed after that date (which seeds `baseSummaries(projectionStart)` for every forward projection) drops the $500 — Debt B's "Remaining" is permanently overstated by $500 relative to what the live engine actually did.
- **Confidence:** High.

### 2. Minimum-payment reconciliation assigns the real paid amount to the wrong date
- **File:** `js/debt-snowball.js:2214-2276`, loop at line 2241 (`adjustMinimumPaymentTransactions`)
- **Defect:** When a debt has 2+ minimum-payment occurrences in the same month, the reconciliation loop walks occurrences **latest-date-first** to decide which gets the real simulated payment amount — but the day-by-day simulation always pays the **earliest** date first and stops once the debt hits zero.
- **Failure scenario:** A bi-weekly debt with occurrences on the 5th and 19th actually pays off on the 5th for $150 (of a $200 templated amount). The reconciliation puts $150 on the **19th** (a date nothing actually happens on) and zeroes/hides the **5th** (the date the money was really applied) — corrupting the visible calendar and any balance display reading materialized transactions.
- **Confidence:** High.

### 3. "Balance without unsettled" double-counts allocated + unsettled expenses
- **Files:** `js/calendar-ui.js:386-394`; root cause in `js/calculation-service.js:306-324`
- **Defect:** `runningUnsettledExpense` and `runningAllocatedExpense` both accumulate the same expense amount when a transaction has `allocated: true` AND `settled: false`, but `runningBalance` only subtracts it once. The combined display formula (`runningBalance + runningUnsettledExpense + runningAllocatedExpense`) adds it back twice.
- **Failure scenario:** Starting balance $1,000, single expense of $200 dated today with `allocated: true, settled: false`, no other transactions. `runningBalance = 800`, but displayed "balance without unsettled" = `800 + 200 + 200 = 1200` instead of the correct $1,000.
- **Confidence:** High.

## Data-loss / staleness bugs

### 4. `loadFromCloud()` can silently overwrite an in-flight edit
- **File:** `js/cloud-sync.js` — `saveToCloud` (~1062-1233), `_hasLocalChangesSinceSync` (1427-1486), `loadFromCloud` (1238-1424)
- **Defect:** `saveToCloud` doesn't stamp `_lastSyncTime` until after multiple sequential network round-trips. An edit made mid-save gets a `_lastModified` earlier than the eventual `_lastSyncTime`, so it looks "already synced" even though it wasn't included in the payload already sent.
- **Failure scenario:** User edits a transaction while a save is mid-flight. If a manual "Load from Cloud" (or an "update available" banner click) fires before the auto-requeued debounced push runs (~10s later), `_hasLocalChangesSinceSync` reports no local changes, so the load does a one-way overwrite — permanently discarding the edit locally, and once the still-pending debounce fires with the now-overwritten data, on the remote copy too.
- **Confidence:** High.

### 5. Recurring transaction deletion doesn't record tombstones
- **Files:** `js/transaction-store.js:1120-1165` (`deleteRecurringTransaction`), `js/recurring-manager.js:1842-1900` (`deleteTransaction`, `deleteFuture` branch)
- **Defect:** Every other delete path in the store (`deleteTransaction`, `deleteDebt`, `deleteCashInfusion`, `closeOutExpiredAllocations`) pushes into `_deletedItems` for merge-conflict resolution. Deleting a recurring series (or "this and future") filters the array directly and never touches `_deletedItems.transactions`.
- **Failure scenario:** A future occurrence of a recurring bill is edited (gets `modifiedInstance: true` + a real synced `id`), then the whole series is deleted before that deletion itself syncs. A subsequent cloud merge that still sees the remote copy of the modified-instance row has no tombstone signal and can resurrect it.
- **Confidence:** High on the internal inconsistency; medium on the end-to-end sync-resurrection consequence (merge algorithm itself not fully traced).

### 6. Custom monthly recurrence on day 29-31 skips/duplicates occurrences
- **File:** `js/recurring-manager.js:1345-1361` (`getCustomIntervalDate`)
- **Defect:** Unlike `applyMonthlyRecurrence`/`applyQuarterlyRecurrence`/`applySemiAnnualRecurrence`/`applyYearlyRecurrence` (which all use `adjustDayForMonth` to clamp), the custom-interval path computes each occurrence independently from the original start date via raw `setMonth()` with no day-of-month clamping.
- **Failure scenario:** A "custom, every 1 month" recurrence starting 2026-01-31: occurrence index 1 (`setMonth(1)` on Jan 31) rolls into March 3, 2026 (Feb has 28 days) instead of clamping to Feb 28; occurrence index 2 independently computes March 31. Net effect: February gets no occurrence, March gets two.
- **Confidence:** High.

### 7. Self-healing a zeroed minimum-payment instance can make it disappear entirely
- **Files:** `js/debt-snowball.js:2229-2237` combined with `js/recurring-manager.js:331-343, 552-612`
- **Defect:** When a debt's required minimum rises back up, `adjustMinimumPaymentTransactions` clears `modifiedInstance`/`hidden` flags but never resets the amount and never calls `invalidateCache()`. The recurrence expansion cache is keyed only off recurring/skip-list data, so it can stay "valid" and serve a stale cached month snapshot that has no entry for the now-unflagged instance (because it was excluded from the cache when it was still flagged) — causing the transaction to vanish for that month instead of resetting to the scheduled amount.
- **Confidence:** Medium (mechanism verified in code; full multi-render interleaving not executed/reproduced).

## Security

### 8. PIN-based encryption is a repeating-key XOR (many-time pad)
- **File:** `js/pin-protection.js:185-221` (`encrypt`/`decrypt`)
- **Defect:** Used to protect the entire TransactionStore (transactions, debts, etc.). XORs plaintext bytes with the raw PIN bytes repeated cyclically — no IV/nonce, no authentication tag, same short numeric PIN reused as keystream for every save.
- **Impact:** An attacker with just the stored ciphertext (no PIN guessing needed) can XOR multiple ciphertexts together to cancel the repeating key and recover plaintext via crib-dragging, since the plaintext is predictable JSON. Also fully malleable (no integrity check) — undetectable bit-flipping tampering. Far weaker than the AES-GCM used elsewhere in the same codebase for tokens/biometric PIN storage.
- **Confidence:** High.

### 9. GitHub token's AES-GCM key is derivable from a plaintext localStorage value
- **File:** `js/cloud-sync.js:114-126` (`_getDeviceKey`)
- **Defect:** The AES-GCM key protecting `github_token_encrypted` is PBKDF2-derived from `_device_id`, which is itself stored in plaintext in the same localStorage. `js/pin-protection.js:320-329` already documents this exact weakness for the analogous biometric-PIN key, but the comment doesn't live at the token-storage site where the same flaw applies.
- **Impact:** Anyone who can read localStorage (XSS, malicious extension, device/backup access) can re-derive the exact decryption key and recover the GitHub token, granting full read/write on the user's private Gist (all synced financial data, plus tamper/delete capability).
- **Confidence:** High on mechanism; medium-high severity.

### 10. Legacy reversible formats for PIN hash / token never force-migrate
- **Files:** `js/cloud-sync.js:174-183` (`decryptValueAsync` legacy branch), `js/pin-protection.js:96-98` (`hashPinLegacy`)
- **Defect:** Values lacking the modern prefix/colon are decoded via plain `atob(...).split('').reverse().join('')` — not a hash or cipher, just reversed base64. Migration to the secure format only happens lazily on next successful verify/credential fetch.
- **Impact:** An install whose `pin_hash` or `github_token_encrypted` is still in legacy format keeps secrets in a form requiring no cryptographic effort to recover, indefinitely, until it happens to re-authenticate once.
- **Confidence:** Medium confidence, low-medium severity.

## Lower severity / narrower

- **`countOccurrencesBefore` off-by-one** — `js/recurring-manager.js:1573-1595`. Midnight-vs-noon `Date` comparison undercounts by 1 for monthly `daySpecific` recurrences, affecting `maxOccurrences` splits on "edit future." The sibling function three lines away in `applyDaySpecificMonthlyRecurrence` explicitly documents and avoids this exact issue; `countOccurrencesBefore` doesn't. Medium-high confidence, narrow blast radius.
- **Recurring cache-hit path skips rolling-allocation supersede collapse** — `js/recurring-manager.js:331-341` vs. line 526. `_collapseSupersededRollingAllocations()` only runs on a cache miss; a cache hit across a day boundary can redisplay/persist a rolling allocation instance that should now be superseded. Medium confidence.
- **Auto-infusion tie-break inconsistency** — historical snapshot breaks balance ties alphabetically by debt name; live projection relies on array insertion order with no explicit tie-break. Can pick a different debt when balances tie to the cent. Low confidence/severity.
- **Crisis/lowest-balance seed can read as $0 far from today** — `js/calendar-ui.js:253` reads `monthlyBalances[todayMonthKey]?.startingBalance || 0` directly instead of going through the self-healing `calculateMonthlySummary` path. If the viewed month is far enough from today that `updateMonthlyBalances`'s rebuilt range excludes today's month key, this silently defaults to 0. Currently masked by display-gating (`showMinimum`) so no observed user-facing effect today. Low confidence of real-world impact.
- **Bank reconcile: deposit could be misfiled as `-$0.00`** — `js/bank-reconcile.js:212-219`. `_parseMoney` returns `0` (not `null`) for a cell containing `"0.00"`; if a bank export ever fills the unused amount column with `"0.00"` instead of leaving it blank, a real deposit gets recorded as a `$0.00` expense instead. Medium confidence (depends on actual export format, unconfirmed).
- **Bank reconcile: window-clamp inconsistency** — `js/bank-reconcile.js:508-534`. `clearedUnsettled`/`pendingMatched` don't apply the same statement-window clamp that `appPendingAtBank`/`appOnlyExpected`/`appOnlyUnmatched` do, so tolerance-margin items can be misattributed to a statement window they aren't part of. Medium confidence.
- **`app.js` cancels pending cloud-save debounce before user confirms** — `js/app.js:595-680, 688-702` (`importData`, `resetData`). Cancels `cloudSync.cancelPendingCloudSave()` before the confirm dialog/file picker resolves. Mitigated: `hasPendingCloudSave()` falls back to a live comparison, so the next lifecycle trigger still detects and pushes the change — net effect is a delayed push, not real data loss. Low confidence/severity.

## Verified clean (no bugs found)

- CSV export escaping (`search-ui.js`) — quotes doubled, `\r\n` flattened, comma-containing fields quoted correctly.
- Date-string parsing — no raw `new Date(dateString)` bypassing `Utils.parseDateString`/`Utils.formatDateString` found in transaction-ui.js, search-ui.js, bank-reconcile.js, app.js, utils.js.
- Modal/listener lifecycle — singleton UI classes with one-time binding guards (`_closeBound`, `_escHandler`); no handler stacking on repeated opens.
- Bank-reconcile double-matching — all three matching passes check `.matched` before scanning and set it synchronously; no item matched twice.
- Settle/unsettle state transitions — `settled === false` convention applied consistently everywhere traced.
- Interest accrual double-counting — `getHistoricalDebtSnapshot` vs. live projection forward-interest reconciliation traced cleanly; no double-accrual or off-by-one day errors.
- Debt-payoff stops future minimum payments correctly once balance hits zero.
- AES-GCM usage (salt/IV generation) in cloud-sync.js and pin-protection.js — fresh random salt+IV per encryption, no reuse found.
- Sync mutex/requeue logic (`_isSyncing`, `_pendingSaveAfterSync`, `_pendingCloudSave`) — internally consistent; no path found where it drops a save outright (aside from finding #4 above, which is a gap specific to `loadFromCloud`).
- Heartbeat generation guard (`_heartbeatGen`) correctly bails out a superseded in-flight start.
