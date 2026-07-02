# Bug-review loop: every JS file, then cross-file interactions

Run a two-phase bug review of this codebase, one file per iteration.

## Setup (first run only)

1. Compute the file order fresh: every `.js` file in the repo (excluding `node_modules`), sorted **most lines of code → least**:
   `find . -name "*.js" -not -path "*/node_modules/*" -not -path "*/.git/*" | xargs wc -l | sort -rn`
2. Create a state file in the session scratchpad (`review-state.md`) with two checklists built from that order:
   - **Phase 1** — one item per file: review that file in isolation for bugs.
   - **Phase 2** — one item per file (same order): trace that file's interactions with the other files (calls it makes, callbacks it registers, data contracts, shared localStorage keys, the duplicated balance-walk paths) and check the *integrations* for bugs.
3. Create a findings log (`review-findings.md`) next to it.
4. If a state file from a previous session exists and is referenced, resume from its first unchecked item instead of starting over.

## Each iteration

1. Take the FIRST unchecked item in the state file; mark it `[x]` with a date and outcome summary when done.
2. Read the file **in full** (no sampling). Before judging anything a bug, consult the memory index (`MEMORY.md` pointers — balance-walk-paths, deletion-tombstones, recurring-modified-instance-ids, sync-lifecycle-entry-points, allocation model notes, etc.) so documented intentional behavior isn't "fixed".
3. Hunt for: logic errors, date/timezone math, off-by-one, state corruption, stale index/reference hazards, sync-merge hazards (tombstones! union resurrection!), silent double-counting, infinite loops, unsafe innerHTML. For suspicious spots, **verify with tools** (grep the callee, write a targeted node test using the verify-logic.js vm-harness pattern) rather than judging by eye — especially in balance-math and sync code.
4. Log every finding with severity (MEDIUM+/LOW/INFO), file:line, and a concrete failure scenario. Also log "verified-not-bugs" so later iterations don't re-litigate them.

## Fix policy

- **Fix autonomously, never ask**: any MEDIUM-or-higher finding (pick the most reasonable option on product decisions and document the choice + rationale in the findings log) plus clear low-risk bugs.
- Leave LOW/INFO judgment calls as log-only.
- After any fix: run `node scripts/verify-logic.js` (all tests must pass); add a regression test to the suite for substantive fixes; update `window.APP_BUILD` in `js/build.js` to `date "+%Y-%m-%d %H:%M %Z"`; commit ALL changes (including build.js) with a descriptive message + the Claude Co-Authored-By footer; `git push`.
- Update the memory files when a fix establishes a durable rule or changes documented behavior.

## Pacing

- **Preferred (cheap)**: run iterations back-to-back in one session; the prompt cache stays warm. Suggest the user run `/compact` at the Phase 1 → Phase 2 boundary.
- **Alternative (spread out)**: a session cron (e.g. every 30 min) works but pays a full cold context re-read per firing — only use it if the user explicitly wants elapsed-time pacing.

## Completion

When every item in both phases is checked: report a final scorecard (fixes by commit, findings by severity), then stop.
