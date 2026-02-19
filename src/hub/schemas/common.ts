import { z } from "zod";

export const CTF_CATEGORIES = [
  "pwn",
  "rev",
  "crypto",
  "web",
  "forensics",
  "misc",
  "osint",
  "hardware",
] as const;

export const CtfCategorySchema = z.enum(CTF_CATEGORIES);

export type CtfCategory = z.infer<typeof CtfCategorySchema>;

export const ConfidenceSchema = z.number().min(0).max(1);
