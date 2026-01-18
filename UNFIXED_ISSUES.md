# Unfixed Issues

This document tracks issues identified during the codebase review that require attention but were not fixed in the initial pass.

## Critical Security Issues

### 1. XOR Encryption is Not Secure
**File:** `js/pin-protection.js`
**Issue:** XOR cipher with PIN-based key provides minimal security. It's easily reversible if the PIN is known or guessed.
**Recommendation:** Replace with Web Crypto API using AES-GCM encryption. Derive key from PIN using PBKDF2 with high iteration count and salt.
**Priority:** CRITICAL

### 2. PIN Hash Uses Weak Hashing
**File:** `js/pin-protection.js`
**Issue:** Custom hash function for PIN storage is not cryptographically secure.
**Recommendation:** Use Web Crypto API with SHA-256 minimum, or better yet PBKDF2/Argon2 with salt stored separately.
**Priority:** CRITICAL

### 3. GitHub Token Stored in localStorage
**File:** `js/cloud-sync.js`
**Issue:** OAuth tokens stored unencrypted in localStorage are vulnerable to XSS attacks.
**Recommendation:** Store tokens encrypted with user-derived key, or use httpOnly cookies for session management.
**Priority:** CRITICAL

### 4. No CSRF Protection for OAuth Flow
**File:** `js/cloud-sync.js`
**Issue:** OAuth state parameter is stored but not cryptographically secure.
**Recommendation:** Generate cryptographically random state using `crypto.getRandomValues()`.
**Priority:** HIGH

## Data Integrity Issues

### 5. Debt Projection Base Date Logic
**File:** `js/debt-snowball.js` (lines 1400-1401)
**Issue:** The logic for determining base year/month switches between view date and current date based on whether viewing past or future months. This can cause inconsistencies in debt projections.
```javascript
const baseYear = viewIndex <= currentIndex ? viewYear : currentYear;
const baseMonth = viewIndex <= currentIndex ? viewMonth : currentMonth;
```
**Recommendation:** Review and potentially simplify to always calculate from current month's actual balances, then adjust display logic accordingly. Needs comprehensive testing before changes.
**Priority:** MEDIUM

### 6. No Transaction ID Collision Handling
**File:** `js/transaction-store.js`
**Issue:** UUID generation could theoretically collide. No validation that generated IDs are unique.
**Recommendation:** Check for existing ID before assignment, or use timestamp + random combination.
**Priority:** LOW

### 7. Monthly Balance Calculation Drift
**File:** `js/calculation-service.js`
**Issue:** Floating-point arithmetic in balance calculations can accumulate small errors over many months.
**Recommendation:** Use integer cents internally, divide by 100 only for display.
**Priority:** MEDIUM

## UI/UX Issues

### 8. Modal Z-Index Conflicts
**File:** `js/utils.js`, `js/transaction-ui.js`
**Issue:** Multiple modals can stack without proper z-index management.
**Recommendation:** Implement modal manager that tracks open modals and assigns increasing z-indices.
**Priority:** LOW

### 9. No Loading States for Async Operations
**File:** `js/cloud-sync.js`, `js/app.js`
**Issue:** Cloud sync operations don't show loading indicators to users.
**Recommendation:** Add loading spinner/overlay during cloud operations.
**Priority:** LOW

### 10. Accessibility: Missing ARIA Live Regions
**File:** `js/calendar-ui.js`, `js/transaction-ui.js`
**Issue:** Dynamic content updates don't announce to screen readers.
**Recommendation:** Add `aria-live="polite"` regions for notifications and dynamic content.
**Priority:** MEDIUM

### 11. Accessibility: Color Contrast for Negative Balances
**File:** `css/styles.css`
**Issue:** Red text on some backgrounds may not meet WCAG AA contrast requirements.
**Recommendation:** Verify contrast ratios and adjust colors or add secondary indicators (icons).
**Priority:** MEDIUM

## Performance Issues

### 12. No Pagination for Transaction Lists
**File:** `js/search-ui.js`
**Issue:** Large transaction histories render all results at once, potentially causing lag.
**Recommendation:** Implement virtual scrolling or pagination for search results.
**Priority:** MEDIUM

### 13. Recurring Transaction Expansion is Expensive
**File:** `js/recurring-manager.js`
**Issue:** Expanding recurring transactions for each month view recalculates even for unchanged templates.
**Recommendation:** Cache expanded transactions per month and invalidate only when templates change.
**Priority:** MEDIUM

### 14. Full Store Save on Every Change
**File:** `js/transaction-store.js`
**Issue:** Each transaction modification saves the entire data object to localStorage.
**Recommendation:** Consider debouncing saves or implementing incremental/differential saves.
**Priority:** LOW

## Code Quality Issues

### 15. Debt Snowball File Too Large
**File:** `js/debt-snowball.js` (~2700 lines)
**Issue:** Single file handles UI, calculations, projections, and charts. Difficult to maintain.
**Recommendation:** Split into separate modules: debt calculations, projection engine, UI components, chart rendering.
**Priority:** MEDIUM

### 16. Inconsistent Error Handling
**Files:** Various
**Issue:** Some functions use try/catch, others don't. Error messages are inconsistent.
**Recommendation:** Establish error handling patterns. Create error types for different failure modes.
**Priority:** LOW

### 17. No Input Sanitization for Descriptions
**File:** `js/transaction-ui.js`
**Issue:** Transaction descriptions are inserted into DOM without sanitization.
**Recommendation:** Use `textContent` instead of `innerHTML` or sanitize HTML entities.
**Priority:** MEDIUM

### 18. Magic Numbers in Calculations
**File:** `js/debt-snowball.js`, `js/calculation-service.js`
**Issue:** Numbers like 600 (max months), 30 (projection days) are hardcoded without explanation.
**Recommendation:** Define named constants with documentation.
**Priority:** LOW

## Testing Gaps

### 19. No Automated Tests
**Issue:** No unit tests, integration tests, or end-to-end tests exist.
**Recommendation:** Add Jest for unit tests, particularly for calculation-service.js and recurring-manager.js.
**Priority:** HIGH

### 20. No Data Migration Tests
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

---

*Generated: January 2026*
