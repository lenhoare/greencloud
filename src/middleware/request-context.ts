import { createMiddleware } from "hono/factory";
import { getConfig } from "../config";
import { createLogger } from "../lib/logger";
import type { AppEnv } from "../types";

/**
 * First middleware in the chain. Sets up per-request context (request id,
 * logger, parsed config) and writes one structured access-log line per
 * request. The request id is echoed in `x-request-id` and in error bodies, so
 * a user-reported error can be matched to its log line.
 */
export const requestContext = createMiddleware<AppEnv>(async (c, next) => {
  const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
  const logger = createLogger({ requestId });
  c.set("requestId", requestId);
  c.set("logger", logger);
  c.set("config", getConfig(c.env));
  c.set("user", null);
  c.set("session", null);

  const start = Date.now();
  await next();

  c.header("x-request-id", requestId);
  const status = c.res.status;
  logger[status >= 500 ? "error" : status >= 400 ? "warn" : "info"]("request", {
    method: c.req.method,
    path: c.req.path,
    status,
    durationMs: Date.now() - start,
    userId: c.var.user?.id,
    country: c.req.raw.cf?.country,
  });
});

export const isApiRequest = (path: string) => path === "/api" || path.startsWith("/api/");
