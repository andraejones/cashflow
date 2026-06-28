# Code Review Findings

Multi-agent bug review of all 14 substantive source files (the 13 `js/` files,
`index.html`, and `scripts/verify-logic.js`). Each file was reviewed for bugs in
isolation, then cross-checked against the files it shares contracts with
(function calls, shared data structures, localStorage keys, DOM ids, the
balance-walk/interest-formula parity).

Review-only — no code was changed.

---

## 🔴 HIGH

### pin-protection.js:485-487, 516-518 — Biometric lockout with no recovery
After a biometric-unlocked session locks on inactivity, `requireBiometric`
forces a biometric-only path; on any failure it recurses to `promptUnlock()` and
never reaches `showUnlockDialog()` — the only path that exposes PIN entry **and**
the "Reset Application" button. If the platform authenticator becomes unavailable
(OS/permission/hardware change, browser revocation, or repeated cancels), the
user is permanently locked out of their encrypted data with no recovery path.
`isWebAuthnEnabled()` only checks `webAuthnEnabled && credentialId` and never
re-checks `webAuthnAvailable`, so `requireBiometric` stays true even after the
authenticator disappears.

**Fix:** fall through to `showUnlockDialog()` after a threshold of failures or on
error names like `NotAllowedError`/`InvalidStateError`, so PIN entry + reset stay
reachable.

---

## 🟠 MEDIUM

### transaction-ui.js:899 / 925 / 934 — Stale positional index in saveEdit / showEditForm / deleteTransaction
These act on a closure-captured positional `index` from render time. Background
`updateUI()` (close-out, roll-forward, re-expansion) can mutate
`transactions[date]` out from under the open modal, shifting every captured index
below a removed item. Result: **delete or edit the wrong transaction** (the store
only guards out-of-range, not wrong-but-valid). The neighboring settle / close-out
/ carried-forward handlers were already hardened against exactly this.

**Fix:** capture `t.id` in the render closure and re-resolve the live index via
`findIndex(x => x.id === txnId)` (or `store.findTransactionById`) at click time,
falling back to the captured index only if not found.

### transaction-ui.js:1114-1120 (one-time) / 1096-1104 (recurring) — Carried-forward "Settle" over-credits the allocation bucket
Settling a carried-forward unsettled expense deletes the original (which refunds
the linked allocation via `_reverseAllocationDraw`) and re-adds a fresh copy on
the viewed date **without** `drawsFromAllocationId`, so `addTransaction` never
re-draws. The bucket is credited back while the spend still stands. Inconsistent
with `bank-reconcile.js:949-951`, which correctly carries the link forward.

**Fix:** copy `drawsFromAllocationId` (drop the stale `drawAmount`) onto the moved
settled copy in both transaction-ui paths.

### pin-protection.js:768-801 — Inactivity lock orphans an in-flight modal promise + leaks listeners
`closeAllModals()` (called from `lockApp`) hides `appModal` via `display="none"`
without invoking the modal's internal `closeModal(result)`, so a `Promise` from an
in-flight `Utils.showModalPrompt`/`showModalDialog` is never resolved and its
listeners are never removed. If a lock fires while `promptChangePin`/
`enableBiometrics` is awaiting input, that `await` hangs forever and its handlers
stay attached to the shared `appModal`. `promptUnlock` then reuses the same modal —
clicking "Unlock" fires the stale handler too, resolving the abandoned change-PIN
prompt with **the PIN the user just typed to unlock** (input leak + reentrancy).
This is the concrete exploit of the `showModalDialog` reentrancy hazard noted
under utils.js.

**Fix:** resolve/cancel any pending dialog in `closeAllModals` (dispatch the cancel
path) instead of only hiding the element; or guard modal handlers with a
generation token.

