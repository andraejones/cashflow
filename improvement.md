# Code Improvement Findings

> **Legend:** ⬜ Not started · 🟡 Started · ✅ Concluded

## High Impact

### 1. Duplicated `daySpecificOptions` array (3 locations) ⬜
The same 35-element array is defined in three places:
- `js/transaction-ui.js` lines 17-53 (`this.daySpecificOptions`)
- `js/debt-snowball.js` lines 3-38 (`DAY_SPECIFIC_OPTIONS`)
- `js/debt-snowball.js` line 92 (copied again as `this.daySpecificOptions`)

**Recommendation:** Define `DAY_SPECIFIC_OPTIONS` once in `utils.js` and reference it from both `TransactionUI` and `DebtSnowballUI`.

### 2. Duplicated `MONTH_LABELS` / month name arrays (3 locations) ⬜
Month name arrays appear in:
- `js/debt-snowball.js` lines 51-64
- `js/calendar-ui.js` lines 102-115 (inline in `generateCalendar`)
- `js/calendar-ui.js` lines 515-518 (inline in `showNotesModal`)

**Recommendation:** Define a single `MONTH_LABELS` constant in `utils.js` and reference it everywhere.

### 3. Duplicated debt normalization logic in `TransactionStore` ⬜
The debt normalization/mapping code (~30 lines) is duplicated nearly identically between:
- `js/transaction-store.js` lines 216-255 (`loadData`)
- `js/transaction-store.js` lines 1082-1120 (`importData`)

**Recommendation:** Extract a `_normalizeDebt(debt)` helper method to eliminate the duplication.

### 4. Duplicated `cleanUpHtmlArtifacts` method ⬜
The exact same method body appears in:
- `js/calendar-ui.js` lines 84-95
- `js/app.js` lines 132-143

**Recommendation:** Keep only the one in `CalendarUI` (which is already called during `initEventListeners`) and remove the duplicate from `app.js`. Or move it to `Utils` if it needs to be shared.

### 5. Duplicated form builder methods between `TransactionUI` and `DebtSnowballUI` ⬜
These methods have nearly identical implementations in both files:
- `addSemiMonthlyOptions` / `addDebtSemiMonthlyOptions`
- `addCustomIntervalOptions` / `addDebtCustomIntervalOptions`
- `addBusinessDayOptions` / `addDebtBusinessDayOptions`
- `addVariableAmountOptions` / `addDebtVariableAmountOptions`
- `addEndConditionOptions` / `addDebtEndConditionOptions`

The only differences are the element ID prefixes (e.g., `semiMonthlyFirstDay` vs `debtSemiMonthlyFirstDay`).

**Recommendation:** Extract a shared form builder utility (could live in `Utils` or a new helper) that takes an ID prefix parameter. This would eliminate ~200+ lines of duplicated code.

### 6. Duplicated `parseDateString` method ⬜
The same date-parsing logic exists in:
- `js/utils.js` lines 104-113 (`Utils.parseDateString`) — includes null/validation guards
- `js/recurring-manager.js` lines 110-113 (`RecurringTransactionManager.parseDateString`) — lacks guards

**Recommendation:** Remove the duplicate from `RecurringTransactionManager` and use `Utils.parseDateString` consistently.

---

## Medium Impact

### 7. Nested ternary operators in `calendar-ui.js` ⬜
The day content template at lines 315-322 uses a triple-nested ternary for indicator rendering.

**Recommendation:** Extract into a helper function that uses an if/else chain for clarity.

### 8. Repeated `onUpdate + cloudSync` pattern in `transaction-ui.js` ⬜
The following pattern appears 8+ times:
```javascript
this.onUpdate();
if (this.cloudSync) {
  this.cloudSync.scheduleCloudSave();
}
```
Locations: lines 867-869, 876-878, 885-887, 981-983, 1009-1010, 1049-1050, 1261-1263, 1329-1331, 1381-1383, 1401-1403.

**Recommendation:** Extract a `_notifyChange()` helper method.

