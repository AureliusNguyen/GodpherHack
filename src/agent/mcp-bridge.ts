import type { ToolAdapter, ToolResult } from "../tools/types.js";
import type { RegisteredTool, ToolDefinition } from "./types.js";

export interface McpToolPack {
  /** Display name for this pack (e.g. "GhidraMCP") */
  name: string;
  /** Key used to load prompts/tools/<promptKey>.md (defaults to name) */
  promptKey?: string;
  /** Static tool definitions sent to the LLM */
  tools: ToolDefinition[];
  /** Factory that creates a fresh adapter instance */
  createAdapter: () => ToolAdapter;
}

/**
 * Bridge between MCP tool packs and the agent loop's RegisteredTool interface.
 * Adapters are lazily connected on first tool invocation.
 */
export class McpToolBridge {
  private packs: McpToolPack[];
  /** Pack name → connected adapter */
  private adapters = new Map<string, ToolAdapter>();
  /** Pack name → in-flight connection promise (deduplicates concurrent connects) */
  private connecting = new Map<string, Promise<ToolAdapter>>();
  /** Tool name → pack name (for routing invocations) */
  private toolToPack = new Map<string, string>();

  constructor(packs: McpToolPack[]) {
    this.packs = packs;
    for (const pack of packs) {
      for (const tool of pack.tools) {
        this.toolToPack.set(tool.name, pack.name);
      }
    }
  }

  /** Get prompt keys for all configured packs (used to load prompts/tools/<key>.md) */
  getPromptKeys(): string[] {
    return this.packs.map((p) => p.promptKey ?? p.name);
  }

  /** Get RegisteredTool[] for all packs — executors lazy-connect on first call */
  getTools(): RegisteredTool[] {
    const tools: RegisteredTool[] = [];
    for (const pack of this.packs) {
      for (const tool of pack.tools) {
        tools.push({
          definition: tool,
          execute: (args) => this.executeTool(pack, tool.name, args),
        });
      }
    }
    return tools;
  }

  /** Disconnect all active adapters */
  async disconnectAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const adapter of this.adapters.values()) {
      promises.push(adapter.disconnect());
    }
    await Promise.all(promises);
    this.adapters.clear();
    this.connecting.clear();
  }

  private async getAdapter(pack: McpToolPack): Promise<ToolAdapter> {
    // Already connected — verify still alive
    const existing = this.adapters.get(pack.name);
    if (existing) {
      if (existing.isConnected()) return existing;
      // Dead connection — discard so we reconnect
      this.adapters.delete(pack.name);
    }

    // Connection in flight — deduplicate
    const inflight = this.connecting.get(pack.name);
    if (inflight) return inflight;

    // Start new connection
    const promise = (async () => {
      const adapter = pack.createAdapter();
      await adapter.connect();
      this.adapters.set(pack.name, adapter);
      this.connecting.delete(pack.name);
      return adapter;
    })();

    this.connecting.set(pack.name, promise);
    return promise;
  }

  private async executeTool(
    pack: McpToolPack,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    try {
      const adapter = await this.getAdapter(pack);
      const result: ToolResult = await adapter.invoke(toolName, args);
      if (!result.success) {
        return `Error: ${result.output.content}`;
      }
      return result.output.content;
    } catch (err) {
      // Clear dead adapter so next call retries connection
      this.adapters.delete(pack.name);
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
