import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve prompts/ relative to the project root.
// At dev time: __dirname = src/agent → ../../prompts
// At bundle time: __dirname = dist → ../prompts
// We try both paths and use whichever exists.
const __dirname = dirname(fileURLToPath(import.meta.url));

function findPromptsDir(): string {
  // Bundled: dist/ → project root is ..
  const fromDist = resolve(__dirname, "../prompts");
  // Dev/test: src/agent/ → project root is ../..
  const fromSrc = resolve(__dirname, "../../prompts");

  try {
    readFileSync(resolve(fromDist, "system.md"));
    return fromDist;
  } catch {
    return fromSrc;
  }
}

const PROMPTS_DIR = findPromptsDir();

/** Load a prompt file from the prompts/ directory */
function loadPrompt(filename: string): string {
  return readFileSync(resolve(PROMPTS_DIR, filename), "utf-8");
}

/** Load a per-tool prompt from prompts/tools/<name>.md (returns empty string if missing) */
function loadToolPrompt(name: string): string {
  try {
    return readFileSync(resolve(PROMPTS_DIR, "tools", `${name}.md`), "utf-8");
  } catch {
    return "";
  }
}

/** Build the system prompt for the CTF solver agent */
export function buildSystemPrompt(challengeDir: string, activeTools?: string[]): string {
  let prompt = loadPrompt("system.md").replaceAll("{{challengeDir}}", challengeDir);

  // Append lightweight tool manifest
  try {
    prompt += "\n\n" + loadPrompt("tools.md");
  } catch {
    // tools.md is optional
  }

  // Append detailed per-tool prompts for each active pack
  if (activeTools) {
    for (const name of activeTools) {
      const toolPrompt = loadToolPrompt(name);
      if (toolPrompt) {
        prompt += "\n\n" + toolPrompt;
      }
    }
  }

  return prompt;
}
