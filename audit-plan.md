# CashFlow Bug-Hunt Audit Plan — 2026-07-01

One area per pass. Priority order: freshest code first (most recent commits = least soak time), then money-critical math, then infra.

## Areas (status: PENDING / IN PROGRESS / DONE / FIXED)

1. [IN PROGRESS] **Allocations: auto close-out + recurring buckets** — `closeOutExpiredAllocations()`, explicit close-out date (commit 556ae6e, newest), `ralloc:` synthetic ids, draw gating, rolling-week collapse
2. [PENDING] **Recurring expansion** — `recurring-manager.js`: lastDayOfMonth flag + migration (58a6bc4), custom monthly overflow fix (c7bdfb8), business-day adjust, variable amounts, semimonthly/biweekly
3. [PENDING] **Agenda view + CalendarUI** — `_buildAgendaRow`, is-empty dimming, shared walk flags, view-mode persistence, keyboard grid days (a2c1787), day-detail balance breakdown (cd1b1c2)
4. [PENDING] **Balance-walk parity** — CalculationService vs calendar-ui vs transaction-ui vs debt-snowball walks; reconciliation-anchor model; unsettled dual balance
5. [PENDING] **Debt snowball projection** — daily-floor lump-sum model, interest accrual in Remaining labels, payoff-date display, seq clearance order, horizon materialization
6. [PENDING] **Unsettled transactions + reconciliation anchor** — carry-forward to today, settle/unsettle toggling, dual balance on current day
7. [PENDING] **TransactionStore** — migrations, `_mergeById`, deletedItems tombstones, movedTransactions, settled persistence
8. [PENDING] **Cloud sync** — `_isSyncing`/`_operationLock`, `_syncPendingOrLoad` 4 entry points, etag handling, token AES-GCM via _device_id
9. [PENDING] **TransactionUI forms** — add/edit modals, cents-first mobile entry (f117642), move/skip, recurrence form, settle toggle
10. [PENDING] **Bank reconcile** — name-coherence ranking (8c7547e), pass structure, amount matching
11. [PENDING] **PIN protection + token crypto** — XOR data encryption, PIN change re-encryption, inactivity timeout, biometric path
12. [PENDING] **Utils + search/CSV + app.js** — date parse/format, escapeHtml coverage, modal promise flows, CSV escaping, import/export integrity

## Findings log

(append per pass: area, findings, fixes/commits)

### Area 1 — Allocations (partial, 2026-07-01)
Reviewed commit 556ae6e diff plus transaction-store.js allocation machinery: `getAllocations` draw
gating (incl. new closeoutDate window), `ralloc:` synthetic-id resolution, `_applyAllocationDraw` /
`_reverseAllocationDraw`, `rollForwardAllocations`, `closeOutExpiredAllocations`. No bugs found so
far; `closeoutDate` handling is consistent across store, edit form, move flow, and bank-reconcile
settle-move. Not yet checked: sweep interaction with movedTransactions; verify-logic.js scenarios.
