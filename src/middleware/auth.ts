import { createMiddleware } from "hono/factory";
import { loadSession } from "../features/auth/sessions";
import { forbidden, unauthorized } from "../lib/errors";
import type { AppEnv, AuthedEnv } from "../types";
import { isApiRequest } from "./request-context";

/**
 * Resolves the session cookie (if any) and attaches `user` / `session` to the
 * context. Never rejects — use `requireUser` for that. Runs on all dynamic
 * routes so public pages can still show "signed in as…".
 */
export const attachUser = createMiddleware<AppEnv>(async (c, next) => {
  const result = await loadSession(c);
  if (result) {
    c.set("user", result.user);
    c.set("session", result.session);
    c.set("logger", c.var.logger.child({ userId: result.user.id }));
  }
  await next();
});

/**
 * Rejects anonymous requests. API callers get a 401 JSON error; browsers get
 * redirected to the login page with a returnTo so they land back here.
 */
export const requireUser = createMiddleware<AuthedEnv>(async (c, next) => {
  if (!c.var.user || !c.var.session) {
    if (isApiRequest(c.req.path)) throw unauthorized();
    const url = new URL(c.req.url);
    const returnTo = c.req.method === "GET" ? url.pathname + url.search : "/app";
    return c.redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`, 302);
  }
  await next();
});

/** Must come after requireUser. */
export const requireAdmin = createMiddleware<AuthedEnv>(async (c, next) => {
  if (c.var.user.role !== "admin") throw forbidden("Admin access required");
  await next();
});
