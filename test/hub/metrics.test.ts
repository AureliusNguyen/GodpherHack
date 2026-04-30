import { describe, it, expect, beforeEach } from "vitest";
import { createHub } from "../../src/hub/server.js";
import { InMemoryWriteupRepository } from "../../src/hub/repository/in-memory.js";
import { ChallengeAnalyzer } from "../../src/hub/services/analyzer.js";
import { registry } from "../../src/hub/services/instrumentation.js";

describe("Hub /metrics endpoint", () => {
  beforeEach(() => {
    registry.resetMetrics();
  });

  it("exposes Prometheus exposition format", async () => {
    const repo = new InMemoryWriteupRepository();
    const app = createHub({ repository: repo, analyzer: new ChallengeAnalyzer(null) });

    const res = await app.request("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type") ?? "").toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("godpherhack_http_requests_total");
  });

  it("counts HTTP requests it sees", async () => {
    const repo = new InMemoryWriteupRepository();
    const app = createHub({ repository: repo, analyzer: new ChallengeAnalyzer(null) });

    await app.request("/health");
    await app.request("/health");
    const res = await app.request("/metrics");
    const body = await res.text();

    // Must have recorded 2 GETs of /health with status 200.
    const lines = body.split("\n").filter((l) => l.startsWith("godpherhack_http_requests_total"));
    const healthLine = lines.find((l) => l.includes('route="/health"') && l.includes('status="200"'));
    expect(healthLine).toBeDefined();
    expect(healthLine).toMatch(/\s2$/); // counter ends with " 2"
  });
});
