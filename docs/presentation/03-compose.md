# Docker Compose Stack

Multi-container local stack for the Hub plus its observability sidecar.
Compose is the deployment shape for "one team on one machine" -- a CTF
club running the platform on a lab server, a VPS, or a teammate's
laptop. The Kubernetes manifests in `deploy/k8s/` cover the next
deployment scale; same image, different orchestrator.

## File layout

```
docker-compose.yml                         # base stack (hub only)
docker-compose.observability.yml           # overlay (adds prometheus + grafana)
deploy/observability/
  prometheus.yml                           # scrape config
  grafana/
    provisioning/
      datasources/prometheus.yml           # auto-add Prometheus DS
      dashboards/godpherhack.yml           # dashboard provider
    dashboards/godpherhack.json            # the actual dashboard
```

## What's in the base stack

`docker-compose.yml` defines one service: `hub`.

- Built from `./Dockerfile` (multi-stage, see `01-docker-image-analysis.md`)
- Exposes port `3000` on the host
- Reads env vars: `PINECONE_API_KEY`, `JWT_SECRET`, `GITHUB_CLIENT_*`,
  `HUB_BASE_URL`, `ALLOW_ANONYMOUS_HUB`
- Healthcheck hits `/health` every 15s using Node's global fetch
- Restart policy: `unless-stopped`

Run alone:

```bash
docker compose up
```

This is enough for a small team using the Hub through the CLI.

## What the observability overlay adds

`docker-compose.observability.yml` layers on two more services:

- **`prometheus` (prom/prometheus:v2.55.1)** -- scrapes
  `hub:3000/metrics` every 15s, retains 15 days, exposes UI on `:9090`
- **`grafana` (grafana/grafana:11.3.0)** -- queries Prometheus,
  renders the provisioned `GodpherHack Hub` dashboard, exposes UI on
  `:3001` (port 3000 inside the container, mapped to 3001 on the host
  to avoid clashing with the Hub)

Run with the overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.observability.yml up
```

## Network topology

All three containers live on the default Compose network. Container
names are DNS hostnames inside that network, which is why
`prometheus.yml` references `hub:3000` rather than `localhost:3000`.

```
   host:3000  --->  hub:3000   (port mapping for browser/CLI access)
   host:9090  --->  prometheus:9090
   host:3001  --->  grafana:3000

Inside the Compose network:
   prometheus  ----- /metrics scrape -----> hub
   grafana     ----- PromQL query   -----> prometheus
```

## How `scripts/smoke.sh` uses Compose

The smoke test boots the entire stack via Compose, exercises every
endpoint, asserts metrics flow end to end, and tears down on exit. It
forces `PINECONE_API_KEY=""` and `ALLOW_ANONYMOUS_HUB=true` so the run
is hermetic (no external services, no real auth needed).

Run with `--keep` to leave the stack up after the assertions pass --
that's how we generated the bench + Grafana screenshots in
`docs/presentation/screenshots/`.

## Inspecting the running stack

```bash
docker compose -f docker-compose.yml -f docker-compose.observability.yml \
  ps --format "table {{.Name}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
```

Returns three rows: `godpherhack-hub`, `godpherhack-prometheus`,
`godpherhack-grafana`. Hub status reads `healthy` once the healthcheck
passes (~15s after start).

Verify Prometheus is actually scraping:

```bash
curl -s http://localhost:9090/api/v1/targets | \
  jq '.data.activeTargets[] | {job: .labels.job, health, lastScrape}'
```

Expect `health: "up"` for `godpherhack-hub`.

## Slide talking points

- One file (`docker-compose.yml`) brings up the whole platform on a
  single host. That's the deployment shape for a small CTF team.
- Observability is a separate overlay file. Teams that don't want
  Prometheus/Grafana skip it. No bloat in the base stack.
- Same `godpherhack/hub:dev` image used here ships unchanged to
  Kubernetes. The orchestrator is the variable, not the artifact.
- Healthcheck uses Node 22's global fetch -- no extra binary in the
  image just to call /health.
- Grafana dashboards are provisioned from JSON files mounted at
  startup. The dashboard exists the moment Grafana boots; no manual
  click-through to set it up.
