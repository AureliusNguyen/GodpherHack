#!/usr/bin/env bash
# Stepped Locust ramp against the Hub. 5 -> MAX users in increments of 5,
# 30 seconds per step. Writes time-series CSV to bench/results/ramp-<ts>/
# and (if matplotlib is installed) plots users-vs-latency to chart.png.
#
# Usage:
#   ./bench/run-ramp.sh                                        # 5 -> 50 over 5 minutes
#   RAMP_MAX=100 RAMP_STEP_TIME=20 ./bench/run-ramp.sh         # bigger / faster
#   HOST=http://lab:3000 ./bench/run-ramp.sh                   # different host

set -euo pipefail

MAX="${RAMP_MAX:-50}"
STEP="${RAMP_STEP:-5}"
STEP_TIME="${RAMP_STEP_TIME:-30}"
HOST="${HOST:-${HUB_BASE_URL:-http://134.84.145.128:3000}}"
JWT="${LOCUST_JWT:-}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Reuse the venv from bench/run.sh
VENV="$REPO_ROOT/bench/.venv"
if [ ! -x "$VENV/bin/locust" ]; then
  echo "First run: creating bench venv..."
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet locust matplotlib
elif ! "$VENV/bin/python" -c "import matplotlib" 2>/dev/null; then
  echo "Adding matplotlib to bench venv..."
  "$VENV/bin/pip" install --quiet matplotlib
fi

ts="$(date +%Y%m%d-%H%M%S)"
out_dir="bench/results/ramp-${ts}"
mkdir -p "$out_dir"

# Total duration: enough to reach MAX + a bit of buffer. Ramp ends when
# tick() returns None; locust exits on its own. We cap with --run-time
# defensively in case the shape hangs.
total_steps=$(( (MAX + STEP - 1) / STEP ))
budget=$(( total_steps * STEP_TIME + 10 ))

echo "Ramp: 5 -> ${MAX} in increments of ${STEP}, ${STEP_TIME}s each (~${budget}s total) -> $HOST"
echo "Output: $out_dir/"

RAMP_MAX="$MAX" RAMP_STEP="$STEP" RAMP_STEP_TIME="$STEP_TIME" \
LOCUST_JWT="$JWT" \
"$VENV/bin/locust" \
  -f bench/locustfile-ramp.py \
  --host "$HOST" \
  --headless \
  --run-time "${budget}s" \
  --csv "$out_dir/stats" \
  --html "$out_dir/report.html"

echo
echo "Plotting..."
"$VENV/bin/python" bench/plot-ramp.py "$out_dir" || {
  echo "Plot failed (matplotlib missing?). CSV is still in $out_dir/."
  exit 0
}

echo
echo "Done. Open: $out_dir/chart.png  $out_dir/report.html"
