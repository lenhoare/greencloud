import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppConfig } from "../../config";
import { base64UrlDecodeToString, base64UrlEncode, pkceChallenge, randomToken, safeEqual } from "../../lib/crypto";
import { AppError } from "../../lib/errors";
import { rateLimit } from "../../middleware/rate-limit";
import type { AppEnv } from "../../types";
import { audit } from "../audit/repo";
import { upsertUserFromGoogle } from "../users/repo";
import { checkAccess } from "./access";
import { createGoogleClient, type GoogleOAuthClient } from "./google";
import { createSession, destroySession, isSecure } from "./sessions";

export type GoogleClientFactory = (config: AppConfig) => GoogleOAuthClient;

const OAUTH_COOKIE = "gc_oauth";
const OAUTH_COOKIE_TTL_S = 10 * 60;

/**
 * Short-lived state for one login attempt, kept in an HttpOnly cookie scoped
 * to /auth. Storing it client-side avoids a DB write per login click; it's
 * safe because the values are random, single-use, only meaningful together
 * with Google's response, and the cookie can't be read by page JS.
 */
interface OAuthState {
  state: string;
  verifier: string;
  nonce: string;
  returnTo: string;
}

/**
 * Only allow same-site relative paths as post-login destinations, otherwise
 * /auth/login?returnTo=https://evil.example becomes an open redirect.
 * "//evil.example" and "/\evil.example" are protocol-relative in browsers.
 */
export function safeReturnTo(value: string | undefined | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/app";
  if (/[\u0000-\u001f]/.test(value)) return "/app";
  return value;
}

function redirectUri(c: Context<AppEnv>): string {
  return `${c.var.config.appUrl ?? new URL(c.req.url).origin}/auth/callback`;
}

/** Send the browser back to the login page with a reason it can display. */
const loginError = (c: Context<AppEnv>, code: string) => c.redirect(`/login?error=${encodeURIComponent(code)}`, 302);

export function createAuthRoutes(googleClient: GoogleClientFactory = defaultGoogleClient) {
  const auth = new Hono<AppEnv>();

  // Brute-force / abuse protection on the whole auth surface, per IP.
  auth.use("*", rateLimit("RATE_LIMIT_AUTH", (c) => `auth:${c.req.header("cf-connecting-ip") ?? "unknown"}`));

  /** Step 1: redirect to Google's consent screen. */
  auth.get("/login", async (c) => {
    const google = googleClient(c.var.config);
    const oauth: OAuthState = {
      state: randomToken(),
      verifier: randomToken(48),
      nonce: randomToken(),
      returnTo: safeReturnTo(c.req.query("returnTo")),
    };
    setCookie(c, OAUTH_COOKIE, base64UrlEncode(new TextEncoder().encode(JSON.stringify(oauth))), {
      httpOnly: true,
      secure: isSecure(c),
      // Must be Lax (not Strict): the callback is a cross-site top-level
      // navigation from accounts.google.com, and Strict cookies aren't sent.
      sameSite: "Lax",
      path: "/auth",
      maxAge: OAUTH_COOKIE_TTL_S,
    });
    const url = google.authorizationUrl({
      redirectUri: redirectUri(c),
      state: oauth.state,
      nonce: oauth.nonce,
      codeChallenge: await pkceChallenge(oauth.verifier),
      loginHint: c.req.query("hint") || undefined,
    });
    return c.redirect(url, 302);
  });

  /** Step 2: Google sends the user back here with ?code&state (or ?error). */
  auth.get("/callback", async (c) => {
    const log = c.var.logger;
    const raw = getCookie(c, OAUTH_COOKIE);
    // Single use: clear it immediately whatever happens next.
    deleteCookie(c, OAUTH_COOKIE, { path: "/auth", secure: isSecure(c) });

    const googleError = c.req.query("error");
    if (googleError) {
      log.info("google returned error", { googleError });
      return loginError(c, googleError === "access_denied" ? "access_denied" : "oauth_failed");
    }

    const oauth = parseOAuthCookie(raw);
    const state = c.req.query("state");
    const code = c.req.query("code");
    if (!oauth || !state || !code || !safeEqual(state, oauth.state)) {
      log.warn("oauth state mismatch", { hasCookie: Boolean(oauth) });
      return loginError(c, "state_mismatch");
    }

    const google = googleClient(c.var.config);
    let identity;
    try {
      const { idToken } = await google.exchangeCode({ code, codeVerifier: oauth.verifier, redirectUri: redirectUri(c) });
      identity = await google.verifyIdToken(idToken, oauth.nonce);
    } catch (err) {
      log.warn("oauth exchange/verify failed", { err, details: err instanceof AppError ? err.details : undefined });
      return loginError(c, "oauth_failed");
    }

    const decision = checkAccess(identity, c.var.config.access);
    if (!decision.allowed) {
      await audit(c, { action: "auth.login_denied", actorId: null, metadata: { email: identity.email, reason: decision.reason } });
      return loginError(c, decision.reason);
    }

    const user = await upsertUserFromGoogle(c.env.DB, identity, decision.isAdmin);
    if (user.disabledAt) {
      await audit(c, { action: "auth.login_denied", actorId: user.id, metadata: { reason: "disabled" } });
      return loginError(c, "account_disabled");
    }

    await createSession(c, user);
    await audit(c, { action: "auth.login", actorId: user.id });
    log.info("user signed in", { userId: user.id });
    return c.redirect(oauth.returnTo, 302);
  });

  /**
   * POST only, so a third-party page can't log you out with an <img> tag.
   * Browsers get redirected home; API clients (Accept: application/json) get 204.
   */
  auth.post("/logout", async (c) => {
    const session = c.var.session;
    await destroySession(c, session?.id);
    if (session) await audit(c, { action: "auth.logout", actorId: session.userId });
    if (c.req.header("accept")?.includes("application/json")) return c.body(null, 204);
    return c.redirect("/", 303);
  });

  return auth;
}

function parseOAuthCookie(raw: string | undefined): OAuthState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(base64UrlDecodeToString(raw)) as Partial<OAuthState>;
    if (typeof v.state === "string" && typeof v.verifier === "string" && typeof v.nonce === "string") {
      return { state: v.state, verifier: v.verifier, nonce: v.nonce, returnTo: safeReturnTo(v.returnTo) };
    }
  } catch {
    // fall through
  }
  return null;
}

function defaultGoogleClient(config: AppConfig): GoogleOAuthClient {
  return createGoogleClient({ clientId: config.google.clientId, clientSecret: config.google.clientSecret });
}
