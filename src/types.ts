import type { Context } from "hono";
import type { AppConfig } from "./config";
import type { Logger } from "./lib/logger";

/** A row from `users`, mapped to camelCase. */
export interface User {
  id: string;
  googleSub: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: UserRole;
  disabledAt: number | null;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

export type UserRole = "user" | "admin";

export interface Session {
  /** SHA-256 of the cookie token (never the token itself). */
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  ip: string | null;
  userAgent: string | null;
}

/** Per-request values set by middleware. */
export interface BaseVariables {
  requestId: string;
  logger: Logger;
  config: AppConfig;
  user: User | null;
  session: Session | null;
}

/** Hono environment for any route. `user` may be null. */
export interface AppEnv {
  Bindings: Env;
  Variables: BaseVariables;
}

/**
 * Hono environment for routes mounted behind `requireUser`. The middleware
 * guarantees `user` and `session` are present, so handlers don't null-check.
 */
export interface AuthedEnv {
  Bindings: Env;
  Variables: BaseVariables & { user: User; session: Session };
}

/**
 * A context from either kind of route. Hono's Context is invariant in its env
 * type, so helpers that work in both public and signed-in routes (audit,
 * flash, renderPage…) accept this union.
 */
export type AnyContext = Context<AppEnv> | Context<AuthedEnv>;
