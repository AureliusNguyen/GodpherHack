import { Registry, Counter, Histogram, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: "godpherhack_" });

export const httpRequestsTotal = new Counter({
  name: "godpherhack_http_requests_total",
  help: "Total HTTP requests handled by the Hub.",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: "godpherhack_http_request_duration_seconds",
  help: "HTTP request duration in seconds.",
  labelNames: ["method", "route"] as const,
  // Fine-grained low-end so sub-5ms latencies (the common case for the
  // RAG path) resolve cleanly. Coarse high-end so we still capture
  // pathological slow requests without exploding cardinality.
  buckets: [
    0.0005, 0.001, 0.002, 0.003, 0.005, 0.0075,
    0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
  ],
  registers: [registry],
});

export const agentRunsTotal = new Counter({
  name: "godpherhack_agent_runs_total",
  help: "Total agent runs (every /solves submission counts as one).",
  registers: [registry],
});

export const pineconeQueriesTotal = new Counter({
  name: "godpherhack_pinecone_queries_total",
  help: "Pinecone operations partitioned by kind.",
  labelNames: ["kind"] as const,
  registers: [registry],
});
