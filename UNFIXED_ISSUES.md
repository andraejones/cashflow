# Unfixed Issues

This document tracks issues identified during the codebase review that require attention but were not fixed in the initial pass.

## Code Quality Issues

### 1. Debt Snowball File Too Large
**File:** `js/debt-snowball.js` (~2700 lines)
**Issue:** Single file handles UI, calculations, projections, and charts. Difficult to maintain.
**Recommendation:** Split into separate modules: debt calculations, projection engine, UI components, chart rendering.
**Priority:** MEDIUM

### 2. Inconsistent Error Handling
**Files:** Various
**Issue:** Some functions use try/catch, others don't. Error messages are inconsistent.
**Recommendation:** Establish error handling patterns. Create error types for different failure modes.
**Priority:** LOW

### 3. No Input Sanitization for Descriptions
**File:** `js/transaction-ui.js`
**Issue:** Transaction descriptions are inserted into DOM without sanitization.
**Recommendation:** Use `textContent` instead of `innerHTML` or sanitize HTML entities.
**Priority:** MEDIUM

### 4. Magic Numbers in Calculations
**File:** `js/debt-snowball.js`, `js/calculation-service.js`
**Issue:** Numbers like 600 (max months), 30 (projection days) are hardcoded without explanation.
**Recommendation:** Define named constants with documentation.
**Priority:** LOW

## Testing Gaps

### 5. No Automated Tests
**Issue:** No unit tests, integration tests, or end-to-end tests exist.
**Recommendation:** Add Jest for unit tests, particularly for calculation-service.js and recurring-manager.js.
**Priority:** HIGH

### 6. No Data Migration Tests
**File:** `js/transaction-store.js`
**Issue:** Data migration logic (`migrateDataIfNeeded`) has no tests for version upgrades.
**Recommendation:** Create test fixtures for each data version and verify migrations.
**Priority:** MEDIUM

---

*Last updated: January 2026*
