# Implementation Plan

Multi-agent parallel execution plan for addressing all findings in `improvement.md`.

## Guiding Principles

- **File isolation** determines parallelism — agents working on different files can run simultaneously
- **Shared dependencies** (additions to `utils.js`) must land first before consumers are updated
- Each agent should verify behavior is preserved after changes (no build process; manual spot-check)

---

## Phase 1 — Foundation (Sequential, Single Agent)

**Must complete before Phase 2 begins.** All Phase 2 agents depend on these additions to `utils.js`.

### Agent 0: Shared Constants & Utilities → `utils.js`

| Step | Finding | Action |
|------|---------|--------|
| 1a | #1 | Add `Utils.DAY_SPECIFIC_OPTIONS` constant (copy the 35-element array) |
| 1b | #2 | Add `Utils.MONTH_LABELS` constant (12-element array) |
| 1c | #4 | Move `cleanUpHtmlArtifacts` into `Utils` as a static method |
| 1d | #8 | (Optional) Add a `Utils.getTransactionSign(type)` helper returning `=`, `+`, or `-` |

**Files modified:** `js/utils.js` only
**Risk:** Low — purely additive, no existing behavior changed

---

## Phase 2 — Parallel Refactoring (4 Agents, Run Simultaneously)

Once Phase 1 lands, these four agents run **in parallel**. Each agent owns a distinct set of files with no overlap.

### Agent A: Data Layer — `transaction-store.js` + `recurring-manager.js`

| Step | Finding | Action |
|------|---------|--------|
| A1 | #3 | Extract `_normalizeDebt(debt)` private method in `TransactionStore`; replace both call sites in `loadData` and `importData` |
| A2 | #6 | Remove `RecurringTransactionManager.parseDateString()`; update all internal calls to use `Utils.parseDateString()` |
| A3 | #11 | Remove unused `flushSave()` and `saveImmediately()` aliases from `TransactionStore` (verify no external callers first) |
| A4 | #13 | Simplify verbose `.filter()` blocks in `applyRecurringTransactions` (line ~377) and `_applyCachedTransactions` (line ~602) to inline arrow expressions |

**Files modified:** `js/transaction-store.js`, `js/recurring-manager.js`
**Est. lines saved:** ~65

---

### Agent B: Transaction UI — `transaction-ui.js` + `debt-snowball.js`

This is the largest stream. Order matters within the agent due to overlapping code regions.

| Step | Finding | Action |
|------|---------|--------|
| B1 | #5 | Extract shared form builder functions into a `FormBuilderUtils` object on `Utils` (or standalone section in `utils.js`). Each function takes an `idPrefix` parameter. Methods: `buildSemiMonthlyOptions(prefix)`, `buildCustomIntervalOptions(prefix)`, `buildBusinessDayOptions(prefix)`, `buildVariableAmountOptions(prefix)`, `buildEndConditionOptions(prefix)` |
| B2 | #5 | Replace the 5 methods in `TransactionUI` with calls to the shared builders (prefix: `''`) |
| B3 | #5 | Replace the 5 methods in `DebtSnowballUI` with calls to the shared builders (prefix: `'debt'`) |
| B4 | #1 | Replace `this.daySpecificOptions` in `TransactionUI` constructor with reference to `Utils.DAY_SPECIFIC_OPTIONS` |
| B5 | #1 | Remove `DAY_SPECIFIC_OPTIONS` constant and `this.daySpecificOptions` copy from `DebtSnowballUI`; reference `Utils.DAY_SPECIFIC_OPTIONS` |
| B6 | #8 | Add `_notifyChange()` method to `TransactionUI` that calls `this.onUpdate()` and conditionally `this.cloudSync.scheduleCloudSave()`. Replace all 8+ occurrences |
| B7 | #10 | Simplify `toggleSettled` handler in `showTransactionDetails` to a single code path |
| B8 | #14 | Remove `console.log` at line ~541 in `transaction-ui.js` |
| B9 | #15 | Remove unused `isSkipped` variable at line ~1389 in `transaction-ui.js` |

**Files modified:** `js/transaction-ui.js`, `js/debt-snowball.js`, `js/utils.js` (Phase 1 additions only — form builders appended)
**Est. lines saved:** ~310+

> **Note:** Step B1 appends to `utils.js` which was modified in Phase 1. This is safe because Agent B is the only Phase 2 agent writing to `utils.js`, and it only appends new functions below the Phase 1 additions.

