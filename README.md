# Cashflow Calendar

Cashflow Calendar is a single-page, offline-first cashflow planner that shows income and expenses on a monthly calendar with running balances.

## Purpose

Plan and monitor monthly cash movement and debts.

## Documentation status

Updated for appVersion 2.0.0 on 2026-01-09 (source of truth: `js/transaction-store.js`).

## Features

- Monthly calendar with daily totals and running balance.
- One-off and recurring transactions (daily to yearly, custom intervals, business-day adjustments).
- Debt snowball planner with minimum plus extra payment scheduling.
- Search with advanced filters and CSV export.
- Full data import and export (JSON).
- Optional PIN lock and GitHub Gist cloud sync.

## Quick start

1. Open `index.html` in a modern browser.
2. Optional: serve the folder with any static server for easier access.

## Data storage and privacy

- Local-first: data is stored in browser `localStorage`.
- If a PIN is set, stored data is encrypted with the current PIN.
- Optional cloud sync stores the same payload in a private GitHub Gist.
  - Requires a GitHub personal access token with `gist` scope and a Gist ID.
  - Token is encrypted and stored under `github_token_encrypted`; Gist ID under `gist_id`.

## Data format

The exported JSON schema is documented in `saveformat.md`.

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
