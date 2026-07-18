#!/usr/bin/env bash
#
# Perf pass (U13 / R14): re-encode the app's referenced onboarding/splash videos
# to display-size dimensions and a lower bitrate to cut install size AND runtime
# decode cost. All target videos are DECORATIVE and played MUTED in code
# (player.muted = true in every consumer), so audio is dropped (-an). The two
# onboarding videos that carried an AAC track were verified silent (-91 dB).
#
# H.264 (libx264), yuv420p, faststart. CRF chosen per group:
#   - Atlantis welcome/splash loops (1080x1430, full-screen cover): keep dims,
#     CRF 24 (was ~6.2 Mbps VBR).
#   - Continent loops (544x720, already display size): keep dims, CRF 24.
#   - Onboarding slides (820x1080, phone-width frames): keep dims, CRF 24
#     (these were already the least oversized; conservative).
#
# Dimensions are PRESERVED (no upsc* / downscale) because every source is
# already at or below the max display size on device. We only reduce bitrate.
#
# Re-runnable: writes to a sibling ".reencoded" temp dir; the caller (or the
# --apply flag) moves outputs over the originals only after inspection.
#
# Usage:
#   scripts/reencode-videos.sh          # encode into *.reencoded/ (safe, no overwrite)
#   scripts/reencode-videos.sh --apply  # encode AND overwrite originals in place
#
# NOTE FOR EMERSON: review a screen-recording of onboarding, welcome, splash,
# and continent-intro after this runs to confirm no visible quality regression
# before shipping. CRF 24 is visually near-transparent for these loops, but the
# Atlantis full-screen background is the one to eyeball most closely.

set -euo pipefail

CRF=24
PRESET=slow

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONT_DIR="$MOBILE_DIR/assets/country-images/continents"
WONDERS_DIR="$MOBILE_DIR/assets/country-images/wonders-world"
ONB_DIR="$MOBILE_DIR/assets/onboarding-videos"

APPLY=0
if [[ "${1:-}" == "--apply" ]]; then APPLY=1; fi

# Only these are referenced in code (verified via require() search).
REFERENCED=(
  "$CONT_DIR/africa.mp4"
  "$CONT_DIR/asia.mp4"
  "$CONT_DIR/europe.mp4"
  "$CONT_DIR/oceania.mp4"
  "$CONT_DIR/north-america.mp4"
  "$WONDERS_DIR/Atlantis.mp4"
  "$WONDERS_DIR/Atlantis2.mp4"
  "$ONB_DIR/onboarding1-share.mp4"
  "$ONB_DIR/onboarding2-country-track.mp4"
  "$ONB_DIR/onboarding3-trips.mp4"
)

encode_one() {
  local in="$1"
  local dir base out
  dir="$(dirname "$in")"
  base="$(basename "$in")"
  local outdir="$dir/.reencoded"
  mkdir -p "$outdir"
  out="$outdir/$base"

  ffmpeg -hide_banner -loglevel error -y -i "$in" \
    -c:v libx264 -crf "$CRF" -preset "$PRESET" -pix_fmt yuv420p \
    -movflags +faststart -an "$out"

  local insize outsize
  insize=$(stat -f%z "$in")
  outsize=$(stat -f%z "$out")
  printf '  %-32s %6.2f MB -> %6.2f MB  (-%2.0f%%)\n' \
    "$base" \
    "$(echo "scale=2; $insize/1048576" | bc)" \
    "$(echo "scale=2; $outsize/1048576" | bc)" \
    "$(echo "scale=0; (1 - $outsize/$insize) * 100" | bc)"

  if [[ "$APPLY" == "1" ]]; then
    mv "$out" "$in"
    rmdir "$outdir" 2>/dev/null || true
  fi
}

echo "Re-encoding referenced videos (CRF=$CRF, preset=$PRESET, audio dropped)"
echo "======================================================================"
for f in "${REFERENCED[@]}"; do
  encode_one "$f"
done

if [[ "$APPLY" == "1" ]]; then
  echo ""
  echo "Applied in place. Originals overwritten."
else
  echo ""
  echo "Wrote re-encoded files to *.reencoded/ dirs. Re-run with --apply to overwrite."
fi
