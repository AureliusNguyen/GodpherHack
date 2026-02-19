import { serve } from "@hono/node-server";
import { InMemoryWriteupRepository } from "./repository/in-memory.js";
import { ChallengeAnalyzer } from "./services/analyzer.js";
import { createHub } from "./server.js";

export interface HubOptions {
  port: number;
}

export async function startHub(opts: HubOptions) {
  const repository = new InMemoryWriteupRepository();
  const analyzer = new ChallengeAnalyzer(null); // no LLM provider yet 

  const app = createHub({ repository, analyzer });

  console.log(`[hub] Starting Hub API on port ${opts.port}...`);

  serve({ fetch: app.fetch, port: opts.port }, (info) => {
    console.log(`[hub] Hub API listening on http://localhost:${info.port}`);
  });
}

export { createHub } from "./server.js";
export type { HubDeps } from "./server.js";
