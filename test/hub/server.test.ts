import { describe, it, expect } from "vitest";
import { createHub } from "../../src/hub/server.js";
import { InMemoryWriteupRepository } from "../../src/hub/repository/in-memory.js";
import { ChallengeAnalyzer } from "../../src/hub/services/analyzer.js";

function setup() {
  const repository = new InMemoryWriteupRepository();
  const analyzer = new ChallengeAnalyzer(null);
  const app = createHub({ repository, analyzer });
  return { app, repository };
}

async function json(res: Response) {
  return res.json();
}

describe("Hub API server", () => {
  describe("GET /health", () => {
    it("returns ok with indexGeneration 0", async () => {
      const { app } = setup();
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.status).toBe("ok");
      expect(body.indexGeneration).toBe(0);
      expect(body.analyzerVersion).toBeTruthy();
    });
  });

  describe("POST /challenges/analyze", () => {
    it("returns analysis with analysisId and runId", async () => {
      const { app } = setup();
      const res = await app.request("/challenges/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge: { name: "test", description: "a pwn challenge" },
        }),
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.category).toBeTruthy();
      expect(body.keywords).toBeInstanceOf(Array);
      expect(body.topWriteups).toBeInstanceOf(Array);
      expect(body.analysisId).toBeTruthy();
      expect(body.runId).toBeTruthy();
    });

    it("returns deterministic analysisId for same input", async () => {
      const { app } = setup();
      const payload = {
        challenge: { name: "test", description: "a pwn challenge" },
      };

      const body1 = await json(await app.request("/challenges/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }));
      const body2 = await json(await app.request("/challenges/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }));

      expect(body1.analysisId).toBe(body2.analysisId);
      expect(body1.runId).toBe(body2.runId);
    });

    it("runId changes when indexGeneration changes", async () => {
      const { app } = setup();
      const payload = {
        challenge: { name: "test", description: "a pwn challenge" },
      };

      const body1 = await json(await app.request("/challenges/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }));

      // Add a solve to bump indexGeneration
      await app.request("/solves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeName: "other",
          category: "pwn",
          writeup: "some writeup",
          executionSteps: ["s1"],
          tools: ["gdb"],
          keyInsights: ["i1"],
        }),
      });

      const body2 = await json(await app.request("/challenges/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }));

      // analysisId stays the same (same input), runId changes (different index state)
      expect(body1.analysisId).toBe(body2.analysisId);
      expect(body1.runId).not.toBe(body2.runId);
    });

    it("returns 400 for invalid body", async () => {
      const { app } = setup();
      const res = await app.request("/challenges/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge: { name: "" } }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /solves", () => {
    it("stores a solve and returns id", async () => {
      const { app } = setup();
      const res = await app.request("/solves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeName: "test-chall",
          category: "pwn",
          writeup: "solved by overflowing the buffer",
          executionSteps: ["step1"],
          tools: ["gdb"],
          keyInsights: ["overflow"],
        }),
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.stored).toBe(true);
      expect(body.id).toBeTruthy();
    });

    it("is idempotent — same content returns same id", async () => {
      const { app } = setup();
      const payload = {
        challengeName: "test-chall",
        category: "pwn" as const,
        writeup: "solved by overflowing the buffer",
        executionSteps: ["step1"],
        tools: ["gdb"],
        keyInsights: ["overflow"],
      };

      const res1 = await app.request("/solves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const res2 = await app.request("/solves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body1 = await json(res1);
      const body2 = await json(res2);
      expect(body1.id).toBe(body2.id);
    });
  });

  describe("DELETE /solves/:id", () => {
    it("deletes a stored writeup", async () => {
      const { app } = setup();

      const storeRes = await app.request("/solves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeName: "test",
          category: "pwn",
          writeup: "a writeup",
          executionSteps: ["s1"],
          tools: ["gdb"],
          keyInsights: ["insight"],
        }),
      });
      const { id } = await json(storeRes);

      const delRes = await app.request(`/solves/${id}`, { method: "DELETE" });
      expect(delRes.status).toBe(200);
      const delBody = await json(delRes);
      expect(delBody.deleted).toBe(true);
    });

    it("returns 404 for non-existent id", async () => {
      const { app } = setup();
      const res = await app.request("/solves/nonexistent", { method: "DELETE" });
      expect(res.status).toBe(404);
    });
  });

  describe("indexGeneration tracking", () => {
    it("increments on store and delete", async () => {
      const { app } = setup();

      let health = await json(await app.request("/health"));
      expect(health.indexGeneration).toBe(0);

      const storeRes = await app.request("/solves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeName: "test",
          category: "pwn",
          writeup: "content",
          executionSteps: ["s1"],
          tools: ["gdb"],
          keyInsights: ["i1"],
        }),
      });
      const { id } = await json(storeRes);

      health = await json(await app.request("/health"));
      expect(health.indexGeneration).toBe(1);

      await app.request(`/solves/${id}`, { method: "DELETE" });
      health = await json(await app.request("/health"));
      expect(health.indexGeneration).toBe(2);
    });
  });

  describe("POST /challenges/retry", () => {
    it("returns refined analysis with feedback", async () => {
      const { app } = setup();
      const res = await app.request("/challenges/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge: { name: "test", description: "a pwn challenge" },
          previousKeywords: ["heap"],
          feedback: "try heap exploitation",
          attemptNumber: 2,
        }),
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.keywords).toContain("heap");
      expect(body.analysisNote).toContain("try heap exploitation");
      expect(body.analysisId).toBeTruthy();
      expect(body.runId).toBeTruthy();
    });

    it("echoes previousAnalysisId when provided", async () => {
      const { app } = setup();

      // First, get an analysisId from analyze
      const analyzeRes = await json(await app.request("/challenges/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge: { name: "test", description: "a pwn challenge" },
        }),
      }));

      // Retry with that analysisId
      const retryRes = await json(await app.request("/challenges/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge: { name: "test", description: "a pwn challenge" },
          previousAnalysisId: analyzeRes.analysisId,
          previousKeywords: analyzeRes.keywords,
          feedback: "didn't work, try something else",
          attemptNumber: 2,
        }),
      }));

      expect(retryRes.previousAnalysisId).toBe(analyzeRes.analysisId);
      expect(retryRes.analysisId).toBeTruthy();
      expect(retryRes.runId).toBeTruthy();
    });
  });
});
