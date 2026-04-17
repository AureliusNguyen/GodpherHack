import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { ToolAdapter, ToolInfo, ToolResult, ToolOutput } from "../types.js";
import type { McpServerConfig } from "./types.js";

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

  async connect(): Promise<void> {
    if (this.connected) return;

    const transport = this.createTransport();
    this.client = new Client({ name: "godpherhack", version: "0.1.0" });
    await this.client.connect(transport);
    this.connected = true;
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

  async listTools(): Promise<ToolInfo[]> {
    if (this.cachedTools) return this.cachedTools;
    const client = this.getClient();

    const tools: ToolInfo[] = [];
    let cursor: string | undefined;

    do {
      const result = await client.listTools(cursor ? { cursor } : undefined);
      for (const tool of result.tools) {
        tools.push({
          name: tool.name,
          description: tool.description ?? "",
          inputSchema: tool.inputSchema as Record<string, unknown>,
        });
      }
      cursor = result.nextCursor;
    } while (cursor);

    this.cachedTools = tools;
    return tools;
  }

  async invoke(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const client = this.getClient();

    const start = performance.now();
    let output: ToolOutput;
    let success: boolean;

    try {
      const result = await client.callTool({ name: toolName, arguments: args });

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
