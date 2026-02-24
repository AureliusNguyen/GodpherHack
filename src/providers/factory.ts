import type { Provider, ProviderSlug } from "./types.js";
import { PROVIDERS, PROVIDER_SLUGS } from "./registry.js";

export const PROVIDER_MODELS: Record<ProviderSlug, Array<{ id: string; label: string }>> = {
  anthropic: [
    { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  ],
  openai: [],
  google: [],
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
    case "google":
      throw new Error("Google provider not yet implemented");
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
