import type { McpServerConfig } from "../mcp/types.js";
import { McpToolAdapter } from "../mcp/mcp-tool-adapter.js";

export const GHIDRA_MCP_DEFAULT_CONFIG: McpServerConfig = {
  name: "GhidraMCP",
  transport: "stdio",
  command: "python",
  args: ["bridge_mcp_ghidra.py"],
  timeoutMs: 60_000,
};

export const GHIDRA_TOOL_NAMES = [
  "list_methods",
  "list_classes",
  "decompile_function",
  "rename_function",
  "rename_data",
  "list_segments",
  "list_imports",
  "list_exports",
  "list_namespaces",
  "list_data_items",
  "search_functions_by_name",
  "rename_variable",
  "get_function_by_address",
  "get_current_address",
  "get_current_function",
  "list_functions",
  "decompile_function_by_address",
  "disassemble_function",
  "set_decompiler_comment",
  "set_disassembly_comment",
  "rename_function_by_address",
  "set_function_prototype",
  "set_local_variable_type",
  "get_xrefs_to",
  "get_xrefs_from",
  "get_function_xrefs",
  "list_strings",
] as const;

export function createGhidraAdapter(
  overrides?: Partial<McpServerConfig>,
): McpToolAdapter {
  return new McpToolAdapter({ ...GHIDRA_MCP_DEFAULT_CONFIG, ...overrides });
}
