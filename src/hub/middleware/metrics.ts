import type { Context, Next } from "hono";
import { httpRequestsTotal, httpRequestDurationSeconds } from "../services/instrumentation.js";

export async function metricsMiddleware(c: Context, next: Next): Promise<void> {
  const start = process.hrtime.bigint();
  await next();
  const elapsed = Number(process.hrtime.bigint() - start) / 1e9;

  // Use the matched route pattern when available so cardinality stays bounded.
  const route = c.req.routePath || c.req.path;
  const method = c.req.method;
  const status = String(c.res.status);

  httpRequestsTotal.inc({ method, route, status });
  httpRequestDurationSeconds.observe({ method, route }, elapsed);
}
