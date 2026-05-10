/** Content blocks returned by an LLM */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

/** Tool result content to send back to the LLM */
export interface ToolResultContent {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError?: boolean;
}

/** Messages for chatWithTools — supports structured content */
export type ProviderMessage =
  | { role: "user"; content: string }
  | { role: "user"; content: ToolResultContent[] }
  | { role: "assistant"; content: ContentBlock[] };

/** LLM response from chatWithTools */
export interface ChatResponse {
  content: ContentBlock[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
}

/** Tool definition sent to the LLM */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Tool executor function */
export type ToolExecutor = (args: Record<string, unknown>) => Promise<string>;

/** Tool definition paired with its executor */
export interface RegisteredTool {
  definition: ToolDefinition;
  execute: ToolExecutor;
}

/** Events yielded by the agent loop (UI consumes these) */
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; output: string; isError: boolean; durationMs: number }
  | { type: "turn_complete" }
  | { type: "error"; message: string };
