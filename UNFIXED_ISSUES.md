# Unfixed Issues

This document tracks issues identified during the codebase review that require attention but were not fixed in the initial pass.

## Data Integrity Issues

### 1. Debt Projection Base Date Logic
**File:** `js/debt-snowball.js` (lines 1400-1401)
**Issue:** The logic for determining base year/month switches between view date and current date based on whether viewing past or future months. This can cause inconsistencies in debt projections.
```javascript
const baseYear = viewIndex <= currentIndex ? viewYear : currentYear;
const baseMonth = viewIndex <= currentIndex ? viewMonth : currentMonth;
```
**Recommendation:** Review and potentially simplify to always calculate from current month's actual balances, then adjust display logic accordingly. Needs comprehensive testing before changes.
**Priority:** MEDIUM

### 2. No Transaction ID Collision Handling
**File:** `js/transaction-store.js`
**Issue:** UUID generation could theoretically collide. No validation that generated IDs are unique.
**Recommendation:** Check for existing ID before assignment, or use timestamp + random combination.
**Priority:** LOW

### 3. Monthly Balance Calculation Drift
**File:** `js/calculation-service.js`
**Issue:** Floating-point arithmetic in balance calculations can accumulate small errors over many months.
**Recommendation:** Use integer cents internally, divide by 100 only for display.
**Priority:** MEDIUM

## UI/UX Issues

*Issues 4-7 have been fixed - see "Issues Fixed in This Session" section below.*

## Performance Issues

*Issues 8-10 have been fixed - see "Performance Issues Fixed (January 2026)" section below.*

## Code Quality Issues

### 11. Debt Snowball File Too Large
**File:** `js/debt-snowball.js` (~2700 lines)
**Issue:** Single file handles UI, calculations, projections, and charts. Difficult to maintain.
**Recommendation:** Split into separate modules: debt calculations, projection engine, UI components, chart rendering.
**Priority:** MEDIUM

### 12. Inconsistent Error Handling
**Files:** Various
**Issue:** Some functions use try/catch, others don't. Error messages are inconsistent.
**Recommendation:** Establish error handling patterns. Create error types for different failure modes.
**Priority:** LOW

### 13. No Input Sanitization for Descriptions
**File:** `js/transaction-ui.js`
**Issue:** Transaction descriptions are inserted into DOM without sanitization.
**Recommendation:** Use `textContent` instead of `innerHTML` or sanitize HTML entities.
**Priority:** MEDIUM

### 14. Magic Numbers in Calculations
**File:** `js/debt-snowball.js`, `js/calculation-service.js`
**Issue:** Numbers like 600 (max months), 30 (projection days) are hardcoded without explanation.
**Recommendation:** Define named constants with documentation.
**Priority:** LOW

## Testing Gaps

### 15. No Automated Tests
**Issue:** No unit tests, integration tests, or end-to-end tests exist.
**Recommendation:** Add Jest for unit tests, particularly for calculation-service.js and recurring-manager.js.
**Priority:** HIGH

### 16. No Data Migration Tests
**File:** `js/transaction-store.js`
**Issue:** Data migration logic (`migrateDataIfNeeded`) has no tests for version upgrades.
**Recommendation:** Create test fixtures for each data version and verify migrations.
**Priority:** MEDIUM

---

## Issues Fixed in This Session

The following issues were addressed:

1. ✅ Date handling consistency (UTC vs local) - Added noon time to `parseDateString`
2. ✅ Leap year handling - Added `isLeapYear` and `adjustDayForMonth` helpers
3. ✅ UI event listener cleanup - Added `destroy()` methods and event delegation
4. ✅ Focus trap for searchModal - Added focus trap setup
5. ✅ Race condition (cloud load + calculations) - Added operation locking
6. ✅ Month key inconsistency - Standardized to padded YYYY-MM format
7. ✅ Cache invalidation timing - Moved to start of `updateMonthlyBalances`
8. ✅ Semi-monthly occurrence counting - Rewrote counting logic
9. ✅ Variable amount calculation - Changed from compound to linear

### UI/UX Issues Fixed (January 2026)

10. ✅ **Issue 4: Modal Z-Index Conflicts** - Added `ModalManager` to `utils.js` that tracks open modals and assigns increasing z-indices. Updated `transaction-ui.js` to register/unregister modals when opened/closed.

11. ✅ **Issue 5: No Loading States for Async Operations** - Added loading overlay with spinner to `index.html`, CSS styles in `styles.css`, and `showLoading()`/`hideLoading()` helpers in `utils.js`. Updated `cloud-sync.js` to show loading overlay during save/load operations.

12. ✅ **Issue 6: Missing ARIA Live Regions** - Added `aria-live="polite"` to `#monthSummary` and `#modalTransactions`. Created dedicated `#ariaLiveRegion` for screen reader announcements. Added `announceToScreenReader()` helper to `Utils`. Updated notifications to also announce via ARIA live region.

13. ✅ **Issue 7: Color Contrast for Negative Balances** - Added `--error-color-contrast: #b4321e` (WCAG AA compliant darker red). Updated `.expense`, `.unallocated-negative`, and `.search-result-amount.expense` to use the higher-contrast color. Added warning icon indicator for negative balance days using CSS `::before` pseudo-element.

### Performance Issues Fixed (January 2026)

14. ✅ **Issue 8: No Pagination for Transaction Lists** - Pagination was already implemented in `search-ui.js`. Updated `resultsPerPage` from 20 to 50 results per page for better performance with large transaction histories. The pagination UI includes "Previous" and "Next" buttons with page info display.

15. ✅ **Issue 9: Recurring Transaction Expansion is Expensive** - Added caching system to `recurring-manager.js`:
    - Added `expansionCache` Map to store expanded transactions per month
    - Added `_generateRecurringHash()` to create a hash of recurring transaction data for cache invalidation
    - Added `invalidateCache()` method called when recurring transactions are added, edited, deleted, or skipped
    - Added `_isCacheValid()` to check if cache matches current recurring transaction state
    - Added `_applyCachedTransactions()` to quickly apply cached results on cache hit
    - Cache key format: "YYYY-MM" based on month being rendered

16. ✅ **Issue 10: Full Store Save on Every Change** - Added debounced saves to `transaction-store.js`:
    - Added `debouncedSave()` method with 500ms debounce delay
    - Added `flushPendingSave()` method for forcing immediate save when needed (e.g., app closing)
    - Updated `addTransaction()`, `updateTransaction()`, `deleteTransaction()`, `setTransactionSkipped()`, and `setMonthlyNotes()` to use debounced saves
    - Multiple rapid changes within 500ms are now batched into a single localStorage write

---

*Generated: January 2026*
