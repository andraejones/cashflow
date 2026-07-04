#!/bin/zsh
# Runs the single-file bug-fix loop: one fresh headless Claude session per file.
# Each session reads bug-fix-session-prompt.md, fixes one file, updates
# bug-fix-handoff.md, bumps the build, commits, and pushes.
#
# Sessions run in BATCHES to spread cost across rolling 5-hour usage windows
# while still riding the 5-minute prompt cache within a batch:
#   - Within a batch: sessions run INTRA_SLEEP apart (default 240s; <= 270s
#     keeps the cache warm, so sessions 2..N of a batch consume much less
#     of the usage allotment).
#   - Between batches: BATCH_SLEEP (default 7200s = 2h) lets the usage
#     window roll over before the next batch starts.
#
# Usage: ./scripts/run-bug-fix-loop.sh
# Tune:  BATCH_SIZE=4 BATCH_SLEEP=5400 INTRA_SLEEP=240 ./scripts/run-bug-fix-loop.sh

cd "$(dirname "$0")/.." || exit 1
PROMPT_FILE="bug-fix-session-prompt.md"
HANDOFF_FILE="bug-fix-handoff.md"
LOG_DIR="scripts/bug-fix-logs"
BATCH_SIZE="${BATCH_SIZE:-3}"
BATCH_SLEEP="${BATCH_SLEEP:-3600}"
INTRA_SLEEP="${INTRA_SLEEP:-240}"
mkdir -p "$LOG_DIR"

for i in {1..14}; do
  echo "=== Session $i starting at $(date) ==="
  claude -p "$(cat "$PROMPT_FILE")" \
    --dangerously-skip-permissions \
    | tee "$LOG_DIR/session-$i.log"
  echo "=== Session $i finished at $(date) ==="

  # Stop early once every checklist item is checked
  if [[ -f "$HANDOFF_FILE" ]] && ! grep -q '^\- \[ \]' "$HANDOFF_FILE"; then
    echo "All files reviewed — loop complete."
    break
  fi

  if (( i % BATCH_SIZE == 0 )); then
    echo "Batch complete. Sleeping ${BATCH_SLEEP}s to let the usage window roll..."
    sleep "$BATCH_SLEEP"
  else
    echo "Sleeping ${INTRA_SLEEP}s (cache stays warm) before next session..."
    sleep "$INTRA_SLEEP"
  fi
done
