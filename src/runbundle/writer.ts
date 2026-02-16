import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  RunMetadata,
  RunMetadataSchema,
  RunStatus,
  StepStatus,
  PIPELINE_STEPS,
  Step,
} from "./types.js";
import { generateRunId } from "./run-id.js";
import { EventLogger } from "./event-logger.js";

export interface RunBundleInit {
  challengeDir: string;
  category?: string | null;
  budget?: number | null;
  outDir?: string | null;
}

export class RunBundle {
  readonly runId: string;
  readonly runDir: string;
  readonly artifactsDir: string;
  readonly eventLogger: EventLogger;
  private metadata: RunMetadata;

  private constructor(runDir: string, metadata: RunMetadata) {
    this.runId = metadata.runId;
    this.runDir = runDir;
    this.artifactsDir = join(runDir, "artifacts");
    this.metadata = metadata;
    this.eventLogger = new EventLogger(join(runDir, "events.jsonl"));
  }

  static create(baseDir: string, init: RunBundleInit): RunBundle {
    const runId = generateRunId();
    const runsRoot = resolve(baseDir, ".godpherhack", "runs");
    const runDir = join(runsRoot, runId);
    const artifactsDir = join(runDir, "artifacts");

    mkdirSync(artifactsDir, { recursive: true });

    const now = new Date().toISOString();
    const steps: Step[] = PIPELINE_STEPS.map((name) => ({
      name,
      status: "pending" as const,
      startedAt: null,
      completedAt: null,
    }));

    const metadata: RunMetadata = {
      runId,
      schemaVersion: 1,
      startedAt: now,
      completedAt: null,
      status: "running",
      durationMs: null,
      challengeDir: resolve(init.challengeDir),
      category: init.category ?? null,
      budget: init.budget ?? null,
      outDir: init.outDir ?? null,
      cliVersion: "0.1.0",
      steps,
      artifactCount: 0,
    };

    const bundle = new RunBundle(runDir, metadata);
    bundle.flush();

    bundle.eventLogger.log("run.start", `Run ${runId} started`);

    return bundle;
  }

  updateStep(name: string, status: StepStatus): void {
    const step = this.metadata.steps.find((s) => s.name === name);
    if (!step) throw new Error(`Unknown step: ${name}`);

    const now = new Date().toISOString();
    step.status = status;

    if (status === "running") {
      step.startedAt = now;
      this.eventLogger.log("step.start", `Step ${name} started`, { step: name });
    } else if (status === "success" || status === "failure" || status === "skipped") {
      step.completedAt = now;
      this.eventLogger.log("step.end", `Step ${name} ${status}`, { step: name });
    }

    this.flush();
  }

  complete(status: "success" | "failure" | "cancelled"): void {
    const now = new Date();
    this.metadata.status = status;
    this.metadata.completedAt = now.toISOString();
    this.metadata.durationMs =
      now.getTime() - new Date(this.metadata.startedAt).getTime();

    // Count artifacts
    try {
      this.metadata.artifactCount = readdirSync(this.artifactsDir).length;
    } catch {
      this.metadata.artifactCount = 0;
    }

    this.eventLogger.log("run.end", `Run completed with status: ${status}`);
    this.flush();
  }

  getMetadata(): RunMetadata {
    return { ...this.metadata };
  }

  private flush(): void {
    writeFileSync(
      join(this.runDir, "run.json"),
      JSON.stringify(this.metadata, null, 2) + "\n",
    );
  }

  static listRunIds(baseDir: string): string[] {
    const runsRoot = resolve(baseDir, ".godpherhack", "runs");
    try {
      const entries = readdirSync(runsRoot, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory() && e.name.startsWith("run_"))
        .map((e) => e.name)
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  static loadMetadata(baseDir: string, runId: string): RunMetadata {
    const runJsonPath = resolve(
      baseDir,
      ".godpherhack",
      "runs",
      runId,
      "run.json",
    );
    const raw = readFileSync(runJsonPath, "utf-8");
    return RunMetadataSchema.parse(JSON.parse(raw));
  }
}
