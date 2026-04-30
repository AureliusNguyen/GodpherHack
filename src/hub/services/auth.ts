import { webcrypto } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";

// jose's webapi build requires globalThis.crypto. Node 19+ has it; polyfill for Node 18.
// configurable: true so other modules can install their own polyfill without throwing.
if (typeof globalThis.crypto === "undefined") {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

const UserClaimsSchema = z.object({
  sub: z.string().min(1),
  login: z.string().min(1),
  name: z.string().optional(),
  email: z.string().optional(),
  avatarUrl: z.string().optional(),
});

export interface AuthConfig {
  jwtSecret: string;
  githubClientId: string;
  githubClientSecret: string;
  hubBaseUrl: string;
  ttlSeconds?: number;
}

export interface UserClaims {
  sub: string;          // GitHub user id
  login: string;        // GitHub username
  name?: string;
  email?: string;
  avatarUrl?: string;
}

export interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

const DEFAULT_TTL = 60 * 60 * 24 * 7; // 7 days

export class AuthService {
  private secret: Uint8Array;
  private cfg: AuthConfig;

  constructor(cfg: AuthConfig) {
    this.cfg = cfg;
    this.secret = new TextEncoder().encode(cfg.jwtSecret);
  }

  get githubClientId(): string {
    return this.cfg.githubClientId;
  }

  get hubBaseUrl(): string {
    return this.cfg.hubBaseUrl;
  }

  async issue(claims: UserClaims): Promise<string> {
    const ttl = this.cfg.ttlSeconds ?? DEFAULT_TTL;
    return new SignJWT({
      login: claims.login,
      name: claims.name,
      email: claims.email,
      avatarUrl: claims.avatarUrl,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`)
      .sign(this.secret);
  }

  async verify(token: string): Promise<UserClaims> {
    const { payload } = await jwtVerify(token, this.secret);
    return UserClaimsSchema.parse({
      sub: payload.sub,
      login: payload.login,
      name: payload.name,
      email: payload.email,
      avatarUrl: payload.avatarUrl,
    });
  }

  async exchangeGithubCode(code: string): Promise<GithubUser> {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: this.cfg.githubClientId,
        client_secret: this.cfg.githubClientSecret,
        code,
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`GitHub token exchange failed: ${tokenRes.status}`);
    }

    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) throw new Error("No access_token from GitHub");

    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${access_token}`, "User-Agent": "godpherhack" },
    });
    if (!userRes.ok) throw new Error(`GitHub user fetch failed: ${userRes.status}`);
    return (await userRes.json()) as GithubUser;
  }
}

/** Build AuthService from env, or return null if not configured. */
export function authConfigFromEnv(): AuthConfig | null {
  const jwtSecret = process.env.JWT_SECRET;
  const githubClientId = process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
  const hubBaseUrl = process.env.HUB_BASE_URL ?? "http://localhost:3000";

  if (!jwtSecret || !githubClientId || !githubClientSecret) return null;
  return { jwtSecret, githubClientId, githubClientSecret, hubBaseUrl };
}
