import { describe, it, expect, vi } from "vitest";
import { McpToolBridge, type McpToolPack } from "../../src/agent/mcp-bridge.js";
import type { ToolAdapter, ToolInfo, ToolResult } from "../../src/tools/types.js";
import type { ToolDefinition } from "../../src/agent/types.js";

function createMockAdapter(overrides?: Partial<ToolAdapter>): ToolAdapter {
  return {
    name: "MockAdapter",
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    isConnected: vi.fn(() => true),
    listTools: vi.fn(async () => [] as ToolInfo[]),
    invoke: vi.fn(async (_name: string, _args: Record<string, unknown>): Promise<ToolResult> => ({
      toolName: _name,
      success: true,
      output: { type: "text", content: `result from ${_name}` },
      durationMs: 10,
    })),
    ...overrides,
  };
}

const SAMPLE_TOOLS: ToolDefinition[] = [
  {
    name: "decompile_function",
    description: "Decompile a function",
    inputSchema: {
      type: "object",
      properties: { function_name: { type: "string" } },
      required: ["function_name"],
    },
  },
  {
    name: "list_functions",
    description: "List all functions",
    inputSchema: { type: "object", properties: {} },
  },
];

function createPack(adapter: ToolAdapter): McpToolPack {
  return {
    name: "TestPack",
    tools: SAMPLE_TOOLS,
    createAdapter: () => adapter,
  };
}

describe("McpToolBridge", () => {
  it("getTools() returns RegisteredTool[] matching static definitions", () => {
    const adapter = createMockAdapter();
    const bridge = new McpToolBridge([createPack(adapter)]);
    const tools = bridge.getTools();

    expect(tools).toHaveLength(2);
    expect(tools[0].definition.name).toBe("decompile_function");
    expect(tools[1].definition.name).toBe("list_functions");
    expect(typeof tools[0].execute).toBe("function");
  });

  it("adapter.connect() not called until execute()", () => {
    const adapter = createMockAdapter();
    const bridge = new McpToolBridge([createPack(adapter)]);
    bridge.getTools();

    expect(adapter.connect).not.toHaveBeenCalled();
  });

  it("execute calls adapter.invoke() with correct args", async () => {
    const adapter = createMockAdapter();
    const bridge = new McpToolBridge([createPack(adapter)]);
    const tools = bridge.getTools();

    const result = await tools[0].execute({ function_name: "main" });

    expect(adapter.connect).toHaveBeenCalledOnce();
    expect(adapter.invoke).toHaveBeenCalledWith("decompile_function", { function_name: "main" });
    expect(result).toBe("result from decompile_function");
  });

  it("connection is reused across multiple tool calls", async () => {
    const adapter = createMockAdapter();
    const bridge = new McpToolBridge([createPack(adapter)]);
    const tools = bridge.getTools();

    await tools[0].execute({ function_name: "main" });
    await tools[1].execute({});

    expect(adapter.connect).toHaveBeenCalledOnce();
    expect(adapter.invoke).toHaveBeenCalledTimes(2);
  });

  it("concurrent execute() calls only connect once", async () => {
    let connectResolve: () => void;
    const connectPromise = new Promise<void>((r) => { connectResolve = r; });
    const adapter = createMockAdapter({
      connect: vi.fn(async () => { await connectPromise; }),
    });
    const bridge = new McpToolBridge([createPack(adapter)]);
    const tools = bridge.getTools();

    // Start two concurrent executions
    const p1 = tools[0].execute({ function_name: "foo" });
    const p2 = tools[1].execute({});

    // Resolve the connect
    connectResolve!();
    await Promise.all([p1, p2]);

    expect(adapter.connect).toHaveBeenCalledOnce();
  });

  it("disconnectAll() disconnects active adapters", async () => {
    const adapter = createMockAdapter();
    const bridge = new McpToolBridge([createPack(adapter)]);
    const tools = bridge.getTools();

    // Connect by executing
    await tools[0].execute({ function_name: "main" });
    await bridge.disconnectAll();

    expect(adapter.disconnect).toHaveBeenCalledOnce();
  });

  it("execute returns error string when adapter.invoke() fails", async () => {
    const adapter = createMockAdapter({
      invoke: vi.fn(async () => { throw new Error("connection refused"); }),
    });
    const bridge = new McpToolBridge([createPack(adapter)]);
    const tools = bridge.getTools();

    const result = await tools[0].execute({ function_name: "main" });

    expect(result).toBe("Error: connection refused");
  });

  it("no adapters connected after getTools() alone", async () => {
    const adapter = createMockAdapter();
    const bridge = new McpToolBridge([createPack(adapter)]);
    bridge.getTools();

    // disconnectAll should be a no-op (nothing to disconnect)
    await bridge.disconnectAll();

    expect(adapter.connect).not.toHaveBeenCalled();
    expect(adapter.disconnect).not.toHaveBeenCalled();
  });

  it("reconnects when adapter reports disconnected", async () => {
    let connected = true;
    const adapter1 = createMockAdapter({
      isConnected: vi.fn(() => connected),
    });
    const adapter2 = createMockAdapter();
    let callCount = 0;
    const bridge = new McpToolBridge([{
      name: "TestPack",
      tools: SAMPLE_TOOLS,
      createAdapter: () => {
        callCount++;
        return callCount === 1 ? adapter1 : adapter2;
      },
    }]);
    const tools = bridge.getTools();

    // First call connects adapter1
    await tools[0].execute({ function_name: "main" });
    expect(adapter1.connect).toHaveBeenCalledOnce();
    expect(adapter1.invoke).toHaveBeenCalledOnce();

    // Simulate connection death
    connected = false;

    // Next call should detect dead connection and create adapter2
    await tools[1].execute({});
    expect(adapter2.connect).toHaveBeenCalledOnce();
    expect(adapter2.invoke).toHaveBeenCalledOnce();
  });

  it("clears dead adapter on invoke failure so next call retries", async () => {
    const failAdapter = createMockAdapter({
      invoke: vi.fn(async () => { throw new Error("Connection closed"); }),
    });
    const goodAdapter = createMockAdapter();
    let callCount = 0;
    const bridge = new McpToolBridge([{
      name: "TestPack",
      tools: SAMPLE_TOOLS,
      createAdapter: () => {
        callCount++;
        return callCount === 1 ? failAdapter : goodAdapter;
      },
    }]);
    const tools = bridge.getTools();

    // First call fails
    const result1 = await tools[0].execute({ function_name: "main" });
    expect(result1).toBe("Error: Connection closed");

    // Second call should reconnect with a fresh adapter
    const result2 = await tools[0].execute({ function_name: "main" });
    expect(result2).toBe("result from decompile_function");
    expect(goodAdapter.connect).toHaveBeenCalledOnce();
  });
});
