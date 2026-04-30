#!/usr/bin/env bash
# Run a Locust benchmark against a running Hub.
#
# Defaults are tuned for a quick presentation capture. Override any of
# them via env vars. Examples:
#
#   ./bench/run.sh                       # 30 users, 60s, 3/sec ramp
#   USERS=100 ./bench/run.sh             # bigger
#   USERS=200 RUN_S=180 ./bench/run.sh   # bigger and longer
#   HOST=http://lab:3000 ./bench/run.sh  # against a remote Hub

set -euo pipefail

USERS="${USERS:-30}"
RAMP="${RAMP:-3}"
RUN_S="${RUN_S:-60}"
HOST="${HOST:-http://localhost:3000}"
JWT="${LOCUST_JWT:-}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Use a dedicated venv so pyenv-shim weirdness on /mnt/c can't break us.
# First run creates it (~10s); later runs reuse it.
VENV="$REPO_ROOT/bench/.venv"
if [ ! -x "$VENV/bin/locust" ]; then
  echo "First run: creating bench venv..."
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet locust
fi

ts="$(date +%Y%m%d-%H%M%S)"
out_dir="bench/results/run-${USERS}u-${ts}"
mkdir -p "$out_dir"

echo "Bench: $USERS users, ${RUN_S}s, ramp ${RAMP}/s -> $HOST"
echo "Output: $out_dir/"

LOCUST_JWT="$JWT" "$VENV/bin/locust" \
  -f bench/locustfile.py \
  --host "$HOST" \
  --users "$USERS" \
  --spawn-rate "$RAMP" \
  --run-time "${RUN_S}s" \
  --headless \
  --html "$out_dir/report.html" \
  --csv "$out_dir/stats" \
  --print-stats

echo
echo "Done. Open: $out_dir/report.html"
