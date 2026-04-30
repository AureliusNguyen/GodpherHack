import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { AuthService, UserClaims } from "./auth.js";

export interface PresenceEntry {
  userId: string;
  login: string;
  name?: string;
  activity: string;
  challengeName?: string;
  lastSeen: number;
}

export interface FeedEvent {
  userId: string;
  login: string;
  runId: string;
  event: Record<string, unknown>;
  ts: number;
}

interface Connection {
  ws: WebSocket;
  user: UserClaims | null;
}

const FEED_BUFFER = 100;
const PRESENCE_TTL_MS = 60_000;
const GC_INTERVAL_MS = 10_000;

/**
 * In-memory collab hub. Multi-instance Hub should swap the maps
 * for Redis Pub/Sub; the broadcast/auth surface stays the same.
 */
export class CollabHub {
  private wss: WebSocketServer;
  private connections = new Map<WebSocket, Connection>();
  private presence = new Map<string, PresenceEntry>();
  private feed: FeedEvent[] = [];
  private gcTimer: NodeJS.Timeout | null = null;

  constructor(server: HttpServer, private auth: AuthService | null) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/ws/collab") {
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit("connection", ws, req);
      });
    });

    this.wss.on("connection", (ws) => this.onConnection(ws));
    this.gcTimer = setInterval(() => this.gc(), GC_INTERVAL_MS);
    this.gcTimer.unref?.();
  }

  close(): void {
    if (this.gcTimer) clearInterval(this.gcTimer);
    this.wss.close();
  }

  private onConnection(ws: WebSocket): void {
    const conn: Connection = { ws, user: null };
    this.connections.set(ws, conn);

    ws.on("message", async (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return; // ignore bad frames
      }
      await this.onMessage(conn, msg);
    });

    ws.on("close", () => this.onClose(conn));
    ws.on("error", () => this.onClose(conn));

    // 30s to authenticate, else close
    setTimeout(() => {
      if (!conn.user && ws.readyState === ws.OPEN) {
        this.send(ws, { type: "auth.error", error: "Auth timeout" });
        ws.close();
      }
    }, 30_000).unref?.();
  }

  private async onMessage(conn: Connection, msg: Record<string, unknown>): Promise<void> {
    const type = msg.type as string;

    if (type === "auth") {
      const token = msg.token as string;
      if (!this.auth) {
        // Auth disabled -- accept anonymous connection with synthetic identity
        conn.user = { sub: "anon", login: "anon" };
        this.send(conn.ws, { type: "auth.ok", user: conn.user });
        this.send(conn.ws, { type: "feed.snapshot", events: this.feed });
        return;
      }
      try {
        conn.user = await this.auth.verify(token);
      } catch (err) {
        this.send(conn.ws, {
          type: "auth.error",
          error: err instanceof Error ? err.message : "Invalid token",
        });
        conn.ws.close();
        return;
      }
      this.send(conn.ws, { type: "auth.ok", user: conn.user });
      this.send(conn.ws, { type: "feed.snapshot", events: this.feed });
      return;
    }

    if (!conn.user) {
      this.send(conn.ws, { type: "error", error: "Not authenticated" });
      return;
    }

    if (type === "presence") {
      const entry: PresenceEntry = {
        userId: conn.user.sub,
        login: conn.user.login,
        name: conn.user.name,
        activity: (msg.activity as string) ?? "idle",
        challengeName: msg.challengeName as string | undefined,
        lastSeen: Date.now(),
      };
      this.presence.set(conn.user.sub, entry);
      this.broadcastPresence();
      return;
    }

    if (type === "agent.event") {
      const event: FeedEvent = {
        userId: conn.user.sub,
        login: conn.user.login,
        runId: (msg.runId as string) ?? "unknown",
        event: (msg.event as Record<string, unknown>) ?? {},
        ts: Date.now(),
      };
      this.feed.push(event);
      if (this.feed.length > FEED_BUFFER) this.feed.shift();
      this.broadcast({ type: "feed.event", ...event });
      return;
    }
  }

  private onClose(conn: Connection): void {
    this.connections.delete(conn.ws);
    if (conn.user) {
      this.presence.delete(conn.user.sub);
      this.broadcastPresence();
    }
  }

  private broadcastPresence(): void {
    const users = Array.from(this.presence.values());
    this.broadcast({ type: "presence.update", users });
  }

  private broadcast(msg: unknown): void {
    const json = JSON.stringify(msg);
    for (const ws of this.connections.keys()) {
      if (ws.readyState === ws.OPEN) ws.send(json);
    }
  }

  private send(ws: WebSocket, msg: unknown): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private gc(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, entry] of this.presence) {
      if (now - entry.lastSeen > PRESENCE_TTL_MS) {
        this.presence.delete(id);
        changed = true;
      }
    }
    if (changed) this.broadcastPresence();
  }
}
