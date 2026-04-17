import type Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ChatOptions, ChatWithToolsOptions, Provider, ProviderInfo } from "./types.js";
import type { ChatResponse, ContentBlock, ProviderMessage, ToolDefinition } from "../agent/types.js";
import { PROVIDERS } from "./registry.js";

export class AnthropicProvider implements Provider {
  readonly info: ProviderInfo = PROVIDERS.anthropic;
  private client: Anthropic;

  constructor(client: Anthropic) {
    this.client = client;
  }

  async validateKey(apiKey: string): Promise<boolean> {
    // Format check only — no API call
    return apiKey.startsWith("sk-ant-") && apiKey.length >= 40;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    // Extract system messages
    const systemMessages = messages.filter((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");

    // Combine system messages with explicit system option
    const systemParts: string[] = [];
    if (options?.system) systemParts.push(options.system);
    for (const msg of systemMessages) systemParts.push(msg.content);
    const system = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;

    const response = await this.client.messages.create({
      model: options?.model ?? "claude-sonnet-4-5-20250929",
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0,
      ...(system ? { system } : {}),
      messages: chatMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    const textParts: string[] = [];
    for (const block of response.content) {
      if (block.type === "text") textParts.push(block.text);
    }
    return textParts.join("");
  }

  async chatWithTools(messages: ProviderMessage[], options?: ChatWithToolsOptions): Promise<ChatResponse> {
    // Map ProviderMessage[] to Anthropic SDK MessageParam[]
    const sdkMessages = messages.map((msg) => {
      if (msg.role === "assistant") {
        // Assistant messages have ContentBlock[] content
        return {
          role: "assistant" as const,
          content: msg.content.map((block) => {
            if (block.type === "text") {
              return { type: "text" as const, text: block.text };
            }
            // tool_use block
            return {
              type: "tool_use" as const,
              id: block.id,
              name: block.name,
              input: block.input,
            };
          }),
        };
      }

      // User messages — either plain string or ToolResultContent[]
      if (typeof msg.content === "string") {
        return { role: "user" as const, content: msg.content };
      }

      // Tool result content blocks
      return {
        role: "user" as const,
        content: msg.content.map((tr) => ({
          type: "tool_result" as const,
          tool_use_id: tr.toolUseId,
          content: tr.content,
          ...(tr.isError ? { is_error: true } : {}),
        })),
      };
    });

    // Map ToolDefinition[] to Anthropic Tool[]
    const tools = options?.tools?.map((t: ToolDefinition) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    const response = await this.client.messages.create({
      model: options?.model ?? "claude-sonnet-4-5-20250929",
      max_tokens: options?.maxTokens ?? 16384,
      temperature: options?.temperature ?? 0,
      ...(options?.system ? { system: options.system } : {}),
      messages: sdkMessages,
      ...(tools && tools.length > 0 ? { tools, tool_choice: { type: "auto" as const } } : {}),
    });

    // Map response blocks back to our ContentBlock type
    const content: ContentBlock[] = [];
    for (const block of response.content) {
      if (block.type === "text") {
        content.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        content.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    // Map stop_reason
    let stopReason: ChatResponse["stopReason"] = "end_turn";
    if (response.stop_reason === "tool_use") stopReason = "tool_use";
    else if (response.stop_reason === "max_tokens") stopReason = "max_tokens";

    return { content, stopReason };
  }
}

/** Factory — lazy-loads SDK, constructs client, returns provider */
export async function createAnthropicProvider(apiKey: string): Promise<AnthropicProvider> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  return new AnthropicProvider(client);
}
