import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createBuiltinTools } from "../../src/agent/tools.js";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;
let tools: ReturnType<typeof createBuiltinTools>;

function getTool(name: string) {
  const tool = tools.find((t) => t.definition.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "ghack-test-"));
  tools = createBuiltinTools(tmpDir);
});

afterEach(async () => {
  // Brief delay to let child processes release directory handles (WSL2/Windows)
  await new Promise((r) => setTimeout(r, 100));
  try {
    await rm(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors on Windows/WSL
  }
});

describe("bash tool", () => {
  it("runs echo and returns stdout", async () => {
    const bash = getTool("bash");
    const result = await bash.execute({ command: "echo hello" });
    expect(result.trim()).toBe("hello");
  });

  it("captures stderr", async () => {
    const bash = getTool("bash");
    const result = await bash.execute({ command: "echo oops >&2" });
    expect(result).toContain("[stderr]");
    expect(result).toContain("oops");
  });

  it("returns error on missing command", async () => {
    const bash = getTool("bash");
    const result = await bash.execute({});
    expect(result).toContain("Error");
  });

  it("times out on long command", async () => {
    const bash = getTool("bash");
    const result = await bash.execute({ command: "echo fast" });
    expect(result.trim()).toBe("fast");
  });

  it("returns non-zero exit with stdout+stderr", async () => {
    const bash = getTool("bash");
    const result = await bash.execute({ command: "echo out && echo err >&2 && exit 1" });
    expect(result).toContain("out");
    expect(result).toContain("[stderr]");
    expect(result).toContain("err");
  });

  it("returns (no output) for silent command", async () => {
    const bash = getTool("bash");
    const result = await bash.execute({ command: "true" });
    expect(result).toBe("(no output)");
  });

  it("stderr prefix stable when stderr is empty", async () => {
    const bash = getTool("bash");
    const result = await bash.execute({ command: "echo only-stdout" });
    expect(result).not.toContain("[stderr]");
    expect(result.trim()).toBe("only-stdout");
  });
});

describe("read_file tool", () => {
  it("reads file with line numbers", async () => {
    await writeFile(join(tmpDir, "test.txt"), "line1\nline2\nline3\n");
    const readFile = getTool("read_file");
    const result = await readFile.execute({ path: "test.txt" });
    expect(result).toContain("1");
    expect(result).toContain("line1");
    expect(result).toContain("line2");
    expect(result).toContain("line3");
  });

  it("respects offset and limit", async () => {
    await writeFile(join(tmpDir, "test.txt"), "a\nb\nc\nd\ne\n");
    const readFile = getTool("read_file");
    const result = await readFile.execute({ path: "test.txt", offset: 2, limit: 2 });
    expect(result).toContain("b");
    expect(result).toContain("c");
    expect(result).not.toContain("  a");
    expect(result).not.toContain("  d");
  });

  it("returns error for missing file", async () => {
    const readFile = getTool("read_file");
    const result = await readFile.execute({ path: "nonexistent.txt" });
    expect(result).toContain("Error");
  });

  it("rejects path traversal with ..", async () => {
    const readFile = getTool("read_file");
    const result = await readFile.execute({ path: "../outside.txt" });
    expect(result).toContain("Error");
    expect(result).toContain("escapes workspace");
  });

  it("rejects absolute path outside workspace", async () => {
    const readFile = getTool("read_file");
    const result = await readFile.execute({ path: "/etc/passwd" });
    expect(result).toContain("Error");
    expect(result).toContain("escapes workspace");
  });
});

describe("write_file tool", () => {
  it("writes file and returns byte count", async () => {
    const wf = getTool("write_file");
    const result = await wf.execute({ path: "out.txt", content: "hello world" });
    expect(result).toContain("11 bytes");

    const readFile = getTool("read_file");
    const content = await readFile.execute({ path: "out.txt" });
    expect(content).toContain("hello world");
  });

  it("creates parent directories", async () => {
    const wf = getTool("write_file");
    const result = await wf.execute({ path: "sub/dir/out.txt", content: "nested" });
    expect(result).toContain("bytes");

    const readFile = getTool("read_file");
    const content = await readFile.execute({ path: "sub/dir/out.txt" });
    expect(content).toContain("nested");
  });

  it("rejects path traversal with ..", async () => {
    const wf = getTool("write_file");
    const result = await wf.execute({ path: "../../evil.txt", content: "bad" });
    expect(result).toContain("Error");
    expect(result).toContain("escapes workspace");
  });

  it("rejects absolute path outside workspace", async () => {
    const wf = getTool("write_file");
    const result = await wf.execute({ path: "/tmp/evil.txt", content: "bad" });
    expect(result).toContain("Error");
    expect(result).toContain("escapes workspace");
  });
});

describe("list_files tool", () => {
  it("lists directory contents", async () => {
    await writeFile(join(tmpDir, "a.txt"), "aaa");
    await writeFile(join(tmpDir, "b.txt"), "bbb");
    await mkdir(join(tmpDir, "subdir"));

    const lf = getTool("list_files");
    const result = await lf.execute({});
    expect(result).toContain("a.txt");
    expect(result).toContain("b.txt");
    expect(result).toContain("subdir/");
  });

  it("returns error for nonexistent directory", async () => {
    const lf = getTool("list_files");
    const result = await lf.execute({ path: "nope" });
    expect(result).toContain("Error");
  });

  it("rejects path traversal with ..", async () => {
    const lf = getTool("list_files");
    const result = await lf.execute({ path: ".." });
    expect(result).toContain("Error");
    expect(result).toContain("escapes workspace");
  });

  it("rejects absolute path outside workspace", async () => {
    const lf = getTool("list_files");
    const result = await lf.execute({ path: "/etc" });
    expect(result).toContain("Error");
    expect(result).toContain("escapes workspace");
  });
});
