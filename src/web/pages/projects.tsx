import { can } from "../../features/projects/service";
import type { ItemDto, ItemStatus, MemberDto, ProjectDto } from "../../features/projects/schemas";
import type { User } from "../../types";
import { Avatar } from "../layout";
import { formatDate } from "../render";

const STATUS_LABEL: Record<ItemStatus, string> = { todo: "To do", doing: "In progress", done: "Done" };

export function ProjectsPage({ projects }: { projects: ProjectDto[] }) {
  return (
    <>
      <div class="page-head">
        <h1>Projects</h1>
      </div>
      <div class="grid">
        {projects.map((p) => (
          <a class="card project-card" href={`/app/projects/${p.id}`}>
            <div class="row between">
              <h2 class="h3">{p.name}</h2>
              <RoleBadge role={p.role} />
            </div>
            {p.description && <p class="muted clamp">{p.description}</p>}
            <p class="small muted">
              {p.openItemCount} open · {p.itemCount} total · {p.memberCount} {p.memberCount === 1 ? "member" : "members"}
            </p>
          </a>
        ))}
        <form method="post" action="/app/projects" class="card stack">
          <h2 class="h3">New project</h2>
          <label>
            Name
            <input name="name" required maxlength={120} placeholder="e.g. Website relaunch" />
          </label>
          <label>
            <span>
              Description <span class="muted">(optional)</span>
            </span>
            <textarea name="description" rows={2} maxlength={2000}></textarea>
          </label>
          <button class="btn btn-primary" type="submit">Create project</button>
        </form>
      </div>
      {projects.length === 0 && <p class="muted">No projects yet. Create your first one above.</p>}
    </>
  );
}

export function ProjectPage({ project, items, filter }: { project: ProjectDto; items: ItemDto[]; filter: ItemStatus | undefined }) {
  const editable = can(project.role, "editor");
  const base = `/app/projects/${project.id}`;
  return (
    <>
      <div class="page-head">
        <div>
          <p class="breadcrumb"><a href="/app">Projects</a> /</p>
          <h1>{project.name}</h1>
          {project.description && <p class="muted">{project.description}</p>}
        </div>
        <div class="row">
          <RoleBadge role={project.role} />
          <a class="btn" href={`${base}/settings`}>{project.role === "owner" ? "Settings & sharing" : "Details"}</a>
        </div>
      </div>

      {editable && (
        <form method="post" action={`${base}/items`} class="card row wrap add-item">
          <input name="title" required maxlength={300} placeholder="Add an item…" aria-label="Item title" class="grow" />
          <input name="dueDate" type="date" aria-label="Due date" />
          <button class="btn btn-primary" type="submit">Add</button>
        </form>
      )}

      <nav class="tabs" aria-label="Filter items">
        <a href={base} class={!filter ? "tab active" : "tab"}>All</a>
        {(["todo", "doing", "done"] as const).map((s) => (
          <a href={`${base}?status=${s}`} class={filter === s ? "tab active" : "tab"}>{STATUS_LABEL[s]}</a>
        ))}
      </nav>

      {items.length === 0 ? (
        <p class="muted empty">Nothing here yet.</p>
      ) : (
        <ul class="items">
          {items.map((item) => (
            <ItemRow item={item} base={base} editable={editable} />
          ))}
        </ul>
      )}
    </>
  );
}

function ItemRow({ item, base, editable }: { item: ItemDto; base: string; editable: boolean }) {
  const overdue = item.dueDate && item.status !== "done" && item.dueDate < new Date().toISOString().slice(0, 10);
  const next: ItemStatus = item.status === "todo" ? "doing" : item.status === "doing" ? "done" : "todo";
  const nextLabel = item.status === "todo" ? "Start" : item.status === "doing" ? "Complete" : "Reopen";
  return (
    <li class={`item item-${item.status}`}>
      <span class={`status status-${item.status}`}>{STATUS_LABEL[item.status]}</span>
      <a href={`${base}/items/${item.id}`} class="item-title grow">{item.title}</a>
      {item.dueDate && <span class={overdue ? "due overdue" : "due"}>{formatDate(item.dueDate)}</span>}
      {editable && (
        <form method="post" action={`${base}/items/${item.id}/status`} class="inline">
          <input type="hidden" name="status" value={next} />
          <button class="btn btn-sm" type="submit">{nextLabel}</button>
        </form>
      )}
    </li>
  );
}

