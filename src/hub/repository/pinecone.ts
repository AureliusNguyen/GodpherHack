import { Pinecone } from "@pinecone-database/pinecone";
import type { WriteupEntry } from "../schemas/writeup.js";
import type { SearchQuery, SearchResult, WriteupRepository } from "./types.js";

export interface PineconeRepoConfig {
  apiKey: string;
  indexName: string;
  namespace?: string;
}

/**
 * Pinecone-backed writeup repository using an integrated index.
 * Text is sent directly — Pinecone handles embedding via llama-text-embed-v2.
 *
 * Record schema (flat fields, no metadata wrapper):
 *   _id: string (writeup ID)
 *   writeup_text: string (concatenated text for embedding — matches fieldMap)
 *   title, category, keywords, tools, summary, challengeName, etc. (metadata)
 */
export class PineconeWriteupRepository implements WriteupRepository {
  private client: Pinecone;
  private indexName: string;
  private namespace: string;
  private indexGeneration = 0;

  constructor(config: PineconeRepoConfig) {
    this.client = new Pinecone({ apiKey: config.apiKey });
    this.indexName = config.indexName;
    this.namespace = config.namespace ?? "writeups";
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const searchText = query.keywords.join(" ");
    if (!searchText.trim()) return [];

    const index = this.client.index(this.indexName);
    const ns = index.namespace(this.namespace);

    // Build metadata filter
    const filter: Record<string, unknown> = {};
    if (query.category) {
      filter.category = { $eq: query.category };
    }
    if (query.excludeIds && query.excludeIds.length > 0) {
      filter._id = { $nin: query.excludeIds };
    }
    const hasFilter = Object.keys(filter).length > 0;

    const results = await ns.searchRecords({
      query: {
        topK: query.topK,
        inputs: { text: searchText },
        ...(hasFilter ? { filter } : {}),
      },
      rerank: { model: "bge-reranker-v2-m3", topN: query.topK, rankFields: ["writeup_text"] },
    });

    const hits = results.result?.hits ?? [];
    return hits.map((hit) => ({
      entry: this.hitToEntry(hit._id, hit.fields as Record<string, unknown>),
      similarity: hit._score ?? 0,
    }));
  }

  async store(entry: WriteupEntry): Promise<void> {
    const index = this.client.index(this.indexName);
    const ns = index.namespace(this.namespace);

    await ns.upsertRecords({
      records: [{
        _id: entry.id,
        writeup_text: this.buildEmbeddingText(entry),
        title: entry.title,
        category: entry.category,
        keywords: entry.keywords.join(","),
        tools: entry.tools.join(","),
        summary: entry.summary,
        challengeName: entry.challengeName,
        keyInsights: entry.keyInsights.join(","),
        createdAt: entry.createdAt,
        ...(entry.flag ? { flag: entry.flag } : {}),
        ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}),
      }],
    });
    this.indexGeneration++;
  }

  async getById(id: string): Promise<WriteupEntry | null> {
    const index = this.client.index(this.indexName);
    const ns = index.namespace(this.namespace);

    try {
      const response = await ns.fetch({ ids: [id] });
      const record = response?.records?.[id];
      if (!record) return null;
      const metadata = (record.metadata ?? {}) as Record<string, unknown>;
      return this.hitToEntry(id, metadata);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    const index = this.client.index(this.indexName);
    const ns = index.namespace(this.namespace);

    try {
      await ns.deleteOne({ id });
      this.indexGeneration++;
      return true;
    } catch {
      return false;
    }
  }

  getIndexGeneration(): number {
    return this.indexGeneration;
  }

  private buildEmbeddingText(entry: WriteupEntry): string {
    return [entry.title, entry.summary, entry.fullWriteup].filter(Boolean).join("\n\n");
  }

  private hitToEntry(id: string, fields: Record<string, unknown>): WriteupEntry {
    return {
      id,
      title: String(fields.title ?? ""),
      category: (fields.category as WriteupEntry["category"]) ?? "misc",
      keywords: this.splitCsv(fields.keywords),
      tools: this.splitCsv(fields.tools),
      executionSteps: [],
      keyInsights: this.splitCsv(fields.keyInsights),
      summary: String(fields.summary ?? ""),
      fullWriteup: String(fields.writeup_text ?? ""),
      challengeName: String(fields.challengeName ?? ""),
      flag: fields.flag ? String(fields.flag) : undefined,
      sourceUrl: fields.sourceUrl ? String(fields.sourceUrl) : undefined,
      createdAt: String(fields.createdAt ?? new Date().toISOString()),
    };
  }

  private splitCsv(value: unknown): string[] {
    if (!value || typeof value !== "string") return [];
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }
}
