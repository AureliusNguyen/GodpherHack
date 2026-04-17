import { describe, it, expect } from "vitest";
import { agentLoop } from "../../src/agent/loop.js";
import type { AgentEvent, ChatResponse, ProviderMessage, RegisteredTool } from "../../src/agent/types.js";
import type { Provider, ProviderInfo } from "../../src/providers/types.js";

function createMockProvider(responses: ChatResponse[]): Provider {
  let callIndex = 0;
  return {
    info: { slug: "anthropic", name: "Anthropic", displayName: "Anthropic", envKey: "ANTHROPIC_API_KEY", packageName: "@anthropic-ai/sdk" } as ProviderInfo,
    async validateKey() { return true; },
    async chat() { return ""; },
    async chatWithTools(_messages: ProviderMessage[]) {
      const resp = responses[callIndex];
      if (!resp) throw new Error("No more mock responses");
      callIndex++;
      return resp;
    },
  };
}

function createMockTool(name: string, output: string): RegisteredTool {
  return {
    definition: { name, description: `Mock ${name}`, inputSchema: { type: "object", properties: {} } },
    async execute() { return output; },
  };
}

function createErrorTool(name: string, error: string): RegisteredTool {
  return {
    definition: { name, description: `Error ${name}`, inputSchema: { type: "object", properties: {} } },
    async execute() { throw new Error(error); },
  };
}

