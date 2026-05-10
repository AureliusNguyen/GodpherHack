import type { McpServerConfig } from "../mcp/types.js";
import { McpToolAdapter } from "../mcp/mcp-tool-adapter.js";

export const IDA_MCP_DEFAULT_CONFIG: McpServerConfig = {
  name: "IdaProMCP",
  transport: "stdio",
  command: "ida-pro-mcp",
  args: [],
  timeoutMs: 60_000,
};

export const IDA_TOOL_NAMES = [
  "decompile",
  "disasm",
  "list_funcs",
  "lookup_funcs",
  "imports",
  "list_globals",
  "xrefs_to",
  "xrefs_to_field",
  "callees",
  "find",
  "find_bytes",
  "find_regex",
  "get_bytes",
  "get_string",
  "basic_blocks",
  "callgraph",
  "export_funcs",
  "set_comments",
  "set_type",
  "rename",
  "patch_asm",
  "analyze_funcs",
  "py_eval",
] as const;

export function createIdaAdapter(
  overrides?: Partial<McpServerConfig>,
): McpToolAdapter {
  return new McpToolAdapter({ ...IDA_MCP_DEFAULT_CONFIG, ...overrides });
}
