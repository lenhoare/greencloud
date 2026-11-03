import { newId, now, page } from "../../db/util";
import type { AnyContext } from "../../types";

/**
 * Audit log for security-relevant and admin actions.
 *
 * Action names are dotted and grouped by area, e.g.
 * `auth.login`, `project.member_add`, `admin.user_update`.
 */
export interface AuditEvent {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: number;
}

export interface AuditInput {
  action: string;
  actorId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Record an audit event. Failures are logged, never thrown: an audit hiccup
 * shouldn't fail the user's request. (If you need strict auditing, include the
 * insert in the same `db.batch()` as the change it describes.)
 */
export async function audit(c: AnyContext, input: AuditInput): Promise<void> {
  try {
    await c.env.DB.prepare(
      `INSERT INTO audit_events (id, actor_id, action, target_type, target_id, metadata, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        newId(),
        input.actorId === undefined ? (c.var.user?.id ?? null) : input.actorId,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        c.req.header("cf-connecting-ip") ?? null,
        now(),
      )
      .run();
  } catch (err) {
    c.var.logger.error("audit write failed", { err, action: input.action });
  }
}

interface AuditRow {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: string | null;
  ip: string | null;
  created_at: number;
}

export async function listAuditEvents(
  db: D1Database,
  opts: { actorId?: string; action?: string; limit?: number; offset?: number } = {},
): Promise<AuditEvent[]> {
  const { limit, offset } = page(opts.limit, opts.offset, 200);
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.actorId) {
    where.push("a.actor_id = ?");
    args.push(opts.actorId);
  }
  if (opts.action) {
    where.push("a.action LIKE ?");
    args.push(`${opts.action.replace(/[%_\\]/g, "")}%`);
  }
  const { results } = await db
    .prepare(
      `SELECT a.*, u.email AS actor_email FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    )
    .bind(...args)
    .all<AuditRow>();
  return results.map((r) => ({
    id: r.id,
    actorId: r.actor_id,
    actorEmail: r.actor_email,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : null,
    ip: r.ip,
    createdAt: r.created_at,
  }));
}

export async function pruneAuditEvents(db: D1Database, retentionMs: number): Promise<number> {
  const res = await db.prepare("DELETE FROM audit_events WHERE created_at < ?").bind(now() - retentionMs).run();
  return res.meta.changes;
}
