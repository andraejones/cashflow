# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CashFlow Calendar is an offline-first, single-page personal finance application built with vanilla JavaScript (ES6+). It runs directly in the browser with no build process - just open `index.html`. All data is stored in localStorage with optional GitHub Gist cloud sync and PIN-based encryption.

## Development Commands

**No build process required.** Open `index.html` directly in a browser or serve via any static server.

No npm, linting, or test commands exist. Testing is manual.

## Build Number — MUST be updated before every commit and push

`js/build.js` exports a single constant, `window.APP_BUILD`, that is rendered at the bottom of the dropdown menu so the user can see which compiled version of the app is running.

**Workflow (LLMs included): immediately before staging a commit, overwrite `window.APP_BUILD` in `js/build.js` with the current local timestamp in the format `"YYYY-MM-DD HH:MM TZ"` (use the `date "+%Y-%m-%d %H:%M %Z"` shell command, or platform equivalent). Stage `js/build.js` along with the rest of the change and include it in the same commit that you push.**

This applies to every commit, even doc-only or CSS-only changes — the visible build line is the user's only signal that a deploy went through. Do not skip it; do not amend an existing commit just to avoid bumping it (create a new commit instead).

## Architecture

### Script Load Order (Critical - Sequential Dependencies)

Scripts must load in this order due to dependencies:
1. `utils.js` - Helpers, notifications, modals
2. `transaction-store.js` - Data persistence & migrations
3. `recurring-manager.js` - Recurrence expansion
4. `calculation-service.js` - Balance computations
5. `transaction-ui.js` - Transaction forms
6. `calendar-ui.js` - Calendar rendering
7. `search-ui.js` - Search & CSV export
8. `debt-snowball.js` - Debt snowball modeling
9. `cloud-sync.js` - GitHub Gist sync
10. `pin-protection.js` - PIN lock & encryption
11. `app.js` - Application orchestrator

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

**RecurringTransactionManager** (`recurring-manager.js`) - Expands recurring transactions into specific dates. Handles complex recurrence patterns: standard intervals, custom intervals, day-specific rules, business day adjustments, and variable amounts.

**CalculationService** (`calculation-service.js`) - Computes daily running balances and monthly summaries with caching.

**CalendarUI** (`calendar-ui.js`) - Renders monthly calendar grid with daily balances, month navigation, and highlighting (lowest balance, negative balance, minimum balance ranges). On the current day, displays a secondary "balance without unsettled" figure when unsettled expenses exist.

**TransactionUI** (`transaction-ui.js`) - Add/edit transaction modals and recurrence form UI. Supports settle/unsettle toggling for one-time expenses and displays carried-forward unsettled transactions on today's date.

**DebtSnowballUI** (`debt-snowball.js`) - Debt entry management, snowball payment generation, and plan timeline.

**CloudSync** (`cloud-sync.js`) - GitHub Gist integration with bi-directional sync and debounced saves. Also owns the GitHub token at rest: it encrypts/decrypts `github_token_encrypted` with an AES-GCM key derived from the plaintext `_device_id` (PinProtection is not involved in token storage).

**PinProtection** (`pin-protection.js`) - PIN setup/verification, XOR encryption of the TransactionStore data (transactions, debts, etc.) keyed by the current PIN, and session inactivity monitoring (120s timeout). It does **not** read or write `github_token_encrypted` — that is CloudSync's, encrypted separately via `_device_id`.

### Key Patterns

- **Callback Pattern**: TransactionStore triggers save callbacks → CloudSync schedules syncs → CalendarUI re-renders
- **Service Layer**: CalculationService and RecurringTransactionManager compute derived data consumed by UI classes
- **Modal Pattern**: Utils.showModalDialog handles all modal interactions with Promise-based async results

### localStorage Keys

```
transactions, monthlyBalances, recurringTransactions, skippedTransactions,
debts, cashInfusions, debtSnowballSettings, monthlyNotes, movedTransactions,
deletedItems, pin_hash, github_token_encrypted, gist_id, auto_sync_enabled,
webauthn_credential_id, biometric_pin, _device_id, gist_etag,
local_last_sync, _backup_before_merge
```

## Important Files

- `styles.css` - CSS variables for theming (primary, accent, error colors)
- `README.md` - Project documentation and feature overview
- `scripts/verify-logic.js` - Standalone logic verification utility
