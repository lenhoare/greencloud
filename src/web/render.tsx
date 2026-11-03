import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Child } from "hono/jsx";
import type { z } from "zod";
import { base64UrlDecodeToString, base64UrlEncode } from "../lib/crypto";
import type { AnyContext } from "../types";
import { Layout } from "./layout";

/**
 * Helpers shared by the server-rendered pages.
 *
 * The UI is plain HTML forms + redirects (Post/Redirect/Get), progressively
 * enhanced by htmx `hx-boost`: with JS, links and forms are fetched via AJAX
 * and the <body> is swapped, so it feels like a SPA; without JS everything
 * still works. Handlers never need to know which happened.
 */

export type FlashKind = "success" | "error" | "info";
export interface Flash {
  kind: FlashKind;
  message: string;
}

const FLASH_COOKIE = "gc_flash";

/** One-shot message shown on the next rendered page. */
export function flash(c: AnyContext, kind: FlashKind, message: string) {
  setCookie(c, FLASH_COOKIE, base64UrlEncode(new TextEncoder().encode(JSON.stringify({ kind, message }))), {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: 60,
  });
}

function takeFlash(c: AnyContext): Flash | null {
  const raw = getCookie(c, FLASH_COOKIE);
  if (!raw) return null;
  deleteCookie(c, FLASH_COOKIE, { path: "/" });
  try {
    const v = JSON.parse(base64UrlDecodeToString(raw)) as Flash;
    return typeof v.message === "string" ? { kind: v.kind, message: v.message.slice(0, 500) } : null;
  } catch {
    return null;
  }
}

/** Flash a message and redirect (303 so the browser follows with GET). */
export function redirectWith(c: AnyContext, to: string, kind: FlashKind, message: string) {
  flash(c, kind, message);
  return c.redirect(to, 303);
}

export function renderPage(
  c: AnyContext,
  opts: { title: string; body: Child; status?: 200 | 400 | 401 | 403 | 404 | 429 | 500; nav?: string },
) {
  const html = (
    <Layout
      title={opts.title}
      appName={c.var.config.appName}
      user={c.var.user}
      flash={takeFlash(c)}
      nav={opts.nav}
    >
      {opts.body}
    </Layout>
  );
  return c.html(html, opts.status ?? 200);
}

/** Parse a urlencoded/multipart form body against a zod schema. */
export async function parseForm<S extends z.ZodType>(
  c: AnyContext,
  schema: S,
  transform: (form: Record<string, string>) => unknown = (f) => f,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; message: string }> {
  const body = await c.req.parseBody();
  const form: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (typeof v === "string") form[k] = v;
  const result = schema.safeParse(transform(form));
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, message: result.error.issues.map((i) => i.message).join(". ") };
}

export function formatDate(value: string | number | null | undefined): string {
  if (value == null) return "—";
  const d = new Date(value);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatDateTime(value: string | number | null | undefined): string {
  if (value == null) return "—";
  const d = new Date(value);
  return `${d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}
