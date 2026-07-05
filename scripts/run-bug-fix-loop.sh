#!/bin/zsh
# Generic single-file bug-fix loop: one fresh headless Claude session per file.
# Each session reads the session prompt, fixes ONE file (the first unchecked
# item in the handoff checklist), logs findings back into the handoff,
# commits, and pushes. The handoff file is the only state shared between
# sessions, so this script works on ANY codebase — point it at a repo and
# tell it which files to review.
#
# Pacing: sessions run back-to-back (INTRA_SLEEP, default 30s apart) and the
# REACTIVE LIMIT PAUSE below is the governor — the limiter itself says when
# to stop and exactly when to resume, so preemptive throttling only wastes
# quota-available wall-clock time. Consecutive sessions also share a prompt-
# cache prefix; any gap <= ~270s keeps it warm, larger gaps pay full price
# again. (The win is partial: each session's commit changes the git-status
# context injected after the static system prompt, so only the prefix ahead
# of that divergence re-uses the cache — still the bulk of the fixed cost.)
#
# Model selection: sessions targeting small files run on Sonnet automatically.
# Before each session, the next unchecked file's LIVE line count is measured
# (falling back to the count recorded in the checklist); at or below
# SONNET_MAX_LINES (default 1000; 0 disables) the session gets
# `--model sonnet`, otherwise the CLI default applies. Passing an explicit
# --model after `--` disables auto-selection entirely.
# Preemptive batch pacing is still available but OFF by default: set
# BATCH_SLEEP > 0 (with BATCH_SIZE) only if you deliberately want to spread
# work out — e.g. overnight runs, or to lower the odds of a session being
# cut off MID-run right at the quota edge (a cutoff wastes that session's
# partial work; Step 0 recovery bounds, but doesn't eliminate, the cost).
#
# Session-limit handling (the governor): if a session's output contains a
# usage-limit message like
#   "You've hit your session limit · resets 1:40am (America/New_York)"
# the session did no work. The script parses the reset time (assumed to be
# in this machine's local timezone), sleeps until reset + LIMIT_BUFFER, and
# RETRIES the same session number — limit hits never consume an iteration.
# If a limit message has no parseable time-of-day (e.g. a weekly limit),
# it falls back to sleeping LIMIT_FALLBACK_SLEEP and retrying.
#
# Runs are RESUMABLE BY DEFAULT: session numbering continues after the
# highest existing log, the checklist drives file selection, and the
# session budget is sized to the unchecked files remaining. `--resume` is
# accepted as an explicit statement of intent but changes nothing.

