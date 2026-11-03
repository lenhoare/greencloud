import { createScheduledController, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { checkAccess } from "../src/features/auth/access";
import { verifyGoogleIdToken, type GoogleIdentity } from "../src/features/auth/google";
import { parseConfig } from "../src/config";
import { runScheduled } from "../src/scheduled";
import { Browser, CLIENT_ID, createTestApp, ORIGIN, signedIn, type FakeGoogle } from "./helpers";

let app: Awaited<ReturnType<typeof createTestApp>>["app"];
let google: FakeGoogle;

beforeAll(async () => {
  ({ app, google } = await createTestApp());
});

describe("health", () => {
  it("reports liveness and readiness", async () => {
    const browser = new Browser(app);
    expect(await (await browser.request("/health")).json()).toEqual({ status: "ok" });
    const ready = await browser.request("/health/ready");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ status: "ok", checks: { db: { ok: true } } });
  });
});

describe("security", () => {
  it("sets security headers and a strict CSP on pages", async () => {
    const res = await new Browser(app).request("/login");
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("relaxes the CSP only for the Swagger UI page", async () => {
    const res = await new Browser(app).request("/api/docs");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("https://cdn.jsdelivr.net");
    const page = await new Browser(app).request("/app");
    expect(page.headers.get("content-security-policy")).not.toContain("cdn.jsdelivr.net");
  });

  it("blocks cross-site form posts (CSRF)", async () => {
    const alice = await signedIn(app, google, "alice@example.com");
    const res = await alice.request("/app/projects", {
      form: { name: "csrf" },
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("allows configured CORS origins with credentials, and no others", async () => {
    const browser = new Browser(app);
    const ok = await browser.request("/api/v1/me", {
      method: "OPTIONS",
      headers: { origin: "https://frontend.example.com", "access-control-request-method": "GET" },
    });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://frontend.example.com");
    expect(ok.headers.get("access-control-allow-credentials")).toBe("true");

    const denied = await browser.request("/api/v1/me", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "GET" },
    });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rate limits the auth endpoints per IP", async () => {
    const browser = new Browser(app);
    let limited: Response | undefined;
    for (let i = 0; i < 30 && !limited; i++) {
      const res = await browser.request("/auth/login");
      if (res.status === 429) limited = res;
    }
    expect(limited).toBeDefined();
    expect(limited!.headers.get("retry-after")).toBe("60");
  });
});

describe("errors and docs", () => {
  it("returns JSON 404s under /api and HTML 404s elsewhere", async () => {
    const browser = new Browser(app);
    const api = await browser.request("/api/nope");
    expect(api.status).toBe(404);
    expect(await api.json()).toMatchObject({ error: { code: "not_found" } });

    const page = await browser.request("/nope");
    expect(page.status).toBe(404);
    expect(page.headers.get("content-type")).toContain("text/html");
  });

  it("serves an OpenAPI document covering the API", async () => {
    const doc = await (await new Browser(app).request("/api/openapi.json")).json<{ paths: Record<string, unknown> }>();
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/v1/me", "/v1/projects", "/v1/projects/{projectId}/items", "/v1/admin/users"]),
    );
  });
});

describe("Google ID token verification", () => {
  const base = { sub: "123", email: "a@example.com", email_verified: true, nonce: "n1" };
  const verify = (token: string, nonce = "n1") => verifyGoogleIdToken(token, { clientId: CLIENT_ID, nonce, jwks: google.jwks });

  it("accepts a valid token", async () => {
    const identity = await verify(await google.signIdToken(base));
    expect(identity).toMatchObject({ sub: "123", email: "a@example.com", emailVerified: true });
  });

  it.each([
    ["wrong audience", () => google.signIdToken(base, { audience: "someone-else" })],
    ["wrong issuer", () => google.signIdToken(base, { issuer: "https://evil.example" })],
    ["expired", () => google.signIdToken(base, { expiresIn: "-5m" })],
    ["wrong nonce", () => google.signIdToken({ ...base, nonce: "other" })],
  ])("rejects a token with %s", async (_name, make) => {
    await expect(verify(await make())).rejects.toMatchObject({ code: "invalid_id_token" });
  });

  it("rejects a token signed by another key", async () => {
    const { FakeGoogle: Fake } = await import("./helpers");
    const other = await Fake.create();
    await expect(verify(await other.signIdToken(base))).rejects.toMatchObject({ code: "invalid_id_token" });
  });
});

describe("access policy", () => {
  const identity = (o: Partial<GoogleIdentity>): GoogleIdentity => ({
    sub: "1",
    email: "x@example.com",
    emailVerified: true,
    name: "",
    picture: null,
    hostedDomain: null,
    ...o,
  });

  it("denies everyone when nothing is configured (safe default)", () => {
    const { access } = parseConfig({ ...env, ALLOWED_EMAILS: "", ALLOWED_DOMAINS: "", ADMIN_EMAILS: "" });
    expect(checkAccess(identity({}), access)).toEqual({ allowed: false, reason: "not_allowed" });
  });

  it("supports '*' to allow any verified account", () => {
    const { access } = parseConfig({ ...env, ALLOWED_EMAILS: "*" });
    expect(checkAccess(identity({}), access)).toMatchObject({ allowed: true });
    expect(checkAccess(identity({ emailVerified: false }), access)).toMatchObject({ allowed: false });
  });
});

describe("scheduled maintenance", () => {
  it("deletes expired sessions", async () => {
    const alice = await signedIn(app, google, "alice@example.com");
    await env.DB.prepare("UPDATE sessions SET expires_at = 1").run();
    await runScheduled(createScheduledController({ cron: "17 3 * * *", scheduledTime: Date.now() }), env);
    const { n } = (await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>())!;
    expect(n).toBe(0);
    expect((await alice.request("/api/v1/me")).status).toBe(401);
  });

  it("uses a non-__Host cookie on plain-HTTP localhost", async () => {
    const res = await app.request("http://localhost/auth/login", { headers: { "cf-connecting-ip": "10.9.9.9" } }, env);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("gc_oauth="))!;
    expect(cookie).not.toMatch(/Secure/i);
    expect(new URL(res.headers.get("location")!).searchParams.get("redirect_uri")).toBe("http://localhost/auth/callback");
    expect(ORIGIN).toMatch(/^https:/);
  });
});
