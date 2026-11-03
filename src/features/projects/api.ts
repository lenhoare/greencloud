import { createRoute, z } from "@hono/zod-openapi";
import { cookieAuth, createApiRouter, errorResponses, jsonBody, jsonResponse } from "../../lib/openapi";
import type { AuthedEnv } from "../../types";
import { audit } from "../audit/repo";
import {
  ItemInput,
  ItemPatch,
  ItemSchema,
  ItemStatus,
  MemberInput,
  MemberPatch,
  MemberSchema,
  ProjectInput,
  ProjectPatch,
  ProjectSchema,
} from "./schemas";
import * as svc from "./service";

/**
 * JSON API for projects, members and items. Mounted at /api/v1/projects.
 *
 * Pattern for adding a feature: define schemas (schemas.ts), business logic
 * (service.ts), then routes like these. Each route definition doubles as
 * OpenAPI documentation, served at /api/openapi.json and /api/docs.
 */
export const projectsApi = createApiRouter<AuthedEnv>();

const tags = ["Projects"];
const ProjectParams = z.object({
  projectId: z.string().uuid().openapi({ param: { name: "projectId", in: "path" } }),
});
const ItemParams = ProjectParams.extend({
  itemId: z.string().uuid().openapi({ param: { name: "itemId", in: "path" } }),
});
const MemberParams = ProjectParams.extend({
  userId: z.string().uuid().openapi({ param: { name: "userId", in: "path" } }),
});

// ------------------------------------------------------------- projects

projectsApi.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags,
    security: cookieAuth,
    summary: "List projects you belong to",
    responses: { 200: jsonResponse(z.object({ projects: z.array(ProjectSchema) }), "Projects"), ...errorResponses },
  }),
  async (c) => c.json({ projects: await svc.listProjects(c.env.DB, c.var.user) }, 200),
);

projectsApi.openapi(
  createRoute({
    method: "post",
    path: "/",
    tags,
    security: cookieAuth,
    summary: "Create a project (you become its owner)",
    request: { body: jsonBody(ProjectInput) },
    responses: { 201: jsonResponse(ProjectSchema, "Created project"), ...errorResponses },
  }),
  async (c) => {
    const project = await svc.createProject(c.env.DB, c.var.user, c.req.valid("json"));
    await audit(c, { action: "project.create", targetType: "project", targetId: project.id });
    return c.json(project, 201);
  },
);

projectsApi.openapi(
  createRoute({
    method: "get",
    path: "/{projectId}",
    tags,
    security: cookieAuth,
    summary: "Get a project",
    request: { params: ProjectParams },
    responses: { 200: jsonResponse(ProjectSchema, "Project"), ...errorResponses },
  }),
  async (c) => c.json(await svc.getProject(c.env.DB, c.var.user, c.req.valid("param").projectId), 200),
);

projectsApi.openapi(
  createRoute({
    method: "patch",
    path: "/{projectId}",
    tags,
    security: cookieAuth,
    summary: "Update a project (editor+)",
    request: { params: ProjectParams, body: jsonBody(ProjectPatch) },
    responses: { 200: jsonResponse(ProjectSchema, "Updated project"), ...errorResponses },
  }),
  async (c) =>
    c.json(await svc.updateProject(c.env.DB, c.var.user, c.req.valid("param").projectId, c.req.valid("json")), 200),
);

projectsApi.openapi(
  createRoute({
    method: "delete",
    path: "/{projectId}",
    tags,
    security: cookieAuth,
    summary: "Delete a project and everything in it (owner)",
    request: { params: ProjectParams },
    responses: { 204: { description: "Deleted" }, ...errorResponses },
  }),
  async (c) => {
    const project = await svc.deleteProject(c.env.DB, c.var.user, c.req.valid("param").projectId);
    await audit(c, { action: "project.delete", targetType: "project", targetId: project.id, metadata: { name: project.name } });
    return c.body(null, 204);
  },
);

// -------------------------------------------------------------- members

projectsApi.openapi(
  createRoute({
    method: "get",
    path: "/{projectId}/members",
    tags,
    security: cookieAuth,
    summary: "List project members",
    request: { params: ProjectParams },
    responses: { 200: jsonResponse(z.object({ members: z.array(MemberSchema) }), "Members"), ...errorResponses },
  }),
  async (c) => c.json({ members: await svc.listMembers(c.env.DB, c.var.user, c.req.valid("param").projectId) }, 200),
);

