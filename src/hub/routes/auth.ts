import { Hono } from "hono";
import type { AuthService } from "../services/auth.js";

const STATE_TTL_MS = 5 * 60 * 1000;
const STATE_GC_INTERVAL_MS = 60_000;
const STATE_MAX_ENTRIES = 1000;

interface PendingState {
  redirectUri: string;
  expiresAt: number;
}

/**
 * Restrict OAuth redirect targets to loopback only. The CLI uses an
 * ephemeral 127.0.0.1 listener, so anything else is an attacker
 * trying to exfiltrate the JWT we are about to mint.
 */
function isAllowedRedirect(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:") return false;
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

export function authRoutes(auth: AuthService) {
  const app = new Hono();

  // In-memory state store for OAuth CSRF protection.
  // For multi-instance Hub, swap this for Redis (interface stays the same).
  const states = new Map<string, PendingState>();

  function gcStates() {
    const now = Date.now();
    for (const [k, v] of states) if (v.expiresAt < now) states.delete(k);
  }

  // Run GC on a timer instead of only on /auth/github so an idle Hub
  // does not accumulate expired entries forever.
  const gcTimer = setInterval(gcStates, STATE_GC_INTERVAL_MS);
  gcTimer.unref?.();

  app.get("/auth/github", (c) => {
    if (states.size >= STATE_MAX_ENTRIES) {
      gcStates();
      if (states.size >= STATE_MAX_ENTRIES) {
        return c.json({ error: "Too many in-flight logins" }, 429);
      }
    }

    const redirect = c.req.query("redirect") ?? "";
    if (!redirect) return c.json({ error: "Missing redirect query param" }, 400);
    if (!isAllowedRedirect(redirect)) {
      return c.json({ error: "redirect must be a loopback http URL" }, 400);
    }

    const state = crypto.randomUUID();
    states.set(state, { redirectUri: redirect, expiresAt: Date.now() + STATE_TTL_MS });

    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", auth.githubClientId);
    url.searchParams.set("redirect_uri", `${auth.hubBaseUrl}/auth/github/callback`);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", "read:user user:email");

    return c.redirect(url.toString());
  });

  app.get("/auth/github/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) return c.json({ error: "Missing code or state" }, 400);

    const pending = states.get(state);
    if (!pending) return c.json({ error: "Unknown or expired state" }, 400);
    states.delete(state);

    const ghUser = await auth.exchangeGithubCode(code);
    const token = await auth.issue({
      sub: String(ghUser.id),
      login: ghUser.login,
      name: ghUser.name ?? undefined,
      email: ghUser.email ?? undefined,
      avatarUrl: ghUser.avatar_url,
    });

    const dest = new URL(pending.redirectUri);
    dest.searchParams.set("token", token);
    return c.redirect(dest.toString());
  });

  app.get("/auth/me", (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthenticated" }, 401);
    return c.json({ user });
  });

  return app;
}
