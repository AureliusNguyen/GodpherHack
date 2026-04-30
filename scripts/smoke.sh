#!/usr/bin/env bash
# End-to-end deployment smoke for the Hub + observability stack.
#
# What this does:
#   1. docker build the Hub image from the repo root
#   2. docker compose up the full stack (hub + prometheus + grafana)
#   3. wait for /health to come up
#   4. POST a fake solve (auth is disabled in this run, so no JWT needed)
#   5. POST a search to /challenges/analyze that should match the solve
#   6. assert indexGeneration on /health bumped, and /metrics counters
#      reflect the traffic we just generated
#   7. assert Prometheus is actually scraping the hub target
#   8. assert Grafana provisioned the Prometheus datasource and the
#      GodpherHack dashboard
#   9. tear down on success
#
# Usage:
#   ./scripts/smoke.sh             # full run, tears down at the end
#   ./scripts/smoke.sh --keep      # leave the stack up after passing
#
# What it intentionally does NOT cover:
#   - GitHub OAuth (requires a registered OAuth App + a human in the
#     loop). Smoke runs with auth disabled.
#   - Pinecone (uses in-memory repo so the run is hermetic).
#   - The Ink UI (no headless terminal harness).

set -euo pipefail

KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

HUB_URL="http://localhost:3000"
PROM_URL="http://localhost:9090"
GRAFANA_URL="http://localhost:3001"
GRAFANA_AUTH="admin:admin"

PASS="\033[32mOK\033[0m"
FAIL="\033[31mFAIL\033[0m"
INFO="\033[36m..\033[0m"

step()  { printf "[$INFO] %s\n" "$*"; }
ok()    { printf "[$PASS] %s\n" "$*"; }
die()   { printf "[$FAIL] %s\n" "$*" >&2; exit 1; }

cleanup() {
  if [[ $KEEP -eq 1 ]]; then
    echo
    step "Leaving stack up (--keep). Tear down with: docker compose down -v"
    return
  fi
  echo
  step "Tearing down..."
  docker compose -f docker-compose.yml -f docker-compose.observability.yml down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

require() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required but not on PATH"
}

require docker
require curl
require jq

# 1. build
step "Building Hub image..."
docker build -t godpherhack/hub:dev . >/tmp/godpherhack-build.log 2>&1 \
  || { tail -40 /tmp/godpherhack-build.log; die "docker build failed (full log: /tmp/godpherhack-build.log)"; }
ok "image built (godpherhack/hub:dev)"

# 2. boot stack with auth disabled and pinecone forced off (hermetic run)
step "Starting docker compose stack..."
PINECONE_API_KEY="" \
JWT_SECRET="" \
GITHUB_CLIENT_ID="" \
GITHUB_CLIENT_SECRET="" \
ALLOW_ANONYMOUS_HUB="true" \
docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d \
  --force-recreate >/tmp/godpherhack-up.log 2>&1 \
  || { tail -40 /tmp/godpherhack-up.log; die "docker compose up failed"; }
ok "stack started"

# 3. wait for /health
step "Waiting for Hub /health..."
for i in {1..40}; do
  if curl -fsS "$HUB_URL/health" >/dev/null 2>&1; then
    ok "Hub is reachable"
    break
  fi
  sleep 1
  if [[ $i -eq 40 ]]; then
    docker compose logs hub | tail -40
    die "Hub did not come up within 40s"
  fi
done

INITIAL_GEN=$(curl -fsS "$HUB_URL/health" | jq -r .indexGeneration)
[[ "$INITIAL_GEN" == "0" ]] || die "expected indexGeneration=0, got $INITIAL_GEN"
ok "/health reports indexGeneration=0"

# 4. POST a fake solve
step "Submitting a synthetic solve..."
SOLVE=$(curl -fsS -X POST "$HUB_URL/solves" \
  -H "Content-Type: application/json" \
  -d '{
    "challengeName": "smoke_test_chal",
    "category": "rev",
    "writeup": "Smoke test writeup. Decompiled main, found XOR key 0x42, recovered flag.",
    "executionSteps": ["smoke step 1", "smoke step 2"],
    "tools": ["smoke", "bash"],
    "keyInsights": ["smoke insight"],
    "flag": "flag{smoke}"
  }')