async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe("agentLoop", () => {
  it("yields text and turn_complete on simple response", async () => {
    const provider = createMockProvider([
      { content: [{ type: "text", text: "Hello!" }], stopReason: "end_turn" },
    ]);

    const history: ProviderMessage[] = [];
    const events = await collectEvents(agentLoop({
      provider, tools: [], systemPrompt: "test", history, userMessage: "hi",
    }));

    expect(events).toEqual([
      { type: "text", text: "Hello!" },
      { type: "turn_complete" },
    ]);
    // History should have user + assistant messages
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({ role: "user", content: "hi" });
  });

  it("executes tool and iterates until end_turn", async () => {
    const provider = createMockProvider([
      {
        content: [
          { type: "text", text: "Let me check..." },
          { type: "tool_use", id: "t1", name: "bash", input: { command: "echo hi" } },
        ],
        stopReason: "tool_use",
      },
      {
        content: [{ type: "text", text: "Done!" }],
        stopReason: "end_turn",
      },
    ]);

    const bashTool = createMockTool("bash", "hi\n");
    const history: ProviderMessage[] = [];
    const events = await collectEvents(agentLoop({
      provider, tools: [bashTool], systemPrompt: "test", history, userMessage: "run echo",
    }));

    const types = events.map((e) => e.type);
    expect(types).toEqual(["text", "tool_call", "tool_result", "text", "turn_complete"]);

    // Check tool_call event
    const toolCall = events.find((e) => e.type === "tool_call")!;
    expect(toolCall).toMatchObject({ name: "bash", input: { command: "echo hi" } });

    // Check tool_result event
    const toolResult = events.find((e) => e.type === "tool_result")!;
    expect(toolResult).toMatchObject({ name: "bash", output: "hi\n", isError: false });

    // History: user, assistant (tool_use), user (tool_result), assistant (end_turn)
    expect(history).toHaveLength(4);
  });

  it("yields multiple text blocks in order", async () => {
    const provider = createMockProvider([
      {
        content: [
          { type: "text", text: "First paragraph." },
          { type: "text", text: "Second paragraph." },
          { type: "text", text: "Third paragraph." },
        ],
        stopReason: "end_turn",
      },
    ]);

    const history: ProviderMessage[] = [];
    const events = await collectEvents(agentLoop({
      provider, tools: [], systemPrompt: "test", history, userMessage: "hi",
    }));

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(3);
    expect(textEvents[0]).toMatchObject({ text: "First paragraph." });
    expect(textEvents[1]).toMatchObject({ text: "Second paragraph." });
    expect(textEvents[2]).toMatchObject({ text: "Third paragraph." });
    // Only one turn_complete
    expect(events.filter((e) => e.type === "turn_complete")).toHaveLength(1);
  });

  it("executes multiple tool_use blocks in one response", async () => {
    const provider = createMockProvider([
      {
        content: [
          { type: "text", text: "Running two tools..." },
          { type: "tool_use", id: "t1", name: "bash", input: { command: "echo a" } },
          { type: "tool_use", id: "t2", name: "read_file", input: { path: "foo.txt" } },
        ],
        stopReason: "tool_use",
      },
      {
        content: [{ type: "text", text: "Got both results." }],
        stopReason: "end_turn",
      },
    ]);

    const bashTool = createMockTool("bash", "a\n");
    const readTool = createMockTool("read_file", "contents of foo");
    const history: ProviderMessage[] = [];
    const events = await collectEvents(agentLoop({
      provider, tools: [bashTool, readTool], systemPrompt: "test", history, userMessage: "go",
    }));

    const types = events.map((e) => e.type);
    // text, tool_call, tool_result, tool_call, tool_result, text, turn_complete
    expect(types).toEqual([
      "text", "tool_call", "tool_result", "tool_call", "tool_result", "text", "turn_complete",
    ]);

    // Both tool_results sent back to the provider in one user message
    const toolResultMsg = history[2]; // user message with tool results
    expect(toolResultMsg.role).toBe("user");
    expect(Array.isArray(toolResultMsg.content)).toBe(true);
    const results = toolResultMsg.content as Array<{ type: string; toolUseId: string }>;
    expect(results).toHaveLength(2);
    expect(results[0].toolUseId).toBe("t1");
    expect(results[1].toolUseId).toBe("t2");
  });

  it("handles unknown tool gracefully", async () => {
    const provider = createMockProvider([
      {
        content: [
          { type: "tool_use", id: "t1", name: "nonexistent", input: {} },
        ],
        stopReason: "tool_use",
      },
      {
        content: [{ type: "text", text: "Oops" }],
        stopReason: "end_turn",
      },
    ]);

    const history: ProviderMessage[] = [];
    const events = await collectEvents(agentLoop({
      provider, tools: [], systemPrompt: "test", history, userMessage: "go",
    }));

    const toolResult = events.find((e) => e.type === "tool_result") as Extract<AgentEvent, { type: "tool_result" }>;
    expect(toolResult.isError).toBe(true);
    expect(toolResult.output).toContain("unknown tool");
  });

  it("handles tool execution error", async () => {
    const provider = createMockProvider([
      {
        content: [
          { type: "tool_use", id: "t1", name: "broken", input: {} },
        ],
        stopReason: "tool_use",
      },
      {
        content: [{ type: "text", text: "I see the error" }],
        stopReason: "end_turn",
      },
    ]);

    const brokenTool = createErrorTool("broken", "kaboom");
    const history: ProviderMessage[] = [];
    const events = await collectEvents(agentLoop({
      provider, tools: [brokenTool], systemPrompt: "test", history, userMessage: "go",
    }));

    const toolResult = events.find((e) => e.type === "tool_result") as Extract<AgentEvent, { type: "tool_result" }>;
    expect(toolResult.isError).toBe(true);
    expect(toolResult.output).toContain("kaboom");
  });

  it("errors if provider lacks chatWithTools", async () => {
    const provider: Provider = {
      info: { slug: "anthropic", name: "Anthropic", displayName: "Anthropic", envKey: "ANTHROPIC_API_KEY", packageName: "@anthropic-ai/sdk" } as ProviderInfo,
      async validateKey() { return true; },
      async chat() { return ""; },
      // no chatWithTools
    };

    const history: ProviderMessage[] = [];
    const events = await collectEvents(agentLoop({
      provider, tools: [], systemPrompt: "test", history, userMessage: "hi",
    }));

    expect(events).toEqual([
      { type: "error", message: "Provider does not support chatWithTools (agentic tool use)" },
    ]);
  });

  it("respects max iterations safety", async () => {
    // Create a provider that always returns tool_use
    const infiniteProvider = createMockProvider(
      Array.from({ length: 25 }, () => ({
        content: [
          { type: "tool_use" as const, id: "t1", name: "bash", input: { command: "echo loop" } },
        ],
        stopReason: "tool_use" as const,
      })),
    );

    const bashTool = createMockTool("bash", "looping\n");
    const history: ProviderMessage[] = [];
    const events = await collectEvents(agentLoop({
      provider: infiniteProvider, tools: [bashTool], systemPrompt: "test", history, userMessage: "go",
    }));

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent as Extract<AgentEvent, { type: "error" }>).message).toContain("maximum iterations");
  });
});
