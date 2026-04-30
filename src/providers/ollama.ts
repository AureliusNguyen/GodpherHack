import type { ChatMessage, ChatOptions, ChatWithToolsOptions, Provider, ProviderInfo } from "./types.js";
import type { ChatResponse, ContentBlock, ProviderMessage, ToolDefinition } from "../agent/types.js";
import { PROVIDERS } from "./registry.js";

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

interface OllamaChatResponse {
  message: { role: string; content: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> };
  done: boolean;
  done_reason?: string;
}

const DEFAULT_MODEL = "qwen2.5:14b";

export class OllamaProvider implements Provider {
  readonly info: ProviderInfo = PROVIDERS.ollama;
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async validateKey(_apiKey: string): Promise<boolean> {
    // No API key for Ollama -- "key" is the base URL. Validate by probing /api/tags.
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const payload = {
      model: options?.model ?? DEFAULT_MODEL,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      options: {
        temperature: options?.temperature ?? 0,
        num_predict: options?.maxTokens ?? 4096,
      },
    };

    const res = await this.post<OllamaChatResponse>("/api/chat", payload);
    return res.message.content ?? "";
  }

  async chatWithTools(messages: ProviderMessage[], options?: ChatWithToolsOptions): Promise<ChatResponse> {
    const ollamaMessages: OllamaMessage[] = [];
    if (options?.system) {
      ollamaMessages.push({ role: "system", content: options.system });
    }

    // Track synthetic tool_use ids -> tool name for pairing tool results back
    const idToName = new Map<string, string>();

    for (const msg of messages) {
      if (msg.role === "assistant") {
        const textParts: string[] = [];
        const toolCalls: NonNullable<OllamaMessage["tool_calls"]> = [];
        for (const block of msg.content) {
          if (block.type === "text") textParts.push(block.text);
          else if (block.type === "tool_use") {
            idToName.set(block.id, block.name);
            toolCalls.push({ function: { name: block.name, arguments: block.input } });
          }
        }
        ollamaMessages.push({
          role: "assistant",
          content: textParts.join(""),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
      } else if (typeof msg.content === "string") {
        ollamaMessages.push({ role: "user", content: msg.content });
      } else {
        // Tool results — emit one tool message per result. Ollama expects role "tool".
        for (const tr of msg.content) {
          ollamaMessages.push({ role: "tool", content: tr.content });
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
      messages: ollamaMessages,
      stream: false,
      options: {
        temperature: options?.temperature ?? 0,
        num_predict: options?.maxTokens ?? 16384,
      },
      ...(tools && tools.length > 0 ? { tools } : {}),
    };

    const res = await this.post<OllamaChatResponse>("/api/chat", payload);

    const content: ContentBlock[] = [];
    if (res.message.content) content.push({ type: "text", text: res.message.content });
    if (res.message.tool_calls) {
      for (const call of res.message.tool_calls) {
        content.push({
          type: "tool_use",
          id: `ollama_${Math.random().toString(36).slice(2, 12)}`,
          name: call.function.name,
          input: call.function.arguments ?? {},
        });
      }
    }

    const stopReason: ChatResponse["stopReason"] =
      res.message.tool_calls && res.message.tool_calls.length > 0 ? "tool_use" : "end_turn";

    return { content, stopReason };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }
}

export async function createOllamaProvider(baseUrl: string): Promise<OllamaProvider> {
  return new OllamaProvider(baseUrl);
}
