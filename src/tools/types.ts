export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolOutput {
  type: "text" | "binary" | "json" | "error";
  content: string;
  data?: unknown;
  mimeType?: string;
}

export interface ToolResult {
  toolName: string;
  success: boolean;
  output: ToolOutput;
  durationMs: number;
}

export interface ToolAdapter {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  listTools(): Promise<ToolInfo[]>;
  invoke(toolName: string, args: Record<string, unknown>): Promise<ToolResult>;
}
