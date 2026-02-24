import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnthropicProvider } from "../../src/providers/anthropic.js";
import type { ChatMessage } from "../../src/providers/types.js";
import type { ProviderMessage } from "../../src/agent/types.js";

// Mock Anthropic client
function createMockClient(responseText = "Hello world") {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: responseText }],
      }),
    },
  };
}

function createProvider(mockClient?: ReturnType<typeof createMockClient>) {
  const client = mockClient ?? createMockClient();
  // AnthropicProvider takes a client object directly
  return { provider: new AnthropicProvider(client as never), client };
}

describe("AnthropicProvider", () => {
  describe("validateKey", () => {
    it("accepts valid key format", async () => {
      const { provider } = createProvider();
      expect(await provider.validateKey("sk-ant-" + "x".repeat(40))).toBe(true);
    });

    it("rejects key without correct prefix", async () => {
      const { provider } = createProvider();
      expect(await provider.validateKey("sk-wrong-" + "x".repeat(40))).toBe(false);
    });

    it("rejects key that is too short", async () => {
      const { provider } = createProvider();
      expect(await provider.validateKey("sk-ant-short")).toBe(false);
    });
  });

  describe("chat", () => {
    it("sends messages and returns text response", async () => {
      const { provider, client } = createProvider(createMockClient("Test response"));

      const messages: ChatMessage[] = [
        { role: "user", content: "Hello" },
      ];

      const result = await provider.chat(messages);

      expect(result).toBe("Test response");
      expect(client.messages.create).toHaveBeenCalledOnce();

      const callArgs = client.messages.create.mock.calls[0][0];
      expect(callArgs.model).toBe("claude-sonnet-4-5-20250929");
      expect(callArgs.max_tokens).toBe(4096);
      expect(callArgs.messages).toEqual([{ role: "user", content: "Hello" }]);
    });

    it("extracts system messages to system param", async () => {
      const { provider, client } = createProvider();

      const messages: ChatMessage[] = [
        { role: "system", content: "You are a CTF solver." },
        { role: "user", content: "Solve this" },
      ];

      await provider.chat(messages);

      const callArgs = client.messages.create.mock.calls[0][0];
      expect(callArgs.system).toBe("You are a CTF solver.");
      expect(callArgs.messages).toEqual([{ role: "user", content: "Solve this" }]);
    });

    it("combines explicit system option with system messages", async () => {
      const { provider, client } = createProvider();

      const messages: ChatMessage[] = [
        { role: "system", content: "From message." },
        { role: "user", content: "Hi" },
      ];

      await provider.chat(messages, { system: "From option." });

      const callArgs = client.messages.create.mock.calls[0][0];
      expect(callArgs.system).toBe("From option.\n\nFrom message.");
    });

    it("respects custom model and maxTokens", async () => {
      const { provider, client } = createProvider();

      await provider.chat(
        [{ role: "user", content: "test" }],
        { model: "claude-opus-4-6", maxTokens: 8192 },
      );

      const callArgs = client.messages.create.mock.calls[0][0];
      expect(callArgs.model).toBe("claude-opus-4-6");
      expect(callArgs.max_tokens).toBe(8192);
    });

    it("joins multiple text blocks", async () => {
      const client = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              { type: "text", text: "Part 1" },
              { type: "text", text: "Part 2" },
            ],
          }),
        },
      };

      const provider = new AnthropicProvider(client as never);
      const result = await provider.chat([{ role: "user", content: "test" }]);
      expect(result).toBe("Part 1Part 2");
    });

    it("filters out non-text blocks", async () => {
      const client = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              { type: "text", text: "Hello" },
              { type: "tool_use", id: "123", name: "test", input: {} },
            ],
          }),
        },
      };

      const provider = new AnthropicProvider(client as never);
      const result = await provider.chat([{ role: "user", content: "test" }]);
      expect(result).toBe("Hello");
    });
  });

  describe("info", () => {
    it("has correct provider info", () => {
      const { provider } = createProvider();
      expect(provider.info.slug).toBe("anthropic");
      expect(provider.info.envKey).toBe("ANTHROPIC_API_KEY");
    });
  });

  describe("chatWithTools", () => {
    it("maps ProviderMessage to SDK MessageParam", async () => {
      const { provider, client } = createProvider();
      client.messages.create.mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
      });

      const messages: ProviderMessage[] = [
        { role: "user", content: "Hello" },
      ];

      const result = await provider.chatWithTools(messages);

      expect(result.content).toEqual([{ type: "text", text: "ok" }]);
      expect(result.stopReason).toBe("end_turn");

      const callArgs = client.messages.create.mock.calls[0][0];
      expect(callArgs.messages).toEqual([{ role: "user", content: "Hello" }]);
      expect(callArgs.max_tokens).toBe(16384);
    });

    it("passes tools to SDK", async () => {
      const { provider, client } = createProvider();
      client.messages.create.mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
      });

      await provider.chatWithTools(
        [{ role: "user", content: "test" }],
        {
          tools: [{
            name: "bash",
            description: "Run bash",
            inputSchema: { type: "object", properties: { command: { type: "string" } } },
          }],
        },
      );

      const callArgs = client.messages.create.mock.calls[0][0];
      expect(callArgs.tools).toHaveLength(1);
      expect(callArgs.tools[0].name).toBe("bash");
      expect(callArgs.tool_choice).toEqual({ type: "auto" });
    });

    it("maps tool_use response blocks", async () => {
      const { provider, client } = createProvider();
      client.messages.create.mockResolvedValue({
        content: [
          { type: "text", text: "Let me run that" },
          { type: "tool_use", id: "tu_1", name: "bash", input: { command: "ls" } },
        ],
        stop_reason: "tool_use",
      });

      const result = await provider.chatWithTools([{ role: "user", content: "list files" }]);

      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({ type: "text", text: "Let me run that" });
      expect(result.content[1]).toEqual({
        type: "tool_use",
        id: "tu_1",
        name: "bash",
        input: { command: "ls" },
      });
      expect(result.stopReason).toBe("tool_use");
    });

    it("maps tool_result messages correctly", async () => {
      const { provider, client } = createProvider();
      client.messages.create.mockResolvedValue({
        content: [{ type: "text", text: "I see" }],
        stop_reason: "end_turn",
      });

      const messages: ProviderMessage[] = [
        { role: "user", content: "do it" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "tu_1", name: "bash", input: { command: "ls" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", toolUseId: "tu_1", content: "file.txt\n" },
          ],
        },
      ];

      await provider.chatWithTools(messages);

      const callArgs = client.messages.create.mock.calls[0][0];
      // Check the tool_result message was mapped correctly
      const toolResultMsg = callArgs.messages[2];
      expect(toolResultMsg.role).toBe("user");
      expect(toolResultMsg.content[0].type).toBe("tool_result");
      expect(toolResultMsg.content[0].tool_use_id).toBe("tu_1");
      expect(toolResultMsg.content[0].content).toBe("file.txt\n");
    });

    it("preserves trailing text after tool_use blocks", async () => {
      const { provider, client } = createProvider();
      client.messages.create.mockResolvedValue({
        content: [
          { type: "text", text: "Before" },
          { type: "tool_use", id: "tu_1", name: "bash", input: { command: "ls" } },
          { type: "text", text: "After" },
        ],
        stop_reason: "tool_use",
      });

      const result = await provider.chatWithTools([{ role: "user", content: "go" }]);

      expect(result.content).toHaveLength(3);
      expect(result.content[0]).toEqual({ type: "text", text: "Before" });
      expect(result.content[1]).toMatchObject({ type: "tool_use", name: "bash" });
      expect(result.content[2]).toEqual({ type: "text", text: "After" });
    });

    it("passes is_error through on tool_result messages", async () => {
      const { provider, client } = createProvider();
      client.messages.create.mockResolvedValue({
        content: [{ type: "text", text: "I see the error" }],
        stop_reason: "end_turn",
      });

      const messages: ProviderMessage[] = [
        { role: "user", content: "do it" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "tu_1", name: "bash", input: { command: "bad" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", toolUseId: "tu_1", content: "Error: command failed", isError: true },
          ],
        },
      ];

      await provider.chatWithTools(messages);

      const callArgs = client.messages.create.mock.calls[0][0];
      const toolResultMsg = callArgs.messages[2];
      expect(toolResultMsg.content[0].is_error).toBe(true);
    });

    it("omits is_error when not set", async () => {
      const { provider, client } = createProvider();
      client.messages.create.mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
      });

      const messages: ProviderMessage[] = [
        { role: "user", content: "do it" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "tu_1", name: "bash", input: { command: "ls" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", toolUseId: "tu_1", content: "file.txt" },
          ],
        },
      ];

      await provider.chatWithTools(messages);

      const callArgs = client.messages.create.mock.calls[0][0];
      const toolResultMsg = callArgs.messages[2];
      expect(toolResultMsg.content[0].is_error).toBeUndefined();
    });

    it("handles end_turn vs tool_use stop_reason", async () => {
      const { provider, client } = createProvider();

      // end_turn
      client.messages.create.mockResolvedValue({
        content: [{ type: "text", text: "done" }],
        stop_reason: "end_turn",
      });
      const r1 = await provider.chatWithTools([{ role: "user", content: "hi" }]);
      expect(r1.stopReason).toBe("end_turn");

      // tool_use
      client.messages.create.mockResolvedValue({
        content: [{ type: "tool_use", id: "t1", name: "bash", input: {} }],
        stop_reason: "tool_use",
      });
      const r2 = await provider.chatWithTools([{ role: "user", content: "run" }]);
      expect(r2.stopReason).toBe("tool_use");

      // max_tokens
      client.messages.create.mockResolvedValue({
        content: [{ type: "text", text: "truncated" }],
        stop_reason: "max_tokens",
      });
      const r3 = await provider.chatWithTools([{ role: "user", content: "long" }]);
      expect(r3.stopReason).toBe("max_tokens");
    });
  });
});
