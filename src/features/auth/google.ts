import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { AppError } from "../../lib/errors";

/**
 * Google OAuth 2.0 / OpenID Connect client (authorization code flow + PKCE).
 *
 * Flow:
 *   1. /auth/login builds `authorizationUrl()` with a random `state` (CSRF
 *      protection for the callback), a PKCE `code_challenge` (stops a stolen
 *      authorization code from being redeemed by anyone else) and a `nonce`
 *      (binds the ID token to this login attempt, preventing replay).
 *   2. Google redirects to /auth/callback with `code` + `state`.
 *   3. `exchangeCode()` swaps the code (plus the PKCE verifier and client
 *      secret) for tokens at Google's token endpoint.
 *   4. `verifyIdToken()` checks the ID token's signature against Google's
 *      published keys and validates iss / aud / exp / nonce.
 *
 * We only need identity, so we request `openid email profile` and discard the
 * access token. Add scopes (and store tokens) if you need Google APIs later.
 */

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
  /** Google Workspace hosted domain. Absent for personal @gmail.com accounts. */
  hostedDomain: string | null;
}

export interface GoogleOAuthClient {
  authorizationUrl(params: {
    redirectUri: string;
    state: string;
    codeChallenge: string;
    nonce: string;
    loginHint?: string;
  }): string;
  exchangeCode(params: { code: string; codeVerifier: string; redirectUri: string }): Promise<{ idToken: string }>;
  verifyIdToken(idToken: string, expectedNonce: string): Promise<GoogleIdentity>;
}

export interface GoogleClientOptions {
  clientId: string;
  clientSecret: string;
  /** Override the key set (tests use a local one). */
  jwks?: JWTVerifyGetKey;
  /** Override fetch (tests stub Google's token endpoint). */
  fetch?: typeof fetch;
}

// Module-level so the key set (and jose's internal cache of fetched keys) is
// reused across requests within an isolate instead of refetched every login.
let sharedJwks: JWTVerifyGetKey | undefined;
const googleJwks = () => (sharedJwks ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL)));

export function createGoogleClient(opts: GoogleClientOptions): GoogleOAuthClient {
  if (!opts.clientId || !opts.clientSecret) {
    throw new AppError(
      500,
      "oauth_not_configured",
      "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see README).",
    );
  }
  const doFetch = opts.fetch ?? fetch;

  return {
    authorizationUrl({ redirectUri, state, codeChallenge, nonce, loginHint }) {
      const url = new URL(GOOGLE_AUTH_URL);
      url.search = new URLSearchParams({
        client_id: opts.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        prompt: "select_account",
        ...(loginHint ? { login_hint: loginHint } : {}),
      }).toString();
      return url.toString();
    },

    async exchangeCode({ code, codeVerifier, redirectUri }) {
      const res = await doFetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
      if (!res.ok || !body.id_token) {
        throw new AppError(502, "token_exchange_failed", "Google sign-in failed while exchanging the code", {
          status: res.status,
          error: body.error,
          description: body.error_description,
        });
      }
      return { idToken: body.id_token };
    },

    verifyIdToken(idToken, expectedNonce) {
      return verifyGoogleIdToken(idToken, {
        clientId: opts.clientId,
        nonce: expectedNonce,
        jwks: opts.jwks ?? googleJwks(),
      });
    },
  };
}

/**
 * Validate a Google ID token. Exported separately so it can be unit tested.
 *
 * Note: the token came straight from Google over TLS in step 3, so strictly
 * the signature check is defence in depth — but it's cheap and it protects us
 * if the token is ever accepted from a less trusted channel later.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  opts: { clientId: string; nonce: string; jwks: JWTVerifyGetKey },
): Promise<GoogleIdentity> {
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, opts.jwks, {
      issuer: GOOGLE_ISSUERS,
      audience: opts.clientId,
      algorithms: ["RS256"],
      clockTolerance: 30,
    }));
  } catch (err) {
    const reason = err instanceof joseErrors.JOSEError ? err.code : "invalid";
    throw new AppError(401, "invalid_id_token", "Google ID token is invalid", { reason });
  }

  if (payload.nonce !== opts.nonce) {
    throw new AppError(401, "invalid_id_token", "Google ID token nonce mismatch", { reason: "nonce" });
  }
  if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
    throw new AppError(401, "invalid_id_token", "Google ID token is missing required claims");
  }
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === "string" ? payload.name : "",
    picture: typeof payload.picture === "string" ? payload.picture : null,
    hostedDomain: typeof payload.hd === "string" ? payload.hd.toLowerCase() : null,
  };
}
