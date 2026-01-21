# Date Comparison Time Component Bug

## Summary

JavaScript `Date` objects always include a time component. This codebase has inconsistent handling of times when creating dates for comparison, which can cause off-by-one-day bugs.

## The Problem

`parseDateString()` creates dates at **noon**:
```javascript
// recurring-manager.js:112
return new Date(year, month - 1, day, 12, 0, 0);  // NOON
```

But many other places create dates at **midnight** (default):
```javascript
new Date(year, month, day)  // MIDNIGHT (00:00:00)
```

When comparing same-day dates: `noon > midnight`, so checks like `startDate <= targetDate` fail incorrectly.

---

## Affected Comparisons

### Uses `startDate`/`endDate` from `parseDateString()` (noon):
- `applyRecurringTransactions()` — lines 387-388

### Must compare against noon-based dates:

| Method | Status | Notes |
|--------|--------|-------|
| `applySemiMonthlyRecurrence()` | ✅ Fixed | Lines 979-1015 use noon |
| `applyMonthlyRecurrence()` | ✅ OK | Line 858 uses noon |
| `applyQuarterlyRecurrence()` | ✅ OK | Line 1067 uses noon |
| `applySemiAnnualRecurrence()` | ✅ OK | Line 1118 uses noon |
| `applyYearlyRecurrence()` | ✅ Fixed | Line 1165 now uses noon |

---

## Locations Using Midnight (Review Needed)

These create dates without time component. Verify none are compared to `parseDateString()` results:

### recurring-manager.js
| Line | Code | Context |
|------|------|---------|
| 267 | `new Date(year, month, 1)` | `getNthDayOfMonth` |
| 280 | `new Date(year, month, daysInMonth)` | `getNthDayOfMonth` |
| 366 | `new Date(year, month + 1, 0)` | `endOfMonth` |
| 369 | `new Date(year, month, day)` | loop iteration |
| 395 | `new Date(year, month + offset, 1)` | cross-month check |
| 398-399 | `targetStartOfMonth`, `targetEndOfMonth` | month boundaries |
| 658-659, 714-715, 766-767, 831-832, 894-895, 955-956, 1208-1209 | `startOfMonth`, `endOfMonth` | various recurrences |

### transaction-store.js
| Line | Code | Risk |
|------|------|------|
| 1054 | `new Date(rt.startDate) <= new Date(date)` | ⚠️ Both parsed from strings — inconsistent |

### calculation-service.js
| Line | Code | Context |
|------|------|---------|
| 37 | `new Date(year, month - 1, day)` | transaction date |
| 46-47 | `viewedMonthStart` | month comparison |

### calendar-ui.js
| Line | Code | Context |
|------|------|---------|
| 147-148 | `firstDay`, `daysInMonth` | UI rendering only |
| 311-313 | `viewedMonthStart`, `viewedMonthEnd` | UI comparison |

### debt-snowball.js
| Line | Code | Context |
|------|------|---------|
| 406, 707, 728 | various | debt date calculations |

---

## Recommended Fix Options

### Option 1: Normalize All to Noon
Add `12, 0, 0` to all `new Date(year, month, day)` calls that may be compared to `parseDateString()` results.

### Option 2: Compare Date Strings
Instead of comparing `Date` objects, compare formatted strings:
```javascript
Utils.formatDateString(date1) <= Utils.formatDateString(date2)
```

### Option 3: Create Helper Function
```javascript
// Create date at noon for safe comparisons
createComparisonDate(year, month, day) {
    return new Date(year, month, day, 12, 0, 0);
}
```

---

## Testing

When testing recurring transactions, verify:
1. Transaction appears on its **exact start date**
2. Semi-monthly transactions on the 1st and 15th appear correctly
3. Yearly transactions appear on anniversary dates
