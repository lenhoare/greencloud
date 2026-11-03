import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Env as HonoEnv } from "hono";
import { badRequest } from "./errors";

/** Shared OpenAPI building blocks for API routers. */

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "not_found" }),
      message: z.string(),
      details: z.unknown().optional(),
      requestId: z.string().optional(),
    }),
  })
  .openapi("Error");

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorSchema } },
});

/** Standard error responses to spread into a route's `responses`. */
export const errorResponses = {
  400: errorResponse("Invalid request"),
  401: errorResponse("Not signed in"),
  403: errorResponse("Not allowed"),
  404: errorResponse("Not found"),
  409: errorResponse("Conflict"),
  429: errorResponse("Rate limited"),
} as const;

export const jsonBody = <T extends z.ZodType>(schema: T, description = "Request body") => ({
  required: true,
  description,
  content: { "application/json": { schema } },
});

export const jsonResponse = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

/** `security` value for routes that need a signed-in user. */
export const cookieAuth = [{ cookieAuth: [] }];

/**
 * Create an OpenAPI router whose validation failures become our standard
 * 400 error envelope (instead of zod-openapi's default response shape).
 */
export function createApiRouter<E extends HonoEnv>() {
  return new OpenAPIHono<E>({
    defaultHook: (result) => {
      if (!result.success) {
        throw badRequest(
          "Validation failed",
          result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
    },
  });
}
