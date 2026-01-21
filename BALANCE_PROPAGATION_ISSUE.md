# Balance Propagation Issue

## Summary

Monthly balances don't correctly flow to future months until the user navigates to that future month. This is caused by lazy calculation—balances are only computed for months within the range of existing transactions or the currently viewed month.

## The Problem

When viewing the current month, if a user wants to see their projected balance for a future month, they must:
1. Navigate to the future month first
2. Return to the current month
3. Navigate to the future month again

Only then will the balance correctly show the cumulative flow from previous months.

---

## Root Cause

In `calculation-service.js`, the `updateMonthlyBalances()` method calculates balances using a range determined by:

1. **Earliest date** with a transaction
2. **Latest date** — the furthest of either:
   - The last transaction date
   - The currently viewed month

```javascript
// Lines 33-55 in calculation-service.js
let earliestDate = null;
let latestDate = null;
for (const dateString in transactions) {
  // ... finds earliest/latest transaction dates
}
if (viewedDate) {
  const viewedMonthStart = new Date(viewedDate.getFullYear(), viewedDate.getMonth(), 1);
  if (!latestDate || viewedMonthStart > latestDate) {
    latestDate = viewedMonthStart;  // Extends to viewed month ONLY
  }
}
```

### Problem Flow

| Step | Action | `latestDate` Includes | Result |
|------|--------|----------------------|--------|
| 1 | User views January (current) | January | Jan balance calculated |
| 2 | User views March (future) | March | Jan → Feb → Mar chain calculated |
| 3 | User returns to January | January | Balances recalculated (Mar data now available from cache) |

The issue is that balances for **unvisited future months are never pre-calculated**.

---

## Affected Files

| File | Method | Issue |
|------|--------|-------|
| `calculation-service.js` | `updateMonthlyBalances()` | Only calculates months within `[earliestDate, max(latestDate, viewedDate)]` |
| `calendar-ui.js` | `generateCalendar()` | Calls `updateMonthlyBalances(this.currentDate)` — only extends to current view |

---

## Symptoms

1. **Incorrect future projections**: Viewing a future month initially shows $0 starting balance instead of carried-over balance
2. **Confusion about "Unallocated"**: The 30-day unallocated calculation may be affected if future months haven't been visited
3. **Inconsistent UI**: Values change after navigating away and back

---

## Potential Fix Options

### Option 1: Extend Range Proactively
Modify `updateMonthlyBalances()` to always calculate at least N months into the future:

```javascript
// Always calculate at least 6 months ahead
const futureMonthCap = new Date(viewedDate.getFullYear(), viewedDate.getMonth() + 6, 1);
if (futureMonthCap > latestDate) {
  latestDate = futureMonthCap;
}
```

### Option 2: Calculate On-Demand with Backfill
When `calculateMonthlySummary()` finds a missing month, recursively calculate all prior months first:

```javascript
if (!monthlyBalances[monthKey]) {
  // Walk backwards to find a known month, then calculate forward
  this.updateMonthlyBalances(new Date(year, month, 1));
}
```

### Option 3: Full Recalculation Always
Remove the optimization and always calculate all months from earliest to viewed + 12 months (performance impact).

---

## Testing

To verify the fix:
1. Reset app data
2. Add a transaction in the current month
3. **Without navigating**, check that the next 3-6 months show correct carried-over balances
4. Verify "Unallocated" shows accurately for the 30-day window
