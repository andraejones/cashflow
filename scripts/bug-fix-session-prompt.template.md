# Single-file bug-fix session

You are ONE session in a multi-session bug-fix loop. Sessions run with no shared context. Your only link to previous sessions is the handoff file described below. Review and fix exactly ONE file this session, then stop.
{{PROJECT_NOTES}}
## Step 0 — Check for interrupted work

- Run `git status --porcelain` FIRST. A dirty working tree means a previous session was interrupted (usage limit, kill, crash) before it could verify and commit.
- Treat WIP in **checklist files** as untrusted: read the diff in full (`git diff`). If it clearly belongs to the file you are about to review and you can validate it line-by-line (and it passes Step 4 verification), incorporate it into your session and record in the handoff that you shipped a predecessor's WIP. Otherwise revert it (`git checkout -- <file>` or `git stash push -m "orphaned bug-fix WIP"`) and record that instead.
- WIP in **non-checklist files** (loop tooling, the handoff/prompt themselves, docs) was likely left deliberately by the loop operator — leave it in place; Step 6 commits it along with your work.
- Never build on unreviewed WIP, and never leave the tree dirty at session end — Step 6 commits everything.

## Step 1 — Load the handoff

- Read `{{HANDOFF_FILE}}` at the repo root. It contains the authoritative **Checklist** of files to review (fixed order — do not recompute or reorder it), plus **Cross-file leads** and **Verified not bugs** sections.
- Your target is the **first unchecked file**. If every file is checked, append a final scorecard (fixes by commit, findings by severity), commit, push, and stop.

## Step 2 — Review the target file

- First read the handoff's **Cross-file leads** and **Verified not bugs** sections — earlier sessions may have flagged something in your file, and you must not re-litigate cleared items.
- The project's `CLAUDE.md` and memory index are already auto-loaded into your context — honor them, but do NOT re-read those files. Read other contributor docs (and the specific memory files the index points at, when relevant to your target) so documented intentional behavior isn't "fixed".
- Read the target file **in full** — no sampling.
- Hunt for: logic errors, date/timezone math, off-by-one, state corruption, stale index/reference hazards, data-merge/sync hazards (tombstones! union resurrection!), silent double-counting, infinite loops, injection / unsafe HTML, resource leaks.
- For suspicious spots, **verify with tools** (grep the callee, write a targeted standalone test) rather than judging by eye — especially in money/date math and sync code.

## Step 3 — Fix policy

- **Fix autonomously, never ask**: any MEDIUM-or-higher finding (pick the most reasonable option on product decisions and document the choice + rationale in the handoff) plus clear low-risk bugs.
- Leave LOW/INFO judgment calls as log-only.
- If a fix requires touching a file later in the checklist, make the minimal coordinated change and note it under that file's checklist entry so the future session knows.

## Step 4 — Verify

{{VERIFY_BLOCK}}

## Step 5 — Update the handoff (this is the message to future sessions)

- Check off your file: `- [x] path — YYYY-MM-DD, N fixed / N log-only`.
- Under that entry, log each finding: severity, `file:line`, one-line failure scenario, and whether it was fixed (with the fix approach) or left log-only.
- Add anything a later session needs to **Cross-file leads** (suspected issues in other files, data contracts you relied on, coordinated changes made).
- Add cleared suspicions to **Verified not bugs** with a one-line reason.
- Keep entries concise — every future session reads this file in full.

## Step 6 — Ship

- Follow any pre-commit rules in the project's `CLAUDE.md` (build stamps, version bumps, changelog entries).
- Commit ALL changes — fixes, tests, the handoff file — with a descriptive message and the Claude Co-Authored-By footer.
- `git push` (skip if the repo has no remote).
- Even if you found zero bugs, still update the handoff, commit, and push — the checked-off entry is the record that the file was reviewed.

## Step 7 — Stop

Do exactly one file. Do not start the next one.
