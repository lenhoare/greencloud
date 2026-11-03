import { z } from "@hono/zod-openapi";
import { toIso, toIsoOrNull } from "../../db/util";
import type { Session, User } from "../../types";

export const UserSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    avatarUrl: z.string().nullable(),
    role: z.enum(["user", "admin"]),
    disabled: z.boolean(),
    createdAt: z.string().datetime(),
    lastLoginAt: z.string().datetime().nullable(),
  })
  .openapi("User");
export type UserDto = z.infer<typeof UserSchema>;

export const toUserDto = (u: User): UserDto => ({
  id: u.id,
  email: u.email,
  name: u.name,
  avatarUrl: u.avatarUrl,
  role: u.role,
  disabled: u.disabledAt !== null,
  createdAt: toIso(u.createdAt),
  lastLoginAt: toIsoOrNull(u.lastLoginAt),
});

export const SessionSchema = z
  .object({
    id: z.string().describe("Opaque session id (a hash; not usable as a credential)"),
    current: z.boolean(),
    createdAt: z.string().datetime(),
    lastSeenAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
  })
  .openapi("Session");
export type SessionDto = z.infer<typeof SessionSchema>;

export const toSessionDto = (s: Session, currentId: string): SessionDto => ({
  // Only expose a prefix: enough to tell sessions apart in a UI.
  id: s.id.slice(0, 16),
  current: s.id === currentId,
  createdAt: toIso(s.createdAt),
  lastSeenAt: toIso(s.lastSeenAt),
  expiresAt: toIso(s.expiresAt),
  ip: s.ip,
  userAgent: s.userAgent,
});
