import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { Browser, createTestApp, ORIGIN, signedIn, type FakeGoogle } from "./helpers";

let app: Awaited<ReturnType<typeof createTestApp>>["app"];
let google: FakeGoogle;

beforeAll(async () => {
  ({ app, google } = await createTestApp());
});

describe("GET /auth/login", () => {
  it("redirects to Google with state, nonce and an S256 PKCE challenge", async () => {
    const browser = new Browser(app);
    const res = await browser.request("/auth/login?returnTo=/app/account");
    expect(res.status).toBe(302);

    const url = new URL(res.headers.get("location")!);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = url.searchParams;
    expect(p.get("client_id")).toBe("test-client-id.apps.googleusercontent.com");
    expect(p.get("redirect_uri")).toBe(`${ORIGIN}/auth/callback`);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")).toBe("openid email profile");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(p.get("state")!.length).toBeGreaterThanOrEqual(43);
    expect(p.get("nonce")!.length).toBeGreaterThanOrEqual(43);

    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("gc_oauth="))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/auth/i);
  });
});

describe("GET /auth/callback", () => {
  it("signs the user in, sets a hardened session cookie and honours returnTo", async () => {
    const browser = new Browser(app);
    const res = await browser.signIn(google, { email: "alice@example.com", name: "Alice" }, "/app/account");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/app/account");
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-gc_session="))!;
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
    // the one-time OAuth cookie is cleared
    expect(browser.cookies.has("gc_oauth")).toBe(false);

    const me = await browser.request("/api/v1/me");
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: "alice@example.com", name: "Alice", role: "user", disabled: false });
  });

  it("stores only a hash of the session token", async () => {
    const browser = await signedIn(app, google, "alice@example.com");
    const token = browser.cookies.get("__Host-gc_session")!;
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE id = ?").bind(token).first<{ n: number }>();
    expect(row!.n).toBe(0);
  });

  it("rejects a callback whose state doesn't match the cookie", async () => {
    const browser = new Browser(app);
    const login = await browser.request("/auth/login");
    const p = new URL(login.headers.get("location")!).searchParams;
    const code = google.issueCode({ email: "alice@example.com" }, p.get("nonce")!, p.get("code_challenge")!);

    const res = await browser.request(`/auth/callback?code=${code}&state=forged-state`);
    expect(res.headers.get("location")).toBe("/login?error=state_mismatch");
    expect([...browser.cookies.keys()].some((k) => k.includes("session"))).toBe(false);
  });

  it("rejects a callback without the OAuth cookie (login CSRF)", async () => {
    const attacker = new Browser(app);
    const login = await attacker.request("/auth/login");
    const p = new URL(login.headers.get("location")!).searchParams;
    const code = google.issueCode({ email: "alice@example.com" }, p.get("nonce")!, p.get("code_challenge")!);

    const victim = new Browser(app);
    const res = await victim.request(`/auth/callback?code=${code}&state=${p.get("state")}`);
    expect(res.headers.get("location")).toBe("/login?error=state_mismatch");
  });

  it("rejects an ID token with the wrong nonce (replay)", async () => {
    const browser = new Browser(app);
    const login = await browser.request("/auth/login");
    const p = new URL(login.headers.get("location")!).searchParams;
    const replayed = await google.signIdToken({ sub: "1", email: "alice@example.com", email_verified: true, nonce: "old-nonce" });
    const code = google.issueCode({ email: "alice@example.com" }, p.get("nonce")!, p.get("code_challenge")!, replayed);

    const res = await browser.request(`/auth/callback?code=${code}&state=${p.get("state")}`);
    expect(res.headers.get("location")).toBe("/login?error=oauth_failed");
  });

  it("handles the user cancelling on Google's consent screen", async () => {
    const browser = new Browser(app);
    await browser.request("/auth/login");
    const res = await browser.request("/auth/callback?error=access_denied");
    expect(res.headers.get("location")).toBe("/login?error=access_denied");
  });

  it("refuses accounts that aren't on the allowlist, without creating a user", async () => {
    const browser = new Browser(app);
    const res = await browser.signIn(google, { email: "mallory@example.com" });
    expect(res.headers.get("location")).toBe("/login?error=not_allowed");
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?").bind("mallory@example.com").first<{ n: number }>();
    expect(row!.n).toBe(0);
  });

  it("refuses unverified email addresses even if allowlisted", async () => {
    const res = await new Browser(app).signIn(google, { email: "unverified@example.com", emailVerified: false });
    expect(res.headers.get("location")).toBe("/login?error=email_unverified");
  });

  it("allows Workspace domains by the hd claim, not the email suffix", async () => {
    const workspace = await new Browser(app).signIn(google, { email: "dave@acme.test", hd: "acme.test" });
    expect(workspace.headers.get("location")).toBe("/app");

    // A personal Google account that merely uses an @acme.test address has no hd claim.
    const personal = await new Browser(app).signIn(google, { email: "eve@acme.test" });
    expect(personal.headers.get("location")).toBe("/login?error=not_allowed");
  });

  it("promotes ADMIN_EMAILS to admin", async () => {
    const admin = await signedIn(app, google, "admin@example.com");
    const me = await (await admin.request("/api/v1/me")).json<{ role: string }>();
    expect(me.role).toBe("admin");
  });

  it("sanitises returnTo to prevent open redirects", async () => {
    for (const evil of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
      const res = await new Browser(app).signIn(google, { email: "alice@example.com" }, evil);
      expect(res.headers.get("location")).toBe("/app");
    }
  });
});

describe("POST /auth/logout", () => {
  it("revokes the session server-side", async () => {
    const browser = await signedIn(app, google, "bob@example.com");
    const token = browser.cookies.get("__Host-gc_session")!;

    const res = await browser.request("/auth/logout", { method: "POST" });
    expect(res.status).toBe(303);
    expect(browser.cookies.has("__Host-gc_session")).toBe(false);

    // Even if the old cookie was stolen before logout, it no longer works.
    const replay = new Browser(app);
    replay.cookies.set("__Host-gc_session", token);
    expect((await replay.request("/api/v1/me")).status).toBe(401);
  });

  it("is not a GET (so <img src=/auth/logout> can't sign you out)", async () => {
    const browser = await signedIn(app, google, "bob@example.com");
    expect((await browser.request("/auth/logout")).status).toBe(404);
    expect((await browser.request("/api/v1/me")).status).toBe(200);
  });
});

describe("route protection", () => {
  it("returns 401 JSON for anonymous API calls", async () => {
    const res = await new Browser(app).request("/api/v1/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("redirects anonymous page views to login with returnTo", async () => {
    const res = await new Browser(app).request("/app/projects?x=1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?returnTo=%2Fapp%2Fprojects%3Fx%3D1");
  });

  it("lists and revokes other sessions", async () => {
    const laptop = await signedIn(app, google, "carol@example.com");
    const phone = await signedIn(app, google, "carol@example.com");

    const list = await (await laptop.request("/api/v1/me/sessions")).json<{ sessions: { current: boolean }[] }>();
    expect(list.sessions.length).toBeGreaterThanOrEqual(2);
    expect(list.sessions.filter((s) => s.current)).toHaveLength(1);

    const revoke = await laptop.request("/api/v1/me/sessions/revoke-others", { method: "POST" });
    expect(await revoke.json()).toMatchObject({ revoked: expect.any(Number) });
    expect((await phone.request("/api/v1/me")).status).toBe(401);
    expect((await laptop.request("/api/v1/me")).status).toBe(200);
  });
});
