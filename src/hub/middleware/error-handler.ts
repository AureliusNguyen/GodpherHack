import type { Context, Next } from "hono";
import { ZodError } from "zod";

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json(
        { error: "Validation error", details: err.errors },
        400,
      );
    }

    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[hub] Unhandled error:", err);
    return c.json({ error: message }, 500);
  }
}