### 9. Manual date string formatting used inconsistently ⬜
The pattern `` `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` `` appears 15+ times across files instead of using `Utils.formatDateString()`.

Key locations:
- `js/calculation-service.js` line 135
- `js/calendar-ui.js` lines 168, 192, 193, 199, 211, 258, 270

**Recommendation:** Use `Utils.formatDateString(new Date(year, month, day))` consistently. This also prevents bugs from inconsistent 0-indexed vs 1-indexed month handling.

### 10. Repetitive settle/unsettle logic in `TransactionUI.showTransactionDetails` ⬜
The `toggleSettled` handler at lines 861-891 has three branches that all do nearly the same thing (set settled, refresh, notify). The only difference is the message text and whether it is recurring.

**Recommendation:** Simplify to a single path: determine the new settled value, call `setTransactionSettled`, then refresh and notify.

---

## Low Impact

### 11. Unused `flushSave()` and `saveImmediately()` aliases ⬜
`js/transaction-store.js` lines 78-86 define two aliases that simply call `flushPendingSave`. Only `flushPendingSave` is used internally.

**Recommendation:** Remove the aliases if they are not used externally.

### 12. Unnecessary `typeof Utils !== 'undefined'` checks in `SearchUI` ⬜
At `js/search-ui.js` lines 126-127, 169-170, and 173-174. Since `utils.js` always loads first per the script order, these are unnecessary.

**Recommendation:** Remove the defensive checks and call `Utils.showNotification` directly.

### 13. Redundant boolean filter pattern in `RecurringTransactionManager` ⬜
At `js/recurring-manager.js` lines 377-382 and 602-607:
```javascript
transactions[dateString] = transactions[dateString].filter(t => {
  if (!t.recurringId || t.modifiedInstance) {
    return true;
  }
  return false;
});
```

**Recommendation:** Simplify to:
```javascript
transactions[dateString] = transactions[dateString].filter(t =>
  !t.recurringId || t.modifiedInstance
);
```

### 14. Stray `console.log` in production code ⬜
`js/transaction-ui.js` line 541:
```javascript
console.log('Opening transaction modal for date:', date);
```

**Recommendation:** Remove or gate behind a debug flag.

### 15. Unused `isSkipped` variable ⬜
At `js/transaction-ui.js` lines 1389-1393, `isSkipped` is fetched but never used.

**Recommendation:** Remove the unused variable.

---

## Summary

| Priority | Finding | Files Affected | Est. Lines Saved | Status |
|----------|---------|----------------|------------------|--------|
| High | Extract shared `DAY_SPECIFIC_OPTIONS` | utils, transaction-ui, debt-snowball | ~70 | ⬜ |
| High | Extract shared `MONTH_LABELS` | utils, calendar-ui, debt-snowball | ~30 | ⬜ |
| High | Extract `_normalizeDebt` helper | transaction-store | ~30 | ⬜ |
| High | Deduplicate form builders | transaction-ui, debt-snowball | ~200+ | ⬜ |
| High | Remove duplicate `cleanUpHtmlArtifacts` | app, calendar-ui | ~12 | ⬜ |
| High | Remove duplicate `parseDateString` | recurring-manager | ~4 | ⬜ |
| Medium | Fix nested ternaries | calendar-ui, transaction-ui | ~10 | ⬜ |
| Medium | Extract `_notifyChange()` helper | transaction-ui | ~20 | ⬜ |
| Medium | Use `Utils.formatDateString` consistently | calculation-service, calendar-ui | ~15 | ⬜ |
| Medium | Simplify settle/unsettle handler | transaction-ui | ~15 | ⬜ |
| Low | Remove unused aliases | transaction-store | ~8 | ⬜ |
| Low | Remove `typeof Utils` checks | search-ui | ~6 | ⬜ |
| Low | Simplify boolean filter | recurring-manager | ~6 | ⬜ |
| Low | Remove stray `console.log` | transaction-ui | ~1 | ⬜ |
| Low | Remove unused `isSkipped` | transaction-ui | ~4 | ⬜ |
