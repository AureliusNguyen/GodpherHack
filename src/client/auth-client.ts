import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const AUTH_FILE = join(homedir(), ".godpherhack", "auth.json");
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

interface StoredAuth {
  token: string;
  hubBaseUrl: string;
  savedAt: number;
}

export function readStoredToken(hubBaseUrl: string): string | null {
  if (!existsSync(AUTH_FILE)) return null;
  try {
    const raw = readFileSync(AUTH_FILE, "utf-8");
    const data = JSON.parse(raw) as StoredAuth;
    if (data.hubBaseUrl !== hubBaseUrl) return null;
    return data.token;
  } catch {
    return null;
  }
}

function writeStoredToken(token: string, hubBaseUrl: string): void {
  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  const data: StoredAuth = { token, hubBaseUrl, savedAt: Date.now() };
  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" :
    process.platform === "win32"  ? "cmd"  :
    "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

export interface LoginOptions {
  /** Optional callback fired with the auth URL once the listener is bound.
   *  When the caller is the Ink UI, console.log gets eaten -- use this to
   *  surface the URL as a system message instead. */
  onAuthUrl?: (url: string) => void;
  /** Skip auto-opening the browser. Useful when the host has no browser
   *  reachable (e.g. raw WSL without wslview installed). */
  skipBrowserOpen?: boolean;
}

/**
 * OAuth login: starts local listener, opens browser to Hub OAuth flow,
 * waits for token redirect, persists to ~/.godpherhack/auth.json.
 */
export async function loginWithGithub(hubBaseUrl: string, opts: LoginOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost`);
      const token = url.searchParams.get("token");
      if (token) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<!doctype html><meta charset="utf-8"><title>godpherhack login</title>
          <body style="font-family:sans-serif;padding:2rem;background:#0c0c0c;color:#eee">
          <h1 style="color:#ff5252">Logged in</h1>
          <p>You can close this tab and return to the terminal.</p></body>`);
        server.close();
        writeStoredToken(token, hubBaseUrl);
        resolve(token);
      } else {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing token");
      }
    });

    server.on("error", reject);

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr !== "object" || addr === null) {
        server.close();
        reject(new Error("Could not allocate local port"));
        return;
      }
      const callback = `http://127.0.0.1:${addr.port}/cb`;
      const authUrl = `${hubBaseUrl.replace(/\/$/, "")}/auth/github?redirect=${encodeURIComponent(callback)}`;

      if (opts.onAuthUrl) {
        opts.onAuthUrl(authUrl);
      } else {
        console.log(`Opening browser to: ${authUrl}`);
        console.log(`If the browser does not open, paste that URL manually.`);
      }
      if (!opts.skipBrowserOpen) openBrowser(authUrl);

      setTimeout(() => {
        server.close();
        reject(new Error("Login timed out"));
      }, LOGIN_TIMEOUT_MS).unref();
    });
  });
}

export function logout(): void {
  if (existsSync(AUTH_FILE)) {
    writeFileSync(AUTH_FILE, "", { mode: 0o600 });
  }
}
