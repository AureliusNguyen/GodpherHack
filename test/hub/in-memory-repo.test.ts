import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryWriteupRepository } from "../../src/hub/repository/in-memory.js";
import type { WriteupEntry } from "../../src/hub/schemas/writeup.js";

function makeEntry(overrides: Partial<WriteupEntry> = {}): WriteupEntry {
  return {
    id: "test-id-1",
    title: "Test Writeup",
    category: "pwn",
    keywords: ["buffer", "overflow", "rop"],
    tools: ["gdb", "pwntools"],
    executionSteps: ["step1", "step2"],
    keyInsights: ["insight1"],
    summary: "A test writeup",
    fullWriteup: "Full writeup content here",
    challengeName: "test-challenge",
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("InMemoryWriteupRepository", () => {
  let repo: InMemoryWriteupRepository;

  beforeEach(() => {
    repo = new InMemoryWriteupRepository();
  });

  it("starts with indexGeneration 0", () => {
    expect(repo.getIndexGeneration()).toBe(0);
  });

  it("stores and retrieves by id", async () => {
    const entry = makeEntry();
    await repo.store(entry);
    const result = await repo.getById("test-id-1");
    expect(result).toEqual(entry);
  });

  it("increments indexGeneration on store", async () => {
    await repo.store(makeEntry());
    expect(repo.getIndexGeneration()).toBe(1);
  });

  it("is idempotent — storing same ID twice does not duplicate or bump generation", async () => {
    const entry = makeEntry();
    await repo.store(entry);
    await repo.store(entry);
    expect(repo.getIndexGeneration()).toBe(1);
    const result = await repo.getById("test-id-1");
    expect(result).toEqual(entry);
  });

  it("deletes entry and bumps indexGeneration", async () => {
    await repo.store(makeEntry());
    expect(repo.getIndexGeneration()).toBe(1);

    const deleted = await repo.delete("test-id-1");
    expect(deleted).toBe(true);
    expect(repo.getIndexGeneration()).toBe(2);
    expect(await repo.getById("test-id-1")).toBeNull();
  });

  it("returns false when deleting non-existent entry", async () => {
    const deleted = await repo.delete("nonexistent");
    expect(deleted).toBe(false);
    expect(repo.getIndexGeneration()).toBe(0);
  });

  it("returns null for non-existent getById", async () => {
    expect(await repo.getById("nonexistent")).toBeNull();
  });

  describe("search", () => {
    it("finds entries by keyword overlap", async () => {
      await repo.store(makeEntry({ id: "a", keywords: ["buffer", "overflow", "rop"] }));
      await repo.store(makeEntry({ id: "b", keywords: ["web", "xss", "cookie"] }));

      const results = await repo.search({
        keywords: ["buffer", "overflow"],
        category: null,
        topK: 10,
      });

      expect(results).toHaveLength(1);
      expect(results[0].entry.id).toBe("a");
      expect(results[0].similarity).toBe(1); // 2/2 keywords match
    });

    it("filters by category", async () => {
      await repo.store(makeEntry({ id: "a", category: "pwn", keywords: ["test"] }));
      await repo.store(makeEntry({ id: "b", category: "web", keywords: ["test"] }));

      const results = await repo.search({
        keywords: ["test"],
        category: "pwn",
        topK: 10,
      });

      expect(results).toHaveLength(1);
      expect(results[0].entry.id).toBe("a");
    });

    it("respects topK limit", async () => {
      await repo.store(makeEntry({ id: "a", keywords: ["test"] }));
      await repo.store(makeEntry({ id: "b", keywords: ["test"] }));
      await repo.store(makeEntry({ id: "c", keywords: ["test"] }));

      const results = await repo.search({
        keywords: ["test"],
        category: null,
        topK: 2,
      });

      expect(results).toHaveLength(2);
    });

    it("excludes specified IDs", async () => {
      await repo.store(makeEntry({ id: "a", keywords: ["test"] }));
      await repo.store(makeEntry({ id: "b", keywords: ["test"] }));

      const results = await repo.search({
        keywords: ["test"],
        category: null,
        topK: 10,
        excludeIds: ["a"],
      });

      expect(results).toHaveLength(1);
      expect(results[0].entry.id).toBe("b");
    });

    it("sorts by similarity descending", async () => {
      await repo.store(makeEntry({ id: "a", keywords: ["one"] }));
      await repo.store(makeEntry({ id: "b", keywords: ["one", "two", "three"] }));

      const results = await repo.search({
        keywords: ["one", "two", "three"],
        category: null,
        topK: 10,
      });

      expect(results).toHaveLength(2);
      expect(results[0].entry.id).toBe("b"); // 3/3 match
      expect(results[1].entry.id).toBe("a"); // 1/3 match
      expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
    });
  });
});
