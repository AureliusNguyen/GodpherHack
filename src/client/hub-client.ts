import type {
  AnalyzeRequest,
  AnalyzeResponse,
  RetryRequest,
  RetryResponse,
  SolveSubmitRequest,
  SolveSubmitResponse,
} from "../shared/api-types.js";
import { FileCache, cacheKey } from "./cache.js";
import { readStoredToken } from "./auth-client.js";

const RETRIEVAL_TTL = 1000 * 60 * 60 * 24; // 24 hours for RAG results

export class HubClient {
  private baseUrl: string;
  private cache: FileCache;

  constructor(baseUrl = "http://localhost:3000") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.cache = new FileCache();
  }

  private authHeaders(): Record<string, string> {
    const token = readStoredToken(this.baseUrl);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async health(): Promise<{ status: string; analyzerVersion: string; indexGeneration: number }> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new Error(`Hub health check failed: ${res.status}`);
    return res.json() as Promise<{ status: string; analyzerVersion: string; indexGeneration: number }>;
  }

  async analyze(req: AnalyzeRequest): Promise<AnalyzeResponse> {
    const { indexGeneration, analyzerVersion } = await this.health();

    // One cache, keyed on both fences. indexGeneration invalidates when
    // new writeups are indexed; analyzerVersion invalidates when the
    // categorization/keyword logic changes server-side. Without the
    // latter, a 24h-cached response keeps stale category labels across
    // an analyzer upgrade.
    const retrievalKey = cacheKey("retrieval", req, analyzerVersion, indexGeneration);
    const cached = await this.cache.get<AnalyzeResponse>(retrievalKey);
    if (cached) return cached;

    const res = await this.post<AnalyzeResponse>("/challenges/analyze", req);
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
      headers: this.authHeaders(),
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
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders(),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Hub API error ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }
}
