import { Hono } from "hono";
import type { AuthService } from "../services/auth.js";

const STATE_TTL_MS = 5 * 60 * 1000;

interface PendingState {
  redirectUri: string;
  expiresAt: number;
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

  app.get("/auth/github", (c) => {
    gcStates();
    const redirect = c.req.query("redirect") ?? "";
    if (!redirect) return c.json({ error: "Missing redirect query param" }, 400);

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
