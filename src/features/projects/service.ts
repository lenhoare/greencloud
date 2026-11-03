import { newId, now, toIso } from "../../db/util";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors";
import type { User } from "../../types";
import { getUserByEmail } from "../users/repo";
import type { ItemDto, ItemStatus, MemberDto, ProjectDto, ProjectRole } from "./schemas";

/**
 * Projects service: all business rules and authorization for projects,
 * members and items live here, so the JSON API and the web UI behave
 * identically. Handlers stay thin: validate input → call service → render.
 *
 * Authorization model:
 *   viewer  – read the project and its items
 *   editor  – viewer + create/edit/delete items, edit project details
 *   owner   – editor + manage members, delete the project
 * Non-members get 404 (not 403) so project ids can't be probed.
 */

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, editor: 2, owner: 3 };

export function can(role: ProjectRole, minimum: ProjectRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  created_at: number;
  updated_at: number;
  role: ProjectRole;
  item_count: number;
  open_item_count: number;
  member_count: number;
}

const PROJECT_SELECT = `
  SELECT p.id, p.name, p.description, p.created_at, p.updated_at, m.role,
    (SELECT COUNT(*) FROM items i WHERE i.project_id = p.id) AS item_count,
    (SELECT COUNT(*) FROM items i WHERE i.project_id = p.id AND i.status != 'done') AS open_item_count,
    (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count
  FROM projects p JOIN project_members m ON m.project_id = p.id AND m.user_id = ?1`;

