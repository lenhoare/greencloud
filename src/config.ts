/**
 * Typed, validated view of environment variables.
 *
 * Wrangler `vars` and secrets are always strings; parse them once here so the
 * rest of the code works with proper types. Parsing is cached per `env` object
 * (one per isolate in production), so it costs nothing per request.
 */
export interface AppConfig {
  appName: string;
  /** Explicit public base URL (no trailing slash), or null to use the request origin. */
  appUrl: string | null;
  google: { clientId: string; clientSecret: string };
  access: {
    /** True when ALLOWED_EMAILS contains "*": any verified Google account may sign in. */
    allowAnyone: boolean;
    emails: Set<string>;
    domains: Set<string>;
    adminEmails: Set<string>;
  };
  corsOrigins: string[];
  sessionTtlMs: number;
  auditRetentionMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const cache = new WeakMap<object, AppConfig>();

export function getConfig(env: Env): AppConfig {
  const cached = cache.get(env);
  if (cached) return cached;
  const config = parseConfig(env);
  cache.set(env, config);
  return config;
}

export function parseConfig(env: Env): AppConfig {
  const emails = csvSet(env.ALLOWED_EMAILS);
  const allowAnyone = emails.delete("*");
  return {
    appName: env.APP_NAME || "Greencloud",
    appUrl: env.APP_URL ? env.APP_URL.replace(/\/+$/, "") : null,
    google: {
      clientId: env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    },
    access: {
      allowAnyone,
      emails,
      domains: csvSet(env.ALLOWED_DOMAINS),
      adminEmails: csvSet(env.ADMIN_EMAILS),
    },
    corsOrigins: csvList(env.CORS_ORIGINS),
    sessionTtlMs: positiveInt(env.SESSION_TTL_DAYS, 30) * DAY_MS,
    auditRetentionMs: positiveInt(env.AUDIT_RETENTION_DAYS, 180) * DAY_MS,
  };
}

function csvList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function csvSet(value: string | undefined): Set<string> {
  return new Set(csvList(value).map((s) => s.toLowerCase()));
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
