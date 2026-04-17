export type ProviderSlug = "anthropic" | "openai" | "google";

export interface ProviderInfo {
  slug: ProviderSlug;
  name: string;
  displayName: string;
  envKey: string;
  packageName: string;
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  system?: string;
}

export interface ChatWithToolsOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  system?: string;
  tools?: import("../agent/types.js").ToolDefinition[];
}

export interface Provider {
  readonly info: ProviderInfo;
  validateKey(apiKey: string): Promise<boolean>;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  chatWithTools?(
    messages: import("../agent/types.js").ProviderMessage[],
    options?: ChatWithToolsOptions,
  ): Promise<import("../agent/types.js").ChatResponse>;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}
