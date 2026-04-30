import type { Context, Next } from "hono";
import type { AuthService, UserClaims } from "../services/auth.js";

const PUBLIC_PREFIXES = ["/health", "/auth/", "/metrics", "/ws/"];

function isPublic(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => path === p.replace(/\/$/, "") || path.startsWith(p));
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
