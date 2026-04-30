import WebSocket from "ws";
import { readStoredToken } from "./auth-client.js";
import type { PresenceEntry, FeedEvent } from "../hub/services/collab-hub.js";
import type { AgentEvent } from "../agent/types.js";

export type CollabMessage =
  | { type: "auth.ok"; user: { sub: string; login: string } }
  | { type: "auth.error"; error: string }
  | { type: "feed.snapshot"; events: FeedEvent[] }
  | { type: "feed.event"; userId: string; login: string; runId: string; event: Record<string, unknown>; ts: number }
  | { type: "presence.update"; users: PresenceEntry[] };

export interface CollabHandlers {
  onPresence?: (users: PresenceEntry[]) => void;
  onFeedEvent?: (event: FeedEvent) => void;
  onFeedSnapshot?: (events: FeedEvent[]) => void;
  onAuthError?: (error: string) => void;
  onClose?: () => void;
  onOpen?: () => void;
}

const PRESENCE_HEARTBEAT_MS = 10_000;

export class CollabClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private currentActivity = "idle";
  private currentChallenge: string | undefined = undefined;
  private closed = false;

  constructor(
    private hubBaseUrl: string,
    private handlers: CollabHandlers = {},
  ) {}

  connect(): void {
    if (this.ws || this.closed) return;
    const token = readStoredToken(this.hubBaseUrl) ?? "anonymous";
    const wsUrl = this.hubBaseUrl.replace(/^http/, "ws") + "/ws/collab";

    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "auth", token }));
    });

    ws.on("message", (data) => {
      let msg: CollabMessage;
      try {
        msg = JSON.parse(data.toString()) as CollabMessage;
      } catch {
        return;
      }
      this.dispatch(msg);
    });

    ws.on("close", () => {
      this.ws = null;
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.handlers.onClose?.();
    });

    ws.on("error", () => {
      // Swallow -- onClose will fire too. Caller treats this as "Hub down".
    });
  }

  private dispatch(msg: CollabMessage): void {
    switch (msg.type) {
      case "auth.ok":
        this.handlers.onOpen?.();
        this.startHeartbeat();
        break;
      case "auth.error":
        this.handlers.onAuthError?.(msg.error);
        break;
      case "feed.snapshot":
        this.handlers.onFeedSnapshot?.(msg.events);
        break;
      case "feed.event":
        this.handlers.onFeedEvent?.({
          userId: msg.userId,
          login: msg.login,
          runId: msg.runId,
          event: msg.event,
          ts: msg.ts,
        });
        break;
      case "presence.update":
        this.handlers.onPresence?.(msg.users);
        break;
    }
  }

  private startHeartbeat(): void {
    this.sendPresence();
    this.heartbeatTimer = setInterval(() => this.sendPresence(), PRESENCE_HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
  }

  setActivity(activity: string, challengeName?: string): void {
    this.currentActivity = activity;
    this.currentChallenge = challengeName;
    this.sendPresence();
  }

  emitAgentEvent(runId: string, event: AgentEvent): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "agent.event", runId, event }));
  }

  private sendPresence(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: "presence",
      activity: this.currentActivity,
      challengeName: this.currentChallenge,
    }));
  }

  close(): void {
    this.closed = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.ws) this.ws.close();
  }
}
