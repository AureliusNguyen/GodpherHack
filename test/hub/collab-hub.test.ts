import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { AddressInfo } from "node:net";
import WebSocket from "ws";
import { CollabHub } from "../../src/hub/services/collab-hub.js";
import { AuthService } from "../../src/hub/services/auth.js";

const cfg = {
  jwtSecret: "test-secret-must-be-long-enough-for-hs256",
  githubClientId: "client",
  githubClientSecret: "secret",
  hubBaseUrl: "http://localhost:3000",
};

/**
 * Buffer all messages received on a WebSocket. Tests pop them in order
 * via next()/nextWhere() instead of racing setup of one-shot listeners.
 */
function buffered(ws: WebSocket) {
  const queue: Record<string, unknown>[] = [];
  const waiters: Array<(m: Record<string, unknown>) => void> = [];

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    const w = waiters.shift();
    if (w) w(msg);
    else queue.push(msg);
  });

  function next(timeoutMs = 1000): Promise<Record<string, unknown>> {
    if (queue.length > 0) return Promise.resolve(queue.shift()!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("recv timeout")), timeoutMs);
      waiters.push((m) => { clearTimeout(timer); resolve(m); });
    });
  }

  async function nextWhere(
    pred: (m: Record<string, unknown>) => boolean,
    timeoutMs = 2000,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const m = await next(deadline - Date.now());
      if (pred(m)) return m;
    }
    throw new Error("predicate not satisfied");
  }

  return { next, nextWhere };
}

describe("CollabHub", () => {
  let server: Server;
  let hub: CollabHub;
  let port: number;
  let auth: AuthService;

  beforeEach(async () => {
    auth = new AuthService(cfg);
    server = createServer();
    hub = new CollabHub(server, auth);
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", () => res()));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    hub.close();
    await new Promise<void>((res) => server.close(() => res()));
  });

  async function connect() {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/collab`);
    await new Promise<void>((res) => ws.on("open", () => res()));
    return { ws, buf: buffered(ws) };
  }

  it("rejects connections with an invalid token", async () => {
    const { ws, buf } = await connect();
    ws.send(JSON.stringify({ type: "auth", token: "not-a-jwt" }));
    const msg = await buf.next();
    expect(msg.type).toBe("auth.error");
    ws.close();
  });

  it("accepts a valid token and sends the feed snapshot", async () => {
    const token = await auth.issue({ sub: "1", login: "alice" });
    const { ws, buf } = await connect();
    ws.send(JSON.stringify({ type: "auth", token }));

    const ok = await buf.next();
    expect(ok.type).toBe("auth.ok");
    const snap = await buf.next();
    expect(snap.type).toBe("feed.snapshot");
    expect(Array.isArray(snap.events)).toBe(true);
    ws.close();
  });

  it("broadcasts presence updates between connected clients", async () => {
    const aliceToken = await auth.issue({ sub: "alice", login: "alice" });
    const bobToken = await auth.issue({ sub: "bob", login: "bob" });

    const a = await connect();
    const b = await connect();

    a.ws.send(JSON.stringify({ type: "auth", token: aliceToken }));
    b.ws.send(JSON.stringify({ type: "auth", token: bobToken }));

    await a.buf.nextWhere((m) => m.type === "auth.ok");
    await b.buf.nextWhere((m) => m.type === "auth.ok");

    a.ws.send(JSON.stringify({ type: "presence", activity: "solving rev/foo" }));

    const update = await b.buf.nextWhere((m) => {
      if (m.type !== "presence.update") return false;
      const users = m.users as Array<{ login: string; activity: string }>;
      return users.some((u) => u.login === "alice" && u.activity === "solving rev/foo");
    });
    expect(update.type).toBe("presence.update");

    a.ws.close();
    b.ws.close();
  });

  it("fans out agent events to all connected clients", async () => {
    const aliceToken = await auth.issue({ sub: "alice", login: "alice" });
    const bobToken = await auth.issue({ sub: "bob", login: "bob" });

    const a = await connect();
    const b = await connect();

    a.ws.send(JSON.stringify({ type: "auth", token: aliceToken }));
    b.ws.send(JSON.stringify({ type: "auth", token: bobToken }));
    await a.buf.nextWhere((m) => m.type === "auth.ok");
    await b.buf.nextWhere((m) => m.type === "auth.ok");

    a.ws.send(JSON.stringify({
      type: "agent.event",
      runId: "run_1",
      event: { type: "tool_call", name: "bash" },
    }));

    const fan = await b.buf.nextWhere((m) => m.type === "feed.event");
    expect(fan.login).toBe("alice");
    expect(fan.runId).toBe("run_1");

    a.ws.close();
    b.ws.close();
  });
});
