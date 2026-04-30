import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { ToolAdapter, ToolInfo, ToolResult, ToolOutput } from "../types.js";
import type { McpServerConfig } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/** Distinguishable from regular SDK errors so callers can mark the adapter dead. */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/** Race a promise against a timeout. Rejects with TimeoutError on timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    timer.unref?.();
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export class McpToolAdapter implements ToolAdapter {
  readonly name: string;
  private config: McpServerConfig;
  private client: Client | null = null;
  private connected = false;
  private cachedTools: ToolInfo[] | null = null;

  constructor(config: McpServerConfig) {
    this.name = config.name;
    this.config = config;
  }

  private get timeoutMs(): number {
    return this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const transport = this.createTransport();
    const client = new Client({ name: "godpherhack", version: "0.1.0" });
    this.client = client;
    try {
      await withTimeout(client.connect(transport), this.timeoutMs, `${this.name}.connect`);
      this.connected = true;
    } catch (err) {
      // If the timeout fired because the wire is wedged, awaiting
      // close() here can hang the same way -- defeating the timeout.
      // markDead() is fire-and-forget on close() for exactly this case.
      this.markDead();
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected || !this.client) return;
    await this.client.close();
    this.client = null;
    this.connected = false;
    this.cachedTools = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Tear down a wedged client without awaiting (timeout paths can't
   * trust the underlying SDK to respond). After this, isConnected()
   * returns false so the bridge will reconnect on the next call.
   */
  private markDead(): void {
    const client = this.client;
    this.client = null;
    this.connected = false;
    this.cachedTools = null;
    if (client) {
      // Fire and forget; the timeout already proved the wire is unhappy.
      client.close().catch(() => { /* already gone */ });
    }
  }

  async listTools(): Promise<ToolInfo[]> {
    if (this.cachedTools) return this.cachedTools;
    const client = this.getClient();

    const tools: ToolInfo[] = [];
    let cursor: string | undefined;

    try {
      do {
        const result = await withTimeout(
          client.listTools(cursor ? { cursor } : undefined),
          this.timeoutMs,
          `${this.name}.listTools`,
        );
        for (const tool of result.tools) {
          tools.push({
            name: tool.name,
            description: tool.description ?? "",
            inputSchema: tool.inputSchema as Record<string, unknown>,
          });
        }
        cursor = result.nextCursor;
      } while (cursor);
    } catch (err) {
      // A timeout means the wire is wedged; reset so the bridge
      // reconnects next call. listTools is allowed to throw, so
      // re-raise after cleanup.
      if (err instanceof TimeoutError) this.markDead();
      throw err;
    }

    this.cachedTools = tools;
    return tools;
  }

  async invoke(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const client = this.getClient();

    const start = performance.now();
    let output: ToolOutput;
    let success: boolean;

    try {
      const result = await withTimeout(
        client.callTool({ name: toolName, arguments: args }),
        this.timeoutMs,
        `${this.name}.${toolName}`,
      );

      // Normalize MCP result to ToolOutput
      if ("content" in result && Array.isArray(result.content)) {
        const textParts: string[] = [];
        for (const c of result.content) {
          if (typeof c === "object" && c !== null && "type" in c && c.type === "text" && "text" in c) {
            textParts.push(c.text as string);
          }
        }

        output = {
          type: "text",
          content: textParts.join("\n"),
        };
        success = !result.isError;
      } else {
        output = {
          type: "json",
          content: JSON.stringify(result),
          data: result,
        };
        success = true;
      }
    } catch (err) {
      // Timeout means the cached client is unusable; tear it down so
      // the next bridge call hits getAdapter() -> isConnected() ===
      // false -> fresh adapter. Other errors (tool-level failure) are
      // returned as success: false but leave the connection alone.
      if (err instanceof TimeoutError) this.markDead();
      output = {
        type: "error",
        content: err instanceof Error ? err.message : String(err),
      };
      success = false;
    }

    const durationMs = Math.round(performance.now() - start);

    return { toolName, success, output, durationMs };
  }

  private createTransport() {
    if (this.config.transport === "stdio") {
      if (!this.config.command) {
        throw new Error(`McpServerConfig "${this.name}": stdio transport requires "command"`);
      }
      return new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        env: this.config.env,
      });
    }

    if (this.config.transport === "sse") {
      if (!this.config.url) {
        throw new Error(`McpServerConfig "${this.name}": sse transport requires "url"`);
      }
      return new SSEClientTransport(new URL(this.config.url));
    }

    throw new Error(`Unknown transport: ${this.config.transport}`);
  }

  private getClient(): Client {
    if (!this.connected || !this.client) {
      throw new Error(`McpToolAdapter "${this.name}" is not connected — call connect() first`);
    }
    return this.client;
  }
}
