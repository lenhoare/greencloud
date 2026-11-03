import { createRoute, z } from "@hono/zod-openapi";
import { cookieAuth, createApiRouter, errorResponses, jsonResponse } from "../../lib/openapi";
import type { AuthedEnv } from "../../types";
import { audit } from "../audit/repo";
import { listUserSessions, revokeUserSessions } from "../auth/sessions";
import { SessionSchema, toSessionDto, toUserDto, UserSchema } from "./schemas";

/** The signed-in user's own account. Mounted at /api/v1/me. */
export const meApi = createApiRouter<AuthedEnv>();
const tags = ["Account"];

meApi.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags,
    security: cookieAuth,
    summary: "The currently signed-in user",
    responses: { 200: jsonResponse(UserSchema, "Current user"), ...errorResponses },
  }),
  (c) => c.json(toUserDto(c.var.user), 200),
);

meApi.openapi(
  createRoute({
    method: "get",
    path: "/sessions",
    tags,
    security: cookieAuth,
    summary: "Your active sessions (signed-in browsers/devices)",
    responses: { 200: jsonResponse(z.object({ sessions: z.array(SessionSchema) }), "Sessions"), ...errorResponses },
  }),
  async (c) => {
    const sessions = await listUserSessions(c.env.DB, c.var.user.id);
    return c.json({ sessions: sessions.map((s) => toSessionDto(s, c.var.session.id)) }, 200);
  },
);

meApi.openapi(
  createRoute({
    method: "post",
    path: "/sessions/revoke-others",
    tags,
    security: cookieAuth,
    summary: "Sign out everywhere except this session",
    responses: { 200: jsonResponse(z.object({ revoked: z.number().int() }), "Number of sessions revoked"), ...errorResponses },
  }),
  async (c) => {
    const revoked = await revokeUserSessions(c.env.DB, c.var.user.id, c.var.session.id);
    await audit(c, { action: "auth.revoke_other_sessions", metadata: { revoked } });
    return c.json({ revoked }, 200);
  },
);
