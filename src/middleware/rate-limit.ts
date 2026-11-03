import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { tooManyRequests } from "../lib/errors";
import type { AppEnv } from "../types";

type RateLimitBinding = "RATE_LIMIT_AUTH" | "RATE_LIMIT_API";

/**
 * Rate limiting using the native Workers Rate Limiting binding (configured in
 * wrangler.jsonc). Limits are enforced per Cloudflare location and are
 * eventually consistent — great for abuse protection, not for billing-grade
 * quotas.
 *
 * Keys: signed-in users are limited per user id; anonymous requests per IP.
 * `cf-connecting-ip` is set by Cloudflare and cannot be spoofed by clients.
 */
export function rateLimit(binding: RateLimitBinding, keyFn: (c: Context<AppEnv>) => string = defaultKey) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const limiter = c.env[binding] as RateLimit | undefined;
    if (limiter) {
      const { success } = await limiter.limit({ key: keyFn(c) });
      if (!success) {
        c.header("retry-after", "60");
        throw tooManyRequests();
      }
    }
    await next();
  });
}

function defaultKey(c: Context<AppEnv>): string {
  return c.var.user ? `user:${c.var.user.id}` : `ip:${c.req.header("cf-connecting-ip") ?? "unknown"}`;
}
