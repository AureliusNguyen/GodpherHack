import { z } from "zod";
import { CtfCategorySchema } from "./common.js";

export const WriteupEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  category: CtfCategorySchema,
  keywords: z.array(z.string()),
  tools: z.array(z.string()),
  executionSteps: z.array(z.string()),
  keyInsights: z.array(z.string()),
  summary: z.string(),
  fullWriteup: z.string(),
  flag: z.string().optional(),
  challengeName: z.string(),
  sourceUrl: z.string().url().optional(),
  userFeedback: z.string().optional(),
  createdAt: z.string(),
});

export type WriteupEntry = z.infer<typeof WriteupEntrySchema>;

export const SolveSubmitRequestSchema = z.object({
  challengeName: z.string().min(1),
  category: CtfCategorySchema,
  writeup: z.string().min(1),
  executionSteps: z.array(z.string()).min(1),
  tools: z.array(z.string()),
  keyInsights: z.array(z.string()),
  flag: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  userFeedback: z.string().optional(),
});

export type SolveSubmitRequest = z.infer<typeof SolveSubmitRequestSchema>;

export const SolveSubmitResponseSchema = z.object({
  stored: z.boolean(),
  id: z.string(),
});

export type SolveSubmitResponse = z.infer<typeof SolveSubmitResponseSchema>;
