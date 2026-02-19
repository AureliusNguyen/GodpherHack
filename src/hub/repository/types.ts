import type { CtfCategory } from "../schemas/common.js";
import type { WriteupEntry } from "../schemas/writeup.js";

export interface SearchQuery {
  keywords: string[];
  category: CtfCategory | null;
  topK: number;
  excludeIds?: string[];
}

export interface SearchResult {
  entry: WriteupEntry;
  similarity: number;
}

export interface WriteupRepository {
  search(query: SearchQuery): Promise<SearchResult[]>;
  store(entry: WriteupEntry): Promise<void>;
  getById(id: string): Promise<WriteupEntry | null>;
  delete(id: string): Promise<boolean>;
  getIndexGeneration(): number;
}
