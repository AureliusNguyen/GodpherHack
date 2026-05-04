#!/usr/bin/env bash
# Saturation sweep: run flat-load Locust tests at increasing concurrent
# users so we can plot users-vs-latency and find where the Hub starts
# degrading. Default sweep is 50 100 200 400.
#
# Usage:
#   LOCUST_JWT=<token> ./bench/run-saturation.sh
#   LOCUST_JWT=<token> ./bench/run-saturation.sh 50 100 200 400 800
#   LOCUST_JWT=<token> RUN_S=120 ./bench/run-saturation.sh
#   LOCUST_JWT=<token> HOST=http://lab:3000 ./bench/run-saturation.sh

set -euo pipefail

USERS_LIST=("${@:-50 100 200 400}")
[ "$#" -eq 0 ] && USERS_LIST=(50 100 200 400)

HOST="${HOST:-${HUB_BASE_URL:-http://localhost:3000}}"
RUN_S="${RUN_S:-60}"
TOKEN="${LOCUST_JWT:-}"

if [ -z "$TOKEN" ]; then
  echo "WARNING: LOCUST_JWT not set. If the Hub has auth enabled,"
  echo "every request will return 401. Get a token via:"
  echo "  jq -r .token ~/.godpherhack/auth.json"
  echo
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ts="$(date +%Y%m%d-%H%M%S)"
out_dir="bench/results/saturation-${ts}"
mkdir -p "$out_dir"

# Pick a locust binary: prefer venv, fall back to user install.
LOCUST="$REPO_ROOT/bench/.venv/bin/locust"
if [ ! -x "$LOCUST" ]; then
  LOCUST="$(command -v locust || true)"
  [ -z "$LOCUST" ] && LOCUST="python3 -m locust"
fi

for u in "${USERS_LIST[@]}"; do
  spawn_rate=$(( u / 10 ))
  [ "$spawn_rate" -lt 1 ] && spawn_rate=1
  echo
  echo "=== $u users for ${RUN_S}s ==="
  LOCUST_JWT="$TOKEN" $LOCUST \
    -f bench/locustfile.py \
    --host "$HOST" \
    --users "$u" --spawn-rate "$spawn_rate" \
    --run-time "${RUN_S}s" --headless --only-summary \
    --csv "$out_dir/run-${u}u" \
    --html "$out_dir/run-${u}u.html"
done

echo
echo "=== Plotting ==="
python3 bench/plot-saturation.py "$out_dir" || \
  echo "plot-saturation.py failed; raw CSVs are in $out_dir/"

echo
echo "Done. Output: $out_dir/"
