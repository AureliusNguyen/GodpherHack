import { z } from "zod";
import { CtfCategorySchema, ConfidenceSchema } from "./common.js";

export const ChallengeInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  files: z.array(z.string()).optional().default([]),
  hints: z.array(z.string()).optional().default([]),
  sourceUrl: z.string().url().optional(),
  rawText: z.string().optional(),
});

export type ChallengeInput = z.infer<typeof ChallengeInputSchema>;

export const WriteupHitSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: CtfCategorySchema,
  similarity: z.number().min(0).max(1),
  summary: z.string(),
  keywords: z.array(z.string()),
  tools: z.array(z.string()),
  keyInsights: z.array(z.string()),
});

export type WriteupHit = z.infer<typeof WriteupHitSchema>;

export const AnalyzeRequestSchema = z.object({
  challenge: ChallengeInputSchema,
  topK: z.number().int().min(1).max(50).optional().default(5),
});

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const AnalyzeResponseSchema = z.object({
  analysisId: z.string(),
  runId: z.string(),
  category: CtfCategorySchema,
  categoryConfidence: ConfidenceSchema,
  keywords: z.array(z.string()),
  suggestedTools: z.array(z.string()),
  topWriteups: z.array(WriteupHitSchema),
  analysisNote: z.string(),
});

export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;

export const RetryRequestSchema = z.object({
  challenge: ChallengeInputSchema,
  previousAnalysisId: z.string().optional(),
  previousKeywords: z.array(z.string()),
  feedback: z.string().min(1),
  attemptNumber: z.number().int().min(1),
  excludeWriteupIds: z.array(z.string()).optional().default([]),
  topK: z.number().int().min(1).max(50).optional().default(5),
});

export type RetryRequest = z.infer<typeof RetryRequestSchema>;

export const RetryResponseSchema = AnalyzeResponseSchema.extend({
  previousAnalysisId: z.string().optional(),
});

export type RetryResponse = z.infer<typeof RetryResponseSchema>;
