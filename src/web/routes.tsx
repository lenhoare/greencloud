import { Hono } from "hono";
import { z } from "zod";
import { audit, listAuditEvents } from "../features/audit/repo";
import { adminUpdateUser, getStats } from "../features/admin/service";
import { listUserSessions, revokeUserSessions } from "../features/auth/sessions";
import { safeReturnTo } from "../features/auth/routes";
import { ItemInput, ItemPatch, ItemStatus, MemberInput, MemberPatch, ProjectInput } from "../features/projects/schemas";
import * as svc from "../features/projects/service";
import { listUsers } from "../features/users/repo";
import { toSessionDto } from "../features/users/schemas";
import { AppError } from "../lib/errors";
import { requireAdmin, requireUser } from "../middleware/auth";
import type { AnyContext, AppEnv, AuthedEnv } from "../types";
import { AccountPage } from "./pages/account";
import { AdminPage } from "./pages/admin";
import { ItemPage, ProjectPage, ProjectSettingsPage, ProjectsPage } from "./pages/projects";
import { LandingPage, LoginPage } from "./pages/public";
import { parseForm, redirectWith, renderPage } from "./render";

/** Empty form fields mean "no value" for optional/nullable inputs. */
const emptyToNull = (v: string | undefined) => (v === undefined || v.trim() === "" ? null : v);

/**
 * Turn service-layer AppErrors (e.g. "forbidden", "conflict") raised while
 * handling a form into a flash message on the page the user came from.
 */
async function formAction(c: AnyContext, fallback: string, fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError && err.status < 500) {
      const back = sameOriginReferer(c.req.header("referer"), c.req.url) ?? fallback;
      return redirectWith(c, back, "error", err.message);
    }
    throw err;
  }
}

