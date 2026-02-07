# Cashflow Calendar

Cashflow Calendar is a single-page, offline-first cashflow planner that shows income and expenses on a monthly calendar with running balances.

## Purpose

Plan and monitor monthly cash movement and debts.

## Documentation status

Updated for appVersion 2.0.0 on 2026-02-06 (source of truth: `js/transaction-store.js`).

## Features

- Monthly calendar with daily totals and running balance.
- One-off and recurring transactions (daily to yearly, custom intervals, business-day adjustments).
- Unsettled expense tracking for one-time expenses with dual balance display (with/without unsettled).
- Hidden transactions (e.g. debt snowball generated) shown with visual distinction.
- Debt snowball planner with minimum plus extra payment scheduling.
- Search with advanced filters and CSV export.
- Full data import and export (JSON).
- Optional PIN lock with FaceID/TouchID biometric unlock and GitHub Gist cloud sync.

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
