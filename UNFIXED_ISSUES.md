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

## Code Quality Issues

### 4. Debt Snowball File Too Large
**File:** `js/debt-snowball.js` (~2700 lines)
**Issue:** Single file handles UI, calculations, projections, and charts. Difficult to maintain.
**Recommendation:** Split into separate modules: debt calculations, projection engine, UI components, chart rendering.
**Priority:** MEDIUM

### 5. Inconsistent Error Handling
**Files:** Various
**Issue:** Some functions use try/catch, others don't. Error messages are inconsistent.
**Recommendation:** Establish error handling patterns. Create error types for different failure modes.
**Priority:** LOW

### 6. No Input Sanitization for Descriptions
**File:** `js/transaction-ui.js`
**Issue:** Transaction descriptions are inserted into DOM without sanitization.
**Recommendation:** Use `textContent` instead of `innerHTML` or sanitize HTML entities.
**Priority:** MEDIUM

### 7. Magic Numbers in Calculations
**File:** `js/debt-snowball.js`, `js/calculation-service.js`
**Issue:** Numbers like 600 (max months), 30 (projection days) are hardcoded without explanation.
**Recommendation:** Define named constants with documentation.
**Priority:** LOW

## Testing Gaps

### 8. No Automated Tests
**Issue:** No unit tests, integration tests, or end-to-end tests exist.
**Recommendation:** Add Jest for unit tests, particularly for calculation-service.js and recurring-manager.js.
**Priority:** HIGH

### 9. No Data Migration Tests
**File:** `js/transaction-store.js`
**Issue:** Data migration logic (`migrateDataIfNeeded`) has no tests for version upgrades.
**Recommendation:** Create test fixtures for each data version and verify migrations.
**Priority:** MEDIUM

---

*Last updated: January 2026*
