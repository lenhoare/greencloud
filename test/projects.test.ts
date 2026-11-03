import { beforeAll, describe, expect, it } from "vitest";
import type { ItemDto, ProjectDto } from "../src/features/projects/schemas";
import { createTestApp, signedIn, type Browser, type FakeGoogle } from "./helpers";

let app: Awaited<ReturnType<typeof createTestApp>>["app"];
let google: FakeGoogle;
let alice: Browser;
let bob: Browser;
let bobId: string;

beforeAll(async () => {
  ({ app, google } = await createTestApp());
  alice = await signedIn(app, google, "alice@example.com");
  bob = await signedIn(app, google, "bob@example.com");
  bobId = (await (await bob.request("/api/v1/me")).json<{ id: string }>()).id;
});

async function createProject(browser: Browser, name = "Launch") {
  const res = await browser.request("/api/v1/projects", { json: { name, description: "Ship it" } });
  expect(res.status).toBe(201);
  return res.json<ProjectDto>();
}

describe("projects API", () => {
  it("creates a project owned by the creator", async () => {
    const project = await createProject(alice);
    expect(project).toMatchObject({ name: "Launch", description: "Ship it", role: "owner", itemCount: 0, memberCount: 1 });

    const list = await (await alice.request("/api/v1/projects")).json<{ projects: ProjectDto[] }>();
    expect(list.projects.map((p) => p.id)).toContain(project.id);
  });

  it("validates input with a structured 400", async () => {
    const res = await alice.request("/api/v1/projects", { json: { name: "" } });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: { code: string; details: { path: string }[] } }>();
    expect(body.error.code).toBe("bad_request");
    expect(body.error.details[0]!.path).toBe("name");
  });

  it("hides other people's projects (404, not 403)", async () => {
    const project = await createProject(alice);
    expect((await bob.request(`/api/v1/projects/${project.id}`)).status).toBe(404);
    expect((await bob.request(`/api/v1/projects/${project.id}/items`)).status).toBe(404);
    const list = await (await bob.request("/api/v1/projects")).json<{ projects: ProjectDto[] }>();
    expect(list.projects.map((p) => p.id)).not.toContain(project.id);
  });

  it("enforces viewer / editor / owner permissions when sharing", async () => {
    const project = await createProject(alice);
    const base = `/api/v1/projects/${project.id}`;

    // share as viewer
    const add = await alice.request(`${base}/members`, { json: { email: "BOB@example.com", role: "viewer" } });
    expect(add.status).toBe(201);
    expect((await bob.request(base)).status).toBe(200);
    expect((await bob.request(`${base}/items`, { json: { title: "Nope" } })).status).toBe(403);

    // promote to editor
    const promote = await alice.request(`${base}/members/${bobId}`, { method: "PATCH", json: { role: "editor" } });
    expect(promote.status).toBe(200);
    const created = await bob.request(`${base}/items`, { json: { title: "Write docs", dueDate: "2030-01-31" } });
    expect(created.status).toBe(201);

    // editors still can't manage members or delete the project
    expect((await bob.request(`${base}/members`, { json: { email: "carol@example.com" } })).status).toBe(403);
    expect((await bob.request(base, { method: "DELETE" })).status).toBe(403);

    // sharing twice conflicts; unknown users are reported
    expect((await alice.request(`${base}/members`, { json: { email: "bob@example.com" } })).status).toBe(409);
    expect((await alice.request(`${base}/members`, { json: { email: "nobody@example.com" } })).status).toBe(404);
  });

  it("keeps at least one owner", async () => {
    const project = await createProject(alice);
    const me = await (await alice.request("/api/v1/me")).json<{ id: string }>();
    const res = await alice.request(`/api/v1/projects/${project.id}/members/${me.id}`, { method: "DELETE" });
    expect(res.status).toBe(400);
  });

  it("lets a member leave", async () => {
    const project = await createProject(alice);
    await alice.request(`/api/v1/projects/${project.id}/members`, { json: { email: "bob@example.com", role: "viewer" } });
    expect((await bob.request(`/api/v1/projects/${project.id}/members/${bobId}`, { method: "DELETE" })).status).toBe(204);
    expect((await bob.request(`/api/v1/projects/${project.id}`)).status).toBe(404);
  });

  it("supports the item lifecycle and status filter", async () => {
    const project = await createProject(alice);
    const base = `/api/v1/projects/${project.id}/items`;
    const a = await (await alice.request(base, { json: { title: "A" } })).json<ItemDto>();
    await alice.request(base, { json: { title: "B", status: "doing" } });

    const patched = await alice.request(`${base}/${a.id}`, { method: "PATCH", json: { status: "done", notes: "shipped" } });
    expect(await patched.json()).toMatchObject({ status: "done", notes: "shipped", title: "A" });

    const done = await (await alice.request(`${base}?status=done`)).json<{ items: ItemDto[] }>();
    expect(done.items.map((i) => i.title)).toEqual(["A"]);

    const summary = await (await alice.request(`/api/v1/projects/${project.id}`)).json<ProjectDto>();
    expect(summary).toMatchObject({ itemCount: 2, openItemCount: 1 });

    expect((await alice.request(`${base}/${a.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await alice.request(`${base}/${a.id}`)).status).toBe(404);
  });

  it("deletes a project with its items", async () => {
    const project = await createProject(alice);
    await alice.request(`/api/v1/projects/${project.id}/items`, { json: { title: "x" } });
    expect((await alice.request(`/api/v1/projects/${project.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await alice.request(`/api/v1/projects/${project.id}`)).status).toBe(404);
  });
});

describe("projects web UI", () => {
  it("creates a project via form post and renders it", async () => {
    const res = await alice.request("/app/projects", { form: { name: "From the form", description: "" } });
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location).toMatch(/^\/app\/projects\/[0-9a-f-]{36}$/);

    const page = await alice.request(location);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("From the form");
    expect(html).toContain("Project created"); // flash message
  });

  it("escapes user content in HTML", async () => {
    const project = await createProject(alice, "<script>alert(1)</script>");
    const html = await (await alice.request(`/app/projects/${project.id}`)).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("shows a friendly error when a form action isn't permitted", async () => {
    const project = await createProject(alice);
    await alice.request(`/api/v1/projects/${project.id}/members`, { json: { email: "bob@example.com", role: "viewer" } });
    const res = await bob.request(`/app/projects/${project.id}/items`, {
      form: { title: "sneaky" },
      headers: { referer: `https://app.test/app/projects/${project.id}` },
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/app/projects/${project.id}`);
    const html = await (await bob.request(`/app/projects/${project.id}`)).text();
    expect(html).toContain("requires the editor role");
  });
});
