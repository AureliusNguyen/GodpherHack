import { describe, it, expect } from "vitest";
import { AuthService } from "../../src/hub/services/auth.js";

const cfg = {
  jwtSecret: "test-secret-must-be-long-enough-for-hs256",
  githubClientId: "client",
  githubClientSecret: "secret",
  hubBaseUrl: "http://localhost:3000",
};

describe("AuthService", () => {
  it("issues and verifies a JWT round-trip", async () => {
    const auth = new AuthService(cfg);
    const token = await auth.issue({
      sub: "12345",
      login: "octocat",
      name: "The Octocat",
      email: "octocat@example.com",
    });

    const claims = await auth.verify(token);
    expect(claims.sub).toBe("12345");
    expect(claims.login).toBe("octocat");
    expect(claims.email).toBe("octocat@example.com");
  });

  it("rejects a token signed with the wrong secret", async () => {
    const issuer = new AuthService(cfg);
    const token = await issuer.issue({ sub: "1", login: "a" });

    const verifier = new AuthService({ ...cfg, jwtSecret: "different-secret-still-long-enough" });
    await expect(verifier.verify(token)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const auth = new AuthService({ ...cfg, ttlSeconds: 1 });
    const token = await auth.issue({ sub: "1", login: "a" });

    await new Promise((r) => setTimeout(r, 1100));
    await expect(auth.verify(token)).rejects.toThrow();
  });

  it("exposes githubClientId and hubBaseUrl from config", () => {
    const auth = new AuthService(cfg);
    expect(auth.githubClientId).toBe("client");
    expect(auth.hubBaseUrl).toBe("http://localhost:3000");
  });
});
