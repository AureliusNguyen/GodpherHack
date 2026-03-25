import type { ToolDefinition } from "../../agent/types.js";

/**
 * Curated subset of IDA Pro MCP tools sent to the LLM.
 * Keeps token overhead manageable (~12 tools from 40+).
 * Focused on read/analysis operations most useful for CTF solving.
 */
export const IDA_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "decompile",
    description: "Decompile a function in IDA Pro, returning C pseudocode. Accepts function name or address.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Function name or hex address (e.g. 'main' or '0x401000')" },
      },
      required: ["address"],
    },
  },
  {
    name: "disasm",
    description: "Disassemble instructions at a given address in IDA Pro.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Start address or function name" },
        count: { type: "number", description: "Number of instructions to disassemble (default: 50)" },
      },
      required: ["address"],
    },
  },
  {
    name: "list_funcs",
    description: "List all functions in the IDA database.",
    inputSchema: {
      type: "object",
      properties: {
        offset: { type: "number", description: "Pagination offset (default: 0)" },
        limit: { type: "number", description: "Max results (default: 1000)" },
      },
    },
  },
  {
    name: "lookup_funcs",
    description: "Search for functions by name pattern.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search pattern to match against function names" },
      },
      required: ["query"],
    },
  },
  {
    name: "imports",
    description: "List all imported functions/symbols in the binary.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_globals",
    description: "List global variables defined in the binary.",
    inputSchema: {
      type: "object",
      properties: {
        offset: { type: "number", description: "Pagination offset (default: 0)" },
        limit: { type: "number", description: "Max results (default: 1000)" },
      },
    },
  },
  {
    name: "xrefs_to",
    description: "Get all cross-references to a given address.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Target address (e.g. '0x401000')" },
      },
      required: ["address"],
    },
  },
  {
    name: "callees",
    description: "List all functions called by a given function.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Function name or address" },
      },
      required: ["address"],
    },
  },
  {
    name: "find",
    description: "Search for a text string in the IDA database.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to search for" },
      },
      required: ["query"],
    },
  },
  {
    name: "find_bytes",
    description: "Search for a byte pattern in the binary.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Hex byte pattern (e.g. '48 89 5C 24' or '48 89 ?? 24')" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "get_string",
    description: "Read a string at a given address.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Address of the string" },
      },
      required: ["address"],
    },
  },
  {
    name: "basic_blocks",
    description: "Get the control flow graph (basic blocks) of a function.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Function name or address" },
      },
      required: ["address"],
    },
  },
];
