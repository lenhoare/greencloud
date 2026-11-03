import { likePattern, newId, now, page } from "../../db/util";
import type { User, UserRole } from "../../types";
import type { GoogleIdentity } from "../auth/google";

interface UserRow {
  id: string;
  google_sub: string;
  email: string;
  name: string;
  avatar_url: string | null;
  role: UserRole;
  disabled_at: number | null;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
}

export const USER_COLUMNS =
  "id, google_sub, email, name, avatar_url, role, disabled_at, created_at, updated_at, last_login_at";

export function mapUser(r: UserRow): User {
  return {
    id: r.id,
    googleSub: r.google_sub,
    email: r.email,
    name: r.name,
    avatarUrl: r.avatar_url,
    role: r.role,
    disabledAt: r.disabled_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastLoginAt: r.last_login_at,
  };
}

/**
 * Create or update the user for a Google identity at login.
 * Users are keyed on Google's stable `sub`, not email (emails can change).
 * Admin promotion via ADMIN_EMAILS is one-way: removing someone from the list
 * doesn't demote them; do that in the admin UI.
 */
export async function upsertUserFromGoogle(db: D1Database, identity: GoogleIdentity, promoteToAdmin: boolean): Promise<User> {
  const ts = now();
  const row = await db
    .prepare(
      `INSERT INTO users (id, google_sub, email, name, avatar_url, role, created_at, updated_at, last_login_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?7)
       ON CONFLICT (google_sub) DO UPDATE SET
         email = excluded.email,
         name = excluded.name,
         avatar_url = excluded.avatar_url,
         role = CASE WHEN ?8 THEN 'admin' ELSE users.role END,
         updated_at = excluded.updated_at,
         last_login_at = excluded.last_login_at
       RETURNING ${USER_COLUMNS}`,
    )
    .bind(
      newId(),
      identity.sub,
      identity.email,
      identity.name,
      identity.picture,
      promoteToAdmin ? "admin" : "user",
      ts,
      promoteToAdmin ? 1 : 0,
    )
    .first<UserRow>();
  if (!row) throw new Error("upsert returned no row");
  return mapUser(row);
}

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
  const row = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(id).first<UserRow>();
  return row ? mapUser(row) : null;
}

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  const row = await db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ? COLLATE NOCASE`)
    .bind(email.trim())
    .first<UserRow>();
  return row ? mapUser(row) : null;
}

export async function listUsers(
  db: D1Database,
  opts: { search?: string; limit?: number; offset?: number } = {},
): Promise<{ users: User[]; total: number }> {
  const { limit, offset } = page(opts.limit, opts.offset);
  const where = opts.search ? "WHERE email LIKE ?1 ESCAPE '\\' OR name LIKE ?1 ESCAPE '\\'" : "";
  const args = opts.search ? [likePattern(opts.search)] : [];
  const [rows, count] = await db.batch([
    db
      .prepare(`SELECT ${USER_COLUMNS} FROM users ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`)
      .bind(...args),
    db.prepare(`SELECT COUNT(*) AS n FROM users ${where}`).bind(...args),
  ]);
  return {
    users: (rows!.results as UserRow[]).map(mapUser),
    total: (count!.results[0] as { n: number }).n,
  };
}

export async function updateUser(
  db: D1Database,
  id: string,
  patch: { role?: UserRole; disabled?: boolean },
): Promise<User | null> {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.role) {
    sets.push("role = ?");
    args.push(patch.role);
  }
  if (patch.disabled !== undefined) {
    sets.push("disabled_at = ?");
    args.push(patch.disabled ? now() : null);
  }
  if (sets.length === 0) return getUserById(db, id);
  sets.push("updated_at = ?");
  args.push(now(), id);
  const row = await db
    .prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ? RETURNING ${USER_COLUMNS}`)
    .bind(...args)
    .first<UserRow>();
  return row ? mapUser(row) : null;
}
