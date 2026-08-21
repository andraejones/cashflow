# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CashFlow Calendar is an offline-first, single-page personal finance application built with vanilla JavaScript (ES6+). It runs directly in the browser with no build process - just open `index.html`. All data is stored in localStorage with optional GitHub Gist cloud sync and PIN-based encryption.

## Development Commands

**No build process required.** Open `index.html` directly in a browser or serve via any static server.

**Tests:** `npm test` (or run the two scripts directly with Node) — it must pass before every commit:
- `node scripts/verify-logic.js` — 97 numbered integration tests over vm-loaded sources
  (numbered up to TEST 98; the numbering has gaps where tests were merged).
  Four of them are SWEEPS rather than scenarios, and they are the ones worth
  extending when something new is added:
    - TEST 93 puts a wrong-typed value in every field the app reads, one field
      at a time, and walks every headless surface. Nothing coerces most stored
      fields on the way in from an import or a cloud merge, so each read surface
      has to guard itself — three separate crashes (two of which took the
      calendar render down) came from one that forgot.
    - TEST 94 drives every bank-reconcile action and asserts what it leaves
      behind for the OTHER components: allocation reserves conserved, persisted
      ids intact and unique, balances stable across a re-render and a reload.
    - TEST 95 injects the user's next keystroke at every await boundary of
      saveToCloud and loadFromCloud. The failure mode there is not a bad push,
      it is the edit being destroyed in memory and on disk by the merged import.
    - TEST 96 pins the one rule five different readers have to agree on: which
      instance of a rolling allocation series is live (see below).
    - TEST 98 is a SOURCE sweep for two shapes that read as correct and are not:
      `parseDateString(a) <= parseDateString(b)` (a null coerces to 0, so the
      comparison is always true — this blanked the calendar once) and
      `a < b ? -1 : 1` (never returns 0, so equal keys each claim to be greater
      and the engine may order them either way).
  Each was validated by reverting the fix it guards and watching it fail; keep
  doing that, or a sweep that cannot fail pins nothing.
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
10. `what-if.js` - What-if draft preview
11. `savings-goals.js` - Savings goals
12. `cloud-sync.js` - GitHub Gist sync
13. `pin-protection.js` - PIN lock & encryption
14. `app.js` - Application orchestrator

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

Money entering the store is normalized, never trusted: the domain collections go through `_normalizeDebt` / `_normalizeSavingsGoal` / `_normalizeCashInfusion` (all built on `_finiteNumber`), and the three inputs the balance walk steps through — the transactions map, the recurring definitions, and the monthly anchors — are swept by `_repairWalkAmounts()` in both `loadData` and `importData`. That sweep is the only guard covering data that never passed a form: `"1e999"` is valid JSON that parses to `Infinity`, so an imported backup can otherwise put a non-finite amount straight into the walk. It rewrites non-finite values only, so finite money is never re-rounded. Use `Number.isFinite`, never bare `isNaN`, on any amount that gets persisted. A value the FORM rejects has to be rejected on every other path too: the snowball's `dailyFloor` was coerced with `_finiteNumber` in `loadData`, `importData` and `setDebtSnowballSettings`, none of which refused a negative — and a negative floor makes the projection schedule payoffs that drive the projected balance below zero. `_normalizeDailyFloor` is the single choke point now (TEST 97).

Shape is guarded per FIELD too, and that is the reader's job. Only money
(`_repairWalkAmounts`) and the domain collections (`_normalizeDebt` /
`_normalizeSavingsGoal` / `_normalizeCashInfusion`) are coerced on the way in —
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

"Which instance of a rolling allocation series is LIVE?" is answered in five
places — `getAllocations` (the drawable list), `_reservedTotalIndex` (what the
anchors hold back), `closeOutExpiredAllocations` and
`_collapseSupersededRollingAllocations` (the two sweeps that retire old
periods), plus the Allocated modal's list — and **all five must apply the same
rule: the latest occurrence dated on/before today that is NOT skipped.** A
skipped period set nothing aside, so it holds no reserve and supersedes nothing.
The first two excluded skips and the rest did not, so skipping this period made
the sweeps treat the skipped date as live and FORFEIT the previous bucket: the
one `getAllocations` was still offering, with money already drawn from it. It
was deleted and tombstoned (so every device followed), its reserve was released
into every projected balance, and its drawers were left dangling. TEST 96.

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

