import { createRoute, z } from "@hono/zod-openapi";
import { toIso } from "../../db/util";
import { cookieAuth, createApiRouter, errorResponses, jsonBody, jsonResponse } from "../../lib/openapi";
import type { AuthedEnv } from "../../types";
import { audit, listAuditEvents } from "../audit/repo";
import { listUsers } from "../users/repo";
import { toUserDto, UserSchema } from "../users/schemas";
import { adminUpdateUser, getStats } from "./service";

/** Admin-only endpoints. Mounted at /api/v1/admin behind requireAdmin. */
export const adminApi = createApiRouter<AuthedEnv>();
const tags = ["Admin"];

const Pagination = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

adminApi.openapi(
  createRoute({
    method: "get",
    path: "/stats",
    tags,
    security: cookieAuth,
    summary: "Usage statistics",
    responses: {
      200: jsonResponse(
        z.object({
          users: z.number().int(),
          activeUsers7d: z.number().int(),
          projects: z.number().int(),
          items: z.number().int(),
          activeSessions: z.number().int(),
        }),
        "Stats",
      ),
      ...errorResponses,
    },
  }),
  async (c) => c.json(await getStats(c.env.DB), 200),
);

adminApi.openapi(
  createRoute({
    method: "get",
    path: "/users",
    tags,
    security: cookieAuth,
    summary: "List users",
    request: { query: Pagination.extend({ search: z.string().max(200).optional() }) },
    responses: {
      200: jsonResponse(z.object({ users: z.array(UserSchema), total: z.number().int() }), "Users"),
      ...errorResponses,
    },
  }),
  async (c) => {
    const { users, total } = await listUsers(c.env.DB, c.req.valid("query"));
    return c.json({ users: users.map(toUserDto), total }, 200);
  },
);

adminApi.openapi(
  createRoute({
    method: "patch",
    path: "/users/{userId}",
    tags,
    security: cookieAuth,
    summary: "Change a user's role or disable/enable them",
    request: {
      params: z.object({ userId: z.string().uuid().openapi({ param: { name: "userId", in: "path" } }) }),
      body: jsonBody(
        z.object({ role: z.enum(["user", "admin"]).optional(), disabled: z.boolean().optional() }).openapi("AdminUserPatch"),
      ),
    },
    responses: { 200: jsonResponse(UserSchema, "Updated user"), ...errorResponses },
  }),
  async (c) => {
    const { userId } = c.req.valid("param");
    const patch = c.req.valid("json");
    const user = await adminUpdateUser(c.env.DB, c.var.user, userId, patch);
    await audit(c, { action: "admin.user_update", targetType: "user", targetId: userId, metadata: patch });
    return c.json(toUserDto(user), 200);
  },
);

const AuditEventSchema = z
  .object({
    id: z.string(),
    actorId: z.string().nullable(),
    actorEmail: z.string().nullable(),
    action: z.string(),
    targetType: z.string().nullable(),
    targetId: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    ip: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi("AuditEvent");

adminApi.openapi(
  createRoute({
    method: "get",
    path: "/audit",
    tags,
    security: cookieAuth,
    summary: "Audit log, newest first",
    request: {
      query: Pagination.extend({
        actorId: z.string().uuid().optional(),
        action: z.string().max(100).optional().describe("Action prefix, e.g. `auth.` or `project.delete`"),
      }),
    },
    responses: { 200: jsonResponse(z.object({ events: z.array(AuditEventSchema) }), "Audit events"), ...errorResponses },
  }),
  async (c) => {
    const events = await listAuditEvents(c.env.DB, c.req.valid("query"));
    return c.json({ events: events.map((e) => ({ ...e, createdAt: toIso(e.createdAt) })) }, 200);
  },
);
