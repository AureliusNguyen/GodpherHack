import { execFile } from "node:child_process";
import { readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
import { join, resolve, dirname, sep } from "node:path";
import type { RegisteredTool } from "./types.js";

const BASH_TIMEOUT_MS = 30_000;
const READ_FILE_DEFAULT_LIMIT = 2000;

/** Resolve a path and ensure it stays within the workspace root */
function safePath(cwd: string, inputPath: string): string {
  const resolved = resolve(cwd, inputPath);
  const normalizedCwd = resolve(cwd);
  if (!resolved.startsWith(normalizedCwd + sep) && resolved !== normalizedCwd) {
    throw new Error(`Path escapes workspace: ${inputPath}`);
  }
  return resolved;
}

function runBash(cmd: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((res, reject) => {
    execFile("bash", ["-c", cmd], { cwd, timeout: BASH_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && (err as Error & { killed?: boolean }).killed) {
        reject(new Error(`Command timed out after ${BASH_TIMEOUT_MS / 1000}s`));
        return;
      }
      // Return stdout+stderr even on non-zero exit (err.code is exit code)
      if (err && !stdout && !stderr) {
        reject(err);
        return;
      }
      res({ stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

function bashTool(cwd: string): RegisteredTool {
  return {
    definition: {
      name: "bash",
      description: "Execute a bash command. Use this to run shell commands, compile code, execute scripts, etc.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "The bash command to execute" },
        },
        required: ["command"],
      },
    },
    async execute(args) {
      const command = args.command as string;
      if (!command) return "Error: no command provided";
      try {
        const { stdout, stderr } = await runBash(command, cwd);
        let result = "";
        if (stdout) result += stdout;
        if (stderr) result += (result ? "\n" : "") + "[stderr]\n" + stderr;
        return result || "(no output)";
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

function readFileTool(cwd: string): RegisteredTool {
  return {
    definition: {
      name: "read_file",
      description: "Read a file's contents with line numbers. Paths are relative to the working directory.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path (relative or absolute)" },
          offset: { type: "number", description: "Starting line number (1-based, default 1)" },
          limit: { type: "number", description: `Max lines to read (default ${READ_FILE_DEFAULT_LIMIT})` },
        },
        required: ["path"],
      },
    },
    async execute(args) {
      const offset = Math.max(1, (args.offset as number) ?? 1);
      const limit = (args.limit as number) ?? READ_FILE_DEFAULT_LIMIT;
      try {
        const filePath = safePath(cwd, args.path as string);
        const raw = await readFile(filePath, "utf-8");
        const lines = raw.split("\n");
        const selected = lines.slice(offset - 1, offset - 1 + limit);
        const numbered = selected.map((line, i) => `${String(offset + i).padStart(6)}  ${line}`);
        const result = numbered.join("\n");
        if (lines.length > offset - 1 + limit) {
          return result + `\n[+${lines.length - (offset - 1 + limit)} more lines]`;
        }
        return result;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

function writeFileTool(cwd: string): RegisteredTool {
  return {
    definition: {
      name: "write_file",
      description: "Write content to a file. Creates parent directories if needed. Paths are relative to the working directory.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path (relative or absolute)" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["path", "content"],
      },
    },
    async execute(args) {
      const content = args.content as string;
      try {
        const filePath = safePath(cwd, args.path as string);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content, "utf-8");
        const bytes = Buffer.byteLength(content, "utf-8");
        return `Wrote ${bytes} bytes to ${filePath}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

function listFilesTool(cwd: string): RegisteredTool {
  return {
    definition: {
      name: "list_files",
      description: "List files in a directory. Paths are relative to the working directory.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path (default: working directory)" },
          recursive: { type: "boolean", description: "List recursively (default: false)" },
        },
      },
    },
    async execute(args) {
      const recursive = (args.recursive as boolean) ?? false;
      try {
        const dirPath = safePath(cwd, (args.path as string) ?? ".");
        const entries = await readdir(dirPath, { withFileTypes: true, recursive });
        const lines: string[] = [];
        for (const entry of entries) {
          const entryPath = join(entry.parentPath ?? dirPath, entry.name);
          const relativePath = entryPath.startsWith(dirPath)
            ? entryPath.slice(dirPath.length + 1) || entry.name
            : entry.name;
          if (entry.isDirectory()) {
            lines.push(`${relativePath}/`);
          } else {
            try {
              const info = await stat(entryPath);
              const size = info.size < 1024
                ? `${info.size}B`
                : info.size < 1024 * 1024
                  ? `${(info.size / 1024).toFixed(1)}K`
                  : `${(info.size / (1024 * 1024)).toFixed(1)}M`;
              lines.push(`${relativePath}  (${size})`);
            } catch {
              lines.push(relativePath);
            }
          }
        }
        return lines.join("\n") || "(empty directory)";
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/** Create all built-in tools scoped to a working directory */
export function createBuiltinTools(workingDirectory: string): RegisteredTool[] {
  return [
    bashTool(workingDirectory),
    readFileTool(workingDirectory),
    writeFileTool(workingDirectory),
    listFilesTool(workingDirectory),
  ];
}
