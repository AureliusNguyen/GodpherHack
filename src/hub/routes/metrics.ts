import { Hono } from "hono";
import { registry } from "../services/instrumentation.js";

export function metricsRoutes() {
  const app = new Hono();

  app.get("/metrics", async (c) => {
    const body = await registry.metrics();
    return c.text(body, 200, { "Content-Type": registry.contentType });
  });

  return app;
}
