#!/bin/bash
# render-overlay.sh — renders one overlay state to a transparent 1920x1080 PNG
# for DaVinci Resolve. Uses headless Chrome; no dependencies.
#
# Usage:
#   ./render-overlay.sh '<query params>' out.png
#
# Examples:
#   ./render-overlay.sh 'hg=0&ag=0&clock=00:00&period=1' 0-0.png
#   ./render-overlay.sh 'hg=1&ag=0&clock=07:13&period=1&scorers=L. Modrić' 1-0.png
#   ./render-overlay.sh 'hg=2&ag=1&clock=18:42&period=2&scorers=L. Modrić*2&scorersAway=A. Kramarić' 2-1.png
#   ./render-overlay.sh 'summary=1&hg=2&ag=1&board=0' kraj.png
#
# Full parameter list: see the comment at the top of overlay-render.html.

set -euo pipefail

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
HTML="$(cd "$(dirname "$0")" && pwd)/overlay-render.html"

# ---- EDIT: match defaults (team names + kit colors, hex without #) ----------
BASE='home=Ogrevanje Zamuda&away=Primavita&hj=2563eb&hs=ffffff&aj=ec4899&as=111827'
# -----------------------------------------------------------------------------

PARAMS="${1:?usage: ./render-overlay.sh '<query params>' out.png}"
OUT="${2:?missing output png path}"

# User params first — URLSearchParams.get() returns the first occurrence,
# so per-call values override BASE defaults.
QUERY="${PARAMS}&${BASE}"
QUERY="${QUERY// /%20}"

"$CHROME" --headless --disable-gpu \
  --default-background-color=00000000 \
  --hide-scrollbars \
  --window-size=1920,1080 \
  --virtual-time-budget=2000 \
  --screenshot="$OUT" \
  "file://${HTML}?${QUERY}" 2>/dev/null

echo "OK -> $OUT"
