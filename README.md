# Cashflow Calendar

Cashflow Calendar is a single-page, offline-first cashflow planner that shows income and expenses on a monthly calendar with running balances.

## Purpose

Plan and monitor monthly cash movement and debts.

## Documentation status

Updated for appVersion 2.0.0 on 2026-02-18 (source of truth: `js/transaction-store.js`).

## Features

- Monthly calendar with daily totals and running balance; the lowest-balance day and first upcoming negative-balance day in the next 30 days are highlighted.
- One-off and recurring transactions (daily to yearly, semi-monthly, custom intervals, day-specific rules like "first Monday of the month", business-day adjustments, variable/escalating amounts, optional end date or max-occurrence limit).
- Recurring transaction occurrences can be rescheduled to a different date or skipped individually without affecting other occurrences. When editing a recurring transaction, choose to update only this occurrence, this and future occurrences, or all occurrences.
- Unsettled expense tracking: mark one-time or recurring expenses as unsettled; they carry forward to today's view until resolved. Dual balance display (with/without unsettled) shown on each day. Older unsettled recurring expenses are auto-settled when a later occurrence is detected.
- Hidden transactions (e.g. debt snowball generated) shown with visual distinction.
- Debt snowball planner with minimum-plus-extra payment scheduling, per-debt interest rate field, one-time cash infusions, and a "Convert to Debt" shortcut from any recurring expense.
- Search with advanced filters, sort by date/amount/description, pagination (50 results per page), and CSV export.
- Monthly summary shows projected minimum balance for the next 30 days.
- Full data import and export (JSON).
- Optional PIN lock with FaceID/TouchID biometric unlock (120-second inactivity timeout) and GitHub Gist cloud sync with background change detection (handles truncated Gist files).

## Calendar star indicators

Color-coded stars (★) appear in the top-right corner of calendar days to indicate special states:

| Color | Meaning |
|-------|---------|
| Orange | Day has an explicit ending balance set (overrides calculated balance) |
| Purple | Day has moved transactions (recurring transaction rescheduled from or to this date) |
| Teal/Green | Day has skipped recurring transactions |

A star also appears next to the "Notes" link in the monthly summary when notes exist for the current month.

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

The exported JSON schema includes: `transactions`, `monthlyBalances`, `recurringTransactions`, `skippedTransactions`, `movedTransactions`, `debts`, `cashInfusions`, `debtSnowballSettings`, `monthlyNotes`, `_deletedItems`, and metadata fields. See `CLAUDE.md` for localStorage key details.

## Project structure

- `index.html` / `styles.css`: UI shell and styling.
- `js/app.js`: application wiring plus import and export handlers.
- `js/transaction-store.js`: persistence, migrations, and `appVersion`.
- `js/recurring-manager.js`: recurrence expansion rules.
- `js/calculation-service.js`: daily totals and monthly summaries.
- `js/calendar-ui.js`: calendar rendering and toolbar.
- `js/transaction-ui.js`: add and edit transaction modal plus recurrence UI.
- `js/search-ui.js`: search, filters, and CSV export.
- `js/cloud-sync.js`: Gist sync and credential handling.
- `js/debt-snowball.js`: debt snowball modeling.
- `js/pin-protection.js`: PIN locking and encryption.
- `js/utils.js`: date and ID helpers plus notifications.
- `scripts/verify-logic.js`: standalone logic verification utility.
