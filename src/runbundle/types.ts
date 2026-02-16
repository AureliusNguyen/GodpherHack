import { z } from "zod";

export const RUN_ID_PATTERN = /^run_\d{8}T\d{6}_[0-9a-f]{8}$/;

export const PIPELINE_STEPS = [
  "recon",
  "plan",
  "exploit",
  "verify",
  "report",
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number];

export const StepStatusSchema = z.enum([
  "pending",
  "running",
  "success",
  "failure",
  "skipped",
]);

export type StepStatus = z.infer<typeof StepStatusSchema>;

export const StepSchema = z.object({
  name: z.string(),
  status: StepStatusSchema,
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export type Step = z.infer<typeof StepSchema>;

export const RunStatusSchema = z.enum([
  "running",
  "success",
  "failure",
  "cancelled",
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunMetadataSchema = z.object({
  runId: z.string().regex(RUN_ID_PATTERN),
  schemaVersion: z.literal(1),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  status: RunStatusSchema,
  durationMs: z.number().nullable(),
  challengeDir: z.string(),
  category: z.string().nullable(),
  budget: z.number().nullable(),
  outDir: z.string().nullable(),
  cliVersion: z.string(),
  steps: z.array(StepSchema),
  artifactCount: z.number(),
});

export type RunMetadata = z.infer<typeof RunMetadataSchema>;

export const RunEventTypeSchema = z.enum([
  "run.start",
  "step.start",
  "step.end",
  "run.end",
  "error",
]);

export type RunEventType = z.infer<typeof RunEventTypeSchema>;

export const RunEventSchema = z.object({
  seq: z.number(),
  ts: z.string(),
  type: RunEventTypeSchema,
  step: z.string().optional(),
  message: z.string(),
  data: z.record(z.unknown()).optional(),
});

export type RunEvent = z.infer<typeof RunEventSchema>;
