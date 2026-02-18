export type ProviderSlug = "anthropic" | "openai" | "google";

export interface ProviderInfo {
  slug: ProviderSlug;
  name: string;
  displayName: string;
  envKey: string;
  packageName: string;
}

export interface Provider {
  readonly info: ProviderInfo;
  validateKey(apiKey: string): Promise<boolean>;
  chat(messages: ChatMessage[]): Promise<string>;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}
