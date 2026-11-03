import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Throw an AppError anywhere (services, middleware, handlers) and the global
 * error handler turns it into the right response: a JSON error body for the
 * API, or an error page / redirect for the web UI.
 */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message = "Bad request", details?: unknown) =>
  new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "Authentication required") =>
  new AppError(401, "unauthorized", message);
export const forbidden = (message = "You don't have permission to do that") =>
  new AppError(403, "forbidden", message);
export const notFound = (message = "Not found") => new AppError(404, "not_found", message);
export const conflict = (message: string) => new AppError(409, "conflict", message);
export const tooManyRequests = (message = "Too many requests, slow down") =>
  new AppError(429, "rate_limited", message);

/** JSON error envelope used by every API error response. */
export interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}
