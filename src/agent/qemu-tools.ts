import { spawn } from "node:child_process";
import type { RegisteredTool } from "./types.js";
import { safePath } from "./tools.js";

const DEFAULT_TIMEOUT_SEC = 10;
const MAX_OUTPUT_BYTES = 1024 * 256; // 256 KB cap before truncation

const SUPPORTED_ARCHES = ["x86_64", "i386", "arm", "aarch64", "mips", "mipsel", "riscv64"] as const;
type Arch = (typeof SUPPORTED_ARCHES)[number];

interface QemuRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

function runQemu(
  binaryPath: string,
  arch: Arch,
  stdinInput: string,
  timeoutMs: number,
): Promise<QemuRunResult> {
  return new Promise((resolve, reject) => {
    const cmd = `qemu-${arch}`;
    const child = spawn(cmd, [binaryPath], { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      action();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString("utf-8");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      // ENOENT = qemu-<arch> not installed
      const e = err as NodeJS.ErrnoException;
      settle(() => {
        if (e.code === "ENOENT") {
          reject(new Error(`${cmd} is not installed. Install qemu-user (or qemu-user-static) to run ${arch} binaries.`));
        } else {
          reject(err);
        }
      });
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      settle(() => resolve({ stdout, stderr, exitCode, signal, timedOut }));
    });

    // stdin can be null when spawn fails synchronously (ENOENT etc.).
    // Wrap in try so we don't double-reject via 'error' + a thrown TypeError.
    try {
      if (stdinInput && child.stdin) child.stdin.write(stdinInput);
      child.stdin?.end();
    } catch {
      // 'error' will fire and reject with the real cause.
    }
  });
}

function qemuRunTool(challengeDir: string): RegisteredTool {
  return {
    definition: {
      name: "qemu_run",
      description:
        "Run a binary under qemu user-mode emulation. Use this for cross-arch CTF binaries " +
        "(arm, mips, riscv64, etc.) that won't execute natively on x86_64. For x86_64 Linux binaries, " +
        "the bash tool is simpler. No networking, no full kernel -- user-mode emulation only.",
      inputSchema: {
        type: "object",
        properties: {
          binaryPath: {
            type: "string",
            description: "Path to the ELF binary to run, relative to the challenge dir.",
          },
          arch: {
            type: "string",
            enum: [...SUPPORTED_ARCHES],
            description: "Target architecture. Defaults to x86_64. Pick the one matching `file <binary>`.",
          },
          stdin: {
            type: "string",
            description: "Optional input piped to the binary's stdin.",
          },
          timeoutSec: {
            type: "number",
            description: `Kill the binary after this many seconds. Default ${DEFAULT_TIMEOUT_SEC}.`,
          },
        },
        required: ["binaryPath"],
      },
    },
    async execute(args) {
      const binaryPathArg = args.binaryPath as string;
      const arch = ((args.arch as Arch) ?? "x86_64") as Arch;
      const stdinInput = (args.stdin as string) ?? "";
      const timeoutSec = (args.timeoutSec as number) ?? DEFAULT_TIMEOUT_SEC;

      if (!SUPPORTED_ARCHES.includes(arch)) {
        return `Error: unsupported arch "${arch}". Supported: ${SUPPORTED_ARCHES.join(", ")}.`;
      }

      // Reject leading dash so the binaryPath cannot be interpreted as a
      // qemu flag (e.g. -L, -strace).
      if (binaryPathArg.startsWith("-")) {
        return "Error: binaryPath cannot start with '-'";
      }

      let binaryPath: string;
      try {
        binaryPath = safePath(challengeDir, binaryPathArg);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }

      try {
        const result = await runQemu(binaryPath, arch, stdinInput, timeoutSec * 1000);
        const lines: string[] = [];
        if (result.stdout) lines.push(result.stdout);
        if (result.stderr) lines.push((lines.length ? "\n" : "") + "[stderr]\n" + result.stderr);
        if (result.timedOut) lines.push(`\n[timed out after ${timeoutSec}s]`);
        else if (result.signal) lines.push(`\n[killed by ${result.signal}]`);
        else if (result.exitCode !== 0) lines.push(`\n[exit ${result.exitCode}]`);
        return lines.join("") || "(no output)";
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/** Create qemu tools scoped to a challenge directory. */
export function createQemuTools(challengeDir: string): RegisteredTool[] {
  return [qemuRunTool(challengeDir)];
}
