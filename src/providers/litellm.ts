import type { ChatMessage, ChatOptions, ChatWithToolsOptions, Provider, ProviderInfo } from "./types.js";
import type { ChatResponse, ContentBlock, ProviderMessage, ToolDefinition } from "../agent/types.js";
import { PROVIDERS } from "./registry.js";

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAiResponse {
  choices: Array<{
    message: { role: string; content: string | null; tool_calls?: OpenAiToolCall[] };
    finish_reason: string;
  }>;
}

const DEFAULT_MODEL = "gpt-4o-mini";

/**
 * Talks to a LiteLLM proxy via the OpenAI-compatible /v1/chat/completions
 * endpoint. The proxy fans out to whatever upstream (Anthropic, OpenAI,
 * Bedrock, Vertex, etc.) the team has configured server-side.
 */
export class LiteLLMProvider implements Provider {
  readonly info: ProviderInfo = PROVIDERS.litellm;
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  async validateKey(_apiKey: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const payload = {
      model: options?.model ?? DEFAULT_MODEL,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? 0,
      max_tokens: options?.maxTokens ?? 4096,
    };

    const res = await this.post<OpenAiResponse>("/v1/chat/completions", payload);
    return res.choices[0]?.message?.content ?? "";
  }

  async chatWithTools(messages: ProviderMessage[], options?: ChatWithToolsOptions): Promise<ChatResponse> {
    const oaiMessages: OpenAiMessage[] = [];
    if (options?.system) oaiMessages.push({ role: "system", content: options.system });

    for (const msg of messages) {
      if (msg.role === "assistant") {
        const textParts: string[] = [];
        const toolCalls: OpenAiToolCall[] = [];
        for (const block of msg.content) {
          if (block.type === "text") textParts.push(block.text);
          else if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id,
              type: "function",
              function: { name: block.name, arguments: JSON.stringify(block.input) },
            });
          }
        }
        oaiMessages.push({
          role: "assistant",
          content: textParts.join("") || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
      } else if (typeof msg.content === "string") {
        oaiMessages.push({ role: "user", content: msg.content });
      } else {
        // Tool results -- one tool message per result, paired by tool_call_id.
        for (const tr of msg.content) {
          oaiMessages.push({
            role: "tool",
            tool_call_id: tr.toolUseId,
            content: tr.content,
          });
        }
      }
    }

    const tools = options?.tools?.map((t: ToolDefinition) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    const payload = {
      model: options?.model ?? DEFAULT_MODEL,
      messages: oaiMessages,
      temperature: options?.temperature ?? 0,
      max_tokens: options?.maxTokens ?? 16384,
      ...(tools && tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
    };

    const res = await this.post<OpenAiResponse>("/v1/chat/completions", payload);
    const choice = res.choices[0];
    if (!choice) return { content: [], stopReason: "end_turn" };

    const content: ContentBlock[] = [];
    if (choice.message.content) content.push({ type: "text", text: choice.message.content });
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(tc.function.arguments); } catch { /* leave empty */ }
        content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
      }
    }

    const stopReason: ChatResponse["stopReason"] =
      choice.finish_reason === "tool_calls" ? "tool_use" :
      choice.finish_reason === "length" ? "max_tokens" :
      "end_turn";

    return { content, stopReason };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LiteLLM API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }
}

export async function createLiteLLMProvider(apiKey: string): Promise<LiteLLMProvider> {
  const baseUrl = process.env.LITELLM_BASE_URL ?? "http://localhost:4000";
  return new LiteLLMProvider(baseUrl, apiKey);
}
