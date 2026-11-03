import { badRequest, notFound } from "../../lib/errors";
import type { User, UserRole } from "../../types";
import { revokeUserSessions } from "../auth/sessions";
import { updateUser } from "../users/repo";

/**
 * Admin operations on users. Admins cannot demote or disable themselves —
 * that's the easiest way to lock everyone out of the admin area.
 */
export async function adminUpdateUser(
  db: D1Database,
  actor: User,
  userId: string,
  patch: { role?: UserRole; disabled?: boolean },
): Promise<User> {
  if (userId === actor.id && (patch.role === "user" || patch.disabled === true)) {
    throw badRequest("You can't demote or disable your own account");
  }
  const user = await updateUser(db, userId, patch);
  if (!user) throw notFound("User not found");
  // Disabling takes effect immediately: kill all their sessions.
  if (patch.disabled) await revokeUserSessions(db, userId);
  return user;
}

export interface AdminStats {
  users: number;
  activeUsers7d: number;
  projects: number;
  items: number;
  activeSessions: number;
}

export async function getStats(db: D1Database): Promise<AdminStats> {
  const now = Date.now();
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM users WHERE last_login_at > ?1) AS active_users,
         (SELECT COUNT(*) FROM projects) AS projects,
         (SELECT COUNT(*) FROM items) AS items,
         (SELECT COUNT(*) FROM sessions WHERE expires_at > ?2) AS sessions`,
    )
    .bind(now - 7 * 24 * 60 * 60 * 1000, now)
    .first<{ users: number; active_users: number; projects: number; items: number; sessions: number }>();
  return {
    users: row?.users ?? 0,
    activeUsers7d: row?.active_users ?? 0,
    projects: row?.projects ?? 0,
    items: row?.items ?? 0,
    activeSessions: row?.sessions ?? 0,
  };
}
