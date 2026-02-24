import { z } from "zod";

export const ToolInfoSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.unknown()),
});

export const ToolOutputSchema = z.object({
  type: z.enum(["text", "binary", "json", "error"]),
  content: z.string(),
  data: z.unknown().optional(),
  mimeType: z.string().optional(),
});

export const ToolResultSchema = z.object({
  toolName: z.string(),
  success: z.boolean(),
  output: ToolOutputSchema,
  durationMs: z.number(),
});
