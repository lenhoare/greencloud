import { z } from "@hono/zod-openapi";

/**
 * Zod schemas are the single source of truth for validation, TypeScript types
 * and OpenAPI docs. The web UI reuses the same input schemas for its forms.
 */

export const ProjectRole = z.enum(["owner", "editor", "viewer"]).openapi("ProjectRole");
export type ProjectRole = z.infer<typeof ProjectRole>;

export const ItemStatus = z.enum(["todo", "doing", "done"]).openapi("ItemStatus");
export type ItemStatus = z.infer<typeof ItemStatus>;

export const ProjectSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string(),
    role: ProjectRole.describe("The current user's role in this project"),
    itemCount: z.number().int(),
    openItemCount: z.number().int(),
    memberCount: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("Project");
export type ProjectDto = z.infer<typeof ProjectSchema>;

export const ProjectInput = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    description: z.string().trim().max(2000).default(""),
  })
  .openapi("ProjectInput");

export const ProjectPatch = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).optional(),
  })
  .openapi("ProjectPatch");

export const MemberSchema = z
  .object({
    userId: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    avatarUrl: z.string().nullable(),
    role: ProjectRole,
    addedAt: z.string().datetime(),
  })
  .openapi("ProjectMember");
export type MemberDto = z.infer<typeof MemberSchema>;

export const MemberInput = z
  .object({
    email: z.string().trim().toLowerCase().email("Enter a valid email address"),
    role: ProjectRole.default("editor"),
  })
  .openapi("MemberInput");

export const MemberPatch = z.object({ role: ProjectRole }).openapi("MemberPatch");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date");

export const ItemSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    title: z.string(),
    notes: z.string(),
    status: ItemStatus,
    dueDate: z.string().nullable(),
    createdBy: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("Item");
export type ItemDto = z.infer<typeof ItemSchema>;

export const ItemInput = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(300),
    notes: z.string().trim().max(10_000).default(""),
    status: ItemStatus.default("todo"),
    dueDate: isoDate.nullable().optional(),
  })
  .openapi("ItemInput");

export const ItemPatch = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    notes: z.string().trim().max(10_000).optional(),
    status: ItemStatus.optional(),
    dueDate: isoDate.nullable().optional(),
  })
  .openapi("ItemPatch");
