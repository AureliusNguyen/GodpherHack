import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQemuTools } from "../../src/agent/qemu-tools.js";

describe("createQemuTools", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "godpher-qemu-"));
  });

  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* WSL race */ }
  });

  it("registers a single qemu_run tool with a JSON schema", () => {
    const tools = createQemuTools(tmp);
    expect(tools).toHaveLength(1);
    expect(tools[0].definition.name).toBe("qemu_run");
    expect(tools[0].definition.inputSchema).toMatchObject({
      type: "object",
      required: ["binaryPath"],
    });
  });

  it("rejects an unsupported arch without spawning qemu", async () => {
    const [tool] = createQemuTools(tmp);
    const out = await tool.execute({ binaryPath: "fake", arch: "alpha" });
    expect(out).toMatch(/unsupported arch/);
  });

  it("blocks paths that escape the workspace", async () => {
    const [tool] = createQemuTools(tmp);
    const out = await tool.execute({ binaryPath: "../../../etc/passwd" });
    expect(out).toMatch(/escapes workspace/);
  });

  it("returns a clear error when qemu-<arch> is not installed", async () => {
    const [tool] = createQemuTools(tmp);
    const stub = join(tmp, "stub");
    writeFileSync(stub, "");
    chmodSync(stub, 0o755);
    // arch=riscv64 is unlikely to have qemu-riscv64 installed in CI; the
    // tool should report a clean "not installed" message rather than crash.
    const out = await tool.execute({ binaryPath: "stub", arch: "riscv64" });
    expect(out.toLowerCase()).toMatch(/not installed|error/);
  });
});
