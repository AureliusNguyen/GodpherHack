import { Hono } from "hono";
import type { WriteupRepository } from "../repository/types.js";
import { ANALYZER_VERSION } from "../services/analyzer.js";

export function healthRoutes(repository: WriteupRepository) {
  const app = new Hono();

  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      analyzerVersion: ANALYZER_VERSION,
      indexGeneration: repository.getIndexGeneration(),
    });
  });

  return app;
}
