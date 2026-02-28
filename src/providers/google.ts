import type {
  ChatMessage,
  ChatOptions,
  ChatWithToolsOptions,
  Provider,
  ProviderInfo,
} from "./types.js";
import type {
  ChatResponse,
  ContentBlock,
  ProviderMessage,
  ToolDefinition,
  ToolResultContent,
} from "../agent/types.js";
import { PROVIDERS } from "./registry.js";
import { GoogleGenAI } from "@google/genai";
import type { Content, ContentListUnion } from "@google/genai";

export class GoogleProvider implements Provider {
  readonly info: ProviderInfo = PROVIDERS.google;
  private client: GoogleGenAI;

  constructor(client: GoogleGenAI) {
    this.client = client;
  }

  async validateKey(apiKey: string): Promise<boolean> {
    // Gemini API keys typically start with "AIza", but accept any reasonably long key.
    return apiKey.length >= 20;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    // Extract system messages
    const systemMessages = messages.filter((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");

    // Combine system messages with explicit system option
    const systemParts: string[] = [];
    if (options?.system) systemParts.push(options.system);
    for (const msg of systemMessages) systemParts.push(msg.content);
    const system =
      systemParts.length > 0 ? systemParts.join("\n\n") : undefined;

    const result = await this.client.models.generateContent({
      model: options?.model ?? "gemini-2.0-flash",
      contents: chatMessages.map(
        (m) =>
          ({
            role: m.role === "user" ? "user" : "assistant",
            parts: [{ text: m.content }],
          }) as Content,
      ),
      config: {
        maxOutputTokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0,
        systemInstruction: system,
      },
    });

    return result.text ?? "";
  }

  async chatWithTools(
    messages: ProviderMessage[],
    options?: ChatWithToolsOptions,
  ): Promise<ChatResponse> {
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

    const result = await this.client.models.generateContent({
      model: options?.model ?? "gemini-2.0-flash",
      contents: sdkMessages,
      config: {
        maxOutputTokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0,
      },
    });

    // TODO: naive: just return the entire response as a block of text
    const text = result.text ?? "";
    const content: ContentBlock[] = text ? [{ type: "text", text }] : [];

    return {
      content,
      stopReason: "end_turn",
    };
  }
}

export async function createGoogleProvider(
  apiKey: string,
): Promise<GoogleProvider> {
  const client = new GoogleGenAI({ apiKey });
  return new GoogleProvider(client);
}
