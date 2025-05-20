# Cashflow Calendar

Cashflow Calendar is a single page web app for planning and tracking your personal income and expenses. Each day on the calendar lists transactions and running balance so you can see how cashflow changes through the month.

## Usage

Open `index.html` in any modern browser. No build step is required – you can simply double click the file or serve the folder with a static file server if preferred.

## Cloud Sync (Optional)

Data is stored locally in your browser using `localStorage`. You can optionally sync to a private GitHub Gist. When enabling sync you will be asked for a GitHub personal access token (with the `gist` scope) and a Gist ID. The token is encrypted and saved in local storage under the key `github_token_encrypted`; the Gist ID is stored under `gist_id`.

## JavaScript Modules

- **`utils.js`** – helpers for IDs, date formatting and toast notifications.
- **`transaction-store.js`** – loads/saves transactions, monthly balances and recurring transactions in `localStorage`.
- **`recurring-manager.js`** – expands recurring transaction rules into individual calendar entries.
- **`calculation-service.js`** – calculates daily totals and monthly summaries.
- **`calendar-ui.js`** – renders the month view and handles month navigation.
- **`transaction-ui.js`** – modal interface for adding/editing transactions and recurrence.
- **`search-ui.js`** – search modal for filtering and exporting transactions.
- **`cloud-sync.js`** – manages syncing data to/from a GitHub Gist and storing credentials.
- **`app.js`** – wires everything together when the page loads.

