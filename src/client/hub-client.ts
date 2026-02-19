import type {
  AnalyzeRequest,
  AnalyzeResponse,
  RetryRequest,
  RetryResponse,
  SolveSubmitRequest,
  SolveSubmitResponse,
} from "../shared/api-types.js";
import { FileCache, cacheKey } from "./cache.js";

const ANALYSIS_TTL = 1000 * 60 * 60;       // 1 hour for LLM categorization
const RETRIEVAL_TTL = 1000 * 60 * 60 * 24; // 24 hours for RAG results

export class HubClient {
  private baseUrl: string;
  private cache: FileCache;

  constructor(baseUrl = "http://localhost:3000") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.cache = new FileCache();
  }

  async health(): Promise<{ status: string; analyzerVersion: string; indexGeneration: number }> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new Error(`Hub health check failed: ${res.status}`);
    return res.json() as Promise<{ status: string; analyzerVersion: string; indexGeneration: number }>;
  }

  async analyze(req: AnalyzeRequest): Promise<AnalyzeResponse> {
    const { indexGeneration, analyzerVersion } = await this.health();

    // Analysis cache: keyed by challenge + analyzerVersion (invalidates on analyzer upgrade)
    const analysisKey = cacheKey("analysis", req.challenge, analyzerVersion);

    // Retrieval cache: keyed by challenge + topK + indexGeneration (invalidates on RAG changes)
    const retrievalKey = cacheKey("retrieval", req, indexGeneration);
    const cachedRetrieval = await this.cache.get<AnalyzeResponse>(retrievalKey);

    // Retrieval layer covers both analysis + writeups — return if valid
    if (cachedRetrieval) return cachedRetrieval;

    // Analysis-only cache: same analysis but writeups may have changed
    const cachedAnalysis = await this.cache.get<AnalyzeResponse>(analysisKey);
    if (cachedAnalysis) return cachedAnalysis;

    const res = await this.post<AnalyzeResponse>("/challenges/analyze", req);
    await this.cache.set(analysisKey, res, ANALYSIS_TTL);
    await this.cache.set(retrievalKey, res, RETRIEVAL_TTL);
    return res;
  }

  async retry(req: RetryRequest): Promise<RetryResponse> {
    // Retry is never cached — feedback changes each time
    return this.post<RetryResponse>("/challenges/retry", req);
  }

  async submitSolve(req: SolveSubmitRequest): Promise<SolveSubmitResponse> {
    // Write operation — never cached
    return this.post<SolveSubmitResponse>("/solves", req);
  }

  async deleteSolve(id: string): Promise<{ deleted: boolean; id: string }> {
    const res = await fetch(`${this.baseUrl}/solves/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Hub API error ${res.status}: ${text}`);
    }

    return res.json() as Promise<{ deleted: boolean; id: string }>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Hub API error ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }
}