usage() {
  cat <<'EOF'
Usage: run-bug-fix-loop.sh [flags] [-- extra args passed to `claude`]

Target selection:
  --dir PATH        Repo to run against (default: this script's parent repo).

File list (used only when the handoff doesn't exist yet):
  --files GLOB      Glob of files to review, relative to the target repo
                    (repeatable; zsh globs, e.g. 'src/**/*.js'). Checklist is
                    ordered largest-first by line count.
  --list FILE       Newline-separated file paths (relative to target repo);
                    order is preserved. '#' comments and blanks ignored.

Prompt (used only when the target repo has no bug-fix-session-prompt.md):
  --verify CMD      Project verify/test command sessions must pass
                    (e.g. 'npm test'). Default: sessions find the suite.
  --notes FILE      Project-specific instructions injected into the prompt.
  --prompt FILE     Use this prompt file verbatim (skips template generation).

Run control:
  --sessions N      Cap sessions this run (default: all unchecked files).
  --intra-sleep S   Gap between sessions (default 30; keep <= 270 to ride the
                    prompt cache). The reactive limit pause is the governor.
  --batch-sleep S   OPTIONAL preemptive pacing, off by default (0): sleep S
                    seconds after every BATCH_SIZE sessions to deliberately
                    spread work out (overnight runs, mid-run-cutoff hedging).
  --batch-size N    Sessions per batch when --batch-sleep is on (default 3).
  --sonnet-max-lines N
                    Auto-model threshold: a session whose target file is <= N
                    lines runs with `--model sonnet` (default 1000; 0 disables).
                    Ignored when an explicit --model is passed after `--`.
  --handoff FILE    Handoff path relative to target (default bug-fix-handoff.md).
  --log-dir DIR     Log dir relative to target (default scripts/bug-fix-logs).
  --resume          Explicitly resume (default behavior; kept for clarity).
  --fresh           Archive the existing handoff + logs and start over.
  --dry-run         Print the resolved plan and exit without writing/running.

Anything after `--` is passed to the claude CLI (e.g. -- --model opus).

Examples:
  ./scripts/run-bug-fix-loop.sh --resume
  ./scripts/run-bug-fix-loop.sh --dir ~/code/otherapp --files 'src/**/*.ts' \
      --verify 'npm test' --notes ~/code/otherapp/review-notes.md
EOF
}

SCRIPT_DIR="${0:A:h}"
TEMPLATE_FILE="$SCRIPT_DIR/bug-fix-session-prompt.template.md"

TARGET_DIR=""
PROMPT_OPT=""
HANDOFF_FILE="bug-fix-handoff.md"
LOG_DIR="scripts/bug-fix-logs"
VERIFY_CMD=""
NOTES_FILE=""
LIST_FILE=""
typeset -a GLOBS CLAUDE_ARGS
SESSIONS_OPT=""
DRY_RUN=false
FRESH=false
BATCH_SIZE="${BATCH_SIZE:-3}"
BATCH_SLEEP="${BATCH_SLEEP:-0}"   # 0 = no preemptive pacing (reactive limit pause governs)
INTRA_SLEEP="${INTRA_SLEEP:-30}"
SONNET_MAX_LINES="${SONNET_MAX_LINES:-1000}"        # auto --model sonnet at/below this; 0 disables
LIMIT_BUFFER="${LIMIT_BUFFER:-120}"                  # seconds past the advertised reset
LIMIT_FALLBACK_SLEEP="${LIMIT_FALLBACK_SLEEP:-3600}" # wait when reset time is unparseable

while (( $# > 0 )); do
  case "$1" in
    --dir)         TARGET_DIR="${2:?--dir requires a value}"; shift 2 ;;
    --files)       GLOBS+=("${2:?--files requires a value}"); shift 2 ;;
    --list)        LIST_FILE="${2:?--list requires a value}"; shift 2 ;;
    --verify)      VERIFY_CMD="${2:?--verify requires a value}"; shift 2 ;;
    --notes)       NOTES_FILE="${2:?--notes requires a value}"; shift 2 ;;
    --prompt)      PROMPT_OPT="${2:?--prompt requires a value}"; shift 2 ;;
    --handoff)     HANDOFF_FILE="${2:?--handoff requires a value}"; shift 2 ;;
    --log-dir)     LOG_DIR="${2:?--log-dir requires a value}"; shift 2 ;;
    --sessions)    SESSIONS_OPT="${2:?--sessions requires a value}"; shift 2 ;;
    --batch-size)  BATCH_SIZE="${2:?--batch-size requires a value}"; shift 2 ;;
    --batch-sleep) BATCH_SLEEP="${2:?--batch-sleep requires a value}"; shift 2 ;;
    --intra-sleep) INTRA_SLEEP="${2:?--intra-sleep requires a value}"; shift 2 ;;
    --sonnet-max-lines) SONNET_MAX_LINES="${2:?--sonnet-max-lines requires a value}"; shift 2 ;;
    --resume)      shift ;;  # resuming is the default; flag kept for clarity
    --fresh)       FRESH=true; shift ;;
    --dry-run)     DRY_RUN=true; shift ;;
    --)            shift; CLAUDE_ARGS=("$@"); break ;;
    -h|--help)     usage; exit 0 ;;
    *)             echo "Unknown argument: $1"; echo; usage; exit 1 ;;
  esac
done

