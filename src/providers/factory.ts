import type { Provider, ProviderSlug } from "./types.js";
import { PROVIDERS, PROVIDER_SLUGS } from "./registry.js";

export const PROVIDER_MODELS: Record<ProviderSlug, Array<{ id: string; label: string }>> = {
  anthropic: [
    { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  ],
  openai: [],
  google: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  ],
};

export function resolveApiKey(slug: ProviderSlug): string | null {
  return process.env[PROVIDERS[slug].envKey] ?? null;
}

export async function createProvider(slug: ProviderSlug, apiKey: string): Promise<Provider> {
  switch (slug) {
    case "anthropic": {
      const { createAnthropicProvider } = await import("./anthropic.js");
      return createAnthropicProvider(apiKey);
    }
    case "openai":
      throw new Error("OpenAI provider not yet implemented");
    case "google": {
      const { createGoogleProvider } = await import("./google.js");
      return createGoogleProvider(apiKey);
    }
  }
}

export async function autoDetectProvider(): Promise<Provider | null> {
  for (const slug of PROVIDER_SLUGS) {
    const key = resolveApiKey(slug);
    if (key) {
      try {
        return await createProvider(slug, key);
      } catch {
        // Provider not yet implemented — skip
        continue;
      }
    }
  }
  return null;
}