export function ItemPage({ project, item }: { project: ProjectDto; item: ItemDto }) {
  const editable = can(project.role, "editor");
  const base = `/app/projects/${project.id}`;
  return (
    <>
      <p class="breadcrumb">
        <a href="/app">Projects</a> / <a href={base}>{project.name}</a> /
      </p>
      <form method="post" action={`${base}/items/${item.id}`} class="card stack narrow">
        <label>
          Title
          <input name="title" required maxlength={300} value={item.title} disabled={!editable} />
        </label>
        <div class="row wrap">
          <label class="grow">
            Status
            <select name="status" disabled={!editable}>
              {(["todo", "doing", "done"] as const).map((s) => (
                <option value={s} selected={item.status === s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </label>
          <label class="grow">
            Due date
            <input name="dueDate" type="date" value={item.dueDate ?? ""} disabled={!editable} />
          </label>
        </div>
        <label>
          Notes
          <textarea name="notes" rows={8} maxlength={10000} disabled={!editable}>{item.notes}</textarea>
        </label>
        <p class="small muted">Created {formatDate(item.createdAt)} · Updated {formatDate(item.updatedAt)}</p>
        {editable && (
          <div>
            <button class="btn btn-primary" type="submit">Save</button>
          </div>
        )}
      </form>
      {editable && (
        <form method="post" action={`${base}/items/${item.id}/delete`} class="narrow" hx-confirm="Delete this item?">
          <button class="btn btn-danger" type="submit">Delete item</button>
        </form>
      )}
    </>
  );
}

export function ProjectSettingsPage({ project, members, user }: { project: ProjectDto; members: MemberDto[]; user: User }) {
  const base = `/app/projects/${project.id}`;
  const isOwner = project.role === "owner";
  const editable = can(project.role, "editor");
  return (
    <>
      <p class="breadcrumb">
        <a href="/app">Projects</a> / <a href={base}>{project.name}</a> /
      </p>
      <h1>Settings</h1>

      <section class="card stack">
        <h2 class="h3">Details</h2>
        <form method="post" action={base} class="stack">
          <label>
            Name
            <input name="name" required maxlength={120} value={project.name} disabled={!editable} />
          </label>
          <label>
            Description
            <textarea name="description" rows={3} maxlength={2000} disabled={!editable}>{project.description}</textarea>
          </label>
          {editable && <button class="btn btn-primary" type="submit">Save</button>}
        </form>
      </section>

      <section class="card stack">
        <h2 class="h3">Members</h2>
        <ul class="members">
          {members.map((m) => (
            <li class="row between wrap">
              <span class="row">
                <Avatar user={m} size={32} />
                <span>
                  <strong>{m.name || m.email}</strong>
                  {m.userId === user.id && <span class="muted"> (you)</span>}
                  <br />
                  <span class="small muted">{m.email}</span>
                </span>
              </span>
              <span class="row">
                {isOwner ? (
                  <form method="post" action={`${base}/members/${m.userId}`} class="row inline">
                    <select name="role" aria-label={`Role for ${m.email}`}>
                      {(["owner", "editor", "viewer"] as const).map((r) => (
                        <option value={r} selected={m.role === r}>{r}</option>
                      ))}
                    </select>
                    <button class="btn btn-sm" type="submit">Update</button>
                  </form>
                ) : (
                  <RoleBadge role={m.role} />
                )}
                {(isOwner || m.userId === user.id) && (
                  <form
                    method="post"
                    action={`${base}/members/${m.userId}/remove`}
                    class="inline"
                    hx-confirm={m.userId === user.id ? "Leave this project?" : `Remove ${m.email}?`}
                  >
                    <button class="btn btn-sm btn-ghost" type="submit">
                      {m.userId === user.id ? "Leave" : "Remove"}
                    </button>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ul>
        {isOwner && (
          <form method="post" action={`${base}/members`} class="row wrap">
            <input name="email" type="email" required placeholder="colleague@example.com" class="grow" aria-label="Email" />
            <select name="role" aria-label="Role">
              <option value="editor">editor</option>
              <option value="viewer">viewer</option>
              <option value="owner">owner</option>
            </select>
            <button class="btn btn-primary" type="submit">Share</button>
          </form>
        )}
        <p class="small muted">
          Viewers can read. Editors can also add and change items. Owners can also manage members and delete the
          project. People must have signed in once before you can share with them.
        </p>
      </section>

      {isOwner && (
        <section class="card stack danger-zone">
          <h2 class="h3">Danger zone</h2>
          <form method="post" action={`${base}/delete`} hx-confirm={`Delete "${project.name}" and all its items? This can't be undone.`}>
            <button class="btn btn-danger" type="submit">
              Delete project
            </button>
          </form>
        </section>
      )}
    </>
  );
}

export function RoleBadge({ role }: { role: string }) {
  return <span class={`badge badge-${role}`}>{role}</span>;
}