# Auto-model policy: an explicit --model in the passthrough args wins outright.
AUTO_MODEL=false
if (( ${CLAUDE_ARGS[(Ie)--model]} )) || [[ -n "${(M)CLAUDE_ARGS:#--model=*}" ]]; then
  model_policy="explicit --model passed after -- (auto-selection off)"
elif (( SONNET_MAX_LINES > 0 )); then
  AUTO_MODEL=true
  model_policy="target file <= ${SONNET_MAX_LINES} lines -> --model sonnet, else CLI default"
else
  model_policy="auto-selection disabled (--sonnet-max-lines 0); CLI default model"
fi

# Resolve caller-relative paths to absolute BEFORE cd'ing into the target.
[[ -n "$LIST_FILE"  ]] && LIST_FILE="${LIST_FILE:A}"
[[ -n "$NOTES_FILE" ]] && NOTES_FILE="${NOTES_FILE:A}"
[[ -n "$PROMPT_OPT" ]] && PROMPT_OPT="${PROMPT_OPT:A}"
[[ -n "$LIST_FILE"  && ! -f "$LIST_FILE"  ]] && { echo "--list file not found: $LIST_FILE"; exit 1; }
[[ -n "$NOTES_FILE" && ! -f "$NOTES_FILE" ]] && { echo "--notes file not found: $NOTES_FILE"; exit 1; }
[[ -n "$PROMPT_OPT" && ! -f "$PROMPT_OPT" ]] && { echo "--prompt file not found: $PROMPT_OPT"; exit 1; }

TARGET_DIR="${TARGET_DIR:-$SCRIPT_DIR/..}"
cd "$TARGET_DIR" || { echo "Cannot cd to target dir: $TARGET_DIR"; exit 1; }
TARGET_DIR="$PWD"