---

### Agent C: Calendar & Rendering — `calendar-ui.js` + `calculation-service.js` + `app.js`

| Step | Finding | Action |
|------|---------|--------|
| C1 | #4 | Remove `cleanUpHtmlArtifacts` from both `calendar-ui.js` and `app.js`; replace calls with `Utils.cleanUpHtmlArtifacts()` |
| C2 | #2 | Replace inline month name arrays in `calendar-ui.js` (`generateCalendar` and `showNotesModal`) with `Utils.MONTH_LABELS` |
| C3 | #2 | Replace `MONTH_LABELS` in `debt-snowball.js` — **coordinate with Agent B** or handle here if Agent B has not touched that section |
| C4 | #7 | Extract nested ternary in `calendar-ui.js` line ~315 into a `_getDayIndicator(dailyTotals, hasMoveAnomaly)` helper method |
| C5 | #9 | Replace all manual date formatting patterns in `calendar-ui.js` (~7 occurrences) with `Utils.formatDateString()` calls |
| C6 | #9 | Replace manual date formatting in `calculation-service.js` (~1 occurrence) with `Utils.formatDateString()` |

**Files modified:** `js/calendar-ui.js`, `js/calculation-service.js`, `js/app.js`
**Est. lines saved:** ~65

> **Coordination note for C3:** `MONTH_LABELS` in `debt-snowball.js` overlaps with Agent B's file scope. Two options:
> 1. Agent B handles the `MONTH_LABELS` replacement in `debt-snowball.js` as part of B5 (preferred)
> 2. Agent C handles it after Agent B completes
>
> **Decision:** Assign to Agent B (step B5 expanded) since they already modify that file.

---

### Agent D: Search UI — `search-ui.js`

| Step | Finding | Action |
|------|---------|--------|
| D1 | #12 | Remove all `typeof Utils !== 'undefined'` guard checks; call `Utils.showNotification` directly |

**Files modified:** `js/search-ui.js`
**Est. lines saved:** ~6

> This is a small task. Agent D could also handle any remaining cross-cutting cleanup not covered by other agents.

---

## Phase 3 — Verification (Sequential, Single Agent)

After all Phase 2 agents complete:

| Step | Action |
|------|--------|
| 3a | Verify `utils.js` has all new constants and helpers, no duplicates |
| 3b | Grep for any remaining duplicated patterns (leftover `daySpecificOptions`, inline month arrays, manual date formatting) |
| 3c | Verify no broken references — search for removed method names (`parseDateString` on RecurringTransactionManager, `flushSave`, `saveImmediately`, old form builder method names) |
| 3d | Open `index.html` and manually verify: calendar renders, transactions can be added/edited, debt snowball page loads, search works, cloud sync triggers |

---

## Execution Summary

```
Phase 1 (Agent 0)          ████████░░░░░░░░░░░░░░░░░░░░░░  utils.js foundation
                                    |
Phase 2 (Parallel)                  v
  Agent A (Data Layer)              ████████████░░░░░░░░░░░░░░░░
  Agent B (Transaction UI)          ████████████████████░░░░░░░░  ← largest stream
  Agent C (Calendar/Render)         ████████████████░░░░░░░░░░░░
  Agent D (Search UI)               ███░░░░░░░░░░░░░░░░░░░░░░░░  ← smallest
                                                          |
Phase 3 (Verification)                                    v
                                                          ████████  verify & test
```

## File Ownership Matrix

Ensures no two parallel agents modify the same file:

| File | Phase 1 | Agent A | Agent B | Agent C | Agent D |
|------|---------|---------|---------|---------|---------|
| `utils.js` | **write** | read | **append** | read | read |
| `transaction-store.js` | — | **write** | — | — | — |
| `recurring-manager.js` | — | **write** | — | — | — |
| `transaction-ui.js` | — | — | **write** | — | — |
| `debt-snowball.js` | — | — | **write** | — | — |
| `calendar-ui.js` | — | — | — | **write** | — |
| `calculation-service.js` | — | — | — | **write** | — |
| `app.js` | — | — | — | **write** | — |
| `search-ui.js` | — | — | — | — | **write** |

## Estimated Total Impact

- **~450+ lines** of duplicated code removed
- **5 files** gain shared utilities instead of inline copies
- **0 new files** created (all additions go into existing `utils.js`)
- **0 behavior changes** — all refactoring preserves existing functionality
