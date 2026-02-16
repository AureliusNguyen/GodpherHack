import { describe, it, expect } from "vitest";
import { generateRunId } from "../../src/runbundle/run-id.js";
import { RUN_ID_PATTERN } from "../../src/runbundle/types.js";

describe("generateRunId", () => {
  it("matches the expected pattern", () => {
    const id = generateRunId();
    expect(id).toMatch(RUN_ID_PATTERN);
  });

  it("uses the injected date", () => {
    const date = new Date("2026-03-15T09:30:45Z");
    const id = generateRunId(date);
    expect(id).toMatch(/^run_20260315T093045_[0-9a-f]{8}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateRunId());
    }
    expect(ids.size).toBe(100);
  });

  it("pads single-digit months and days", () => {
    const date = new Date("2026-01-05T03:07:09Z");
    const id = generateRunId(date);
    expect(id).toMatch(/^run_20260105T030709_[0-9a-f]{8}$/);
  });
});
