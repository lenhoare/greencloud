import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp, signedIn, type Browser, type FakeGoogle } from "./helpers";

let app: Awaited<ReturnType<typeof createTestApp>>["app"];
let google: FakeGoogle;
let admin: Browser;

beforeAll(async () => {
  ({ app, google } = await createTestApp());
  admin = await signedIn(app, google, "admin@example.com");
});

describe("admin", () => {
  it("is forbidden to regular users (API and UI)", async () => {
    const alice = await signedIn(app, google, "alice@example.com");
    expect((await alice.request("/api/v1/admin/users")).status).toBe(403);
    const page = await alice.request("/app/admin", { headers: { accept: "*/*" } });
    expect(page.status).toBe(403);
    expect(page.headers.get("content-type")).toContain("text/html");
  });

  it("lists and searches users", async () => {
    await signedIn(app, google, "bob@example.com");
    const all = await (await admin.request("/api/v1/admin/users")).json<{ users: { email: string }[]; total: number }>();
    expect(all.total).toBeGreaterThanOrEqual(2);

    const found = await (await admin.request("/api/v1/admin/users?search=bob")).json<{ users: { email: string }[] }>();
    expect(found.users.map((u) => u.email)).toEqual(["bob@example.com"]);
  });

  it("disabling a user signs them out immediately and blocks sign-in", async () => {
    const carol = await signedIn(app, google, "carol@example.com");
    const { id } = await (await carol.request("/api/v1/me")).json<{ id: string }>();

    const res = await admin.request(`/api/v1/admin/users/${id}`, { method: "PATCH", json: { disabled: true } });
    expect(res.status).toBe(200);
    expect((await carol.request("/api/v1/me")).status).toBe(401);

    const again = await carol.signIn(google, { email: "carol@example.com" });
    expect(again.headers.get("location")).toBe("/login?error=account_disabled");

    await admin.request(`/api/v1/admin/users/${id}`, { method: "PATCH", json: { disabled: false } });
    const ok = await carol.signIn(google, { email: "carol@example.com" });
    expect(ok.headers.get("location")).toBe("/app");
  });

  it("won't let an admin lock themselves out", async () => {
    const { id } = await (await admin.request("/api/v1/me")).json<{ id: string }>();
    const res = await admin.request(`/api/v1/admin/users/${id}`, { method: "PATCH", json: { role: "user" } });
    expect(res.status).toBe(400);
  });

  it("records an audit trail", async () => {
    const res = await admin.request("/api/v1/admin/audit?action=auth.");
    const { events } = await res.json<{ events: { action: string }[] }>();
    expect(events.some((e) => e.action === "auth.login")).toBe(true);
  });

  it("renders the admin dashboard", async () => {
    const res = await admin.request("/app/admin");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Recent activity");
    expect(html).toContain("admin@example.com");
  });
});
