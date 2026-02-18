import type { ProviderInfo, ProviderSlug } from "./types.js";

export const PROVIDERS: Record<ProviderSlug, ProviderInfo> = {
  anthropic: {
    slug: "anthropic",
    name: "Anthropic",
    displayName: "Claude (Anthropic)",
    envKey: "ANTHROPIC_API_KEY",
    packageName: "@anthropic-ai/sdk",
  },
  openai: {
    slug: "openai",
    name: "OpenAI",
    displayName: "GPT-4 (OpenAI)",
    envKey: "OPENAI_API_KEY",
    packageName: "openai",
  },
  google: {
    slug: "google",
    name: "Google",
    displayName: "Gemini (Google)",
    envKey: "GOOGLE_API_KEY",
    packageName: "@google/genai",
  },
};

export const PROVIDER_SLUGS = Object.keys(PROVIDERS) as ProviderSlug[];

export const PROVIDER_CHOICES = PROVIDER_SLUGS.map(
  (slug) => PROVIDERS[slug].displayName,
);

export function resolveProvider(input: string): ProviderSlug | null {
  const lower = input.toLowerCase();
  for (const [slug, info] of Object.entries(PROVIDERS)) {
    if (
      lower.includes(slug) ||
      lower.includes(info.name.toLowerCase())
    ) {
      return slug as ProviderSlug;
    }
  }
  return null;
}
