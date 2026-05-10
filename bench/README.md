# Hub load tests (Locust)

Locust scenarios for the GodpherHack Hub API. The agent itself isn't
benchmarked here -- solving CTF challenges is timing-noisy and hard to
compare run-to-run. This bench measures the parts that *can* be
measured reliably: the Hub's RAG path, the write path, and the health
endpoint, under concurrent load.

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install locust
```

## Run interactively

```bash
locust -f bench/locustfile.py --host http://localhost:3000
# Then open http://localhost:8089 to start a run.
```

## Run headless (CI-friendly)

```bash
locust -f bench/locustfile.py \
  --host http://localhost:3000 \
  --users 20 --spawn-rate 4 --run-time 60s \
  --headless --csv=bench/results/run
```

## With auth enabled

If the Hub was started with `JWT_SECRET` + `GITHUB_CLIENT_ID` +
`GITHUB_CLIENT_SECRET`, all routes except `/health`, `/auth/*`, and
`/metrics` require a JWT. Get one via:

```bash
godpherhack auth login
JWT=$(jq -r .token ~/.godpherhack/auth.json)
LOCUST_JWT=$JWT locust -f bench/locustfile.py --host http://localhost:3000
```

## Scenarios

| Task               | Weight | Endpoint                |
|--------------------|--------|-------------------------|
| HealthChecker      | 2x     | GET /health             |
| WriteupSearcher    | 5x     | POST /challenges/analyze |
| SolveSubmitter     | 1x     | POST /solves            |

The 5:2:1 ratio reflects the realistic shape: most traffic is
read-heavy RAG queries, health checks come from probes, writes are
rarer but heavier.
