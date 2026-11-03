-- Initial schema.
-- Conventions:
--   * ids are TEXT UUIDs generated in the Worker (crypto.randomUUID()).
--   * timestamps are INTEGER milliseconds since the Unix epoch (UTC).
--   * D1 enforces foreign keys by default, so ON DELETE CASCADE works.
-- Add new migrations with `npm run db:new -- <name>`; never edit an applied one.

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  google_sub     TEXT NOT NULL UNIQUE,          -- stable Google account id ("sub" claim)
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT NOT NULL DEFAULT '',
  avatar_url     TEXT,
  role           TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  disabled_at    INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  last_login_at  INTEGER
);

-- The session id is SHA-256(cookie token). The raw token only ever exists in
-- the user's cookie, so a database leak does not yield usable sessions.
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  ip            TEXT,
  user_agent    TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE projects (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- Access control for projects. Every project has at least one 'owner'.
CREATE TABLE project_members (
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX idx_project_members_user ON project_members(user_id);

CREATE TABLE items (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  due_date    TEXT,                                  -- ISO date (YYYY-MM-DD)
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_items_project ON items(project_id, status, created_at);

-- Append-only record of security-relevant and admin actions.
CREATE TABLE audit_events (
  id           TEXT PRIMARY KEY,
  actor_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,                        -- e.g. 'auth.login', 'project.delete'
  target_type  TEXT,
  target_id    TEXT,
  metadata     TEXT,                                 -- JSON
  ip           TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_events(created_at);
CREATE INDEX idx_audit_actor ON audit_events(actor_id, created_at);
