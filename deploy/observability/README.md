# Observability

Prometheus + Grafana stack for the Hub. Provisioned dashboards land in
the `GodpherHack` folder of the running Grafana instance.

## Run locally

```bash
# from the repo root
docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d
```

- Hub:        http://localhost:3000
- Prometheus: http://localhost:9090
- Grafana:    http://localhost:3001 (default login: admin / admin)

## What ships

- `prometheus.yml` -- single scrape job against `hub:3000/metrics`,
  15s interval. External label `cluster=godpherhack-local`.
- `grafana/provisioning/datasources/prometheus.yml` -- auto-adds the
  Prometheus datasource as default.
- `grafana/provisioning/dashboards/godpherhack.yml` -- file-based
  provider that watches `/var/lib/grafana/dashboards` for JSON.
- `grafana/dashboards/godpherhack.json` -- starter dashboard with:
  request rate by route, p95 latency, total agent runs, Pinecone ops
  by kind, 5xx rate, LLM tokens.

## In Kubernetes

Use kube-prometheus-stack (Prometheus operator) + the ServiceMonitor in
`deploy/k8s/servicemonitor.yaml`. The dashboard JSON works there too:
import via Grafana UI, or wire up a ConfigMap with the
`grafana_dashboard: "1"` label so the sidecar picks it up.