function sameOriginReferer(referer: string | undefined, current: string): string | null {
  if (!referer) return null;
  try {
    const r = new URL(referer);
    return r.origin === new URL(current).origin ? r.pathname + r.search : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- public

export const publicPages = new Hono<AppEnv>();

publicPages.get("/", (c) => {
  if (c.var.user) return c.redirect("/app", 302);
  return renderPage(c, { title: "Welcome", body: <LandingPage appName={c.var.config.appName} /> });
});

publicPages.get("/login", (c) => {
  const returnTo = safeReturnTo(c.req.query("returnTo"));
  if (c.var.user) return c.redirect(returnTo, 302);
  return renderPage(c, { title: "Sign in", body: <LoginPage error={c.req.query("error")} returnTo={returnTo} /> });
});

// ---------------------------------------------------------------- app

export const appPages = new Hono<AuthedEnv>();
appPages.use("*", requireUser);

appPages.get("/", async (c) => {
  const projects = await svc.listProjects(c.env.DB, c.var.user);
  return renderPage(c, { title: "Projects", nav: "projects", body: <ProjectsPage projects={projects} /> });
});

appPages.post("/projects", (c) =>
  formAction(c, "/app", async () => {
    const form = await parseForm(c, ProjectInput);
    if (!form.ok) return redirectWith(c, "/app", "error", form.message);
    const project = await svc.createProject(c.env.DB, c.var.user, form.data);
    await audit(c, { action: "project.create", targetType: "project", targetId: project.id });
    return redirectWith(c, `/app/projects/${project.id}`, "success", "Project created");
  }),
);

appPages.get("/projects/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const status = ItemStatus.safeParse(c.req.query("status"));
  const filter = status.success ? status.data : undefined;
  const project = await svc.getProject(c.env.DB, c.var.user, projectId);
  const items = await svc.listItems(c.env.DB, c.var.user, projectId, { status: filter });
  return renderPage(c, { title: project.name, nav: "projects", body: <ProjectPage project={project} items={items} filter={filter} /> });
});

appPages.post("/projects/:projectId", (c) =>
  formAction(c, `/app/projects/${c.req.param("projectId")}/settings`, async () => {
    const projectId = c.req.param("projectId");
    const back = `/app/projects/${projectId}/settings`;
    const form = await parseForm(c, ProjectInput);
    if (!form.ok) return redirectWith(c, back, "error", form.message);
    await svc.updateProject(c.env.DB, c.var.user, projectId, form.data);
    return redirectWith(c, back, "success", "Project updated");
  }),
);

appPages.post("/projects/:projectId/delete", (c) =>
  formAction(c, "/app", async () => {
    const project = await svc.deleteProject(c.env.DB, c.var.user, c.req.param("projectId"));
    await audit(c, { action: "project.delete", targetType: "project", targetId: project.id, metadata: { name: project.name } });
    return redirectWith(c, "/app", "success", `Deleted "${project.name}"`);
  }),
);

appPages.get("/projects/:projectId/settings", async (c) => {
  const projectId = c.req.param("projectId");
  const project = await svc.getProject(c.env.DB, c.var.user, projectId);
  const members = await svc.listMembers(c.env.DB, c.var.user, projectId);
  return renderPage(c, {
    title: `${project.name} settings`,
    nav: "projects",
    body: <ProjectSettingsPage project={project} members={members} user={c.var.user} />,
  });
});

// members

appPages.post("/projects/:projectId/members", (c) =>
  formAction(c, `/app/projects/${c.req.param("projectId")}/settings`, async () => {
    const projectId = c.req.param("projectId");
    const back = `/app/projects/${projectId}/settings`;
    const form = await parseForm(c, MemberInput);
    if (!form.ok) return redirectWith(c, back, "error", form.message);
    const member = await svc.addMember(c.env.DB, c.var.user, projectId, form.data);
    await audit(c, { action: "project.member_add", targetType: "project", targetId: projectId, metadata: { userId: member.userId, role: member.role } });
    return redirectWith(c, back, "success", `Shared with ${member.email}`);
  }),
);

appPages.post("/projects/:projectId/members/:userId", (c) =>
  formAction(c, `/app/projects/${c.req.param("projectId")}/settings`, async () => {
    const { projectId, userId } = c.req.param();
    const back = `/app/projects/${projectId}/settings`;
    const form = await parseForm(c, MemberPatch);
    if (!form.ok) return redirectWith(c, back, "error", form.message);
    const member = await svc.updateMemberRole(c.env.DB, c.var.user, projectId, userId, form.data.role);
    await audit(c, { action: "project.member_role", targetType: "project", targetId: projectId, metadata: { userId, role: member.role } });
    return redirectWith(c, back, "success", `${member.email} is now ${member.role}`);
  }),
);

appPages.post("/projects/:projectId/members/:userId/remove", (c) =>
  formAction(c, `/app/projects/${c.req.param("projectId")}/settings`, async () => {
    const { projectId, userId } = c.req.param();
    await svc.removeMember(c.env.DB, c.var.user, projectId, userId);
    await audit(c, { action: "project.member_remove", targetType: "project", targetId: projectId, metadata: { userId } });
    if (userId === c.var.user.id) return redirectWith(c, "/app", "success", "You left the project");
    return redirectWith(c, `/app/projects/${projectId}/settings`, "success", "Member removed");
  }),
);

// items

const itemForm = (f: Record<string, string>) => ({ ...f, dueDate: emptyToNull(f.dueDate) });

appPages.post("/projects/:projectId/items", (c) =>
  formAction(c, `/app/projects/${c.req.param("projectId")}`, async () => {
    const projectId = c.req.param("projectId");
    const back = `/app/projects/${projectId}`;
    const form = await parseForm(c, ItemInput, itemForm);
    if (!form.ok) return redirectWith(c, back, "error", form.message);
    await svc.createItem(c.env.DB, c.var.user, projectId, form.data);
    return c.redirect(back, 303);
  }),
);

appPages.get("/projects/:projectId/items/:itemId", async (c) => {
  const { projectId, itemId } = c.req.param();
  const project = await svc.getProject(c.env.DB, c.var.user, projectId);
  const item = await svc.getItem(c.env.DB, c.var.user, projectId, itemId);
  return renderPage(c, { title: item.title, nav: "projects", body: <ItemPage project={project} item={item} /> });
});

appPages.post("/projects/:projectId/items/:itemId", (c) =>
  formAction(c, `/app/projects/${c.req.param("projectId")}`, async () => {
    const { projectId, itemId } = c.req.param();
    const form = await parseForm(c, ItemPatch, itemForm);
    if (!form.ok) return redirectWith(c, `/app/projects/${projectId}/items/${itemId}`, "error", form.message);
    await svc.updateItem(c.env.DB, c.var.user, projectId, itemId, form.data);
    return redirectWith(c, `/app/projects/${projectId}`, "success", "Item saved");
  }),
);

appPages.post("/projects/:projectId/items/:itemId/status", (c) =>
  formAction(c, `/app/projects/${c.req.param("projectId")}`, async () => {
    const { projectId, itemId } = c.req.param();
    const form = await parseForm(c, z.object({ status: ItemStatus }));
    if (!form.ok) return redirectWith(c, `/app/projects/${projectId}`, "error", form.message);
    await svc.updateItem(c.env.DB, c.var.user, projectId, itemId, form.data);
    const back = sameOriginReferer(c.req.header("referer"), c.req.url) ?? `/app/projects/${projectId}`;
    return c.redirect(back, 303);
  }),
);

appPages.post("/projects/:projectId/items/:itemId/delete", (c) =>
  formAction(c, `/app/projects/${c.req.param("projectId")}`, async () => {
    const { projectId, itemId } = c.req.param();
    await svc.deleteItem(c.env.DB, c.var.user, projectId, itemId);
    return redirectWith(c, `/app/projects/${projectId}`, "success", "Item deleted");
  }),
);

// account

appPages.get("/account", async (c) => {
  const sessions = (await listUserSessions(c.env.DB, c.var.user.id)).map((s) => toSessionDto(s, c.var.session.id));
  return renderPage(c, { title: "Account", nav: "account", body: <AccountPage user={c.var.user} sessions={sessions} /> });
});

appPages.post("/account/revoke-sessions", async (c) => {
  const revoked = await revokeUserSessions(c.env.DB, c.var.user.id, c.var.session.id);
  await audit(c, { action: "auth.revoke_other_sessions", metadata: { revoked } });
  return redirectWith(c, "/app/account", "success", `Signed out ${revoked} other ${revoked === 1 ? "session" : "sessions"}`);
});

// admin

appPages.use("/admin/*", requireAdmin);
appPages.use("/admin", requireAdmin);

appPages.get("/admin", async (c) => {
  const search = (c.req.query("q") ?? "").slice(0, 200);
  const [stats, { users, total }, events] = await Promise.all([
    getStats(c.env.DB),
    listUsers(c.env.DB, { search: search || undefined, limit: 100 }),
    listAuditEvents(c.env.DB, { limit: 50 }),
  ]);
  return renderPage(c, {
    title: "Admin",
    nav: "admin",
    body: <AdminPage stats={stats} users={users} total={total} search={search} events={events} currentUserId={c.var.user.id} />,
  });
});

const AdminUserForm = z.object({
  role: z.enum(["user", "admin"]).optional(),
  disabled: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

appPages.post("/admin/users/:userId", (c) =>
  formAction(c, "/app/admin", async () => {
    const userId = c.req.param("userId");
    const form = await parseForm(c, AdminUserForm);
    if (!form.ok) return redirectWith(c, "/app/admin", "error", form.message);
    const user = await adminUpdateUser(c.env.DB, c.var.user, userId, form.data);
    await audit(c, { action: "admin.user_update", targetType: "user", targetId: userId, metadata: form.data });
    return redirectWith(c, "/app/admin", "success", `Updated ${user.email}`);
  }),
);
