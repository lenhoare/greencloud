import { Hono } from "hono";
import type { AppEnv } from "../../types";

/**
 * Health checks for uptime monitors / load balancers.
 *   GET /health        liveness: the Worker is running (no dependencies)
 *   GET /health/ready  readiness: the database answers
 */
export const health = new Hono<AppEnv>();

health.get("/", (c) => c.json({ status: "ok" }));

health.get("/ready", async (c) => {
  const start = Date.now();
  try {
    await c.env.DB.prepare("SELECT 1").first();
    return c.json({ status: "ok", checks: { db: { ok: true, latencyMs: Date.now() - start } } });
  } catch (err) {
    c.var.logger.error("readiness check failed", { err });
    return c.json({ status: "error", checks: { db: { ok: false } } }, 503);
  }
});
