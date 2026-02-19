import { createHash } from "node:crypto";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { AnalyzeRequestSchema, RetryRequestSchema } from "../schemas/challenge.js";
import type { WriteupHit } from "../schemas/challenge.js";
import type { ChallengeAnalyzer } from "../services/analyzer.js";
import type { SearchService } from "../services/search.js";
import type { WriteupRepository } from "../repository/types.js";

function computeRunId(
  analysisId: string,
  indexGeneration: number,
  topK: number,
  hitIds: string[],
): string {
  return createHash("sha256")
    .update(`${analysisId}|${indexGeneration}|${topK}|${hitIds.join(",")}`)
    .digest("hex")
    .slice(0, 12);
}

export function challengeRoutes(
  analyzer: ChallengeAnalyzer,
  searchService: SearchService,
  repository: WriteupRepository,
) {
  const app = new Hono();

  app.post(
    "/challenges/analyze",
    zValidator("json", AnalyzeRequestSchema),
    async (c) => {
      const { challenge, topK } = c.req.valid("json");

      const analysis = await analyzer.analyze(challenge);
      const writeups = await searchService.search({
        keywords: analysis.keywords,
        category: analysis.category,
        topK,
      });

      const runId = computeRunId(
        analysis.analysisId,
        repository.getIndexGeneration(),
        topK,
        writeups.map((w: WriteupHit) => w.id),
      );

      return c.json({
        analysisId: analysis.analysisId,
        runId,
        category: analysis.category,
        categoryConfidence: analysis.categoryConfidence,
        keywords: analysis.keywords,
        suggestedTools: analysis.suggestedTools,
        topWriteups: writeups,
        analysisNote: analysis.analysisNote,
      });
    },
  );

  app.post(
    "/challenges/retry",
    zValidator("json", RetryRequestSchema),
    async (c) => {
      const {
        challenge,
        previousAnalysisId,
        previousKeywords,
        feedback,
        excludeWriteupIds,
        topK,
      } = c.req.valid("json");

      const analysis = await analyzer.refine(
        challenge,
        previousKeywords,
        feedback,
      );
      const writeups = await searchService.search({
        keywords: analysis.keywords,
        category: analysis.category,
        topK,
        excludeIds: excludeWriteupIds,
      });

      const runId = computeRunId(
        analysis.analysisId,
        repository.getIndexGeneration(),
        topK,
        writeups.map((w: WriteupHit) => w.id),
      );

      return c.json({
        analysisId: analysis.analysisId,
        runId,
        previousAnalysisId,
        category: analysis.category,
        categoryConfidence: analysis.categoryConfidence,
        keywords: analysis.keywords,
        suggestedTools: analysis.suggestedTools,
        topWriteups: writeups,
        analysisNote: analysis.analysisNote,
      });
    },
  );

  return app;
}
