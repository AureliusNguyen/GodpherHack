import { createHash } from "node:crypto";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { SolveSubmitRequestSchema } from "../schemas/writeup.js";
import type { WriteupRepository } from "../repository/types.js";

function generateWriteupId(
  writeup: string,
  challengeName: string,
  sourceUrl?: string,
): string {
  const content = `${writeup.trim()}|${challengeName.trim()}|${sourceUrl ?? ""}`;
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function solveRoutes(repository: WriteupRepository) {
  const app = new Hono();

  app.post(
    "/solves",
    zValidator("json", SolveSubmitRequestSchema),
    async (c) => {
      const body = c.req.valid("json");

      const id = generateWriteupId(
        body.writeup,
        body.challengeName,
        body.sourceUrl,
      );

      const title = `Solve: ${body.challengeName}`;
      const summary = body.writeup.length > 200
        ? body.writeup.slice(0, 200) + "..."
        : body.writeup;

      await repository.store({
        id,
        title,
        category: body.category,
        keywords: extractKeywordsFromWriteup(body.writeup, body.tools),
        tools: body.tools,
        executionSteps: body.executionSteps,
        keyInsights: body.keyInsights,
        summary,
        fullWriteup: body.writeup,
        flag: body.flag,
        challengeName: body.challengeName,
        sourceUrl: body.sourceUrl,
        userFeedback: body.userFeedback,
        createdAt: new Date().toISOString(),
      });

      return c.json({ stored: true, id });
    },
  );

  app.delete("/solves/:id", async (c) => {
    const id = c.req.param("id");
    const deleted = await repository.delete(id);

    if (!deleted) {
      return c.json({ error: "Writeup not found" }, 404);
    }

    return c.json({ deleted: true, id });
  });

  return app;
}

function extractKeywordsFromWriteup(writeup: string, tools: string[]): string[] {
  const words = writeup
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3);
  const unique = [...new Set([...words, ...tools.map((t) => t.toLowerCase())])];
  return unique.slice(0, 20);
}
