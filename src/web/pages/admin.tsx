import type { AdminStats } from "../../features/admin/service";
import type { AuditEvent } from "../../features/audit/repo";
import type { User } from "../../types";
import { Avatar } from "../layout";
import { formatDate, formatDateTime } from "../render";

export function AdminPage(props: {
  stats: AdminStats;
  users: User[];
  total: number;
  search: string;
  events: AuditEvent[];
  currentUserId: string;
}) {
  const { stats } = props;
  return (
    <>
      <h1>Admin</h1>
      <div class="stats">
        <Stat label="Users" value={stats.users} />
        <Stat label="Active (7d)" value={stats.activeUsers7d} />
        <Stat label="Projects" value={stats.projects} />
        <Stat label="Items" value={stats.items} />
        <Stat label="Sessions" value={stats.activeSessions} />
      </div>

      <section class="card stack">
        <div class="row between wrap">
          <h2 class="h3">Users ({props.total})</h2>
          <form method="get" action="/app/admin" class="row">
            <input type="search" name="q" value={props.search} placeholder="Search name or email" aria-label="Search users" />
            <button class="btn btn-sm" type="submit">Search</button>
          </form>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Last login</th>
                <th>Joined</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {props.users.map((u) => {
                const self = u.id === props.currentUserId;
                return (
                  <tr class={u.disabledAt ? "disabled" : ""}>
                    <td>
                      <span class="row">
                        <Avatar user={u} size={24} />
                        <span>
                          {u.name || u.email}
                          <br />
                          <span class="small muted">{u.email}</span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <span class={`badge badge-${u.role}`}>{u.role}</span>
                      {u.disabledAt && <span class="badge badge-danger">disabled</span>}
                    </td>
                    <td>{formatDateTime(u.lastLoginAt)}</td>
                    <td>{formatDate(u.createdAt)}</td>
                    <td class="actions">
                      {!self && (
                        <>
                          <form method="post" action={`/app/admin/users/${u.id}`} class="inline">
                            <input type="hidden" name="role" value={u.role === "admin" ? "user" : "admin"} />
                            <button class="btn btn-sm" type="submit">{u.role === "admin" ? "Make user" : "Make admin"}</button>
                          </form>
                          <form
                            method="post"
                            action={`/app/admin/users/${u.id}`}
                            class="inline"
                            hx-confirm={u.disabledAt ? undefined : `Disable ${u.email}? They'll be signed out immediately.`}
                          >
                            <input type="hidden" name="disabled" value={u.disabledAt ? "false" : "true"} />
                            <button class={u.disabledAt ? "btn btn-sm" : "btn btn-sm btn-danger"} type="submit">
                              {u.disabledAt ? "Enable" : "Disable"}
                            </button>
                          </form>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section class="card stack">
        <h2 class="h3">Recent activity</h2>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {props.events.map((e) => (
                <tr>
                  <td class="nowrap">{formatDateTime(e.createdAt)}</td>
                  <td>{e.actorEmail ?? "—"}</td>
                  <td><code>{e.action}</code></td>
                  <td class="small muted">{e.metadata ? JSON.stringify(e.metadata) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div class="card stat">
      <span class="stat-value">{value}</span>
      <span class="stat-label">{label}</span>
    </div>
  );
}
