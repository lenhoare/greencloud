import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { adminApi } from "./features/admin/api";
import { createAuthRoutes, type GoogleClientFactory } from "./features/auth/routes";
import { health } from "./features/health/routes";
import { projectsApi } from "./features/projects/api";
import { meApi } from "./features/users/api";
import { AppError, type ErrorBody } from "./lib/errors";
import { attachUser, requireAdmin, requireUser } from "./middleware/auth";
import { rateLimit } from "./middleware/rate-limit";
import { isApiRequest, requestContext } from "./middleware/request-context";
import { noStore, securityHeaders } from "./middleware/security";
import type { AppEnv, AuthedEnv } from "./types";
import { ErrorPage } from "./web/pages/public";
import { renderPage } from "./web/render";
import { appPages, publicPages } from "./web/routes";

export interface AppDeps {
  /** Swap the Google client (tests inject one that talks to a fake Google). */
  googleClient?: GoogleClientFactory;
}

/**
 * Builds the Hono application. Route map:
 *
 *   /health, /health/ready     health checks (public)
 *   /auth/login|callback|logout Google OAuth (public, rate limited)
 *   /api/v1/me                 current user & sessions        (signed in)
 *   /api/v1/projects/...       projects, members, items       (signed in)
 *   /api/v1/admin/...          users, audit log, stats        (admin)
 *   /api/openapi.json, /api/docs  OpenAPI spec + Swagger UI   (public)
 *   /, /login                  public pages
 *   /app/...                   server-rendered UI             (signed in)
 *   everything in public/      static assets, served by Cloudflare directly
 *
 * Middleware order matters: request context → security headers → CSRF →
 * session lookup → (per-area) auth guards & rate limits → handlers.
 */
export function createApp(deps: AppDeps = {}) {
  const app = new Hono<AppEnv>();

  app.use("*", requestContext);
  app.use("*", securityHeaders);
  app.use("*", noStore);
  // CSRF: reject state-changing form submissions whose Origin isn't us (or an
  // allowed CORS origin). Complements SameSite=Lax session cookies.
  app.use(
    "*",
    csrf({
      origin: (origin, c) => origin === new URL(c.req.url).origin || c.var.config.corsOrigins.includes(origin),
    }),
  );
  app.use("*", attachUser);

  app.route("/health", health);
  app.route("/auth", createAuthRoutes(deps.googleClient));
  app.route("/api", buildApi());
  app.route("/", publicPages);
  app.route("/app", appPages);

  app.notFound((c) => {
    if (isApiRequest(c.req.path)) {
      return c.json<ErrorBody>({ error: { code: "not_found", message: "Route not found", requestId: c.var.requestId } }, 404);
    }
    return renderPage(c, { title: "Not found", status: 404, body: <ErrorPage status={404} message="We couldn't find that page." /> });
  });

  app.onError((err, c) => {
    let status: ContentfulStatusCode = 500;
    let code = "internal_error";
    let message = "Something went wrong. Please try again.";
    let details: unknown;

    if (err instanceof AppError) {
      ({ status, code, message, details } = err);
    } else if (err instanceof HTTPException) {
      status = err.status as ContentfulStatusCode;
      code = status === 403 ? "forbidden" : "http_error";
      message = err.message || message;
    }

    const logger = c.var.logger;
    if (status >= 500) logger?.error("request failed", { err, code });
    else logger?.warn("request rejected", { code, message });

    // Never leak internal details from 5xx errors that weren't deliberate.
    const body: ErrorBody = {
      error: { code, message, ...(details !== undefined && status < 500 ? { details } : {}), requestId: c.var.requestId },
    };
    // Pages get an HTML error page (htmx-boosted requests send Accept: */*, so
    // don't key this on text/html); API routes or explicit JSON clients get JSON.
    const wantsJson = isApiRequest(c.req.path) || c.req.header("accept")?.startsWith("application/json");
    if (wantsJson || !c.var.config) {
      return c.json(body, status);
    }
    return renderPage(c, {
      title: "Error",
      status: status as 400,
      body: <ErrorPage status={status} message={message} requestId={c.var.requestId} />,
    });
  });

  return app;
}

function buildApi() {
  const api = new OpenAPIHono<AppEnv>();

  api.use("*", (c, next) =>
    cors({
      origin: (origin) => (c.var.config.corsOrigins.includes(origin) ? origin : null),
      credentials: true,
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["content-type"],
      exposeHeaders: ["x-request-id", "retry-after"],
      maxAge: 600,
    })(c, next),
  );

  // Everything under /v1 requires a signed-in user and is rate limited per user.
  const v1 = new OpenAPIHono<AuthedEnv>();
  v1.use("*", requireUser);
  v1.use("*", rateLimit("RATE_LIMIT_API"));
  v1.use("/admin/*", requireAdmin);
  v1.route("/me", meApi);
  v1.route("/projects", projectsApi);
  v1.route("/admin", adminApi);
  api.route("/v1", v1);

  api.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: "__Host-gc_session",
    description: "Session cookie set by signing in at /auth/login (named gc_session on plain-HTTP localhost).",
  });
  api.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Greencloud API",
      version: "1.0.0",
      description: "Sign in via /auth/login in the same browser, then try requests from this page.",
    },
    servers: [{ url: "/api" }],
  });
  // Pinned so the docs page doesn't change under you. Its CSP: middleware/security.ts.
  api.get("/docs", swaggerUI({ url: "/api/openapi.json", title: "Greencloud API", version: "5.34.1" }));

  return api;
}
