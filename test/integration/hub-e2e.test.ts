/**
 * End-to-end integration smoke test.
 *
 * Boots a real http server via @hono/node-server (the same path the
 * `godpherhack hub` command uses), exercises the full happy path
 * across multiple endpoints, and asserts that auth, write, search,
 * metrics, and the websocket upgrade all wire together correctly.
 *
 * What this catches that unit tests do not:
 *  - Hono.fetch() vs the Node http boundary (stream handling, etc.)
 *  - JWT middleware ordering relative to route mounting
 *  - /metrics scoping vs requireJwt
 *  - Counter increments that only fire when requests actually flow
 *    through the middleware chain (not just app.request())
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import type { Server as HttpServer } from "node:http";
import { AuthService } from "../../src/hub/services/auth.js";
import { InMemoryWriteupRepository } from "../../src/hub/repository/in-memory.js";
import { ChallengeAnalyzer } from "../../src/hub/services/analyzer.js";
import { createHub } from "../../src/hub/server.js";
import { CollabHub } from "../../src/hub/services/collab-hub.js";
import { registry } from "../../src/hub/services/instrumentation.js";

const cfg = {
  jwtSecret: "test-secret-must-be-long-enough-for-hs256",
  githubClientId: "client",
  githubClientSecret: "secret",
  hubBaseUrl: "http://localhost:0",
};

interface TestStack {
  port: number;
  baseUrl: string;
  auth: AuthService;
  collab: CollabHub;
  server: HttpServer;
  shutdown: () => Promise<void>;
}

async function spinUp(): Promise<TestStack> {
  registry.resetMetrics();
  const auth = new AuthService(cfg);
  const repo = new InMemoryWriteupRepository();
  const app = createHub({ repository: repo, analyzer: new ChallengeAnalyzer(null), auth });

  let server!: HttpServer;
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, () => resolve()) as unknown as HttpServer;
  });
  const collab = new CollabHub(server, auth);

  const addr = server.address();
  if (typeof addr !== "object" || addr === null) throw new Error("no address");
  const port = addr.port;

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    auth,
    collab,
    server,
    async shutdown() {
      collab.close();
      await new Promise<void>((res) => server.close(() => res()));
    },
  };
}

describe("Hub end-to-end", () => {
  let stack: TestStack;

  beforeAll(async () => { stack = await spinUp(); });
  afterAll(async () => { await stack.shutdown(); });

  it("/health is publicly reachable without a JWT", async () => {
    const res = await fetch(`${stack.baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; indexGeneration: number };
    expect(body.status).toBe("ok");
    expect(body.indexGeneration).toBe(0);
  });

  it("rejects /solves when no Authorization header is sent", async () => {
    const res = await fetch(`${stack.baseUrl}/solves`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("accepts a valid JWT and increments indexGeneration after a solve", async () => {
    const token = await stack.auth.issue({ sub: "1", login: "alice" });

    const submitRes = await fetch(`${stack.baseUrl}/solves`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        challengeName: "e2e_smoke_chal",
        category: "rev",
        writeup: "Decompiled main, found XOR key 0x42, recovered flag.",
        executionSteps: ["ghidra decompile", "xor with 0x42"],
        tools: ["ghidra"],
        keyInsights: ["single-byte XOR"],
        flag: "flag{e2e_smoke}",
      }),
    });

    expect(submitRes.status).toBe(200);
    const submitted = await submitRes.json() as { stored: boolean; id: string };
    expect(submitted.stored).toBe(true);
    expect(submitted.id).toMatch(/^[0-9a-f]{16}$/);

    // indexGeneration must have bumped from 0 -> 1 after the write
    const healthRes = await fetch(`${stack.baseUrl}/health`);
    const health = await healthRes.json() as { indexGeneration: number };
    expect(health.indexGeneration).toBe(1);
  });

  it("/metrics exposes counters that show the prior requests", async () => {
    const res = await fetch(`${stack.baseUrl}/metrics`);
    expect(res.status).toBe(200);
    const body = await res.text();

    // We hit /health twice and /solves once so far.
    expect(body).toContain("godpherhack_http_requests_total");
    expect(body).toContain('route="/health"');
    expect(body).toContain('route="/solves"');
    // agent_runs_total is incremented by /solves
    expect(body).toMatch(/godpherhack_agent_runs_total\s+1/);
  });

  it("rejects a JWT signed with the wrong secret", async () => {
    const otherAuth = new AuthService({ ...cfg, jwtSecret: "different-secret-still-long-enough" });
    const badToken = await otherAuth.issue({ sub: "evil", login: "evil" });

    const res = await fetch(`${stack.baseUrl}/solves`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${badToken}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("WebSocket upgrade survives an http request on the same port", async () => {
    // Just verify the WS endpoint is reachable; the dedicated collab-hub
    // test covers handshake + presence + fan-out.
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(`ws://127.0.0.1:${stack.port}/ws/collab`);
    await new Promise<void>((res, rej) => {
      ws.on("open", () => res());
      ws.on("error", rej);
    });
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});