### cloud-sync.js:809-814 / 740-744 (driven by :1046-1048) — debtSnowballSettings always loses remote edits on push-merge
In `saveToCloud`, `dataToSave.lastUpdated` is stamped to `new Date().toISOString()`
(now) **before** the merge, and that object is passed as `localData` to
`_mergeData`. `_mergeDebtSnowballSettings` picks the winner via
`localData.lastUpdated >= remoteData.lastUpdated`, so on every push-merge local
(now) always wins. A more-recent `dailyFloor`/`autoGenerate` change from another
device is silently discarded, then propagated back as the stale value. The
`loadFromCloud` merge path is fair (uses the genuine local save time), confirming
the push path is the buggy one.

**Fix:** pass the store's real (pre-stamp) `lastUpdated` into
`_mergeData`/`_mergeDebtSnowballSettings`, not the freshly-stamped value.

### debt-snowball.js:~2200-2231 — modifiedInstance set without id / _lastModified
The three branches of `adjustMinimumPaymentTransactions` that set
`transaction.modifiedInstance = true` operate on expanded recurring instances,
which carry only `recurringId` and no own `id`. The cloud merge `_mergeById`
(cloud-sync.js:565-595) skips any item without `id`, so a hidden/reduced minimum
is silently dropped on the next sync merge. The sibling methods
`setTransactionSettled` and `autoSettleExpiredRecurring` both assign
`id` + `_lastModified` when promoting an expansion; this is the one place that
omits it. Self-heals after re-expansion, but during the window the running balance
is wrong and a push writes bad state to the gist.

**Fix:** in each branch also set
`transaction.id = transaction.id || Utils.generateUniqueId()` and
`transaction._lastModified = new Date().toISOString()`.

### debt-snowball.js:2189-2195 — adjustMinimumPaymentTransactions can reduce but never restore a hidden minimum
The function only ever drives `currentTotal` down to `targetTotal`. Once a minimum
is hidden (`amount = 0, hidden = true, modifiedInstance = true`), `currentTotal`
is 0, so any later render where the target rises hits `0 <= targetTotal` and
returns early — the instance stays hidden forever (re-expansion preserves
`modifiedInstance` rows; `cleanupOrphanedDebtMinimums` won't remove an in-window
row). Strands when a debt's projected payoff moves later after minimums were
hidden (raise `dailyFloor`, delete an infusion, add a debt that reorders
clearance). The projection engine stays correct, so the materialized
calendar/balance diverges from the plan — a real minimum payment silently missing.

**Fix:** when `targetTotal > currentTotal`, clear `hidden`/`modifiedInstance` and
let re-expansion repopulate, then let `adjust` re-reduce only what's truly needed.

### recurring-manager.js:882-940 — Day-specific monthly materializes an occurrence before the start date
`applyDaySpecificMonthlyRecurrence` checks only the upper bound; there is no
per-occurrence `targetDate >= startDate` guard. For an "Nth weekday, monthly"
rule whose start date falls later in the month than that weekday (start = Jan 20,
rule = 1st Monday → Jan 5), it adds a phantom Jan 5 instance dated before the
recurrence began — it hits the running balance and inflates `maxOccurrences`. The
sibling `countOccurrencesBefore` correctly gates with `occDate >= startDate`.

**Fix:** after computing `targetDate`, return early when it precedes the start,
comparing by calendar date (`getNthDayOfMonth` returns local midnight,
`parseDateString` returns noon): `if (Utils.formatDateString(targetDate) <
Utils.formatDateString(startDate)) return;`.

### search-ui.js:355-356 — Recurring date-range filter uses startDate membership
A recurrence is open-ended but is filtered solely by its start date, so a
date-range search misses any recurring item that began before the window but still
occurs inside it (search June 2026 for monthly rent with `startDate=2025-01-01` →
dropped). Results then depend on calendar-navigation state. Recurring items are
represented in search almost entirely by their definition, so this is the
canonical path for them.

