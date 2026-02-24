import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpToolAdapter } from "../../src/tools/mcp/mcp-tool-adapter.js";
import type { McpServerConfig } from "../../src/tools/mcp/types.js";

// Mock the MCP SDK modules
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  const mockClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({
      tools: [
        {
          name: "decompile_function",
          description: "Decompile a function",
          inputSchema: { type: "object", properties: { name: { type: "string" } } },
        },
        {
          name: "list_functions",
          description: "List all functions",
          inputSchema: { type: "object" },
        },
      ],
      nextCursor: undefined,
    }),
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "decompiled output" }],
      isError: false,
    }),
  };

  return {
    Client: vi.fn().mockImplementation(() => mockClient),
    __mockClient: mockClient,
  };
});

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: vi.fn().mockImplementation(() => ({})),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { __mockClient } = await import("@modelcontextprotocol/sdk/client/index.js") as any as {
  __mockClient: {
    connect: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    listTools: ReturnType<typeof vi.fn>;
    callTool: ReturnType<typeof vi.fn>;
  };
};

const stdioConfig: McpServerConfig = {
  name: "TestMCP",
  transport: "stdio",
  command: "python",
  args: ["test_bridge.py"],
};

describe("McpToolAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("connect / disconnect lifecycle", () => {
    it("connects and tracks state", async () => {
      const adapter = new McpToolAdapter(stdioConfig);

      expect(adapter.isConnected()).toBe(false);
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
      expect(adapter.name).toBe("TestMCP");
    });

    it("disconnect clears state", async () => {
      const adapter = new McpToolAdapter(stdioConfig);
      await adapter.connect();
      await adapter.disconnect();

      expect(adapter.isConnected()).toBe(false);
    });

    it("connect is idempotent", async () => {
      const adapter = new McpToolAdapter(stdioConfig);
      await adapter.connect();
      await adapter.connect(); // Should not throw

      expect(__mockClient.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe("listTools", () => {
    it("returns mapped ToolInfo array", async () => {
      const adapter = new McpToolAdapter(stdioConfig);
      await adapter.connect();

      const tools = await adapter.listTools();

      expect(tools).toHaveLength(2);
      expect(tools[0]).toEqual({
        name: "decompile_function",
        description: "Decompile a function",
        inputSchema: { type: "object", properties: { name: { type: "string" } } },
      });
    });

    it("caches results on subsequent calls", async () => {
      const adapter = new McpToolAdapter(stdioConfig);
      await adapter.connect();

      await adapter.listTools();
      await adapter.listTools();

      expect(__mockClient.listTools).toHaveBeenCalledTimes(1);
    });

    it("clears cache on disconnect", async () => {
      const adapter = new McpToolAdapter(stdioConfig);
      await adapter.connect();
      await adapter.listTools();
      await adapter.disconnect();

      // Reconnect and list again
      await adapter.connect();
      await adapter.listTools();

      expect(__mockClient.listTools).toHaveBeenCalledTimes(2);
    });

    it("throws if not connected", async () => {
      const adapter = new McpToolAdapter(stdioConfig);
      await expect(adapter.listTools()).rejects.toThrow("not connected");
    });
  });

  describe("invoke", () => {
    it("calls tool and returns normalized result", async () => {
      const adapter = new McpToolAdapter(stdioConfig);
      await adapter.connect();

      const result = await adapter.invoke("decompile_function", { name: "main" });

      expect(result.toolName).toBe("decompile_function");
      expect(result.success).toBe(true);
      expect(result.output.type).toBe("text");
      expect(result.output.content).toBe("decompiled output");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("handles error result from MCP", async () => {
      __mockClient.callTool.mockResolvedValueOnce({
        content: [{ type: "text", text: "tool failed" }],
        isError: true,
      });

      const adapter = new McpToolAdapter(stdioConfig);
      await adapter.connect();

      const result = await adapter.invoke("fail_tool", {});

      expect(result.success).toBe(false);
      expect(result.output.content).toBe("tool failed");
    });

    it("handles callTool throwing", async () => {
      __mockClient.callTool.mockRejectedValueOnce(new Error("Connection lost"));

      const adapter = new McpToolAdapter(stdioConfig);
      await adapter.connect();

      const result = await adapter.invoke("crash_tool", {});

      expect(result.success).toBe(false);
      expect(result.output.type).toBe("error");
      expect(result.output.content).toBe("Connection lost");
    });

    it("throws if not connected", async () => {
      const adapter = new McpToolAdapter(stdioConfig);
      await expect(adapter.invoke("tool", {})).rejects.toThrow("not connected");
    });
  });

  describe("transport selection", () => {
    it("uses StdioClientTransport for stdio", async () => {
      const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
      const adapter = new McpToolAdapter(stdioConfig);
      await adapter.connect();

      expect(StdioClientTransport).toHaveBeenCalledWith({
        command: "python",
        args: ["test_bridge.py"],
        env: undefined,
      });
    });

    it("uses SSEClientTransport for sse", async () => {
      const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
      const adapter = new McpToolAdapter({
        name: "SSE",
        transport: "sse",
        url: "http://localhost:8080/sse",
      });
      await adapter.connect();

      expect(SSEClientTransport).toHaveBeenCalled();
    });

    it("throws if stdio has no command", async () => {
      const adapter = new McpToolAdapter({
        name: "Bad",
        transport: "stdio",
      });

      await expect(adapter.connect()).rejects.toThrow('requires "command"');
    });

    it("throws if sse has no url", async () => {
      const adapter = new McpToolAdapter({
        name: "Bad",
        transport: "sse",
      });

      await expect(adapter.connect()).rejects.toThrow('requires "url"');
    });
  });
});
