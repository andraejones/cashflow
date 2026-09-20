# Runtime debugging review

Reviewed the 32 repository-owned runtime files in descending **original byte
size**, using `4f5f7d4` as the baseline. Runtime membership comes from
`index.html`, the service worker's core assets, and the web manifest. `dev/`,
`node_modules/`, development scripts, and documentation are not runtime review
targets. Test harnesses were extended to verify the fixes. Optional external
Google Fonts are outside this repository review.

“Reviewed” means source inspection plus relevant automated coverage, not a
guarantee that every possible input or browser behavior is defect-free.

## File-by-file results

| Order | Original bytes | Runtime file | Result |
| ---: | ---: | --- | --- |
| 1 | 85,282 | `js/bank-reconcile.js` | Fixed impossible CSV dates, cleared additions using purchase instead of posted dates, and deleted-ID fallback to another matching purchase. |
| 2 | 76,558 | `js/recurring-manager.js` | Fixed invalid weekday rules hanging expansion and short-month semi-monthly payments disappearing; preserved occurrence limits across months of different lengths. |
| 3 | 68,394 | `styles.css` | Restored visible keyboard focus on agenda rows. |
| 4 | 64,022 | `js/cloud-sync.js` | Abort uploads when remote checks fail with HTTP errors; tolerate null merge entries. |
| 5 | 53,647 | `js/debt-snowball-engine.js` | Reviewed projections, recurrence flows, and balance-walk integration; no new confirmed defect. |
| 6 | 48,130 | `js/transaction-ui-daydetail.js` | Fixed stale close-out and settlement actions targeting the next row after deletion. |
| 7 | 44,071 | `js/calendar-ui.js` | Prevented imported transaction types from injecting agenda markup. |
| 8 | 41,259 | `js/debt-snowball.js` | Reviewed forms, lifecycle, and settings; no new confirmed defect. |
| 9 | 39,140 | `js/transaction-ui-forms.js` | Reviewed recurrence and allocation draw controls; no new confirmed defect. |
| 10 | 38,458 | `js/transaction-store-allocations.js` | Excluded expired recurring auto-close-out buckets from future-date draw choices. |
| 11 | 37,326 | `js/transaction-store-persistence.js` | Reviewed import, migration, save, and rollback paths; no new confirmed defect. |
| 12 | 35,056 | `js/calculation-service.js` | Fixed stale reserve-total memoization and monthly summaries computed before recurring expansion. |
| 13 | 34,843 | `js/pin-protection.js` | Enter on the unlock Reset button now activates that button, not PIN submission. |
| 14 | 34,777 | `js/app.js` | Reviewed startup and component orchestration; no new confirmed defect. |
| 15 | 28,603 | `js/utils.js` | Enter on prompt Cancel now cancels instead of submitting the input. |
| 16 | 28,591 | `js/debt-snowball-payments.js` | Reviewed payment generation and cleanup; no new confirmed defect. |
| 17 | 26,717 | `index.html` | Reviewed runtime wiring and modal markup; browser boot and script/precache consistency covered. |
| 18 | 21,870 | `js/debt-snowball-render.js` | Reviewed rendering and dynamic values; no new confirmed defect. |
| 19 | 20,723 | `js/search-ui.js` | Skip recurring definitions with unusable start dates instead of crashing results rendering. |
| 20 | 20,071 | `js/transaction-store-domains.js` | Reviewed domain normalization, CRUD, drafts, and notes; no new confirmed defect. |
| 21 | 16,970 | `js/transaction-ui-edit.js` | Stale identified edit forms cannot modify the next transaction. |
| 22 | 15,448 | `js/transaction-ui.js` | Stale delete confirmations cannot delete the next transaction; focus trapping excludes hidden/disabled controls. |
| 23 | 15,384 | `js/transaction-store.js` | Reviewed transaction CRUD, skip/settle state, and ID lookup; no new confirmed defect. |
| 24 | 14,784 | `icons/icon-512.png` | PNG format/dimensions checked; browser decoding checked. |
| 25 | 12,590 | `js/transaction-ui-add.js` | Reviewed validation, recurrence creation, and allocation input; no new confirmed defect. |
| 26 | 11,838 | `js/savings-goals.js` | Contributions use the latest goal state after the prompt, preserving updates received while it was open. |
| 27 | 7,869 | `js/what-if.js` | Reviewed draft, apply/discard, and banner flows; no new confirmed defect. |
| 28 | 7,040 | `icons/icon-192.png` | PNG format/dimensions checked; browser decoding checked. |
| 29 | 6,496 | `icons/icon-180.png` | PNG format/dimensions checked; browser decoding checked. |
| 30 | 3,231 | `sw.js` | Preserve unrelated origin caches; keep the worker alive until background cache writes finish without blocking network responses. |
| 31 | 571 | `manifest.webmanifest` | JSON parsed; referenced icon dimensions and runtime paths checked. |
| 32 | 268 | `js/build.js` | Build stamp loads. Left unchanged because no commit or deployment was requested. |

## Regression coverage and verification

- Logic tests 105–111 cover reconciliation dates/identity, malformed recurrence
  rules, short months and occurrence limits, failed remote checks, null merge
  rows, allocation expiry, reserve invalidation, monthly expansion, concurrent
  savings updates, and service-worker cache ownership/lifetime.
- Browser checks cover focus visibility/trapping, prompt keyboard behavior,
  stale close-out/settle/edit/delete actions, search malformed dates, and agenda
  markup safety.
- Existing browser coverage exercises responsive layouts, PIN lifecycle,
  offline boot, and two-device sync against a fake Gist. No real account data
  or remote Gist was modified by these tests.
- `npm test`: passed logic tests and 137,901 parity assertions (seed
  `1056109606`, 10 edge scenarios and 200 randomized scenarios).
- `npm run test:ui`: passed, including a reload with the server shut down.
- `npm run test:sync`: passed, including edits made during an in-flight push.
- All 26 runtime JavaScript files passed `node --check`; all three PNG icons
  decoded in Chromium; manifest dimensions matched; `git diff --check` passed.

Changes are local and uncommitted. No push or deployment was performed.