function mapProject(r: ProjectRow): ProjectDto {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    role: r.role,
    itemCount: r.item_count,
    openItemCount: r.open_item_count,
    memberCount: r.member_count,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

export async function listProjects(db: D1Database, user: User): Promise<ProjectDto[]> {
  const { results } = await db.prepare(`${PROJECT_SELECT} ORDER BY p.updated_at DESC`).bind(user.id).all<ProjectRow>();
  return results.map(mapProject);
}

/** Load a project the user belongs to, enforcing a minimum role. */
export async function getProject(
  db: D1Database,
  user: User,
  projectId: string,
  minimum: ProjectRole = "viewer",
): Promise<ProjectDto> {
  const row = await db.prepare(`${PROJECT_SELECT} WHERE p.id = ?2`).bind(user.id, projectId).first<ProjectRow>();
  if (!row) throw notFound("Project not found");
  if (!can(row.role, minimum)) throw forbidden(`This action requires the ${minimum} role`);
  return mapProject(row);
}

export async function createProject(db: D1Database, user: User, input: { name: string; description: string }): Promise<ProjectDto> {
  const id = newId();
  const ts = now();
  // batch() runs as a single transaction: both rows or neither.
  await db.batch([
    db
      .prepare("INSERT INTO projects (id, name, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, input.name, input.description, user.id, ts, ts),
    db
      .prepare("INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)")
      .bind(id, user.id, ts),
  ]);
  return getProject(db, user, id);
}

export async function updateProject(
  db: D1Database,
  user: User,
  projectId: string,
  patch: { name?: string; description?: string },
): Promise<ProjectDto> {
  await getProject(db, user, projectId, "editor");
  await db
    .prepare(
      "UPDATE projects SET name = COALESCE(?, name), description = COALESCE(?, description), updated_at = ? WHERE id = ?",
    )
    .bind(patch.name ?? null, patch.description ?? null, now(), projectId)
    .run();
  return getProject(db, user, projectId);
}

export async function deleteProject(db: D1Database, user: User, projectId: string): Promise<ProjectDto> {
  const project = await getProject(db, user, projectId, "owner");
  await db.prepare("DELETE FROM projects WHERE id = ?").bind(projectId).run(); // cascades to members & items
  return project;
}

// ---------------------------------------------------------------- members

interface MemberRow {
  user_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  role: ProjectRole;
  created_at: number;
}

export async function listMembers(db: D1Database, user: User, projectId: string): Promise<MemberDto[]> {
  await getProject(db, user, projectId);
  const { results } = await db
    .prepare(
      `SELECT m.user_id, u.email, u.name, u.avatar_url, m.role, m.created_at
       FROM project_members m JOIN users u ON u.id = m.user_id
       WHERE m.project_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.email`,
    )
    .bind(projectId)
    .all<MemberRow>();
  return results.map((r) => ({
    userId: r.user_id,
    email: r.email,
    name: r.name,
    avatarUrl: r.avatar_url,
    role: r.role,
    addedAt: toIso(r.created_at),
  }));
}

/**
 * Share a project with an existing user. The person must have signed in at
 * least once (so we know their account). Pending email invites are a natural
 * extension: store them in an `invites` table and claim them at login.
 */
export async function addMember(
  db: D1Database,
  user: User,
  projectId: string,
  input: { email: string; role: ProjectRole },
): Promise<MemberDto> {
  await getProject(db, user, projectId, "owner");
  const target = await getUserByEmail(db, input.email);
  if (!target || target.disabledAt) {
    throw notFound("No user with that email has signed in yet. Ask them to sign in once, then share again.");
  }
  const res = await db
    .prepare(
      "INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
    )
    .bind(projectId, target.id, input.role, now())
    .run();
  if (res.meta.changes === 0) throw conflict(`${target.email} is already a member`);
  const members = await listMembers(db, user, projectId);
  return members.find((m) => m.userId === target.id)!;
}

export async function updateMemberRole(
  db: D1Database,
  user: User,
  projectId: string,
  memberId: string,
  role: ProjectRole,
): Promise<MemberDto> {
  await getProject(db, user, projectId, "owner");
  const members = await listMembers(db, user, projectId);
  const member = members.find((m) => m.userId === memberId);
  if (!member) throw notFound("Member not found");
  if (member.role === "owner" && role !== "owner") assertAnotherOwner(members, memberId);
  await db
    .prepare("UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?")
    .bind(role, projectId, memberId)
    .run();
  return { ...member, role };
}

/** Owners can remove anyone; any member can remove themselves (leave). */
export async function removeMember(db: D1Database, user: User, projectId: string, memberId: string): Promise<void> {
  const project = await getProject(db, user, projectId);
  if (memberId !== user.id && project.role !== "owner") throw forbidden("Only owners can remove other members");
  const members = await listMembers(db, user, projectId);
  const member = members.find((m) => m.userId === memberId);
  if (!member) throw notFound("Member not found");
  if (member.role === "owner") assertAnotherOwner(members, memberId);
  await db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").bind(projectId, memberId).run();
}

function assertAnotherOwner(members: MemberDto[], leavingId: string) {
  if (!members.some((m) => m.role === "owner" && m.userId !== leavingId)) {
    throw badRequest("A project must keep at least one owner. Make someone else an owner first, or delete the project.");
  }
}

// ------------------------------------------------------------------ items

interface ItemRow {
  id: string;
  project_id: string;
  title: string;
  notes: string;
  status: ItemStatus;
  due_date: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

function mapItem(r: ItemRow): ItemDto {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    notes: r.notes,
    status: r.status,
    dueDate: r.due_date,
    createdBy: r.created_by,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

export async function listItems(
  db: D1Database,
  user: User,
  projectId: string,
  filter: { status?: ItemStatus } = {},
): Promise<ItemDto[]> {
  await getProject(db, user, projectId);
  const { results } = await db
    .prepare(
      `SELECT * FROM items WHERE project_id = ?1 AND (?2 IS NULL OR status = ?2)
       ORDER BY CASE status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
                due_date IS NULL, due_date, created_at DESC
       LIMIT 500`,
    )
    .bind(projectId, filter.status ?? null)
    .all<ItemRow>();
  return results.map(mapItem);
}

async function getItemRow(db: D1Database, projectId: string, itemId: string): Promise<ItemRow> {
  const row = await db.prepare("SELECT * FROM items WHERE id = ? AND project_id = ?").bind(itemId, projectId).first<ItemRow>();
  if (!row) throw notFound("Item not found");
  return row;
}

export async function getItem(db: D1Database, user: User, projectId: string, itemId: string): Promise<ItemDto> {
  await getProject(db, user, projectId);
  return mapItem(await getItemRow(db, projectId, itemId));
}

export async function createItem(
  db: D1Database,
  user: User,
  projectId: string,
  input: { title: string; notes: string; status: ItemStatus; dueDate?: string | null },
): Promise<ItemDto> {
  await getProject(db, user, projectId, "editor");
  const ts = now();
  const [row] = await db.batch<ItemRow>([
    db
      .prepare(
        `INSERT INTO items (id, project_id, title, notes, status, due_date, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .bind(newId(), projectId, input.title, input.notes, input.status, input.dueDate ?? null, user.id, ts, ts),
    touchProject(db, projectId, ts),
  ]);
  return mapItem(row!.results[0]!);
}

export async function updateItem(
  db: D1Database,
  user: User,
  projectId: string,
  itemId: string,
  patch: { title?: string; notes?: string; status?: ItemStatus; dueDate?: string | null },
): Promise<ItemDto> {
  await getProject(db, user, projectId, "editor");
  const current = await getItemRow(db, projectId, itemId);
  const ts = now();
  const [row] = await db.batch<ItemRow>([
    db
      .prepare(
        "UPDATE items SET title = ?, notes = ?, status = ?, due_date = ?, updated_at = ? WHERE id = ? RETURNING *",
      )
      .bind(
        patch.title ?? current.title,
        patch.notes ?? current.notes,
        patch.status ?? current.status,
        patch.dueDate === undefined ? current.due_date : patch.dueDate,
        ts,
        itemId,
      ),
    touchProject(db, projectId, ts),
  ]);
  return mapItem(row!.results[0]!);
}

export async function deleteItem(db: D1Database, user: User, projectId: string, itemId: string): Promise<void> {
  await getProject(db, user, projectId, "editor");
  await getItemRow(db, projectId, itemId);
  await db.batch([db.prepare("DELETE FROM items WHERE id = ?").bind(itemId), touchProject(db, projectId, now())]);
}

const touchProject = (db: D1Database, projectId: string, ts: number) =>
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").bind(ts, projectId);
