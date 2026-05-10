import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OllamaProvider } from "../../src/providers/ollama.js";

const BASE = "http://localhost:11434";

describe("OllamaProvider", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch") as never;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function mockJson(body: unknown, ok = true, status = 200) {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  it("validateKey probes /api/tags and returns true on 200", async () => {
    mockJson({ models: [] });
    const provider = new OllamaProvider(BASE);
    expect(await provider.validateKey("")).toBe(true);
    // Now passes an AbortSignal for the 1s timeout; assert on URL only.
    expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/api/tags`, expect.objectContaining({ signal: expect.anything() }));
  });

  it("validateKey returns false when probe fails", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("connection refused"));
    const provider = new OllamaProvider(BASE);
    expect(await provider.validateKey("")).toBe(false);
  });

  it("chat sends messages and returns assistant content", async () => {
    mockJson({ message: { role: "assistant", content: "hi there" }, done: true });
    const provider = new OllamaProvider(BASE);
    const out = await provider.chat([{ role: "user", content: "hi" }]);
    expect(out).toBe("hi there");
  });

  it("chatWithTools maps text + tool_use blocks and detects tool stop reason", async () => {
    mockJson({
      message: {
        role: "assistant",
        content: "let me check",
        tool_calls: [{ function: { name: "bash", arguments: { command: "ls" } } }],
      },
      done: true,
    });
    const provider = new OllamaProvider(BASE);
    const res = await provider.chatWithTools([{ role: "user", content: "list files" }], {
      tools: [{ name: "bash", description: "run shell", inputSchema: { type: "object" } }],
    });

    expect(res.stopReason).toBe("tool_use");
    expect(res.content).toHaveLength(2);
    expect(res.content[0]).toEqual({ type: "text", text: "let me check" });
    expect(res.content[1].type).toBe("tool_use");
    if (res.content[1].type === "tool_use") {
      expect(res.content[1].name).toBe("bash");
      expect(res.content[1].input).toEqual({ command: "ls" });
    }
  });

  it("chatWithTools returns end_turn when there are no tool calls", async () => {
    mockJson({ message: { role: "assistant", content: "done" }, done: true });
    const provider = new OllamaProvider(BASE);
    const res = await provider.chatWithTools([{ role: "user", content: "hi" }]);
    expect(res.stopReason).toBe("end_turn");
    expect(res.content).toEqual([{ type: "text", text: "done" }]);
  });

  it("chatWithTools serializes prior tool results as role=tool messages", async () => {
    mockJson({ message: { role: "assistant", content: "ok" }, done: true });
    const provider = new OllamaProvider(BASE);
    await provider.chatWithTools([
      { role: "user", content: "list" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "running" },
          { type: "tool_use", id: "abc", name: "bash", input: { command: "ls" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", toolUseId: "abc", content: "file1\nfile2" }],
      },
    ]);

    const call = fetchSpy.mock.calls[0];
    const body = JSON.parse((call[1] as { body: string }).body) as {
      messages: Array<{ role: string; content: string }>;
    };
    const tool = body.messages.find((m) => m.role === "tool");
    expect(tool?.content).toBe("file1\nfile2");
  });
});
