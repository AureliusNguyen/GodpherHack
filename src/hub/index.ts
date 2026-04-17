import { serve } from "@hono/node-server";
import { InMemoryWriteupRepository } from "./repository/in-memory.js";
import { PineconeWriteupRepository } from "./repository/pinecone.js";
import type { WriteupRepository } from "./repository/types.js";
import { ChallengeAnalyzer } from "./services/analyzer.js";
import { createHub } from "./server.js";

export interface HubOptions {
  port: number;
}

function createRepository(): WriteupRepository {
  const pineconeKey = process.env.PINECONE_API_KEY;
  if (pineconeKey) {
    const indexName = process.env.PINECONE_INDEX_NAME ?? "ctf-writeups";
    console.log(`[hub] Using Pinecone repository (index: ${indexName})`);
    return new PineconeWriteupRepository({ apiKey: pineconeKey, indexName });
  }
  console.log("[hub] PINECONE_API_KEY not set — using in-memory repository (data will not persist)");
  return new InMemoryWriteupRepository();
}

export async function startHub(opts: HubOptions) {
  const repository = createRepository();
  const analyzer = new ChallengeAnalyzer(null); // no LLM provider yet

  const app = createHub({ repository, analyzer });

  console.log(`[hub] Starting Hub API on port ${opts.port}...`);

  serve({ fetch: app.fetch, port: opts.port }, (info) => {
    console.log(`[hub] Hub API listening on http://localhost:${info.port}`);
  });
}

export { createHub } from "./server.js";
export type { HubDeps } from "./server.js";
