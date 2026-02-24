import type { ChatMessage, ChatOptions, ChatWithToolsOptions, Provider, ProviderInfo } from "./types.js";
import type {
  ChatResponse,
  ContentBlock,
  ProviderMessage,
  ToolDefinition,
  ToolResultContent,
} from "../agent/types.js";
import { PROVIDERS } from "./registry.js";

interface GoogleGenAIClient {
  models: {
    generateContent(args: {
      model: string;
      contents: string;
      config?: {
        maxOutputTokens?: number;
        temperature?: number;
      };
    }): Promise<{ text?: string | null }>;
  };
}

function buildBasePrompt(system?: string, tools?: ToolDefinition[]): string {
  const lines: string[] = [];

  if (system && system.trim()) {
    lines.push("System instructions:", system.trim(), "");
  }

  if (tools && tools.length > 0) {
    lines.push("You can call the following tools by asking the user explicitly to run them for you:");
    for (const tool of tools) {
      lines.push(
        `- ${tool.name}: ${tool.description}`,
        `  JSON input schema: ${JSON.stringify(tool.inputSchema)}`,
      );
    }
    lines.push(
      "",
      "When you need to use a tool, clearly describe which tool to run and the JSON arguments.",
      "",
    );
  }

  return lines.join("\n");
}

function buildPromptFromChatMessages(messages: ChatMessage[], system?: string): string {
  const lines: string[] = [];

  if (system && system.trim()) {
    lines.push("System instructions:", system.trim(), "");
  }

  for (const msg of messages) {
    const role =
      msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "System";
    lines.push(`${role}:`, msg.content, "");
  }

  lines.push("Assistant:");
  return lines.join("\n");
}

function buildPromptFromProviderMessages(
  messages: ProviderMessage[],
  system?: string,
  tools?: ToolDefinition[],
): string {
  const base = buildBasePrompt(system, tools);
  const lines: string[] = [];
  if (base) {
    lines.push(base, "");
  }

  for (const msg of messages) {
    if (msg.role === "assistant") {
      const blocks = msg.content;
      const textParts: string[] = [];
      for (const block of blocks) {
        if (block.type === "text") {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          textParts.push(
            `Requested tool call "${block.name}" with input: ${JSON.stringify(block.input)}`,
          );
        }
      }
      if (textParts.length > 0) {
        lines.push("Assistant:", textParts.join("\n\n"), "");
      }
    } else if (msg.role === "user") {
      if (typeof msg.content === "string") {
        lines.push("User:", msg.content, "");
      } else {
        // Tool results as user-provided context
        const toolResults = msg.content as ToolResultContent[];
        for (const tr of toolResults) {
          lines.push(
            `Tool result (${tr.toolUseId})${tr.isError ? " [error]" : ""}:`,
            tr.content,
            "",
          );
        }
      }
    }
  }

  lines.push("Assistant:");
  return lines.join("\n");
}

export class GoogleProvider implements Provider {
  readonly info: ProviderInfo = PROVIDERS.google;
  private client: GoogleGenAIClient;

  constructor(client: GoogleGenAIClient) {
    this.client = client;
  }

  async validateKey(apiKey: string): Promise<boolean> {
    // Gemini API keys typically start with "AIza", but accept any reasonably long key.
    return apiKey.length >= 20;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const prompt = buildPromptFromChatMessages(messages, options?.system);
    const model = options?.model ?? "gemini-2.0-flash";

    const result = await this.client.models.generateContent({
      model,
      contents: prompt,
      config: {
        maxOutputTokens: options?.maxTokens ?? 2048,
        temperature: options?.temperature ?? 0,
      },
    });

    return result.text ?? "";
  }

  async chatWithTools(
    messages: ProviderMessage[],
    options?: ChatWithToolsOptions,
  ): Promise<ChatResponse> {
    const prompt = buildPromptFromProviderMessages(messages, options?.system, options?.tools);
    const model = options?.model ?? "gemini-2.0-flash";

    const result = await this.client.models.generateContent({
      model,
      contents: prompt,
      config: {
        maxOutputTokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0,
      },
    });

    const text = result.text ?? "";
    const content: ContentBlock[] = text ? [{ type: "text", text }] : [];

    return {
      content,
      stopReason: "end_turn",
    };
  }
}

export async function createGoogleProvider(apiKey: string): Promise<GoogleProvider> {
  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({ apiKey }) as unknown as GoogleGenAIClient;
  return new GoogleProvider(client);
}