**Fix:** test overlap of `[startDate, endDate]` with the window — drop only when
`rt.startDate > dateTo`, or when `rt.endDate && rt.endDate < dateFrom`.

### app.js:569 — Manual Import silently becomes a cloud merge, not a restore
A successful `importData` schedules a debounced cloud save; `saveToCloud` merges
remote into local before pushing, keyed per-item by `_lastModified`. `importData`
preserves each item's existing `_lastModified`, so importing an older backup while
connected to a populated gist lets newer cloud items win — the restore is only
partial, post-backup remote edits survive, and items deleted after the backup can
reappear. The `cancelPendingCloudSave()` at app.js:546 runs before the file picker
opens, so it does nothing here.

**Fix:** for explicit import, suppress auto-sync and force an authoritative push
(bump all `_lastModified`, or push without the pre-merge), or warn the user that
import merges with the cloud copy.

---

## 🟡 LOW

### bank-reconcile.js:386 / 467 — Stale `b._match` across re-runs
The reset loop clears `b.matched` but not `b._match`. After an Add/Settle/Fix
mutation triggers a re-run, a bank row re-matched via the near-amount/name pass
keeps a `_match` pointing into the previous run's discarded `appItems` array. The
`clearedUnsettled` builder reads off that stale snapshot and can emit a spurious
"Cleared at bank — still unsettled / Mark settled" row; clicking it settles the
wrong/already-handled entry or errors.
**Fix:** also reset `b._match = null;` in the line-386 loop.

### transaction-store.js:150-334 — loadData can silently zero a key, then persist the loss
`PinProtection.decrypt` returns `""` on failure rather than throwing, and a
corrupt value that parses-then-throws hits the single outer `catch` (319) which
resets in-memory state to empty without re-throwing and without clearing
localStorage. The next `debouncedSave` overwrites good ciphertext with the empty
state — silent, unrecoverable. Narrow trigger (storage corruption or a
wrong-PIN-that-passed-hash) but total data loss.
**Fix:** track per-key load failure and refuse to overwrite keys that failed to
decrypt/parse (or snapshot raw values before reset).

### cloud-sync.js:438-443 — _pendingCloudSave left stale without credentials
When the debounced timer fires but `getCloudCredentialsAsync()` returns no
token/gistId, it returns without resetting `_pendingCloudSave = false`, so
`hasPendingCloudSave()` reports unpushed work forever on an un-credentialed device.
**Fix:** set `this._pendingCloudSave = false;` on that early return.

### cloud-sync.js:980-984 — Direct saveToCloud calls dropped silently mid-sync
`saveNowFromPending` and `flushAppOnHide` get an early return during an in-flight
sync (unlike `scheduleCloudSave`, which sets `_pendingSaveAfterSync`); that
trigger is lost and the push relies on resume/next-startup. Eventual consistency
holds, but a tap during sync is a silent no-op.

### cloud-sync.js:1052-1134 — No optimistic concurrency on the PATCH (TOCTOU)
The GET-merge-then-PATCH sequence sends no `If-Match`; a third device writing
between the merge GET and the PATCH is overwritten. GitHub Gist API limitation,
mitigated by heartbeat + merge-on-next-sync. Noted for completeness.

### app.js:291-298 / 449-456 + utils.js — Escape handlers ignore ModalManager.topModal()
The Recent and Allocated modals register document-level bubble-phase keydown
listeners that unconditionally close their own modal; both can be open at once, so
one Escape closes the background modal too. The `showModalDialog` Escape path
(utils.js:249-253) calls `preventDefault()` but not `stopPropagation()`, so Escape
bubbles to `document`. `bank-reconcile.js:93-102` has the correct capture-phase +
`topModal()` pattern.
**Fix:** gate each handler on `ModalManager.topModal() === modal` (and/or capture
phase).

