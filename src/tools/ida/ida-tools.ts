import type { ToolDefinition } from "../../agent/types.js";

/**
 * Curated subset of IDA Pro MCP tools sent to the LLM.
 * Parameter names match the actual server API (batch-style: addrs, queries, patterns).
 */
export const IDA_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "decompile",
    description: "Decompile a function in IDA Pro, returning C pseudocode. Accepts function name or address.",
    inputSchema: {
      type: "object",
      properties: {
        addr: { type: "string", description: "Function name or hex address (e.g. 'main' or '0x401000')" },
      },
      required: ["addr"],
    },
  },
  {
    name: "disasm",
    description: "Disassemble instructions at a given address in IDA Pro.",
    inputSchema: {
      type: "object",
      properties: {
        addr: { type: "string", description: "Function name or hex address" },
        max_instructions: { type: "number", description: "Max instructions to return (default: 5000)" },
        offset: { type: "number", description: "Skip first N instructions (default: 0)" },
      },
      required: ["addr"],
    },
  },
  {
    name: "list_funcs",
    description: "List functions in the IDA database. Supports filtering and pagination.",
    inputSchema: {
      type: "object",
      properties: {
        queries: {
          description: "Filter/pagination query. Can be a string filter or object with offset, count, filter.",
          oneOf: [
            { type: "string", description: "Filter string to match function names" },
            {
              type: "object",
              properties: {
                offset: { type: "number", description: "Starting index (default: 0)" },
                count: { type: "number", description: "Max results (default: 50)" },
                filter: { type: "string", description: "Filter string to match function names" },
              },
            },
          ],
        },
      },
      required: ["queries"],
    },
  },
  {
    name: "lookup_funcs",
    description: "Look up functions by name or address.",
    inputSchema: {
      type: "object",
      properties: {
        queries: {
          description: "Function name(s) or address(es) to look up. Can be a single string or array.",
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
        },
      },
      required: ["queries"],
    },
  },
  {
    name: "imports",
    description: "List all imported functions/symbols in the binary.",
    inputSchema: {
      type: "object",
      properties: {
        offset: { type: "number", description: "Starting index (default: 0)" },
        count: { type: "number", description: "Max results (0 = all imports)" },
      },
    },
  },
  {
    name: "list_globals",
    description: "List global variables defined in the binary.",
    inputSchema: {
      type: "object",
      properties: {
        queries: {
          description: "Filter/pagination query.",
          oneOf: [
            { type: "string", description: "Filter string" },
            {
              type: "object",
              properties: {
                offset: { type: "number", description: "Starting index (default: 0)" },
                count: { type: "number", description: "Max results (default: 50)" },
                filter: { type: "string", description: "Filter string" },
              },
            },
          ],
        },
      },
      required: ["queries"],
    },
  },
  {
    name: "xrefs_to",
    description: "Get all cross-references to a given address.",
    inputSchema: {
      type: "object",
      properties: {
        addrs: {
          description: "Address(es) to find xrefs to. Single string or array.",
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
        },
        limit: { type: "number", description: "Max xrefs per address (default: 100)" },
      },
      required: ["addrs"],
    },
  },
  {
    name: "callees",
    description: "List all functions called by a given function.",
    inputSchema: {
      type: "object",
      properties: {
        addrs: {
          description: "Function address(es) or name(s). Single string or array.",
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
        },
        limit: { type: "number", description: "Max callees per function (default: 200)" },
      },
      required: ["addrs"],
    },
  },
  {
    name: "find",
    description: "Search for strings, immediates, data references, or code references in the binary.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["string", "immediate", "data_ref", "code_ref"],
          description: "Type of search to perform",
        },
        targets: {
          description: "Search targets — strings, integers, or addresses. Single value or array.",
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
        },
        limit: { type: "number", description: "Max matches per target (default: 1000)" },
      },
      required: ["type", "targets"],
    },
  },
  {
    name: "find_bytes",
    description: "Search for byte patterns in the binary (supports wildcards with ??).",
    inputSchema: {
      type: "object",
      properties: {
        patterns: {
          description: "Byte pattern(s) to search for (e.g. '48 89 5C 24' or '48 89 ?? 24'). Single string or array.",
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
        },
        limit: { type: "number", description: "Max matches per pattern (default: 1000)" },
      },
      required: ["patterns"],
    },
  },
  {
    name: "get_string",
    description: "Read a string at a given address.",
    inputSchema: {
      type: "object",
      properties: {
        addrs: {
          description: "Address(es) to read strings from. Single string or array.",
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
        },
      },
      required: ["addrs"],
    },
  },
  {
    name: "basic_blocks",
    description: "Get the control flow graph (basic blocks) of a function.",
    inputSchema: {
      type: "object",
      properties: {
        addrs: {
          description: "Function address(es) or name(s). Single string or array.",
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
        },
        max_blocks: { type: "number", description: "Max blocks per function (default: 1000)" },
      },
      required: ["addrs"],
    },
  },
];
