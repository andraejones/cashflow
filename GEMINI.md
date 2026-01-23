# Cashflow Calendar - Gemini Context

## Project Overview
Cashflow Calendar is a single-page, offline-first personal finance application designed to help users plan and monitor monthly cash movement and debts. It provides a calendar view with daily running balances, debt snowball planning, and recurring transaction management.

## Tech Stack
*   **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3.
*   **Data Storage:** Browser `localStorage` (encrypted if PIN is set) and optional GitHub Gist synchronization.
*   **Build Tools:** None. The project runs directly in the browser.

## Key Files & Directories

### Root
*   `index.html`: The main entry point and UI shell. Contains the calendar grid, modals, and base layout.
*   `styles.css`: Global styles, CSS variables for theming (light/dark mode support implied by `CLAUDE.md` context or potential future feature, currently defines colors).
*   `CLAUDE.md`: Detailed developer guide and architecture documentation.
*   `README.md`: User-facing documentation and feature overview.

### Source Code (`js/`)
*   `app.js`: Main application orchestrator. Initializes components (`TransactionStore`, `CalendarUI`, etc.) and handles import/export logic.
*   `transaction-store.js`: **Single Source of Truth**. Manages data persistence in `localStorage`, data migrations, and encryption.
*   `calculation-service.js`: Computes daily running balances and monthly summaries.
*   `recurring-manager.js`: Handles logic for expanding recurring transactions into specific calendar dates.
*   `calendar-ui.js`: Renders the calendar grid and handles navigation.
*   `transaction-ui.js`: Manages add/edit transaction modals.
*   `search-ui.js`: Handles search functionality and CSV export.
*   `debt-snowball.js`: Logic and UI for debt planning and "snowball" payment calculation.
*   `cloud-sync.js`: Integration with GitHub Gists for cloud backup/sync.
*   `pin-protection.js`: Security module for PIN locking and data encryption.
*   `utils.js`: Shared helper functions, modal dialogs, and notifications.

## Architecture Highlights
*   **State Management:** `TransactionStore` holds the state. Components subscribe to updates or trigger refreshes via callbacks (e.g., `app.updateUI`).
*   **Initialization:** `DOMContentLoaded` -> `PinProtection` (unlock) -> `CashflowApp` init -> Cloud Load -> Render.
*   **Data Flow:** UI -> `TransactionUI`/`DebtSnowballUI` -> `TransactionStore` -> `CloudSync` (background) & `CalendarUI` (render).

## Development Workflow
1.  **Run:** Open `index.html` in any modern web browser. No server is strictly required, though a static server (e.g., `python -m http.server`, `live-server`) is recommended for better path handling.
2.  **Test:** Manual testing. There are no automated test scripts configured in a `package.json` (as none exists). `tests/` directory contains some performance/UI tests but they are likely manual HTML harnesses.
3.  **Dependencies:** Zero external runtime dependencies. All logic is contained within the `js/` directory.

## Common Tasks
*   **Reset Data:** `app.resetData()` in console or via UI.
*   **Export/Import:** managed via `app.js` methods, triggered from UI.
*   **Debug Cloud Sync:** Check `localStorage` keys `github_token_encrypted` and `gist_id`.
