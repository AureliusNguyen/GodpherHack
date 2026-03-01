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
} from "../agent/types.js";
import { PROVIDERS } from "./registry.js";
import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import type { Content } from "@google/genai";

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
    // Gemini function responses ideally include the original tool name.
    const toolUseNameById = new Map<string, string>();
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      for (const block of msg.content) {
        if (block.type === "tool_use") {
          toolUseNameById.set(block.id, block.name);
        }
      }
    }

    const sdkMessages: Content[] = messages.map((msg) => {
      if (msg.role === "assistant") {
        // Assistant messages have ContentBlock[] content
        return {
          role: "model",
          parts: msg.content.map((block) => {
            if (block.type === "text") {
              return { text: block.text };
            }
            // tool_use block
            return {
              functionCall: {
                id: block.id,
                name: block.name,
                args: block.input,
              },
            };
          }),
        };
      }

      // User messages — either plain string or ToolResultContent[]
      if (typeof msg.content === "string") {
        return {
          role: "user" as const,
          parts: [{ text: msg.content }],
        };
      }

      // Tool result content blocks
      return {
        role: "user" as const,
        parts: msg.content.map((tr) => {
          const name = toolUseNameById.get(tr.toolUseId);
          return {
            functionResponse: {
              id: tr.toolUseId,
              ...(name ? { name } : {}),
              response: tr.isError ? { error: tr.content } : { output: tr.content },
            },
          };
        }),
      };
    });

    // Tools
    const functionDeclarations = options?.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }));

    const response = await this.client.models.generateContent({
      model: options?.model ?? "gemini-2.0-flash",
      contents: sdkMessages,
      config: {
        maxOutputTokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0,
        ...(options?.system ? { systemInstruction: options.system } : {}),
        ...(functionDeclarations && functionDeclarations.length > 0
          ? {
              tools: [{ functionDeclarations }],
              toolConfig: {
                functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO },
              },
            }
          : {}),
      },
    });

    const content: ContentBlock[] = [];
    const responseParts = response.candidates?.[0]?.content?.parts ?? [];
    let generatedToolCallIndex = 0;

    for (const part of responseParts) {
      if (part.text) {
        content.push({ type: "text", text: part.text });
      }

      if (part.functionCall?.name) {
        content.push({
          type: "tool_use",
          id: part.functionCall.id ?? `tool_call_${generatedToolCallIndex++}`,
          name: part.functionCall.name,
          input: (part.functionCall.args ?? {}) as Record<string, unknown>,
        });
      }
    }

    if (content.length === 0 && response.text) {
      content.push({ type: "text", text: response.text });
    }

    let stopReason: ChatResponse["stopReason"] = "end_turn";
    if (content.some((block) => block.type === "tool_use")) stopReason = "tool_use";
    else if (response.candidates?.[0]?.finishReason === "MAX_TOKENS") stopReason = "max_tokens";

    return {
      content,
      stopReason,
    };
  }
}

export async function createGoogleProvider(
  apiKey: string,
): Promise<GoogleProvider> {
  const client = new GoogleGenAI({ apiKey });
  return new GoogleProvider(client);
}
