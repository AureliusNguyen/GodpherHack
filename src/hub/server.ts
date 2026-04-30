import { Hono } from "hono";
import type { WriteupRepository } from "./repository/types.js";
import type { ChallengeAnalyzer } from "./services/analyzer.js";
import type { AuthService } from "./services/auth.js";
import { SearchService } from "./services/search.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requireJwt } from "./middleware/auth.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { challengeRoutes } from "./routes/challenges.js";
import { solveRoutes } from "./routes/solves.js";

export interface HubDeps {
  repository: WriteupRepository;
  analyzer: ChallengeAnalyzer;
  auth?: AuthService;
}

export function createHub(deps: HubDeps): Hono {
  const app = new Hono();
  const searchService = new SearchService(deps.repository);

  app.use("*", errorHandler);

  if (deps.auth) {
    app.use("*", requireJwt(deps.auth));
    app.route("/", authRoutes(deps.auth));
  }

  app.route("/", healthRoutes(deps.repository));
  app.route("/", challengeRoutes(deps.analyzer, searchService, deps.repository));
  app.route("/", solveRoutes(deps.repository));

  return app;
}
