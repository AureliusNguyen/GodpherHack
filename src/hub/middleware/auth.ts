import type { Context, Next } from "hono";
import type { AuthService, UserClaims } from "../services/auth.js";

// Exact-match allowlist. A prefix list silently exposes any future
// /auth/<something> route, so list every public endpoint explicitly.
const PUBLIC_PATHS = new Set([
  "/health",
  "/metrics",
  "/auth/github",
  "/auth/github/callback",
]);

function isPublic(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  // /ws/* is upgraded out of band before this middleware runs; no Hono
  // route ever matches it. Listed for safety.
  return path.startsWith("/ws/");
}

declare module "hono" {
  interface ContextVariableMap {
    user: UserClaims;
  }
}

export function requireJwt(auth: AuthService) {
  return async (c: Context, next: Next) => {
    if (isPublic(c.req.path)) return next();

    const header = c.req.header("Authorization");
    if (!header || !header.startsWith("Bearer ")) {
      return c.json({ error: "Missing bearer token" }, 401);
    }

    try {
      const claims = await auth.verify(header.slice("Bearer ".length).trim());
      c.set("user", claims);
    } catch (err) {
      return c.json(
        { error: `Invalid token: ${err instanceof Error ? err.message : String(err)}` },
        401,
      );
    }

    return next();
  };
}