SOLVE_ID=$(echo "$SOLVE" | jq -r .id)
[[ "$SOLVE_ID" =~ ^[0-9a-f]{16}$ ]] || die "unexpected solve id: $SOLVE_ID"
ok "solve stored (id=$SOLVE_ID)"

# 5. POST a search that should match the writeup we just submitted
step "Querying /challenges/analyze..."
ANALYZE=$(curl -fsS -X POST "$HUB_URL/challenges/analyze" \
  -H "Content-Type: application/json" \
  -d '{
    "challenge": {
      "name": "smoke search",
      "description": "decompiled binary with XOR encoded flag",
      "files": [],
      "hints": []
    },
    "topK": 3
  }') || die "/challenges/analyze failed"
echo "$ANALYZE" | jq . >/dev/null || die "analyze returned non-JSON"

# Assert the search actually returned the solve we just submitted.
# (In-memory repo + matching keywords -> the solve must be in topWriteups.)
HITS=$(echo "$ANALYZE" | jq -r '.topWriteups[].id // empty')
echo "$HITS" | grep -qx "$SOLVE_ID" \
  || die "topWriteups did not contain the submitted solve ($SOLVE_ID); got: $HITS"
ok "/challenges/analyze returned topWriteups containing $SOLVE_ID"

# 6. /health indexGeneration bumped
NEW_GEN=$(curl -fsS "$HUB_URL/health" | jq -r .indexGeneration)
[[ "$NEW_GEN" -gt "$INITIAL_GEN" ]] || die "indexGeneration did not bump (still $NEW_GEN)"
ok "/health indexGeneration bumped: $INITIAL_GEN -> $NEW_GEN"

# 6b. /metrics shows the traffic
step "Validating /metrics counters..."
METRICS=$(curl -fsS "$HUB_URL/metrics")
echo "$METRICS" | grep -q 'godpherhack_http_requests_total' \
  || die "/metrics missing godpherhack_http_requests_total"
echo "$METRICS" | grep -q 'godpherhack_agent_runs_total 1' \
  || die "/metrics missing agent_runs_total or value != 1"
ok "/metrics shows http_requests_total + agent_runs_total=1"

# 7. Prometheus scraping the hub
step "Waiting for Prometheus to scrape hub..."
for i in {1..30}; do
  TARGETS=$(curl -fsS "$PROM_URL/api/v1/targets" 2>/dev/null || echo "")
  if echo "$TARGETS" | jq -e '.data.activeTargets[] | select(.labels.job=="godpherhack-hub" and .health=="up")' >/dev/null 2>&1; then
    ok "Prometheus target godpherhack-hub is up"
    break
  fi
  sleep 1
  if [[ $i -eq 30 ]]; then
    echo "$TARGETS" | jq '.data.activeTargets' || true
    die "Prometheus never marked the hub target up"
  fi
done

# 8. Grafana datasource + dashboard
step "Waiting for Grafana to provision..."
for i in {1..30}; do
  if curl -fsS -u "$GRAFANA_AUTH" "$GRAFANA_URL/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
  [[ $i -eq 30 ]] && die "Grafana did not respond within 30s"
done

DS=$(curl -fsS -u "$GRAFANA_AUTH" "$GRAFANA_URL/api/datasources")
echo "$DS" | jq -e '.[] | select(.name=="Prometheus" and .isDefault==true)' >/dev/null \
  || { echo "$DS" | jq .; die "Prometheus datasource not provisioned in Grafana"; }
ok "Grafana has Prometheus datasource"

DASH=$(curl -fsS -u "$GRAFANA_AUTH" "$GRAFANA_URL/api/search?query=GodpherHack")
echo "$DASH" | jq -e '.[] | select(.uid=="godpherhack-hub")' >/dev/null \
  || { echo "$DASH" | jq .; die "GodpherHack dashboard not found"; }
ok "Grafana has the GodpherHack dashboard"

echo
echo -e "[\033[32mPASS\033[0m] smoke run complete"
echo
echo "  Hub:        $HUB_URL"
echo "  Prometheus: $PROM_URL  (Status -> Targets)"
echo "  Grafana:    $GRAFANA_URL  (admin / admin -> Dashboards -> GodpherHack)"
echo
[[ $KEEP -eq 1 ]] || step "Stack will be torn down on exit (use --keep to preserve)"
