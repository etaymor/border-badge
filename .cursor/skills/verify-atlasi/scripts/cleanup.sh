#!/usr/bin/env bash
# Tear down processes this verification run started. Never deletes artifacts/.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_ID="${1:-$(cat "$SKILL_DIR/.state/latest" 2>/dev/null || echo "")}"

if [[ -z "$RUN_ID" ]]; then
  echo "No RUN_ID and no .state/latest — nothing to clean"
  exit 0
fi

STATE_DIR="$SKILL_DIR/.state/$RUN_ID"
if [[ ! -d "$STATE_DIR" ]]; then
  echo "No state dir for RUN_ID=$RUN_ID"
  exit 0
fi

stop_pid() {
  local name="$1" file="$2"
  if [[ -f "$file" ]]; then
    local pid
    pid="$(cat "$file")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "Stopping $name (pid $pid)"
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$file"
  fi
}

stop_pid "metro" "$STATE_DIR/metro.pid"
stop_pid "metro-wrapper" "$STATE_DIR/metro-wrapper.pid"
stop_pid "backend" "$STATE_DIR/backend.pid"
stop_pid "backend-wrapper" "$STATE_DIR/backend-wrapper.pid"

ARTIFACTS="$SKILL_DIR/artifacts/$RUN_ID"
if [[ -d "$ARTIFACTS" ]]; then
  echo "Artifacts preserved at: $ARTIFACTS"
else
  echo "No artifacts dir for this run"
fi

rm -rf "$STATE_DIR"
echo "Removed state: $STATE_DIR"
