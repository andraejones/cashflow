# Failed Tests Report

*Generated: January 18, 2026*

This document tracks all failing tests from the UI/UX and Performance test suites.

---

## Summary

| Test Suite | Passed | Failed | Total |
|------------|--------|--------|-------|
| UI/UX Tests (Issues 4-7) | 11 | 11 | 22 |
| Performance Tests (Issues 8-10) | — | 7 | — |
| **Total** | — | **18** | — |

---

## UI/UX Tests (`tests/ui-ux-tests.js`)

### Issue 4: Modal Z-Index Conflicts

| # | Test | Status | Details |
|---|------|--------|---------|
| 1 | ModalManager global object exists | ❌ FAIL | `undefined` |
| 2 | ModalManager.register() method exists | ❌ FAIL | ModalManager not found |
| 3 | ModalManager.unregister() method exists | ❌ FAIL | ModalManager not found |
| 4 | ModalManager.getNextZIndex() method exists | ❌ FAIL | ModalManager not found |
| 5 | Existing modals have appropriate base z-index in CSS | ✅ PASS | z-index: 1000 |

### Issue 5: Loading States for Async Operations

| # | Test | Status | Details |
|---|------|--------|---------|
| 6 | Utils.showLoadingOverlay() function exists | ❌ FAIL | `undefined` |
| 7 | Utils.hideLoadingOverlay() function exists | ❌ FAIL | `undefined` |
| 8 | CloudSync instance exists | ✅ PASS | — |
| 9 | Sync indicator element exists or can be created | ❌ FAIL | No sync-related elements found |

### Issue 6: Accessibility - ARIA Live Regions

| # | Test | Status | Details |
|---|------|--------|---------|
| 10 | At least one aria-live region exists | ✅ PASS | Found 5 regions |
| 11 | Dedicated aria-live announcement region exists | ✅ PASS | — |
| 12 | Utils.announce() function exists | ❌ FAIL | `undefined` |
| 13 | Search results region has aria-live | ✅ PASS | aria-live="polite" |
| 14 | Notifications are accessible to screen readers | ✅ PASS | Toast announced |
| 15 | Calendar days container has appropriate ARIA role | ✅ PASS | role="grid" |

### Issue 7: Color Contrast for Negative Balances

| # | Test | Status | Details |
|---|------|--------|---------|
| 16 | CSS variable for error/negative color is defined | ✅ PASS | #e4572e |
| 17 | CSS class for negative balance styling exists | ❌ FAIL | Missing `.negative-balance` or `.unallocated-negative` in stylesheets |
| 18 | Negative balance visual indicators (mock element) | ✅ PASS | Border: 1px, Background: rgba(180, 50, 30, 0.15) |
| 19 | Utility function for adding negative balance indicators | ❌ FAIL | `Utils.addNegativeIndicator` undefined |
| 20 | First-crisis class has distinct visual styling | ✅ PASS | Border: solid |
| 21 | Error/negative color is visually distinct | ✅ PASS | rgb(228, 87, 46) |
| 22 | Warning icons or indicators for negative balances | ❌ FAIL | No CSS pseudo-elements or inline icons |

---

## Performance Tests (`tests/performance-tests.js`)

### Issue 9: Recurring Transaction Caching

| # | Test | Status | Details |
|---|------|--------|---------|
| 1 | RecurringTransactionManager has cache lookup method | ❌ FAIL | `isCached`: undefined, `getCached`: undefined |
| 2 | RecurringTransactionManager has cache key generation method | ❌ FAIL | `getCacheKey`: undefined, `generateCacheKey`: undefined |

### Issue 10: Debounced Saves

| # | Test | Status | Details |
|---|------|--------|---------|
| 3 | TransactionStore has debounce delay property | ❌ FAIL | `debounceDelay`: false, `saveDelay`: false |
| 4 | Debounce delay is reasonable (100-2000ms) | ❌ FAIL | Debounce delay not found or not a number |
| 5 | TransactionStore has pending save indicator | ❌ FAIL | `pendingSave`: false, `saveTimer`: false |
| 6 | TransactionStore has flush/immediate save method | ❌ FAIL | `flushSave`: undefined, `saveImmediately`: undefined |
| 7 | TransactionStore has cancel pending save method | ❌ FAIL | `cancelPendingSave`: undefined, `cancelSave`: undefined |

---

## Required Implementations

To fix all failing tests, the following need to be implemented:

### In `js/utils.js`
- [ ] `ModalManager` object with `register()`, `unregister()`, `getNextZIndex()` methods
- [ ] `Utils.showLoadingOverlay(message)` function
- [ ] `Utils.hideLoadingOverlay()` function
- [ ] `Utils.announce(message)` function for screen readers
- [ ] `Utils.addNegativeIndicator()` or `Utils.formatBalanceWithIndicator()` function

### In `css/styles.css`
- [ ] `.negative-balance` or `.unallocated-negative` class definition
- [ ] Warning icon pseudo-elements (::before/::after) for negative balance indicators
- [ ] `.cloud-sync-indicator` or sync-related element styles

### In `js/recurring-manager.js`
- [ ] `isCached()` or `getCached()` method
- [ ] `getCacheKey()` or `generateCacheKey()` method

### In `js/transaction-store.js`
- [ ] `debounceDelay` or `saveDelay` property
- [ ] `pendingSave` or `saveTimer` property
- [ ] `flushSave()` or `saveImmediately()` method
- [ ] `cancelPendingSave()` or `cancelSave()` method

---

## Notes

- The **Implementation Status** in performance tests reports Issues 8-10 as "IMPLEMENTED", suggesting the core functionality exists but with different method names than the tests expect.
- Several tests pass for the underlying functionality (CSS styling works, ARIA regions exist, etc.) but the **public API methods** expected by tests are missing.