### app.js:309-312 / 510 — Esc-handler listener leak + export cancels pending push
`_recentEscHandler`/`_allocatedEscHandler` are only removed in `hide*`, but
`pin-protection.js:774` (`closeAllModals`) and the import modal-sweep
(app.js:573-582) hide those modals without calling the hide methods, leaving
dangling listeners. Separately, `exportData()` (a read-only action) calls
`cancelPendingCloudSave()`, needlessly delaying a queued push.

### utils.js — Latent contract hazards
- `parseDateString` advertises a `null` return, but most callers immediately
  deref the result (`bank-reconcile.js:315-318/641-649`, many recurring-manager
  sites). A malformed/empty or ISO-datetime string (`"...T00:00"` → `null`) throws
  downstream. Most relevant for CSV-derived dates in bank-reconcile.
- `showModalDialog` reentrancy on the shared `#appModal` (utils.js:150-275) stacks
  duplicate listeners and can double-resolve if a second dialog opens before the
  first resolves. Root cause of the pin-protection MEDIUM. No current overlapping
  caller, but unguarded.

### search-ui.js:155 — CSV date format inconsistent with UI
Export emits `YYYY/MM/DD` while on-screen results render `MM/DD/YYYY`. Cosmetic /
ambiguous for US-locale spreadsheet import.

### pin-protection.js — At-rest crypto + timing
- `biometric_pin` is AES-GCM encrypted with a PBKDF2 key derived from
  `webauthn_credential_id`, which is stored plaintext in localStorage — anyone with
  localStorage read access can re-derive the key and recover the master PIN. Same
  structural shape as cloud-sync's token "encryption" keyed off plaintext
  `_device_id`. Obfuscation, not encryption — worth documenting.
- Non-constant-time PIN comparison (`computedHash === stored`, line 131).
  Negligible for a local-only app.

---

## ✅ Clean / no real bugs

- **index.html** — script load order correct (build.js first; bank-reconcile.js
  slotted before app.js; no async/defer breaking the sequential model); every
  JS-queried DOM id exists statically or is created at runtime; no duplicate/missing
  script tags; inline handlers resolve to real globals.
- **calendar-ui.js** — render walk verified in parity with all three
  calculation-service walk sites (anchor reset, carry-in, minimum/negative/lowest
  highlighting); month indexing consistent; no XSS vector (descriptions never reach
  calendar innerHTML; fallback uses `createTextNode`); event delegation wired once.
- **calculation-service.js** — all four balance-walks treat the Ending-Balance
  anchor identically; unsettled-set definition agrees across calendar carry,
  carried-forward filter, and per-day totals; no interest accrual here to diverge.
  Minor: dead `monthIncome`/`monthExpense` locals; far-future-month gross-total
  understatement edge (balances unaffected).
- **transaction-store.js** core — merge-by-id backfill, rolling-allocation
  cross-date dedup, persisted-item filter, and allocation reverse/redraw all
  verified correct. (The notable defects it surfaced live in transaction-ui.js,
  above.)
- **verify-logic.js** — executes real production code via
  `vm.runInThisContext` (not a transcribed copy), so there is no formula drift and
  all 13 tests pass against current source. Caveat: thin coverage of the
  balance-walk / reconciliation-anchor / unsettled-carry-forward paths — the most
  churned, must-stay-in-sync logic. A regression in three of the four balance-walk
  paths would not be caught.

---

## Cross-cutting notes

1. **Stale documentation.** The CLAUDE.md / architecture line *"PinProtection …
   encrypts github token"* is inaccurate — `github_token_encrypted` is owned solely
   by cloud-sync.js (AES-GCM via `_device_id`). pin-protection never reads or writes
   it. Worth correcting.

2. **Recurring root cause.** Several findings share one root: **id-less recurring
   expansions + stale positional indices** (transaction-ui index desync,
   debt-snowball modifiedInstance-without-id, the carried-forward allocation drop,
   and the merge layer). An id-based mutate/settle/find API on the store would retire
   a whole class of these.
