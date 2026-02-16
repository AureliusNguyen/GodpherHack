import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RunBundle } from "../../src/runbundle/writer.js";
import { RunMetadataSchema, RunEventSchema } from "../../src/runbundle/types.js";

describe("RunBundle", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "godpherhack-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates the expected directory structure", () => {
    const bundle = RunBundle.create(tempDir, {
      challengeDir: tempDir,
    });

    expect(existsSync(bundle.runDir)).toBe(true);
    expect(existsSync(bundle.artifactsDir)).toBe(true);
    expect(existsSync(join(bundle.runDir, "run.json"))).toBe(true);
  });

  it("writes valid run.json that passes schema validation", () => {
    const bundle = RunBundle.create(tempDir, {
      challengeDir: tempDir,
      category: "pwn",
      budget: 100,
    });

    const raw = readFileSync(join(bundle.runDir, "run.json"), "utf-8");
    const parsed = JSON.parse(raw);
    const result = RunMetadataSchema.safeParse(parsed);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("running");
      expect(result.data.category).toBe("pwn");
      expect(result.data.budget).toBe(100);
      expect(result.data.steps).toHaveLength(5);
    }
  });

  it("updates step status correctly", () => {
    const bundle = RunBundle.create(tempDir, {
      challengeDir: tempDir,
    });

    bundle.updateStep("recon", "running");
    let meta = bundle.getMetadata();
    const recon = meta.steps.find((s) => s.name === "recon")!;
    expect(recon.status).toBe("running");
    expect(recon.startedAt).not.toBeNull();

    bundle.updateStep("recon", "success");
    meta = bundle.getMetadata();
    const reconDone = meta.steps.find((s) => s.name === "recon")!;
    expect(reconDone.status).toBe("success");
    expect(reconDone.completedAt).not.toBeNull();
  });

  it("completes the run with duration", () => {
    const bundle = RunBundle.create(tempDir, {
      challengeDir: tempDir,
    });

    bundle.complete("success");
    const meta = bundle.getMetadata();

    expect(meta.status).toBe("success");
    expect(meta.completedAt).not.toBeNull();
    expect(meta.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("serializes events to events.jsonl", () => {
    const bundle = RunBundle.create(tempDir, {
      challengeDir: tempDir,
    });

    bundle.updateStep("recon", "running");
    bundle.updateStep("recon", "success");

    const eventsPath = join(bundle.runDir, "events.jsonl");
    expect(existsSync(eventsPath)).toBe(true);

    const lines = readFileSync(eventsPath, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    // run.start + step.start + step.end = 3 events
    expect(lines.length).toBe(3);

    for (const line of lines) {
      const result = RunEventSchema.safeParse(line);
      expect(result.success).toBe(true);
    }

    expect(lines[0].type).toBe("run.start");
    expect(lines[1].type).toBe("step.start");
    expect(lines[2].type).toBe("step.end");
  });

  it("lists run IDs newest first", () => {
    RunBundle.create(tempDir, { challengeDir: tempDir });
    RunBundle.create(tempDir, { challengeDir: tempDir });

    const ids = RunBundle.listRunIds(tempDir);
    expect(ids).toHaveLength(2);
    // Newest first (reverse sorted)
    expect(ids[0] > ids[1]).toBe(true);
  });

  it("loads and validates metadata from disk", () => {
    const bundle = RunBundle.create(tempDir, {
      challengeDir: tempDir,
    });

    const loaded = RunBundle.loadMetadata(tempDir, bundle.runId);
    expect(loaded.runId).toBe(bundle.runId);
    expect(loaded.schemaVersion).toBe(1);
  });
});
