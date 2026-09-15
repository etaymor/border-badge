#!/usr/bin/env bash
# Start backend + Metro for verification. Writes PIDs under .state/$RUN_ID/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
MOBILE="$ROOT/mobile"
BACKEND="$ROOT/backend"
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_ID="${RUN_ID:-$(date +%Y%m%dT%H%M%S)}"
STATE_DIR="$SKILL_DIR/.state/$RUN_ID"
mkdir -p "$STATE_DIR"

echo "RUN_ID=$RUN_ID"
echo "$RUN_ID" >"$STATE_DIR/run_id"
echo "$STATE_DIR" >"$SKILL_DIR/.state/latest"

ENV_FILE="$MOBILE/.env"
[[ -f "$MOBILE/.env.local" ]] && ENV_FILE="$MOBILE/.env.local"
API_URL="$(rg '^EXPO_PUBLIC_API_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"')"
HEALTH_URL="${API_URL%/}/health"

is_atlasi_health() {
  local url="$1"
  local body
  body="$(curl -sf --max-time 3 "$url" 2>/dev/null)" || return 1
  echo "$body" | rg -q '"status"\s*:\s*"ok"' || return 1
  echo "$body" | rg -q '"db"' && return 1
  return 0
}

if is_atlasi_health "$HEALTH_URL"; then
  echo "Backend already up: $HEALTH_URL"
elif is_atlasi_health "http://127.0.0.1:8000/health"; then
  echo "Backend already up on 127.0.0.1:8000 (simulator uses $HEALTH_URL — ensure uvicorn binds 0.0.0.0)"
else
  if lsof -ti :8000 >/dev/null 2>&1; then
    echo "Port 8000 is in use but health check failed. Stop the conflicting service (often Docker) or free the port."
    exit 1
  fi
  echo "Starting backend on :8000..."
  (cd "$BACKEND" && poetry run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000) \
    >"$STATE_DIR/backend.log" 2>&1 &
  echo $! >"$STATE_DIR/backend-wrapper.pid"
  for _ in $(seq 1 30); do
    if is_atlasi_health "$HEALTH_URL" || is_atlasi_health "http://127.0.0.1:8000/health"; then
      echo "Backend ready"
      break
    fi
    sleep 1
  done
  is_atlasi_health "$HEALTH_URL" || is_atlasi_health "http://127.0.0.1:8000/health" || {
    echo "Backend failed to start. See $STATE_DIR/backend.log"
    exit 1
  }
fi

if lsof -ti :8000 >/dev/null 2>&1; then
  lsof -ti :8000 | head -1 >"$STATE_DIR/backend.pid"
fi

if ! xcrun simctl list devices booted 2>/dev/null | rg -q "Booted"; then
  SIM_NAME=""
  for candidate in "iPhone 15" "iPhone 17" "iPhone 17 Pro" "iPhone 16" "iPhone 16 Pro"; do
    if xcrun simctl list devices available 2>/dev/null | rg -q "$candidate"; then
      SIM_NAME="$candidate"
      break
    fi
  done
  if [[ -z "$SIM_NAME" ]]; then
    echo "No known iPhone simulator found. Install one in Xcode or update mobile/.detoxrc.js device.name."
    exit 1
  fi
  echo "Booting $SIM_NAME simulator..."
  xcrun simctl boot "$SIM_NAME" 2>/dev/null || true
  open -a Simulator
fi

metro_ready() {
  curl -sf --max-time 2 http://127.0.0.1:8081/status 2>/dev/null | rg -q 'packager-status:running'
}

if ! metro_ready; then
  echo "Starting Metro (expo dev client) on :8081..."
  (cd "$MOBILE" && npx expo start --dev-client --port 8081) >"$STATE_DIR/metro.log" 2>&1 &
  echo $! >"$STATE_DIR/metro-wrapper.pid"
  for _ in $(seq 1 60); do
    if metro_ready; then
      echo "Metro ready on :8081"
      break
    fi
    sleep 1
  done
  metro_ready || {
    echo "Metro failed to start. See $STATE_DIR/metro.log"
    exit 1
  }
else
  echo "Metro already up on :8081"
fi

if lsof -ti :8081 >/dev/null 2>&1; then
  lsof -ti :8081 | head -1 >"$STATE_DIR/metro.pid"
fi

echo "Stack ready. State: $STATE_DIR"
echo "Next: bash .cursor/skills/verify-atlasi/scripts/doctor.sh"
