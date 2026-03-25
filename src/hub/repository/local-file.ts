import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { WriteupEntry } from "../schemas/writeup.js";
import type { SearchQuery, SearchResult, WriteupRepository } from "./types.js";

/**
 * File-based local writeup repository.
 * Stores writeups as JSON files in ~/.godpherhack/writeups/.
 * Search uses keyword overlap (grep-style, no embeddings needed).
 */
export class LocalFileWriteupRepository implements WriteupRepository {
  private dir: string;
  private indexGeneration = 0;

  constructor(dir?: string) {
    this.dir = dir ?? join(homedir(), ".godpherhack", "writeups");
    mkdirSync(this.dir, { recursive: true });
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const entries = this.loadAll();
    const results: SearchResult[] = [];
    const excludeSet = new Set(query.excludeIds ?? []);
    const queryKeywords = query.keywords.map((k) => k.toLowerCase());

    for (const entry of entries) {
      if (excludeSet.has(entry.id)) continue;
      if (query.category && entry.category !== query.category) continue;

      // Match keywords against title, summary, keywords, and tools
      const searchable = [
        entry.title,
        entry.summary,
        ...entry.keywords,
        ...entry.tools,
        entry.challengeName,
      ].join(" ").toLowerCase();

      const matchCount = queryKeywords.filter((k) => searchable.includes(k)).length;
      if (matchCount === 0 && queryKeywords.length > 0) continue;

      const similarity = queryKeywords.length > 0 ? matchCount / queryKeywords.length : 0;
      results.push({ entry, similarity });
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, query.topK);
  }

  async store(entry: WriteupEntry): Promise<void> {
    const filePath = this.entryPath(entry.id);
    if (existsSync(filePath)) return; // idempotent
    writeFileSync(filePath, JSON.stringify(entry, null, 2), "utf-8");
    this.indexGeneration++;
  }

  async getById(id: string): Promise<WriteupEntry | null> {
    const filePath = this.entryPath(id);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, "utf-8")) as WriteupEntry;
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    const filePath = this.entryPath(id);
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    this.indexGeneration++;
    return true;
  }

  getIndexGeneration(): number {
    return this.indexGeneration;
  }

  private entryPath(id: string): string {
    // Sanitize ID for filesystem
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.dir, `${safeId}.json`);
  }

  private loadAll(): WriteupEntry[] {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    const entries: WriteupEntry[] = [];
    for (const file of files) {
      try {
        entries.push(JSON.parse(readFileSync(join(this.dir, file), "utf-8")) as WriteupEntry);
      } catch {
        // skip corrupted files
      }
    }
    return entries;
  }
}
