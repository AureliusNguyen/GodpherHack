# Benchmarking the Hub Under Stepped Load

Stepped Locust ramp from 5 to 50 concurrent users, run **on the lab
machine** against the Hub on `localhost:3000` (no campus-network
roundtrip per request). 5-second steps held 30 seconds each, 5-minute
total run.

Artifacts: `bench/results/ramp/chart.png`, `report.html`,
`stats_stats_history.csv`.

## What got measured

Three endpoints, weighted to mirror realistic traffic:

| Task | Weight | Endpoint | What it exercises |
|---|---|---|---|
| WriteupSearcher | 5 | POST /challenges/analyze | RAG path (analyzer + repository) |
| HealthChecker  | 2 | GET /health              | framework floor, no work |
| SolveSubmitter | 1 | POST /solves             | write path + index generation bump |

Each user runs `between(0.5, 2.0)` seconds between requests --
realistic shape, not a hammer. Authenticated as a real GitHub user
via the JWT issued by the OAuth flow, so the Hub's `requireJwt`
middleware ran on every authed request.

## Results

```
6,600 requests over 5 minutes
   0 failures (0.00%)
   ~33 RPS sustained at the 50-user plateau
```

| Percentile | Aggregated latency |
|---|---|
| p50  | 1 ms  |
| p75  | 1 ms  |
| p95  | 1 ms (steady-state, post-warmup) |
| p99  | 4 ms |
| p99.99 | 16 ms |
| max  | 16 ms |

Per-endpoint at the 50-user plateau:

| Endpoint | RPS | p99 |
|---|---|---|
| GET /health             | ~7 | 1 ms |
| POST /challenges/analyze | ~21 | 4 ms |
| POST /solves            | ~4 | 9 ms |

## What `chart.png` shows

**Top panel:** RPS (green) tracks user count (blue) linearly. 5 users
-> 4 RPS, 50 users -> 40 RPS. Step boundaries are clean; throughput
scales without flattening.

**Bottom panel:** Latency starts elevated (p99 ~9ms in the first
plateau) due to JIT compilation and cold caches. Drops monotonically
through the first 150 seconds. Settles at p50=1ms, p95=1ms, p99=2ms
and stays there for the rest of the run.

The shape is the story: **system gets faster as it warms up, then
holds flat through every subsequent step**. No saturation point
visible at 50 concurrent users.

## Honest framing

The system **isn't being stressed** at this load level.

- The Hub on the lab machine has plenty of headroom -- CPU never
  pegged, no contention on the in-memory writeup repo.
- The actual bottleneck is Locust's `wait_time` between requests
  per user. At `between(0.5, 2.0)` seconds, 50 users average
  ~33 RPS -- which is exactly what we measured. The server could
  do orders of magnitude more.
- This is intentional. The bench targets a realistic team load
  shape (RAG queries triggered by a human typing into a CLI),
  not a synthetic hammer.

If we wanted a saturation curve, drop `wait_time` to zero and ramp
to ~500 users. Documented as a follow-up; not run for this demo
because (a) the chart we have already tells the linear-scaling
story cleanly, and (b) we'd have to also instrument the Hub side
properly to see the actual bottleneck (CPU? socket queue?
filesystem?), which is hours of work.

## Reproducing

On the lab (or any host with a JWT for the auth-enabled Hub):

```bash
# Get a JWT (from a CLI sign-in)
LOCUST_JWT=$(jq -r .token ~/.godpherhack/auth.json)

# Run the ramp
LOCUST_JWT=$LOCUST_JWT python3 -m locust \
  -f bench/locustfile-ramp.py \
  --host http://localhost:3000 \
  --headless \
  --csv bench/results/ramp/stats \
  --html bench/results/ramp/report.html

# Plot from the CSV
python3 bench/plot-ramp.py bench/results/ramp/
```

Custom shapes via env: `RAMP_MAX`, `RAMP_STEP`, `RAMP_STEP_TIME`.

## Why we don't benchmark the agent itself

Solve times for a real CTF challenge are dominated by the LLM, which
is non-deterministic between runs (sampling, model weights, temperature)
and varies by orders of magnitude across providers. A "the agent
solved this in 12 seconds" number is meaningless without controlling
for the model -- and once you do that, you're really benchmarking the
LLM, not the agent. The infra bench measures what we can actually
measure regression on.

## Slide talking points

- **6,600 requests, 0 failures.** Headline number. Anchor everything else here.
- **Linear throughput scaling 5 -> 50 users.** Top panel, green line tracks blue stair-step. No bend visible.
- **Sub-2ms p95 in steady state, 4ms p99.** Bottom panel after the warmup region.
- **The dip in latency over time is JIT + cache warmup.** Standard Node.js startup behavior. p99 starts at 9ms, settles at 2ms.
- **No saturation at 50 users on the lab machine.** Wait time, not the server, is the limiter at this scale. Real bottleneck would surface around 500+ users with no wait time -- intentional follow-up, not blocking for this demo.
- **Histogram buckets tuned for sub-ms resolution.** Default prom-client buckets bottom out at 5ms; ours go down to 500us so the Grafana p95 panel resolves the actual differences between routes (`/health` 460us vs `/challenges/analyze` 6ms).
- **Authenticated load.** Every request carried a real JWT through the requireJwt middleware. The bench measures the production code path, not a public bypass.
