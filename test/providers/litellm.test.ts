import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LiteLLMProvider } from "../../src/providers/litellm.js";

const BASE = "http://localhost:4000";

describe("LiteLLMProvider", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch") as never;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function mockJson(body: unknown, ok = true, status = 200) {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
    );
  }

  it("chat hits /v1/chat/completions and returns content", async () => {
    mockJson({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] });
    const provider = new LiteLLMProvider(BASE, "key");
    const out = await provider.chat([{ role: "user", content: "hi" }]);
    expect(out).toBe("ok");

    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe(`${BASE}/v1/chat/completions`);
    const headers = (call[1] as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe("Bearer key");
  });

  it("chatWithTools maps tool_use blocks to OpenAI tool_calls", async () => {
    mockJson({
      choices: [{
        message: {
          role: "assistant",
          content: "let me run it",
          tool_calls: [{
            id: "call_abc",
            type: "function",
            function: { name: "bash", arguments: JSON.stringify({ command: "ls" }) },
          }],
        },
        finish_reason: "tool_calls",
      }],
    });

    const provider = new LiteLLMProvider(BASE, "key");
    const res = await provider.chatWithTools([{ role: "user", content: "list" }], {
      tools: [{ name: "bash", description: "shell", inputSchema: { type: "object" } }],
    });

    expect(res.stopReason).toBe("tool_use");
    expect(res.content[0]).toEqual({ type: "text", text: "let me run it" });
    expect(res.content[1]).toEqual({
      type: "tool_use",
      id: "call_abc",
      name: "bash",
      input: { command: "ls" },
    });
  });

  it("chatWithTools serializes tool_result with tool_call_id", async () => {
    mockJson({ choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }] });
    const provider = new LiteLLMProvider(BASE, "key");
    await provider.chatWithTools([
      { role: "user", content: "list" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "running" },
          { type: "tool_use", id: "call_x", name: "bash", input: { command: "ls" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", toolUseId: "call_x", content: "out" }],
      },
    ]);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as { body: string }).body) as {
      messages: Array<{ role: string; tool_call_id?: string; content: string | null }>;
    };
    const tool = body.messages.find((m) => m.role === "tool");
    expect(tool?.tool_call_id).toBe("call_x");
    expect(tool?.content).toBe("out");
  });

  it("maps finish_reason=length to max_tokens", async () => {
    mockJson({ choices: [{ message: { role: "assistant", content: "..." }, finish_reason: "length" }] });
    const provider = new LiteLLMProvider(BASE, "key");
    const res = await provider.chatWithTools([{ role: "user", content: "long" }]);
    expect(res.stopReason).toBe("max_tokens");
  });
});