projectsApi.openapi(
  createRoute({
    method: "post",
    path: "/{projectId}/members",
    tags,
    security: cookieAuth,
    summary: "Share the project with another user (owner)",
    request: { params: ProjectParams, body: jsonBody(MemberInput) },
    responses: { 201: jsonResponse(MemberSchema, "Added member"), ...errorResponses },
  }),
  async (c) => {
    const { projectId } = c.req.valid("param");
    const member = await svc.addMember(c.env.DB, c.var.user, projectId, c.req.valid("json"));
    await audit(c, {
      action: "project.member_add",
      targetType: "project",
      targetId: projectId,
      metadata: { userId: member.userId, role: member.role },
    });
    return c.json(member, 201);
  },
);

projectsApi.openapi(
  createRoute({
    method: "patch",
    path: "/{projectId}/members/{userId}",
    tags,
    security: cookieAuth,
    summary: "Change a member's role (owner)",
    request: { params: MemberParams, body: jsonBody(MemberPatch) },
    responses: { 200: jsonResponse(MemberSchema, "Updated member"), ...errorResponses },
  }),
  async (c) => {
    const { projectId, userId } = c.req.valid("param");
    const member = await svc.updateMemberRole(c.env.DB, c.var.user, projectId, userId, c.req.valid("json").role);
    await audit(c, { action: "project.member_role", targetType: "project", targetId: projectId, metadata: { userId, role: member.role } });
    return c.json(member, 200);
  },
);

projectsApi.openapi(
  createRoute({
    method: "delete",
    path: "/{projectId}/members/{userId}",
    tags,
    security: cookieAuth,
    summary: "Remove a member (owner), or leave the project (yourself)",
    request: { params: MemberParams },
    responses: { 204: { description: "Removed" }, ...errorResponses },
  }),
  async (c) => {
    const { projectId, userId } = c.req.valid("param");
    await svc.removeMember(c.env.DB, c.var.user, projectId, userId);
    await audit(c, { action: "project.member_remove", targetType: "project", targetId: projectId, metadata: { userId } });
    return c.body(null, 204);
  },
);

// ---------------------------------------------------------------- items

projectsApi.openapi(
  createRoute({
    method: "get",
    path: "/{projectId}/items",
    tags: ["Items"],
    security: cookieAuth,
    summary: "List items in a project",
    request: { params: ProjectParams, query: z.object({ status: ItemStatus.optional() }) },
    responses: { 200: jsonResponse(z.object({ items: z.array(ItemSchema) }), "Items"), ...errorResponses },
  }),
  async (c) =>
    c.json({ items: await svc.listItems(c.env.DB, c.var.user, c.req.valid("param").projectId, c.req.valid("query")) }, 200),
);

projectsApi.openapi(
  createRoute({
    method: "post",
    path: "/{projectId}/items",
    tags: ["Items"],
    security: cookieAuth,
    summary: "Create an item (editor+)",
    request: { params: ProjectParams, body: jsonBody(ItemInput) },
    responses: { 201: jsonResponse(ItemSchema, "Created item"), ...errorResponses },
  }),
  async (c) => c.json(await svc.createItem(c.env.DB, c.var.user, c.req.valid("param").projectId, c.req.valid("json")), 201),
);

projectsApi.openapi(
  createRoute({
    method: "get",
    path: "/{projectId}/items/{itemId}",
    tags: ["Items"],
    security: cookieAuth,
    summary: "Get an item",
    request: { params: ItemParams },
    responses: { 200: jsonResponse(ItemSchema, "Item"), ...errorResponses },
  }),
  async (c) => {
    const { projectId, itemId } = c.req.valid("param");
    return c.json(await svc.getItem(c.env.DB, c.var.user, projectId, itemId), 200);
  },
);

projectsApi.openapi(
  createRoute({
    method: "patch",
    path: "/{projectId}/items/{itemId}",
    tags: ["Items"],
    security: cookieAuth,
    summary: "Update an item (editor+)",
    request: { params: ItemParams, body: jsonBody(ItemPatch) },
    responses: { 200: jsonResponse(ItemSchema, "Updated item"), ...errorResponses },
  }),
  async (c) => {
    const { projectId, itemId } = c.req.valid("param");
    return c.json(await svc.updateItem(c.env.DB, c.var.user, projectId, itemId, c.req.valid("json")), 200);
  },
);

projectsApi.openapi(
  createRoute({
    method: "delete",
    path: "/{projectId}/items/{itemId}",
    tags: ["Items"],
    security: cookieAuth,
    summary: "Delete an item (editor+)",
    request: { params: ItemParams },
    responses: { 204: { description: "Deleted" }, ...errorResponses },
  }),
  async (c) => {
    const { projectId, itemId } = c.req.valid("param");
    await svc.deleteItem(c.env.DB, c.var.user, projectId, itemId);
    return c.body(null, 204);
  },
);
