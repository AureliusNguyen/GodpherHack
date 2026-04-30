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
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
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

export const llmTokensTotal = new Counter({
  name: "godpherhack_llm_tokens_total",
  help: "LLM tokens by provider/model/direction.",
  labelNames: ["provider", "model", "kind"] as const,
  registers: [registry],
});
