#!/usr/bin/env bash
# Drive one mapped feature via Detox. Evidence lands in artifacts/$RUN_ID/.
set -euo pipefail

FEATURE="${1:?Usage: drive.sh <feature-id> [RUN_ID]}"
RUN_ID="${2:-$(cat "$(dirname "$0")/../.state/latest" 2>/dev/null || echo "")}"
if [[ -z "$RUN_ID" ]]; then
  RUN_ID="$(date +%Y%m%dT%H%M%S)"
fi

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
MOBILE="$ROOT/mobile"
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARTIFACTS="$SKILL_DIR/artifacts/$RUN_ID"
mkdir -p "$ARTIFACTS"

case "$FEATURE" in
  app-launch)
    TEST_FILE="e2e/smoke.e2e.ts"
    TEST_NAME="should launch the app successfully"
    ;;
  auth-signup)
    TEST_FILE="e2e/flows/auth.e2e.ts"
    TEST_NAME="creates a new account successfully"
    ;;
  tab-navigation)
    TEST_FILE="e2e/smoke.e2e.ts"
    TEST_NAME="should show welcome or logged in state"
    ;;
  trips-create)
    TEST_FILE="e2e/flows/trips.e2e.ts"
    TEST_NAME="creates a trip with name"
    ;;
  passport-grid)
    TEST_FILE="e2e/smoke.e2e.ts"
    TEST_NAME="should launch the app successfully"
    echo "NOTE: passport-grid has no dedicated Detox spec yet; smoke launch proves simulator + auth shell only." \
      >"$ARTIFACTS/passport-grid-skip-note.txt"
    ;;
  *)
    echo "Unknown feature: $FEATURE"
    echo "Valid: app-launch auth-signup tab-navigation trips-create passport-grid"
    exit 1
    ;;
esac

echo "Driving $FEATURE ($TEST_FILE :: $TEST_NAME)"
echo "Artifacts: $ARTIFACTS"

(
  cd "$MOBILE"
  npx detox test --configuration ios.sim.debug "$TEST_FILE" \
    --testNamePattern "$TEST_NAME" \
    --record-logs all \
    --take-screenshots failing \
    --artifacts-location "$ARTIFACTS/detox" \
    2>&1 | tee "$ARTIFACTS/drive.log"
)

echo "$FEATURE" >"$ARTIFACTS/feature.txt"
echo "$TEST_FILE" >>"$ARTIFACTS/feature.txt"
echo "$TEST_NAME" >>"$ARTIFACTS/feature.txt"
date -u +"%Y-%m-%dT%H:%M:%SZ" >"$ARTIFACTS/timestamp.txt"

echo "Done. Proof: $ARTIFACTS/drive.log"
