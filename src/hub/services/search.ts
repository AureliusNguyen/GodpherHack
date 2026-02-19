import type { WriteupRepository, SearchQuery } from "../repository/types.js";
import type { WriteupHit } from "../schemas/challenge.js";

export class SearchService {
  constructor(private repository: WriteupRepository) {}

  async search(query: SearchQuery): Promise<WriteupHit[]> {
    const results = await this.repository.search(query);

    return results.map((r) => ({
      id: r.entry.id,
      title: r.entry.title,
      category: r.entry.category,
      similarity: r.similarity,
      summary: r.entry.summary,
      keywords: r.entry.keywords,
      tools: r.entry.tools,
      keyInsights: r.entry.keyInsights,
    }));
  }
}
