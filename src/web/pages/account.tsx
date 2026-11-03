import type { SessionDto } from "../../features/users/schemas";
import type { User } from "../../types";
import { Avatar } from "../layout";
import { formatDate, formatDateTime } from "../render";

export function AccountPage({ user, sessions }: { user: User; sessions: SessionDto[] }) {
  return (
    <>
      <h1>Account</h1>
      <section class="card row">
        <Avatar user={user} size={40} />
        <div>
          <strong>{user.name || user.email}</strong>
          <br />
          <span class="muted">{user.email}</span>
        </div>
        <span class={`badge badge-${user.role}`}>{user.role}</span>
      </section>
      <p class="small muted">Member since {formatDate(user.createdAt)}. Your profile is managed by your Google account.</p>

      <section class="card stack">
        <div class="row between wrap">
          <h2 class="h3">Active sessions</h2>
          {sessions.length > 1 && (
            <form method="post" action="/app/account/revoke-sessions" class="inline" hx-confirm="Sign out all other browsers and devices?">
              <button class="btn btn-sm" type="submit">
                Sign out everywhere else
              </button>
            </form>
          )}
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>Device</th>
              <th>IP</th>
              <th>Last active</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr>
                <td>
                  {describeAgent(s.userAgent)} {s.current && <span class="badge">this device</span>}
                </td>
                <td>{s.ip ?? "—"}</td>
                <td>{formatDateTime(s.lastSeenAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

/** Rough, dependency-free user-agent summary. Good enough for a sessions list. */
function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}
