import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "../../src/tools/registry.js";
import type { ToolAdapter, ToolInfo, ToolResult } from "../../src/tools/types.js";

function createMockAdapter(name: string, tools: ToolInfo[] = []): ToolAdapter {
  return {
    name,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(false),
    listTools: vi.fn().mockResolvedValue(tools),
    invoke: vi.fn().mockResolvedValue({
      toolName: "mock_tool",
      success: true,
      output: { type: "text", content: "ok" },
      durationMs: 10,
    } satisfies ToolResult),
  };
}

describe("ToolRegistry", () => {
  it("registers and retrieves adapters", () => {
    const registry = new ToolRegistry();
    const adapter = createMockAdapter("TestAdapter");

    registry.register(adapter);

    expect(registry.get("TestAdapter")).toBe(adapter);
    expect(registry.listAdapters()).toEqual(["TestAdapter"]);
  });

  it("throws on duplicate registration", () => {
    const registry = new ToolRegistry();
    registry.register(createMockAdapter("Dup"));

    expect(() => registry.register(createMockAdapter("Dup"))).toThrow(
      'Adapter "Dup" is already registered',
    );
  });

  it("returns undefined for unknown adapter", () => {
    const registry = new ToolRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("lists all tools across adapters", async () => {
    const registry = new ToolRegistry();

    registry.register(
      createMockAdapter("A", [
        { name: "tool1", description: "desc1", inputSchema: {} },
      ]),
    );
    registry.register(
      createMockAdapter("B", [
        { name: "tool2", description: "desc2", inputSchema: {} },
        { name: "tool3", description: "desc3", inputSchema: {} },
      ]),
    );

    const all = await registry.listAllTools();
    expect(all).toHaveLength(3);
    expect(all[0]).toEqual({ adapter: "A", tool: { name: "tool1", description: "desc1", inputSchema: {} } });
    expect(all[1].adapter).toBe("B");
    expect(all[2].adapter).toBe("B");
  });

  it("invokes tool by qualified name", async () => {
    const registry = new ToolRegistry();
    const adapter = createMockAdapter("GhidraMCP");
    registry.register(adapter);

    await registry.invoke("GhidraMCP.decompile_function", { addr: "0x1000" });

    expect(adapter.invoke).toHaveBeenCalledWith("decompile_function", { addr: "0x1000" });
  });

  it("throws on invalid qualified name (no dot)", async () => {
    const registry = new ToolRegistry();
    await expect(registry.invoke("noDot", {})).rejects.toThrow("Invalid qualified tool name");
  });

  it("throws when adapter not found", async () => {
    const registry = new ToolRegistry();
    await expect(registry.invoke("Unknown.tool", {})).rejects.toThrow('Adapter "Unknown" not found');
  });

  it("connectAll connects all adapters", async () => {
    const registry = new ToolRegistry();
    const a = createMockAdapter("A");
    const b = createMockAdapter("B");
    registry.register(a);
    registry.register(b);

    await registry.connectAll();

    expect(a.connect).toHaveBeenCalledOnce();
    expect(b.connect).toHaveBeenCalledOnce();
  });

  it("disconnectAll disconnects all adapters", async () => {
    const registry = new ToolRegistry();
    const a = createMockAdapter("A");
    const b = createMockAdapter("B");
    registry.register(a);
    registry.register(b);

    await registry.disconnectAll();

    expect(a.disconnect).toHaveBeenCalledOnce();
    expect(b.disconnect).toHaveBeenCalledOnce();
  });
});
