# Single-file bug-fix session

You are ONE session in a multi-session bug-fix loop. Sessions run 30 minutes apart with no shared context. Your only link to previous sessions is the handoff file described below. Review and fix exactly ONE file this session, then stop.

## File order (fixed — do not recompute)

1. `js/debt-snowball.js` (3436 lines)
2. `js/transaction-ui.js` (2197)
3. `js/recurring-manager.js` (1884)
4. `js/transaction-store.js` (1716)
5. `js/bank-reconcile.js` (1575)
6. `js/cloud-sync.js` (1487)
7. `scripts/verify-logic.js` (1173)
8. `js/calendar-ui.js` (959)
9. `js/pin-protection.js` (870)
10. `js/app.js` (776)
11. `js/utils.js` (756)
12. `js/calculation-service.js` (597)
13. `js/search-ui.js` (544)
14. `js/build.js` (4)

## Step 0 — Check for interrupted work

- Run `git status --porcelain` FIRST. A dirty working tree means a previous session was interrupted (usage limit, kill, crash) before it could verify and commit.
- Treat WIP in **checklist files** as untrusted: read the diff in full (`git diff`). If it clearly belongs to the file you are about to review and you can validate it line-by-line (and it passes Step 4 verification), incorporate it into your session and record in the handoff that you shipped a predecessor's WIP. Otherwise revert it (`git checkout -- <file>` or `git stash push -m "orphaned bug-fix WIP"`) and record that instead.
- WIP in **non-checklist files** (loop tooling, the handoff/prompt themselves, docs) was likely left deliberately by the loop operator — leave it in place; Step 6 commits it along with your work.
- Never build on unreviewed WIP, and never leave the tree dirty at session end — Step 6 commits everything.

## Step 1 — Load the handoff

- Read `bug-fix-handoff.md` at the repo root.
- If it does not exist, create it with three sections: **Checklist** (the file order above, all `- [ ]` unchecked), **Cross-file leads** (empty), **Verified not bugs** (empty).
- Your target is the **first unchecked file**. If every file is checked, append a final scorecard (fixes by commit, findings by severity), bump the build, commit, push, and stop.

## Step 2 — Review the target file

- First read the handoff's **Cross-file leads** and **Verified not bugs** sections — earlier sessions may have flagged something in your file, and you must not re-litigate cleared items.
- Consult the project memory index (`MEMORY.md` pointers: balance-walk-paths, deletion-tombstones, recurring-modified-instance-ids, sync-lifecycle-entry-points, allocation model notes, etc.) so documented intentional behavior isn't "fixed".
- Read the target file **in full** — no sampling.
- Hunt for: logic errors, date/timezone math, off-by-one, state corruption, stale index/reference hazards, sync-merge hazards (tombstones! union resurrection!), silent double-counting, infinite loops, unsafe innerHTML.
- For suspicious spots, **verify with tools** (grep the callee, write a targeted node test using the `scripts/verify-logic.js` vm-harness pattern) rather than judging by eye — especially in balance-math and sync code.

## Step 3 — Fix policy

- **Fix autonomously, never ask**: any MEDIUM-or-higher finding (pick the most reasonable option on product decisions and document the choice + rationale in the handoff) plus clear low-risk bugs.
- Leave LOW/INFO judgment calls as log-only.
- If a fix requires touching a file later in the checklist, make the minimal coordinated change and note it under that file's checklist entry so the future session knows.

## Step 4 — Verify

- `node scripts/verify-logic.js` must pass in full after any change.
- Add a regression test to that suite for every substantive fix.

## Step 5 — Update the handoff (this is the message to future sessions)

- Check off your file: `- [x] js/... — YYYY-MM-DD, N fixed / N log-only`.
- Under that entry, log each finding: severity, `file:line`, one-line failure scenario, and whether it was fixed (with the fix approach) or left log-only.
- Add anything a later session needs to **Cross-file leads** (suspected issues in other files, data contracts you relied on, coordinated changes made).
- Add cleared suspicions to **Verified not bugs** with a one-line reason.
- Keep entries concise — every future session reads this file in full.
- Update the project memory files if a fix establishes a durable rule or changes documented behavior.

## Step 6 — Ship

- Update `window.APP_BUILD` in `js/build.js` to the output of `date "+%Y-%m-%d %H:%M %Z"`.
- Commit ALL changes — fixes, tests, `bug-fix-handoff.md`, `js/build.js` — with a descriptive message and the Claude Co-Authored-By footer.
- `git push`.
- Even if you found zero bugs, still update the handoff, bump the build, commit, and push — the checked-off entry is the record that the file was reviewed.

## Step 7 — Stop

Do exactly one file. Do not start the next one.
