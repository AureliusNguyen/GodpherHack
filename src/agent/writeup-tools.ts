import type { RegisteredTool } from "./types.js";
import { HubClient } from "../client/hub-client.js";

/**
 * Writeup tools — search past writeups via Hub, save locally, push to Hub.
 */

function searchWriteupsTool(hub: HubClient): RegisteredTool {
  return {
    definition: {
      name: "search_writeups",
      description:
        "Search the writeup database for past CTF solves similar to the current challenge. " +
        "Use this when you are stuck, need hints, or want to find similar challenges that were solved before. " +
        "Returns ranked writeups with solution approaches.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Describe the challenge or technique you need help with",
          },
          category: {
            type: "string",
            enum: ["pwn", "rev", "crypto", "web", "forensics", "osint", "misc", "hardware"],
            description: "Optional: filter by challenge category",
          },
          topK: {
            type: "number",
            description: "Number of results to return (default: 3)",
          },
        },
        required: ["query"],
      },
    },
    async execute(args) {
      const query = args.query as string;
      const topK = (args.topK as number) ?? 3;

      try {
        const response = await hub.analyze({
          challenge: { name: "search", description: query, files: [], hints: [] },
          topK,
        });

        const writeups = response.topWriteups;
        if (!writeups || writeups.length === 0) {
          return "No matching writeups found. Try a different query or solve from scratch.";
        }

        const formatted = writeups.map((w, i) => {
          const score = (w.similarity * 100).toFixed(0);
          return [
            `--- Writeup ${i + 1} (${score}% match) ---`,
            `Challenge: ${w.title}`,
            `Category: ${w.category}`,
            `Tools: ${w.tools.join(", ") || "none listed"}`,
            `Key Insights: ${w.keyInsights.join("; ") || "none"}`,
            `Summary: ${w.summary}`,
          ].join("\n");
        });

        return formatted.join("\n\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
          return "Hub is not running. Start it with: godpherhack hub";
        }
        return `Error searching writeups: ${msg}`;
      }
    },
  };
}

function saveWriteupTool(challengeDir: string): RegisteredTool {
  return {
    definition: {
      name: "save_writeup",
      description:
        "Save a writeup locally after solving a challenge. Saves to writeups/<category>/ " +
        "in the working directory. Only call this after the user confirms they want to save.",
      inputSchema: {
        type: "object",
        properties: {
          challengeName: { type: "string", description: "Name in format CTFName_ChallengeName" },
          category: {
            type: "string",
            enum: ["pwn", "rev", "crypto", "web", "forensics", "osint", "misc", "hardware"],
            description: "Challenge category",
          },
          writeup: {
            type: "string",
            description:
              "A detailed writeup that must include ALL of the following sections:\n" +
              "# <Challenge Name> — <Category> Writeup\n" +
              "## Challenge Overview\nWhat the challenge gives you (files, description, hints)\n" +
              "## Initial Analysis\nFirst recon steps: file type, strings, imports, behavior\n" +
              "## Vulnerability / Key Insight\nThe core weakness or technique that cracks it\n" +
              "## Solution Steps\nNumbered step-by-step walkthrough with exact commands/code used\n" +
              "## Solve Script\nFull working script if applicable (python, pwntools, sage, etc.)\n" +
              "## Flag\nThe flag value\n" +
              "## Tools Used\nList of tools with brief note on how each was used\n" +
              "## Lessons Learned\nWhat was new or interesting about this challenge",
          },
          flag: { type: "string", description: "The flag value" },
          tools: {
            type: "array",
            items: { type: "string" },
            description: "Tools used (e.g. ['ida', 'python3', 'pwntools'])",
          },
        },
        required: ["challengeName", "category", "writeup"],
      },
    },
    async execute(args) {
      const challengeName = args.challengeName as string;
      const category = args.category as string;
      const writeup = args.writeup as string;
      const flag = args.flag as string | undefined;

      try {
        const { writeFileSync, mkdirSync } = await import("node:fs");
        const { join } = await import("node:path");

        const writeupDir = join(challengeDir, "writeups", category);
        mkdirSync(writeupDir, { recursive: true });

        const safeName = challengeName.replace(/[^a-zA-Z0-9_-]/g, "_");
        const filePath = join(writeupDir, `${safeName}.txt`);
        writeFileSync(filePath, writeup, "utf-8");

        const lines = [`Writeup saved to ${filePath}`];
        if (flag) lines.push(`Flag: ${flag}`);
        lines.push("Ask the user if they want to push this writeup to the shared Hub database.");

        return lines.join("\n");
      } catch (err) {
        return `Error saving writeup: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

function pushWriteupToHubTool(hub: HubClient, challengeDir: string): RegisteredTool {
  return {
    definition: {
      name: "push_writeup_to_hub",
      description:
        "Push a locally saved writeup to the shared Hub RAG database so it appears in " +
        "future search_writeups queries for the whole team. Only call this after the user " +
        "explicitly confirms they want to push to Hub.",
      inputSchema: {
        type: "object",
        properties: {
          challengeName: { type: "string", description: "Name of the challenge" },
          category: {
            type: "string",
            enum: ["pwn", "rev", "crypto", "web", "forensics", "osint", "misc", "hardware"],
            description: "Challenge category",
          },
          writeup: {
            type: "string",
            description: "The full writeup text (same as saved locally)",
          },
          flag: { type: "string", description: "The flag value" },
          tools: {
            type: "array",
            items: { type: "string" },
            description: "Tools used",
          },
          keyInsights: {
            type: "array",
            items: { type: "string" },
            description: "Key insights or techniques",
          },
        },
        required: ["challengeName", "category", "writeup"],
      },
    },
    async execute(args) {
      const challengeName = args.challengeName as string;
      const category = args.category as string;
      const writeup = args.writeup as string;
      const flag = args.flag as string | undefined;
      const tools = (args.tools as string[]) ?? [];
      const keyInsights = (args.keyInsights as string[]) ?? [];

      try {
        const response = await hub.submitSolve({
          challengeName,
          category: category as "pwn" | "rev" | "crypto" | "web" | "forensics" | "osint" | "misc" | "hardware",
          writeup,
          executionSteps: [writeup.slice(0, 500)],
          tools,
          keyInsights,
          flag,
        });

        return `Writeup pushed to Hub (id: ${response.id}). It will appear in future search_writeups queries.`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
          return "Hub is not running. Start it with: godpherhack hub\nWriteup is still saved locally.";
        }
        return `Error pushing to Hub: ${msg}`;
      }
    },
  };
}

/** Create writeup tools. search + push go through Hub, save goes to local challengeDir. */
export function createWriteupTools(challengeDir: string, hubUrl?: string): RegisteredTool[] {
  const url = hubUrl ?? process.env.HUB_URL ?? "http://localhost:3000";
  const hub = new HubClient(url);

  return [
    searchWriteupsTool(hub),
    saveWriteupTool(challengeDir),
    pushWriteupToHubTool(hub, challengeDir),
  ];
}
