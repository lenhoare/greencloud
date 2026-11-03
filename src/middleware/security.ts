import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";

type SecureHeadersOptions = NonNullable<Parameters<typeof secureHeaders>[0]>;
import type { AppEnv } from "../types";

const strictCsp: NonNullable<SecureHeadersOptions["contentSecurityPolicy"]> = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", "data:", "https://*.googleusercontent.com"],
  connectSrc: ["'self'"],
  fontSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};

const common: SecureHeadersOptions = {
  strictTransportSecurity: "max-age=63072000; includeSubDomains",
  referrerPolicy: "strict-origin-when-cross-origin",
  crossOriginEmbedderPolicy: false,
  permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [] },
};

const strict = secureHeaders({ ...common, contentSecurityPolicy: strictCsp });

/**
 * The Swagger UI page loads its JS/CSS from jsDelivr and uses an inline
 * script, so it needs a looser CSP. Only /api/docs gets it.
 */
const swagger = secureHeaders({
  ...common,
  contentSecurityPolicy: {
    ...strictCsp,
    scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
    imgSrc: ["'self'", "data:", "https://cdn.jsdelivr.net"],
  },
});

export const SWAGGER_PATH = "/api/docs";

/**
 * Security headers for every Worker response. (Static assets get theirs from
 * public/_headers, because the Worker doesn't run for them.)
 *
 * The CSP only allows scripts/styles from our own origin — no inline scripts
 * or style attributes — which neutralises most XSS even if an escaping bug
 * slips through. htmx is self-hosted under /vendor and configured with
 * allowEval=false (see web/layout.tsx).
 *
 * The policy is chosen up front by path, because secureHeaders writes its
 * headers after the handler runs and would overwrite any per-route override.
 */
export const securityHeaders = createMiddleware<AppEnv>((c, next) =>
  c.req.path === SWAGGER_PATH ? swagger(c, next) : strict(c, next),
);

/** Authenticated pages and API responses must never be cached by shared caches. */
export const noStore = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  if (!c.res.headers.has("cache-control")) c.header("cache-control", "no-store");
});
