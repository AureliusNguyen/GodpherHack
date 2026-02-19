import type { WriteupEntry } from "../schemas/writeup.js";
import type { SearchQuery, SearchResult, WriteupRepository } from "./types.js";

export class InMemoryWriteupRepository implements WriteupRepository {
  private entries = new Map<string, WriteupEntry>();
  private indexGeneration = 0;

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const excludeSet = new Set(query.excludeIds ?? []);
    const queryKeywords = query.keywords.map((k) => k.toLowerCase());

    for (const entry of this.entries.values()) {
      if (excludeSet.has(entry.id)) continue;
      if (query.category && entry.category !== query.category) continue;

      const entryKeywords = entry.keywords.map((k) => k.toLowerCase());
      const overlap = queryKeywords.filter((k) => entryKeywords.includes(k));
      if (overlap.length === 0 && query.keywords.length > 0) continue;

      const similarity =
        queryKeywords.length > 0 ? overlap.length / queryKeywords.length : 0;

      results.push({ entry, similarity });
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, query.topK);
  }

  async store(entry: WriteupEntry): Promise<void> {
    if (this.entries.has(entry.id)) return; // idempotent — content-hash ID
    this.entries.set(entry.id, entry);
    this.indexGeneration++;
  }

  async getById(id: string): Promise<WriteupEntry | null> {
    return this.entries.get(id) ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const existed = this.entries.delete(id);
    if (existed) this.indexGeneration++;
    return existed;
  }

  getIndexGeneration(): number {
    return this.indexGeneration;
  }
}
