import { describe, it, expect } from "vitest";
import { ChallengeAnalyzer } from "../../src/hub/services/analyzer.js";
import type { ChallengeInput } from "../../src/hub/schemas/challenge.js";

const analyzer = new ChallengeAnalyzer(null);

function challenge(overrides: Partial<ChallengeInput> = {}): ChallengeInput {
  return { name: "test", description: "test", files: [], hints: [], ...overrides };
}

describe("ChallengeAnalyzer (stub)", () => {
  it("categorizes a pwn challenge", async () => {
    const result = await analyzer.analyze(
      challenge({ name: "baby-bof", description: "Simple buffer overflow exploit challenge" }),
    );

    expect(result.category).toBe("pwn");
    expect(result.categoryConfidence).toBeGreaterThan(0);
    expect(result.keywords.length).toBeGreaterThan(0);
    expect(result.suggestedTools).toContain("gdb");
    expect(result.analysisId).toBeTruthy();
  });

  it("categorizes a web challenge", async () => {
    const result = await analyzer.analyze(
      challenge({ name: "sqli-login", description: "A web application with a vulnerable SQL login form" }),
    );

    expect(result.category).toBe("web");
    expect(result.suggestedTools).toContain("sqlmap");
  });

  it("categorizes a crypto challenge", async () => {
    const result = await analyzer.analyze(
      challenge({ name: "rsa-baby", description: "RSA encryption with a small exponent" }),
    );

    expect(result.category).toBe("crypto");
  });

  it("falls back to misc for unrecognized descriptions", async () => {
    const result = await analyzer.analyze(
      challenge({ name: "mystery", description: "Figure it out" }),
    );

    expect(result.category).toBe("misc");
    expect(result.categoryConfidence).toBe(0.3);
  });

  it("returns deterministic analysisId for same input", async () => {
    const input = challenge({ name: "test", description: "a pwn challenge" });
    const a = await analyzer.analyze(input);
    const b = await analyzer.analyze(input);
    expect(a.analysisId).toBe(b.analysisId);
  });

  it("refine merges previous keywords and includes feedback note", async () => {
    const result = await analyzer.refine(
      challenge({ name: "test", description: "a buffer overflow" }),
      ["extra-keyword", "another"],
      "try looking at the heap",
    );

    expect(result.keywords).toContain("extra-keyword");
    expect(result.keywords).toContain("another");
    expect(result.analysisNote).toContain("try looking at the heap");
  });
});