# ---------------------------------------------------------------------------
# Build the review checklist (only needed when the handoff doesn't exist,
# or when --fresh will archive it).
# ---------------------------------------------------------------------------
typeset -a checklist_lines   # formatted "- [ ] path (lines)" entries
build_checklist() {
  typeset -a files
  if [[ -n "$LIST_FILE" ]]; then
    files=( ${(f)"$(grep -vE '^[[:space:]]*(#|$)' "$LIST_FILE")"} )
  elif (( ${#GLOBS} > 0 )); then
    setopt local_options null_glob
    local g
    for g in "${GLOBS[@]}"; do files+=( ${~g} ); done
  else
    echo "No handoff checklist exists and no file source given."
    echo "Provide --files GLOB (repeatable) or --list FILE to create one."
    return 1
  fi
  typeset -A seen
  typeset -a counted
  local f n
  for f in "${files[@]}"; do
    [[ -f "$f" ]] || { echo "warning: skipping non-file: $f" >&2; continue; }
    [[ -n "${seen[$f]:-}" ]] && continue
    seen[$f]=1
    n=$(wc -l < "$f" | tr -d ' ')
    counted+=( "$n"$'\t'"$f" )
  done
  (( ${#counted} > 0 )) || { echo "No files matched — nothing to review."; return 1; }
  # --list preserves the user's order; globs sort largest-first (review the
  # biggest, riskiest files while the loop is young).
  if [[ -z "$LIST_FILE" ]]; then
    counted=( ${(f)"$(printf '%s\n' "${counted[@]}" | sort -t$'\t' -k1,1 -rn)"} )
  fi
  local line
  for line in "${counted[@]}"; do
    checklist_lines+=( "- [ ] ${line#*$'\t'} (${line%%$'\t'*})" )
  done
}

handoff_live=true
if [[ ! -f "$HANDOFF_FILE" ]] || $FRESH; then
  handoff_live=false
  build_checklist || exit 1
fi

# ---------------------------------------------------------------------------
# Resolve the session prompt: explicit --prompt > repo's existing prompt file
# > generated from the template (with --verify / --notes injected).
# ---------------------------------------------------------------------------
PROMPT_FILE="bug-fix-session-prompt.md"
prompt_source=""
if [[ -n "$PROMPT_OPT" ]]; then
  PROMPT_FILE="$PROMPT_OPT"
  prompt_source="explicit (--prompt)"
elif [[ -f "$PROMPT_FILE" ]] && ! $FRESH; then
  prompt_source="existing $PROMPT_FILE"
else
  prompt_source="generated from template"
fi

generate_prompt() {
  [[ -f "$TEMPLATE_FILE" ]] || { echo "Template not found: $TEMPLATE_FILE"; return 1; }
  local tpl verify_block notes_block
  tpl="$(<"$TEMPLATE_FILE")"
  if [[ -n "$VERIFY_CMD" ]]; then
    verify_block="- Run \`$VERIFY_CMD\` — it must pass in full after any change.
- Add a regression test to the project's suite for every substantive fix (seed a lightweight standalone harness next to the code if the project has none)."
  else
    verify_block="- Find and run the project's test/verify command (check CLAUDE.md, package.json scripts, Makefile, CI config, README). It must pass in full after any change.
- If no suite exists, verify each fix with a targeted standalone script, and seed a small regression harness so later sessions can build on it."
  fi
  if [[ -n "$NOTES_FILE" ]]; then
    notes_block=$'\n## Project-specific notes\n\n'"$(<"$NOTES_FILE")"$'\n'
  else
    notes_block=""
  fi
  tpl="${tpl//\{\{HANDOFF_FILE\}\}/$HANDOFF_FILE}"
  tpl="${tpl//\{\{VERIFY_BLOCK\}\}/$verify_block}"
  tpl="${tpl//\{\{PROJECT_NOTES\}\}/$notes_block}"
  print -r -- "$tpl" > "$PROMPT_FILE"
}

# ---------------------------------------------------------------------------
# Dry run: report the plan without writing or launching anything.
# ---------------------------------------------------------------------------
if $DRY_RUN; then
  echo "Target repo:   $TARGET_DIR"
  echo "Handoff file:  $HANDOFF_FILE $($handoff_live && echo '(existing)' || echo "(would be created$($FRESH && [[ -f $HANDOFF_FILE ]] && echo ', current one archived by --fresh'))")"
  echo "Prompt:        $prompt_source"
  [[ "$prompt_source" == "generated from template" ]] && {
    echo "  verify cmd:  ${VERIFY_CMD:-(none — sessions locate the suite)}"
    echo "  notes file:  ${NOTES_FILE:-(none)}"
  }
  echo "Log dir:       $LOG_DIR"
  echo "Model:         $model_policy"
  if $handoff_live; then
    remaining=$(grep -c '^\- \[ \]' "$HANDOFF_FILE")
  else
    remaining=${#checklist_lines}
    echo "Checklist that would be created:"
    printf '  %s\n' "${checklist_lines[@]}"
  fi
  budget=$remaining
  [[ -n "$SESSIONS_OPT" ]] && (( SESSIONS_OPT < budget )) && budget=$SESSIONS_OPT
  last=$(ls "$LOG_DIR" 2>/dev/null | sed -nE 's/^session-([0-9]+)\.log$/\1/p' | sort -n | tail -1)
  echo "Plan:          $remaining file(s) unchecked; would run $budget session(s) starting at session $(( ${last:-0} + 1 ))."
  if (( BATCH_SLEEP > 0 )); then
    echo "Pacing:        ${INTRA_SLEEP}s between sessions; ${BATCH_SLEEP}s after every $BATCH_SIZE sessions (deliberate)."
  else
    echo "Pacing:        ${INTRA_SLEEP}s between sessions; reactive limit pause is the governor."
  fi
  exit 0
fi

# ---------------------------------------------------------------------------
# Materialize state: archive on --fresh, create handoff/prompt as needed.
# ---------------------------------------------------------------------------
if $FRESH; then
  ts=$(date +%Y%m%d-%H%M%S)
  [[ -f "$HANDOFF_FILE" ]] && mv "$HANDOFF_FILE" "$HANDOFF_FILE.archived-$ts" && \
    echo "Archived old handoff to $HANDOFF_FILE.archived-$ts"
  [[ -d "$LOG_DIR" ]] && mv "$LOG_DIR" "$LOG_DIR.archived-$ts" && \
    echo "Archived old logs to $LOG_DIR.archived-$ts"
fi
mkdir -p "$LOG_DIR"

if [[ ! -f "$HANDOFF_FILE" ]]; then
  {
    echo "# Bug-fix loop handoff"
    echo
    echo "One file reviewed per session, in the fixed order below. Sessions share NO context except this file — keep it complete and concise."
    echo
    echo "## Checklist"
    echo
    printf '%s\n' "${checklist_lines[@]}"
    echo
    echo "## Cross-file leads"
    echo
    echo "## Verified not bugs"
  } > "$HANDOFF_FILE"
  echo "Created $HANDOFF_FILE with ${#checklist_lines} file(s)."
fi

if [[ "$prompt_source" == "generated from template" ]]; then
  generate_prompt || exit 1
  echo "Generated $PROMPT_FILE from template."
fi
echo "Prompt: $prompt_source | Handoff: $HANDOFF_FILE | Target: $TARGET_DIR"

# ---------------------------------------------------------------------------
# Session-limit detection. If the given log contains a usage/session-limit
# message, echo the number of seconds to wait before retrying and return 0.
# ---------------------------------------------------------------------------
limit_wait_seconds() {
  local log="$1" line hour min ampm now target
  grep -qiE "(hit|reached).*(session|usage|weekly).*limit|limit reached" "$log" || return 1
  # Try to parse "resets 1:40am" / "resets 11 PM" (local timezone assumed).
  line=$(grep -iE 'resets' "$log" | head -1)
  if [[ "$line" =~ [Rr]esets[[:space:]]+([0-9]{1,2})(:([0-9]{2}))?[[:space:]]*([AaPp])\.?[Mm] ]]; then
    hour=$match[1]
    min=$(( 10#${match[3]:-0} ))
    ampm=${(L)match[4]}
    (( hour == 12 )) && hour=0
    [[ "$ampm" == "p" ]] && (( hour += 12 ))
    now=$(date +%s)
    target=$(date -j -f "%Y-%m-%d %H:%M:%S" \
      "$(date +%Y-%m-%d) $(printf '%02d:%02d:00' "$hour" "$min")" +%s 2>/dev/null)
    if [[ -n "$target" ]]; then
      (( target <= now )) && (( target += 86400 ))
      echo $(( target - now + LIMIT_BUFFER ))
      return 0
    fi
  fi
  # Limit message present but no parseable time — conservative fixed wait.
  echo "$LIMIT_FALLBACK_SLEEP"
  return 0
}

# ---------------------------------------------------------------------------
# Main loop. Budget = unchecked files (capped by --sessions); numbering
# continues after the highest existing log so reruns never clobber history.
# ---------------------------------------------------------------------------
remaining=$(grep -c '^\- \[ \]' "$HANDOFF_FILE")
if (( remaining == 0 )); then
  echo "All files reviewed — nothing to do."
  exit 0
fi
budget=$remaining
[[ -n "$SESSIONS_OPT" ]] && (( SESSIONS_OPT < budget )) && budget=$SESSIONS_OPT
last=$(ls "$LOG_DIR" 2>/dev/null | sed -nE 's/^session-([0-9]+)\.log$/\1/p' | sort -n | tail -1)
START=$(( ${last:-0} + 1 ))
END=$(( START + budget - 1 ))
echo "$remaining file(s) unchecked — running $budget session(s): $START..$END."

IS_GIT_REPO=$(git rev-parse --is-inside-work-tree 2>/dev/null)

i=$START
done_count=0
no_progress=0
while (( i <= END )); do
  # A mid-run cutoff (usage limit, kill, crash) surfaces no limit message —
  # it just leaves uncommitted WIP. Flag it; the prompt's Step 0 tells the
  # session how to validate-or-revert checklist-file WIP before reviewing.
  if [[ "$IS_GIT_REPO" == "true" && -n "$(git status --porcelain 2>/dev/null | grep -v '^??')" ]]; then
    echo "NOTE: working tree is dirty — possible WIP from an interrupted session. Step 0 of the prompt directs recovery."
  fi
  remaining_before=$(grep -c '^\- \[ \]' "$HANDOFF_FILE")

  # Pick this session's model from the next unchecked file's size. Recomputed
  # every iteration so limit retries and no-progress retries stay correct.
  typeset -a session_args
  session_args=("${CLAUDE_ARGS[@]}")
  if $AUTO_MODEL; then
    next_entry=$(grep -m1 '^\- \[ \]' "$HANDOFF_FILE")
    next_file=$(print -r -- "$next_entry" | sed -E 's/^- \[ \] //; s/ \([0-9]+\)[[:space:]]*$//')
    next_lines=$(print -r -- "$next_entry" | sed -nE 's/^.*\(([0-9]+)\)[[:space:]]*$/\1/p')
    [[ -f "$next_file" ]] && next_lines=$(wc -l < "$next_file" | tr -d ' ')
    if [[ -n "$next_lines" ]] && (( next_lines <= SONNET_MAX_LINES )); then
      session_args+=(--model sonnet)
      echo "Auto-model: $next_file ($next_lines lines <= $SONNET_MAX_LINES) -> --model sonnet"
    else
      echo "Auto-model: ${next_file:-?} (${next_lines:-unknown} lines > $SONNET_MAX_LINES) -> CLI default model"
    fi
  fi

  echo "=== Session $i starting at $(date) ==="
  claude -p "$(cat "$PROMPT_FILE")" \
    --dangerously-skip-permissions \
    "${session_args[@]}" \
    | tee "$LOG_DIR/session-$i.log"

  # A limit hit means the session did no work: park until the advertised
  # reset, then retry the SAME session number (no iteration consumed).
  if wait=$(limit_wait_seconds "$LOG_DIR/session-$i.log"); then
    mv "$LOG_DIR/session-$i.log" "$LOG_DIR/session-$i.limit-$(date +%Y%m%d-%H%M%S).log"
    (( wait < 60 )) && wait=60
    echo "Session limit hit. Pausing ${wait}s (until ~$(date -r $(( $(date +%s) + wait )))) then retrying session $i..."
    sleep "$wait"
    continue
  fi

  echo "=== Session $i finished at $(date) ==="
  (( done_count++ ))

  # Stop early once every checklist item is checked
  remaining_after=$(grep -c '^\- \[ \]' "$HANDOFF_FILE")
  if (( remaining_after == 0 )); then
    echo "All files reviewed — loop complete."
    break
  fi

  # A "finished" session that checked nothing off was probably cut off
  # mid-run (a usage limit hit during a session only surfaces on the NEXT
  # attempt). One retry is fine — the next session re-targets the same file
  # and Step 0 recovers its WIP — but two in a row means something is
  # systematically wrong; stop instead of burning the usage window.
  if (( remaining_after >= remaining_before )); then
    (( no_progress++ ))
    echo "WARNING: session $i made no checklist progress (interrupted or failed mid-run?). See $LOG_DIR/session-$i.log"
    if (( no_progress >= 2 )); then
      echo "Two consecutive sessions made no progress — stopping. Investigate the logs, then rerun to continue."
      break
    fi
  else
    no_progress=0
  fi

  if (( i < END )); then
    if (( BATCH_SLEEP > 0 && BATCH_SIZE > 0 && done_count % BATCH_SIZE == 0 )); then
      echo "Batch complete. Sleeping ${BATCH_SLEEP}s (deliberate pacing)..."
      sleep "$BATCH_SLEEP"
    elif (( INTRA_SLEEP > 0 )); then
      echo "Sleeping ${INTRA_SLEEP}s before next session..."
      sleep "$INTRA_SLEEP"
    fi
  fi
  (( i++ ))
done

if grep -q '^\- \[ \]' "$HANDOFF_FILE" 2>/dev/null; then
  echo "Session budget exhausted with unchecked files remaining."
  echo "Rerun (optionally with --resume) to continue from where it left off."
fi
