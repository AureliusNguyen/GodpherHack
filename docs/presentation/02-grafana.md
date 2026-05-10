# Grafana Dashboard Walkthrough

Panel-by-panel script for the observability slide. Each section is short
enough to deliver while pointing at the relevant panel on the screenshot.

Screenshot: `docs/presentation/screenshots/grafana.png`.

## Panel 1: HTTP requests / sec by route (top-left)

> "This is real traffic from a 30-user load test. Each colored line is a
> different endpoint. The blue area on top is `/challenges/analyze` --
> RAG queries, the dominant traffic. Below that, `/health` from
> container probes, `/metrics` from Prometheus scraping itself, and
> `/solves` writes. The 5:2:1 ratio matches the realistic shape we
> modeled: read-heavy RAG, periodic probes, occasional writes."

Point at: the peak (~14 req/sec), call out it's load-test traffic.

## Panel 2: p95 request latency by route (top-right)

The strongest panel. Tells the load-recovery story.

> "Latency under the same load. The blue band on top is
> `/challenges/analyze` -- idles around 2ms, climbs to 6ms at peak load,
> decays as load drops. The `/health` endpoint stays around 460
> microseconds throughout -- that is the framework floor, what any HTTP
> request costs before doing real work. The 13x gap between health and
> analyze is the actual cost of the RAG search, not measurement noise."

Point at: the rising blue curve, then the flat green line below it.

## Panel 3: Agent runs (total)

> "Counts every successful solve submission. 132 in the cumulative
> window. This is the metric you would alert on if a CI pipeline started
> spamming the Hub."

Quick mention. Don't dwell.

## Panel 4: Pinecone operations / sec ("No data")

Pre-empt the question -- a judge will ask if you skip it.

> "Empty by design. This run uses the in-memory repository for hermetic
> load testing, so no Pinecone traffic. With `PINECONE_API_KEY` set,
> this panel shows search, upsert, and delete rates per second."

## Panel 5: Error rate (5xx / sec) ("No data")

Frame "No data" as success, not gap.

> "Also empty, but for a different reason: zero 5xx errors across 1217
> requests. The panel only renders when there are errors. An empty panel
> here is the goal."

## Panel 6: Request count by status code (bottom)

> "Same traffic broken out by HTTP status. One green band -- all 200s.
> No 4xx, no 5xx. The 100 percent success rate from the Locust report
> rendered as a continuous time series."

Tie back to the Locust number explicitly so the audience hears the
two visuals corroborate each other.

## Wrap-up line

> "Three things this dashboard proves:
> One -- observability is real, not theater. Every request is measured
> and shipped to Prometheus.
> Two -- the system is healthy under load. Sub-10ms p95 across all
> routes, zero failures.
> Three -- the empty panels are honest defaults. When Pinecone or
> errors light up, this dashboard catches them. We did not hide them
> to make the demo look cleaner."

## Notes for delivery

- The 460 microseconds health-endpoint number is worth memorizing. It
  separates "we measured properly" from "we just slapped a chart on
  it."
- If asked "why is /metrics in the request rate?" -- Prometheus is
  scraping it every 15s; that's the steady ~0.07 req/sec baseline.
- If asked about the histogram bucket choice -- the buckets go down
  to 500 microseconds at the low end so sub-millisecond latencies
  resolve cleanly. Earlier we had a coarser config that put
  everything in the 0-5ms bucket and produced a useless flat line;
  fixed during prep.
