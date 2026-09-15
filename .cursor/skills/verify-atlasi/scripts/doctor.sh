#!/usr/bin/env bash
# Read-only: is the Atlasi verification stack worth driving?
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
MOBILE="$ROOT/mobile"
BACKEND="$ROOT/backend"
FAIL=0

pass() { echo "OK  $1"; }
fail() { echo "FAIL $1"; FAIL=1; }

echo "=== verify-atlasi doctor ==="

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "macOS required for iOS simulator verification"
else
  pass "macOS"
fi

if command -v xcodebuild >/dev/null 2>&1; then
  pass "Xcode CLI"
else
  fail "xcodebuild not found"
fi

if [[ -f "$MOBILE/.env" || -f "$MOBILE/.env.local" ]]; then
  ENV_FILE="$MOBILE/.env"
  [[ -f "$MOBILE/.env.local" ]] && ENV_FILE="$MOBILE/.env.local"
  pass "mobile env ($ENV_FILE)"
  if rg -q 'EXPO_PUBLIC_API_URL=http://(127\.0\.0\.1|localhost)' "$ENV_FILE" 2>/dev/null; then
    fail "EXPO_PUBLIC_API_URL uses localhost; iOS simulator needs your LAN IP (see docs/environment-setup.md)"
  else
    pass "EXPO_PUBLIC_API_URL is not localhost"
  fi
else
  fail "missing mobile/.env or mobile/.env.local"
fi

if [[ -f "$BACKEND/.env" ]]; then
  pass "backend/.env"
else
  fail "missing backend/.env"
fi

if [[ -d "$MOBILE/node_modules" ]]; then
  pass "mobile node_modules"
else
  fail "run: cd mobile && npm install"
fi

if [[ -d "$BACKEND/.venv" ]] || poetry -C "$BACKEND" env info -p >/dev/null 2>&1; then
  pass "backend poetry env"
else
  fail "run: cd backend && poetry install"
fi

is_atlasi_health() {
  local url="$1"
  local body
  body="$(curl -sf --max-time 3 "$url" 2>/dev/null)" || return 1
  echo "$body" | rg -q '"status"\s*:\s*"ok"' || return 1
  echo "$body" | rg -q '"db"' && return 1
  return 0
}

API_URL="$(rg '^EXPO_PUBLIC_API_URL=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
HEALTH_URL="${API_URL%/}/health"
if is_atlasi_health "$HEALTH_URL"; then
  pass "backend health ($HEALTH_URL)"
elif is_atlasi_health "http://127.0.0.1:8000/health"; then
  fail "backend on 127.0.0.1:8000 only — simulator needs $HEALTH_URL reachable (uvicorn --host 0.0.0.0, port not taken by Docker)"
else
  fail "backend not reachable at $HEALTH_URL — start with: bash .cursor/skills/verify-atlasi/scripts/launch-stack.sh (free port 8000 if Docker occupies it)"
fi

if xcrun simctl list devices booted 2>/dev/null | rg -q "Booted"; then
  pass "iOS simulator booted"
else
  fail "no booted simulator — run: bash .cursor/skills/verify-atlasi/scripts/launch-stack.sh"
fi

APP_BIN="$MOBILE/ios/build/Build/Products/Debug-iphonesimulator/Atlasi.app"
if [[ -d "$APP_BIN" ]]; then
  pass "Detox app binary ($APP_BIN)"
else
  fail "app not built — run: cd mobile && npm run e2e:build:ios"
fi

if (cd "$MOBILE" && npx detox --version >/dev/null 2>&1); then
  pass "detox (npx)"
else
  fail "detox unavailable — run: cd mobile && npm install"
fi

if curl -sf --max-time 2 http://127.0.0.1:8081/status 2>/dev/null | rg -q 'packager-status:running'; then
  pass "Metro bundler on :8081"
else
  fail "Metro not running — debug Detox builds need: bash .cursor/skills/verify-atlasi/scripts/launch-stack.sh"
fi

exit "$FAIL"
