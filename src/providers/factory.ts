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
  ollama: [
    { id: "qwen2.5:14b", label: "Qwen 2.5 14B (local)" },
    { id: "qwen2.5-coder:7b", label: "Qwen 2.5 Coder 7B (local)" },
    { id: "llama3.1:8b", label: "Llama 3.1 8B (local)" },
  ],
  litellm: [
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 via LiteLLM" },
    { id: "gpt-4o", label: "GPT-4o via LiteLLM" },
    { id: "gpt-4o-mini", label: "GPT-4o mini via LiteLLM" },
  ],
};

export function resolveApiKey(slug: ProviderSlug): string | null {
  // Ollama stores the base URL in OLLAMA_BASE_URL, default localhost.
  if (slug === "ollama") return process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
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
    case "ollama": {
      const { createOllamaProvider } = await import("./ollama.js");
      return createOllamaProvider(apiKey);
    }
    case "litellm": {
      const { createLiteLLMProvider } = await import("./litellm.js");
      return createLiteLLMProvider(apiKey);
    }
  }
}

/**
 * Probes Ollama to confirm it's actually reachable before claiming it as a provider.
 * Without this, autoDetect would always pick Ollama (since the URL has a default).
 */
async function isOllamaReachable(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 500);
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export async function autoDetectProvider(): Promise<Provider | null> {
  for (const slug of PROVIDER_SLUGS) {
    const key = resolveApiKey(slug);
    if (!key) continue;

    // Ollama needs a liveness probe -- a default URL is always set.
    if (slug === "ollama" && !(await isOllamaReachable(key))) continue;

    try {
      return await createProvider(slug, key);
    } catch {
      // Provider not yet implemented -- skip
      continue;
    }
  }
  return null;
}
