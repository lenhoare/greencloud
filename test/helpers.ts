import { env } from "cloudflare:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { createApp } from "../src/app";
import { createGoogleClient, GOOGLE_TOKEN_URL } from "../src/features/auth/google";
import { pkceChallenge } from "../src/lib/crypto";

export const ORIGIN = "https://app.test";
export const CLIENT_ID = "test-client-id.apps.googleusercontent.com";

export interface FakeIdentity {
  sub?: string;
  email: string;
  name?: string;
  emailVerified?: boolean;
  hd?: string;
}

/**
 * A stand-in for Google: signs real RS256 ID tokens with a local key and
 * implements the token endpoint, including PKCE verification. The app under
 * test runs its real OAuth code against it (only fetch + JWKS are swapped).
 */
export class FakeGoogle {
  private codes = new Map<string, { identity: FakeIdentity; nonce: string; challenge: string; idToken?: string }>();
  private constructor(
    private privateKey: CryptoKey,
    readonly jwks: ReturnType<typeof createLocalJWKSet>,
  ) {}

  static async create(): Promise<FakeGoogle> {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
    return new FakeGoogle(privateKey, createLocalJWKSet({ keys: [jwk] }));
  }

  async signIdToken(claims: Record<string, unknown>, opts: { audience?: string; issuer?: string; expiresIn?: string } = {}) {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(opts.issuer ?? "https://accounts.google.com")
      .setAudience(opts.audience ?? CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? "1h")
      .sign(this.privateKey);
  }

  /** Simulate the user approving consent: returns the `code` Google would send back. */
  issueCode(identity: FakeIdentity, nonce: string, challenge: string, idToken?: string): string {
    const code = `code-${crypto.randomUUID()}`;
    this.codes.set(code, { identity, nonce, challenge, idToken });
    return code;
  }

  fetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url !== GOOGLE_TOKEN_URL) throw new Error(`Unexpected outbound fetch: ${url}`);
    const body = new URLSearchParams(String(init?.body));
    const entry = this.codes.get(body.get("code") ?? "");
    this.codes.delete(body.get("code") ?? ""); // codes are single use
    const verifier = body.get("code_verifier") ?? "";
    if (!entry || body.get("client_id") !== CLIENT_ID || (await pkceChallenge(verifier)) !== entry.challenge) {
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    const { identity } = entry;
    const idToken =
      entry.idToken ??
      (await this.signIdToken({
        sub: identity.sub ?? `sub-${identity.email}`,
        email: identity.email,
        email_verified: identity.emailVerified ?? true,
        name: identity.name ?? identity.email.split("@")[0],
        picture: null,
        nonce: entry.nonce,
        ...(identity.hd ? { hd: identity.hd } : {}),
      }));
    return Response.json({ access_token: "unused", id_token: idToken, token_type: "Bearer", expires_in: 3599 });
  };
}

export async function createTestApp() {
  const google = await FakeGoogle.create();
  const app = createApp({
    googleClient: (config) =>
      createGoogleClient({
        clientId: config.google.clientId,
        clientSecret: config.google.clientSecret,
        jwks: google.jwks,
        fetch: google.fetch,
      }),
  });
  return { app, google };
}

type TestApp = Awaited<ReturnType<typeof createTestApp>>["app"];

/** Minimal browser: a cookie jar, a stable client IP, and an Origin header on unsafe requests. */
export class Browser {
  readonly cookies = new Map<string, string>();
  readonly ip = `10.${rand()}.${rand()}.${rand()}`;

  constructor(private app: TestApp) {}

  async request(path: string, init: RequestInit & { json?: unknown; form?: Record<string, string> } = {}) {
    const headers = new Headers(init.headers);
    headers.set("cf-connecting-ip", this.ip);
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    const method = init.method ?? (init.json || init.form ? "POST" : "GET");
    if (method !== "GET" && !headers.has("origin")) headers.set("origin", ORIGIN);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    } else if (init.form) {
      headers.set("content-type", "application/x-www-form-urlencoded");
      body = new URLSearchParams(init.form).toString();
    }
    const res = await this.app.request(`${ORIGIN}${path}`, { ...init, method, headers, body }, env);
    this.storeCookies(res);
    return res;
  }

  private storeCookies(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  /** Run the full OAuth dance against FakeGoogle. Returns the final callback response. */
  async signIn(google: FakeGoogle, identity: FakeIdentity, returnTo = "/app") {
    const login = await this.request(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
    const location = new URL(login.headers.get("location")!);
    const params = location.searchParams;
    const code = google.issueCode(identity, params.get("nonce")!, params.get("code_challenge")!);
    return this.request(`/auth/callback?code=${encodeURIComponent(code)}&state=${params.get("state")}`);
  }
}

function rand() {
  return Math.floor(Math.random() * 250) + 1;
}

/** Create a signed-in browser for an allowed test user. */
export async function signedIn(app: TestApp, google: FakeGoogle, email: string, extra: Partial<FakeIdentity> = {}) {
  const browser = new Browser(app);
  const res = await browser.signIn(google, { email, ...extra });
  if (res.status !== 302 || res.headers.get("location")?.startsWith("/login")) {
    throw new Error(`sign-in failed for ${email}: ${res.status} ${res.headers.get("location")}`);
  }
  return browser;
}
