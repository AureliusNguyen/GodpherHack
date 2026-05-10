import type { ToolDefinition } from "../../agent/types.js";

/**
 * Curated subset of GhidraMCP tools sent to the LLM.
 * Keeps token overhead manageable (~10 tools instead of 27).
 */
export const GHIDRA_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "decompile_function",
    description: "Decompile a function by name using Ghidra, returning C-like pseudocode.",
    inputSchema: {
      type: "object",
      properties: {
        function_name: { type: "string", description: "Name of the function to decompile" },
      },
      required: ["function_name"],
    },
  },
  {
    name: "list_functions",
    description: "List all functions in the current Ghidra project.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_imports",
    description: "List all imported functions/symbols in the binary.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_exports",
    description: "List all exported functions/symbols in the binary.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_strings",
    description: "List all defined strings found in the binary.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "disassemble_function",
    description: "Disassemble a function by name, returning assembly instructions.",
    inputSchema: {
      type: "object",
      properties: {
        function_name: { type: "string", description: "Name of the function to disassemble" },
      },
      required: ["function_name"],
    },
  },
  {
    name: "get_xrefs_to",
    description: "Get all cross-references (callers/data refs) to a given address.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Address to find references to (e.g. '0x00401000')" },
      },
      required: ["address"],
    },
  },
  {
    name: "search_functions_by_name",
    description: "Search for functions matching a query string.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query to match against function names" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_classes",
    description: "List all classes/namespaces defined in the binary.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_function_by_address",
    description: "Get function information at a specific address.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Address of the function (e.g. '0x00401000')" },
      },
      required: ["address"],
    },
  },
];
