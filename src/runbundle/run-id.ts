import { randomBytes } from "node:crypto";

/**
 * Generates a run ID in the format: run_YYYYMMDDTHHMMSS_8hexchars
 * Human-readable, sortable by time, with random suffix for uniqueness.
 */
export function generateRunId(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const s = String(now.getUTCSeconds()).padStart(2, "0");
  const hex = randomBytes(4).toString("hex");
  return `run_${y}${mo}${d}T${h}${mi}${s}_${hex}`;
}
