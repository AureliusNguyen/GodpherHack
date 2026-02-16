import { appendFileSync } from "node:fs";
import { RunEventType } from "./types.js";

export interface EventLogOptions {
  step?: string;
  data?: Record<string, unknown>;
}

export class EventLogger {
  private seq = 0;
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  log(type: RunEventType, message: string, opts?: EventLogOptions): void {
    const event = {
      seq: this.seq++,
      ts: new Date().toISOString(),
      type,
      ...(opts?.step !== undefined && { step: opts.step }),
      message,
      ...(opts?.data !== undefined && { data: opts.data }),
    };
    appendFileSync(this.path, JSON.stringify(event) + "\n");
  }
}
