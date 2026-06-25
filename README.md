# Cashflow Calendar

Cashflow Calendar is a single-page, offline-first cashflow planner that shows income and expenses on a monthly calendar with running balances.

## Purpose

Plan and monitor monthly cash movement and debts.

## Documentation status

Updated for appVersion 2.0.0 on 2026-06-24 (source of truth: `js/transaction-store.js`). The running build timestamp is shown at the bottom of the menu and lives in `js/build.js`.

## Features

- Monthly calendar with daily totals and a running balance. The lowest-balance day in the next 30 days is highlighted, the first day the balance drops to zero or below is flagged as a crisis day, and every negative/zero-balance day is shaded.
- One-off and recurring transactions (daily to yearly, twice-a-month, custom intervals, day-specific rules like "first Monday of the month", business-day adjustments, variable/escalating amounts, optional end date or max-occurrence limit).
- Recurring transaction occurrences can be rescheduled to a different date or skipped individually without affecting other occurrences. When editing a recurring transaction, choose to update only this occurrence, this and future occurrences, or all occurrences.
- Authorized recurring payments: a recurring occurrence that was settled a day or two after its scheduled date shows as "(Authorized)" (grayed, not struck through, no calendar star) rather than "(Skipped)", since the payment did happen and just cleared later. Genuine skips and backward moves are unchanged.
- Ending balances act as reconciliation anchors: an entered ending balance is shown as-is and is treated as authoritative cash on that day, reconciling unsettled expenses dated on or before it; only later unsettled items drag the running balance.
- Unsettled expense tracking: mark one-time or recurring expenses as unsettled; they carry forward to today's view until resolved. Dual balance display (with/without unsettled) is shown when unsettled expenses exist. Older unsettled recurring expenses are auto-settled when a later occurrence clears.
- Allocations (set-aside buckets): mark an expense "Allocate" to reserve money in a named bucket instead of spending it. Buckets roll forward to stay one day ahead of today while they hold a balance, regular one-time expenses can draw down from a bucket, and a bucket is cleared with "Close Out". The menu's "Allocated" view lists buckets soonest-first, and days holding an allocation get a light-purple highlight.
- Description autocomplete suggests previously used descriptions while typing (disabled for allocation buckets).
- Hidden transactions (e.g. debt-snowball generated) are shown with a visual distinction.
- Debt snowball planner (a full-page view): every debt pays only its minimum while you declare a **minimum daily cashflow floor**; whatever your projected daily checking balance carries above that floor — durably, so a payoff never drops a later day below it — is swept into a full debt payoff, smallest-balance first, on the exact day the cash is available (independent of the debt's due date). Freed-up minimums of paid-off debts raise that surplus naturally, so there is no separate set-aside fund. (This suits lenders that apply overpayments as pre-payments rather than to principal.) Includes a per-debt interest rate field, a configurable month to start applying the floor, one-time cash infusions, remaining-balance display on each day-view debt payment, and a "Convert to Debt" shortcut from any recurring expense.
- Search with advanced filters, sort by date/amount/description, pagination (50 results per page), and CSV export. A search box is also available inline in the top toolbar.
- Monthly summary shows the projected minimum balance for the next 30 days and a Notes link.
- Full data import and export (JSON), via "Save to Device" / "Load from Device".
- Optional PIN lock with FaceID/TouchID biometric unlock (120-second inactivity timeout) and GitHub Gist cloud sync with background change detection (handles truncated Gist files). Tapping the pending-sync hourglass forces an immediate cloud save.

## Top toolbar and menu

A toolbar across the top of the calendar holds a hamburger menu and an inline search box. The menu contains:

- **Recent Transactions** — quick list of recent entries; click one to open its day to edit or delete.
- **Allocated** — list of allocation buckets, soonest to farthest.
- **Debt Snowball** — opens the full-page debt planner.
- **Save to Device** / **Load from Device** — JSON export/import.
- **Save to Cloud** / **Load from Cloud** — GitHub Gist sync.
- **Set/Change PIN** and, on supported devices, a biometrics toggle.
- **Reset** — clear data.

The current build timestamp is shown at the bottom of the menu.

## Calendar star indicators

Color-coded stars (★) appear in the top-right corner of calendar days to indicate special states:

| Color | Meaning |
|-------|---------|
| Orange | Day has an explicit ending balance set (overrides calculated balance) |
| Purple | Day has moved transactions (a recurring occurrence rescheduled from or to this date); forward "authorized" moves are excluded |
| Teal/Green | Day has skipped recurring transactions (authorized-later occurrences are excluded) |

In addition, a day holding an allocation bucket gets a light-purple background highlight (not a star). A star also appears next to the "Notes" link in the monthly summary when notes exist for the current month.

## Quick start

1. Open `index.html` in a modern browser.
2. Optional: serve the folder with any static server for easier access.

## Data storage and privacy

- Local-first: data is stored in browser `localStorage`.
- If a PIN is set, stored data is encrypted with the current PIN. FaceID/TouchID can be used to unlock on supported devices.
- Optional cloud sync stores the same payload in a private GitHub Gist.
  - Requires a GitHub personal access token with `gist` scope and a Gist ID.
  - Token is encrypted and stored under `github_token_encrypted`; Gist ID under `gist_id`.

## Data format

The exported JSON schema includes: `transactions`, `monthlyBalances`, `recurringTransactions`, `skippedTransactions`, `movedTransactions`, `debts`, `cashInfusions`, `debtSnowballSettings`, `monthlyNotes`, `_deletedItems`, and metadata fields (`lastUpdated`, `lastExported`, `appVersion`). See `CLAUDE.md` for localStorage key details.

## Project structure

- `index.html` / `styles.css`: UI shell and styling.
- `js/build.js`: build timestamp shown in the menu.
- `js/app.js`: application wiring plus import and export handlers.
- `js/transaction-store.js`: persistence, migrations, allocations, and `appVersion`.
- `js/recurring-manager.js`: recurrence expansion rules.
- `js/calculation-service.js`: daily totals and monthly summaries.
- `js/calendar-ui.js`: calendar rendering, toolbar, and menu.
- `js/transaction-ui.js`: add and edit transaction modal plus recurrence UI.
- `js/search-ui.js`: search, filters, and CSV export.
- `js/cloud-sync.js`: Gist sync and credential handling.
- `js/debt-snowball.js`: debt snowball modeling.
- `js/pin-protection.js`: PIN locking and encryption.
- `js/utils.js`: date and ID helpers plus notifications.
- `scripts/verify-logic.js`: standalone logic verification utility.
