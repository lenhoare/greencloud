import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomToken, sha256Hex } from "../../lib/crypto";
import { now } from "../../db/util";
import type { AppEnv, Session, User } from "../../types";
import { mapUser, USER_COLUMNS } from "../users/repo";

/**
 * Server-side sessions stored in D1.
 *
 * Design notes:
 * - The cookie holds a random 256-bit token. The database stores only
 *   SHA-256(token) as the session id, so leaked DB rows can't be replayed.
 * - Sessions are opaque and revocable (logout, "sign out everywhere", admin
 *   disabling a user all take effect immediately) — the main advantage over
 *   stateless JWT cookies.
 * - Expiry is sliding: activity extends it, but we only write to the DB when
 *   the session was last touched more than TOUCH_INTERVAL ago, so a busy user
 *   costs ~1 write per hour rather than one per request.
 */

const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Cookie name. On HTTPS we use the `__Host-` prefix, which browsers only
 * accept with Secure, Path=/ and no Domain — guaranteeing the cookie can't be
 * set or overwritten by a subdomain. Plain-HTTP local dev can't use it.
 */
export function sessionCookieName(c: Context): string {
  return isSecure(c) ? "__Host-gc_session" : "gc_session";
}

export function isSecure(c: Context): boolean {
  return new URL(c.req.url).protocol === "https:";
}

interface SessionUserRow {
  s_id: string;
  s_user_id: string;
  s_created_at: number;
  s_expires_at: number;
  s_last_seen_at: number;
  s_ip: string | null;
  s_user_agent: string | null;
}

function mapSession(r: SessionUserRow): Session {
  return {
    id: r.s_id,
    userId: r.s_user_id,
    createdAt: r.s_created_at,
    expiresAt: r.s_expires_at,
    lastSeenAt: r.s_last_seen_at,
    ip: r.s_ip,
    userAgent: r.s_user_agent,
  };
}

export async function createSession(c: Context<AppEnv>, user: User): Promise<Session> {
  const token = randomToken();
  const ts = now();
  const session: Session = {
    id: await sha256Hex(token),
    userId: user.id,
    createdAt: ts,
    expiresAt: ts + c.var.config.sessionTtlMs,
    lastSeenAt: ts,
    ip: c.req.header("cf-connecting-ip") ?? null,
    userAgent: c.req.header("user-agent")?.slice(0, 512) ?? null,
  };
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(session.id, session.userId, session.createdAt, session.expiresAt, session.lastSeenAt, session.ip, session.userAgent)
    .run();

  setCookie(c, sessionCookieName(c), token, {
    httpOnly: true, // not readable from JS, so XSS can't exfiltrate it
    secure: isSecure(c),
    // Lax: sent on top-level navigations (so following a link into the app
    // keeps you signed in) but not on cross-site POSTs/fetches — this is our
    // first line of CSRF defence; hono/csrf origin checks are the second.
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(c.var.config.sessionTtlMs / 1000),
  });
  return session;
}

/** Resolve the session cookie to an active session + enabled user, or null. */
export async function loadSession(c: Context<AppEnv>): Promise<{ session: Session; user: User } | null> {
  const token = getCookie(c, sessionCookieName(c));
  if (!token || token.length > 128) return null;

  const id = await sha256Hex(token);
  const ts = now();
  const row = await c.env.DB.prepare(
    `SELECT s.id AS s_id, s.user_id AS s_user_id, s.created_at AS s_created_at, s.expires_at AS s_expires_at,
            s.last_seen_at AS s_last_seen_at, s.ip AS s_ip, s.user_agent AS s_user_agent,
            ${USER_COLUMNS.split(", ").map((col) => `u.${col}`).join(", ")}
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ? AND u.disabled_at IS NULL`,
  )
    .bind(id, ts)
    .first<SessionUserRow & Parameters<typeof mapUser>[0]>();
  if (!row) return null;

  const session = mapSession(row);
  const user = mapUser(row);

  if (ts - session.lastSeenAt > TOUCH_INTERVAL_MS) {
    session.lastSeenAt = ts;
    session.expiresAt = ts + c.var.config.sessionTtlMs;
    await c.env.DB.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?")
      .bind(session.lastSeenAt, session.expiresAt, session.id)
      .run();
    // Re-issue the cookie so the browser-side expiry slides too.
    setCookie(c, sessionCookieName(c), token, {
      httpOnly: true,
      secure: isSecure(c),
      sameSite: "Lax",
      path: "/",
      maxAge: Math.floor(c.var.config.sessionTtlMs / 1000),
    });
  }
  return { session, user };
}

export async function destroySession(c: Context<AppEnv>, sessionId: string | undefined): Promise<void> {
  if (sessionId) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
  deleteCookie(c, sessionCookieName(c), { path: "/", secure: isSecure(c) });
}

export async function listUserSessions(db: D1Database, userId: string): Promise<Session[]> {
  const { results } = await db
    .prepare(
      `SELECT id AS s_id, user_id AS s_user_id, created_at AS s_created_at, expires_at AS s_expires_at,
              last_seen_at AS s_last_seen_at, ip AS s_ip, user_agent AS s_user_agent
       FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC`,
    )
    .bind(userId, now())
    .all<SessionUserRow>();
  return results.map(mapSession);
}

/** Revoke all of a user's sessions, optionally keeping one (the current one). */
export async function revokeUserSessions(db: D1Database, userId: string, exceptSessionId?: string): Promise<number> {
  const res = await db
    .prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?")
    .bind(userId, exceptSessionId ?? "")
    .run();
  return res.meta.changes;
}

export async function deleteExpiredSessions(db: D1Database): Promise<number> {
  const res = await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now()).run();
  return res.meta.changes;
}
