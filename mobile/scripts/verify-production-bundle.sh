#!/usr/bin/env bash
#
# Preflight for a production `eas update`.
#
# Builds the exact bundle `eas update` would publish and greps the compiled
# output for a local/private API URL. This catches the failure that shipped a
# broken production update:
#
#   1. `eas update` bundles LOCALLY, so it inlines EXPO_PUBLIC_* from whatever
#      env the shell has. Without `--environment production` that is this
#      machine's mobile/.env - a LAN IP. The in-app guard in src/config/env.ts
#      does NOT catch it, because that same .env also sets
#      EXPO_PUBLIC_APP_ENV=development, so the guard reads the bundle as a dev
#      build and stays quiet.
#   2. Metro's transform cache survives an env change. Even with the env fixed,
#      a cached module keeps the previously inlined URL, so the old LAN IP gets
#      re-baked into a "fixed" publish. This is why the bug outlived the first
#      round of fixes. `--clear` is not optional here.
#
# Greps the Hermes bytecode rather than trusting the env, because the bundle is
# the artifact that actually ships.

set -euo pipefail

cd "$(dirname "$0")/.."

OUT_DIR="${TMPDIR:-/tmp}/atlasi-production-preflight"
rm -rf "$OUT_DIR"

echo "==> Exporting production bundle (cleared cache, EAS production env)"
npx eas env:exec production \
  "npx expo export --platform ios --clear --output-dir '$OUT_DIR'"

BUNDLE=$(find "$OUT_DIR/_expo/static/js/ios" -name '*.hbc' | head -1)
if [ -z "$BUNDLE" ]; then
  echo "FAIL: no iOS bundle produced at $OUT_DIR" >&2
  exit 1
fi

echo "==> Scanning $(basename "$BUNDLE")"

# Any of these in a production bundle means dev env leaked in.
# The port is part of the match so the allowlist below can pin an exact
# host:port rather than blanket-excusing every localhost URL.
BAD_PATTERN='https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})(:[0-9]+)?'

# @supabase/auth-js hardcodes `GOTRUE_URL = 'http://localhost:9999'` as a default
# it never uses (we always construct the client with an explicit supabaseUrl), so
# that literal is in every bundle we will ever ship. It is the only allowed hit;
# anything else matching BAD_PATTERN is our own env leaking in.
VENDOR_ALLOWLIST='http://localhost:9999'

if strings "$BUNDLE" | grep -oE "$BAD_PATTERN" | grep -vFx "$VENDOR_ALLOWLIST" | sort -u | grep .; then
  echo "" >&2
  echo "FAIL: the production bundle contains a local/private URL (shown above)." >&2
  echo "Do NOT publish. Re-run with --environment production and a cleared cache." >&2
  exit 1
fi

# The real backend must actually be present - an empty API URL would also pass
# the negative check above while breaking every request.
# grep -c, not grep -q: under `set -o pipefail` a -q match closes the pipe early,
# `strings` dies with SIGPIPE, and the pipeline reports failure on success.
if [ "$(strings "$BUNDLE" | grep -c 'https://atlasi\.app')" -eq 0 ]; then
  echo "FAIL: production bundle never mentions https://atlasi.app." >&2
  echo "EXPO_PUBLIC_API_URL did not reach the bundle." >&2
  exit 1
fi

echo "PASS: no local/private URLs; https://atlasi.app is present."