**CalendarUI** (`calendar-ui.js`) - Renders monthly calendar grid with daily balances, month navigation, and highlighting (lowest balance, negative balance, minimum balance ranges). The per-day balance-variant figures ("Balance before holdbacks", "Balance excluding allocations") live in the day-detail modal via `CalculationService.getDayBalanceBreakdown`, not in the calendar cells.

**TransactionUI** (`transaction-ui.js`) - Add/edit transaction modals and recurrence form UI. Supports settle/unsettle toggling for one-time expenses and displays carried-forward unsettled transactions on today's date.

**DebtSnowballUI** (`debt-snowball.js`) - Debt entry management, snowball payment generation, and plan timeline.

Two ordering rules the shared transactions map depends on. (1)
`ensureSnowballPaymentsForHorizon` sweeps orphaned minimums, THEN projects, THEN
tightens each minimum series' `endDate` to its projected payoff — so it must
sweep **again** after that tightening, or a due-date edit leaves phantom
minimums past the payoff for a whole render (TEST 82). (2) The recurrence window
is judged on two DIFFERENT dates, and `_outsideRecurrenceWindow` owns that
asymmetry: `startDate` against the SCHEDULED occurrence (`originalDate`), and
`endDate` against the LANDING date — because that is what the expansion compares
and what `computeMinimumPaymentEndDate` writes. Using one date for both made
expansion and cleanup fight forever over a business-day-adjusted final payment
(TEST 83).

**WhatIfUI** (`what-if.js`) - What-if preview: draft transactions flagged `whatIf: true` ride in the in-memory transactions map so every balance walk sees them, but `_filterPersistedTransactions` keeps them out of localStorage/exports/sync. Banner above the calendar shows the 30-day-minimum swing with Apply/Discard. **Because drafts sit in the shared map, every new read surface must opt out or mark them** — search excludes them in `performSearch` (which also covers the CSV export, built from `searchResults`), bank reconciliation excludes them in `_buildAppItems` and `_appPayeeVocabulary` (a draft matched to a bank line hides a genuinely missing transaction, and Settle/Fix-date would persist the draft via `_relocateEntry`), the description autocomplete excludes them in `populateDescriptionSuggestions`, the agenda flags them 🔮, and the day-detail modal labels them. Surfaces that key off a field a draft never carries (`_lastModified` for Recent Transactions, `debtId`, `recurringId`, `type: "balance"`) opt out structurally. `getUnsettledTransactions` and the reserve index check `whatIf` explicitly instead: their structural argument rested on `WhatIfUI.addDraft` forcing `settled: true` and never setting `allocated` — a guarantee living two files away from the code depending on it.

**SavingsGoalsUI** (`savings-goals.js`) - Savings goals (`store.savingsGoals`, synced like cashInfusions). Feasibility line reuses the balance walk via `CalculationService.getMinimumBalanceThrough(targetDate)` minus the snowball daily floor.

**CloudSync** (`cloud-sync.js`) - GitHub Gist integration with bi-directional sync and debounced saves. Also owns the GitHub token at rest: it encrypts/decrypts `github_token_encrypted` with an AES-GCM key derived from the plaintext `_device_id` (PinProtection is not involved in token storage).

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
debts, cashInfusions, savingsGoals, debtSnowballSettings, monthlyNotes,
movedTransactions, deletedItems, pin_hash, github_token_encrypted, gist_id, auto_sync_enabled,
webauthn_credential_id, biometric_pin, _device_id, gist_etag,
local_last_sync, _backup_before_merge, calendar_view_mode
```

## Important Files

- `styles.css` - CSS variables for theming (primary, accent, error colors)
- `README.md` - Project documentation and feature overview
- `scripts/verify-logic.js` - Standalone logic verification utility (97 tests)
- `scripts/verify-walk-parity.js` - Randomized balance-walk parity harness + source guard
- `scripts/verify-ui.js` - Optional headless-Chromium UI harness (`npm run test:ui`)
- `scripts/verify-sync.js` - Optional two-device cloud-sync harness (`npm run test:sync`)
