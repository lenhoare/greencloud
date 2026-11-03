import { raw } from "hono/html";
import type { Child, PropsWithChildren } from "hono/jsx";
import type { User } from "../types";
import type { Flash } from "./render";

/**
 * htmx settings (read from this meta tag, so no inline script is needed and
 * our strict CSP holds):
 * - allowEval / allowScriptTags false: htmx won't execute code from responses.
 * - historyCacheSize 0: don't snapshot pages (which may contain private data)
 *   into localStorage; back/forward refetches instead.
 * - responseHandling: also swap 4xx/5xx bodies so error pages are shown.
 */
const HTMX_CONFIG = JSON.stringify({
  allowEval: false,
  allowScriptTags: false,
  includeIndicatorStyles: false,
  historyCacheSize: 0,
  refreshOnHistoryMiss: true,
  scrollIntoViewOnBoost: false,
  responseHandling: [
    { code: "204", swap: false },
    { code: "[23]..", swap: true },
    { code: "[45]..", swap: true, error: true },
  ],
});

export function Layout(
  props: PropsWithChildren<{ title: string; appName: string; user: User | null; flash: Flash | null; nav?: string | undefined }>,
) {
  const { user } = props;
  return (
    <>
      {raw("<!doctype html>")}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="htmx-config" content={HTMX_CONFIG} />
          <title>{`${props.title} · ${props.appName}`}</title>
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          <link rel="stylesheet" href="/styles.css" />
          <script src="/vendor/htmx-2.0.11.min.js" defer></script>
        </head>
        <body hx-boost="true">
          <header class="topbar">
            <div class="container topbar-inner">
              <a href={user ? "/app" : "/"} class="brand">
                <img src="/favicon.svg" alt="" width="24" height="24" />
                {props.appName}
              </a>
              {user && (
                <nav class="nav">
                  <NavLink href="/app" active={props.nav === "projects"}>Projects</NavLink>
                  {user.role === "admin" && (
                    <NavLink href="/app/admin" active={props.nav === "admin"}>Admin</NavLink>
                  )}
                  <NavLink href="/app/account" active={props.nav === "account"}>
                    <Avatar user={user} size={24} />
                    <span class="hide-sm">{user.name || user.email}</span>
                  </NavLink>
                  <form method="post" action="/auth/logout" class="inline">
                    <button type="submit" class="btn btn-ghost btn-sm">Sign out</button>
                  </form>
                </nav>
              )}
            </div>
          </header>
          <main class="container main">
            {props.flash && (
              <div class={`flash flash-${props.flash.kind}`} role={props.flash.kind === "error" ? "alert" : "status"}>
                {props.flash.message}
              </div>
            )}
            {props.children}
          </main>
          <footer class="container footer">
            <span>{props.appName}</span>
            <a href="/api/docs" hx-boost="false">API docs</a>
          </footer>
        </body>
      </html>
    </>
  );
}

function NavLink(props: { href: string; active?: boolean; children?: Child }) {
  return (
    <a href={props.href} class={props.active ? "nav-link active" : "nav-link"} aria-current={props.active ? "page" : undefined}>
      {props.children}
    </a>
  );
}

export function Avatar({ user, size = 32 }: { user: { name: string; email: string; avatarUrl: string | null }; size?: 24 | 32 | 40 }) {
  if (user.avatarUrl) {
    // Google avatar URLs reject requests that send a Referer.
    return <img class="avatar" src={user.avatarUrl} alt="" width={size} height={size} referrerpolicy="no-referrer" />;
  }
  const initial = (user.name || user.email).charAt(0).toUpperCase();
  return (
    // No inline style attribute: the CSP (style-src 'self') would block it.
    <span class={`avatar avatar-fallback avatar-${size}`} aria-hidden="true">
      {initial}
    </span>
  );
}
