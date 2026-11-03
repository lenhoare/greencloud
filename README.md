# Greencloud

A production-ready foundation for web apps on **Cloudflare Workers**: Google sign-in, secure sessions, a typed JSON API with OpenAPI docs, a server-rendered UI, an admin area, and an example feature (**Projects → Items with sharing**) to copy when you add your own.

| | |
|---|---|
| Runtime | Cloudflare Workers, TypeScript, [Hono](https://hono.dev) |
| Data | D1 (SQLite), plain SQL migrations |
| Auth | Google OAuth 2.0 / OIDC (authorization code + PKCE), server-side sessions in D1 |
| API | `/api/v1/*`, validated with Zod, OpenAPI 3.1 at `/api/openapi.json`, Swagger UI at `/api/docs` |
| UI | Server-rendered Hono JSX + [htmx](https://htmx.org) `hx-boost` (works without JS) |
| Platform | Workers Static Assets, native Rate Limiting binding, Cron Triggers, Workers Logs |
| Tests | Vitest in the real Workers runtime (`@cloudflare/vitest-plugin`), 50+ tests |

---

## Quick start (local)

Requirements: Node.js 22+.

```sh
npm install
cp .dev.vars.example .dev.vars      # then fill in Google credentials + your email
npm run db:migrate:local            # create the local D1 database
npm run dev                         # http://localhost:8787
```

Sign in at <http://localhost:8787>. The email in `ADMIN_EMAILS` becomes an admin on first sign-in.

```sh
npm test            # run the test suite (no Google account needed)
npm run typecheck
npm run check       # both
```

## Setting up Google OAuth

1. Open the [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials). Create a project if you don't have one.
2. **OAuth consent screen** (Google Auth Platform → Branding/Audience): choose *External* (or *Internal* for Google Workspace-only apps), fill in the app name and support email. Scopes needed: `openid`, `email`, `profile` (all non-sensitive, so no verification review). While the app is in *Testing* status, only listed test users can sign in; click *Publish app* when you're ready.
3. **Create credentials → OAuth client ID → Web application.**
   - *Authorized JavaScript origins*: not needed.
   - *Authorized redirect URIs*: add one for each place the app runs:
     - `http://localhost:8787/auth/callback` (local dev)
     - `https://greencloud.<your-subdomain>.workers.dev/auth/callback` (after first deploy)
     - `https://your.custom.domain/auth/callback` (if you add one)
4. Copy the **Client ID** and **Client secret** into `.dev.vars` (local) and Wrangler secrets (production, below).

The redirect URI is built from the request's origin (`<origin>/auth/callback`). If the app sits behind something that changes the host, set `APP_URL` to the public URL.

## Configuration

Non-secret settings are `vars` in [`wrangler.jsonc`](wrangler.jsonc); override them locally in `.dev.vars`.

| Variable | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client ID (**secret** in production) |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret (**secret**) |
| `ALLOWED_EMAILS` | Comma-separated emails allowed to sign in. `*` = any verified Google account |
| `ALLOWED_DOMAINS` | Google Workspace domains allowed to sign in (matched on the token's `hd` claim) |
| `ADMIN_EMAILS` | Always allowed; promoted to admin at sign-in |
| `APP_NAME` | Shown in the UI |
| `APP_URL` | Optional public base URL for the OAuth redirect |
| `CORS_ORIGINS` | Extra origins allowed to call `/api` with cookies (e.g. a separate frontend) |
| `SESSION_TTL_DAYS` | Sliding session lifetime (default 30) |
| `AUDIT_RETENTION_DAYS` | Audit log retention (default 180) |

**Nobody can sign in until you set at least one of `ALLOWED_EMAILS`, `ALLOWED_DOMAINS` or `ADMIN_EMAILS`.** That's deliberate: an app that is open by default can be opened by accident.

## Deploying

```sh
npx wrangler login
npx wrangler d1 create greencloud          # copy database_id into wrangler.jsonc
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
# set ALLOWED_EMAILS / ADMIN_EMAILS in wrangler.jsonc "vars" (or as secrets)
npm run deploy                             # applies D1 migrations, then deploys
```

Then add the deployed URL's `/auth/callback` to your Google OAuth client's redirect URIs.

**Continuous deployment:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) typechecks, tests and builds every push. To also deploy `main` automatically, add repository secrets `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers" plus D1 edit) and `CLOUDFLARE_ACCOUNT_ID`, and a repository variable `DEPLOY_ENABLED=true`.

Everything used here works on the Workers **free plan**.

---

## Project layout

```
src/
  index.ts                 Worker entry: fetch + scheduled handlers
  app.tsx                  Builds the Hono app: middleware order, route map, error handling
  config.ts                Typed, parsed env vars
  types.ts                 User/Session types, Hono env types (AppEnv, AuthedEnv)
  scheduled.ts             Cron jobs (expired sessions, audit retention)
  lib/                     Framework-free helpers: errors, crypto, logger, OpenAPI helpers
  middleware/              request context/logging, security headers, auth guards, rate limiting
  db/util.ts               Small D1 helpers (ids, timestamps, pagination)
  features/
    auth/                  google.ts (OAuth client), access.ts (allowlist), sessions.ts, routes.ts
    users/                 user repo, /api/v1/me
    projects/              ← the example feature: schemas.ts, service.ts, api.ts
    admin/                 admin service + /api/v1/admin
    audit/                 audit log
    health/                /health, /health/ready
  web/                     Server-rendered UI: layout, pages/, routes.tsx (form handlers)
migrations/                D1 SQL migrations (applied in order)
public/                    Static assets (CSS, favicon, vendored htmx), served without the Worker
test/                      Vitest tests running in workerd
```

## How it works

### Authentication flow

1. `GET /auth/login` generates a random `state`, PKCE `code_verifier` and `nonce`, stores them in a short-lived HttpOnly cookie scoped to `/auth`, and redirects to Google.
2. Google redirects to `GET /auth/callback?code&state`. We check `state` against the cookie (stops login CSRF), exchange the code plus the PKCE verifier for tokens, and verify the ID token: signature against Google's JWKS, `iss`, `aud`, `exp` and `nonce` (stops replay).
3. The identity must have a verified email and pass the allowlist. Workspace domains match on the `hd` claim, since anyone can create a personal Google account with a `you@company.com` address.
4. We upsert the user, keyed on Google's stable `sub`, and create a **server-side session**. The cookie (`__Host-gc_session`; HttpOnly, Secure, SameSite=Lax) holds a random 256-bit token. D1 stores only its SHA-256, so a database leak can't be replayed.
5. `POST /auth/logout` deletes the session row. Logout, "sign out everywhere" and disabling a user all take effect immediately.

**Why D1 for sessions, not KV?** KV is eventually consistent (up to ~60s globally), so a revoked session could keep working in other regions. D1 is strongly consistent. Session expiry slides, but we only write to D1 when a session was last touched more than an hour ago, so a busy user costs about one write per hour.

### Protecting routes

```ts
// Any router typed AuthedEnv and guarded by requireUser gets a non-null user:
const router = new Hono<AuthedEnv>();
router.use("*", requireUser);              // 401 JSON for /api, redirect to /login for pages
router.get("/thing", (c) => c.text(`hi ${c.var.user.email}`));

router.use("/admin/*", requireAdmin);      // 403 unless role = admin
```

Authorization inside a feature lives in its service. `projects/service.ts` enforces `viewer < editor < owner` and returns 404 to non-members, so ids can't be probed.

### Security measures

- Strict CSP (`script-src 'self'`, no inline scripts or styles), HSTS, `nosniff`, `frame-ancestors 'none'`, Permissions-Policy, Referrer-Policy.
- CSRF: SameSite=Lax cookies plus an Origin check on form posts (`hono/csrf`). JSON requests can't be sent cross-site without passing CORS.
- CORS is closed by default; open it per origin with `CORS_ORIGINS`.
- Rate limiting: auth routes 20/min per IP, API 300/min per user, using the native Workers Rate Limiting binding.
- `Cache-Control: no-store` on all dynamic responses.
- htmx runs with `allowEval: false`, `allowScriptTags: false`, and no localStorage history cache.
- Open-redirect-safe `returnTo`, and an audit log for logins and admin/sharing actions.
- 5xx errors never leak internals. Every response carries `x-request-id`, which matches the structured log line.

### Errors and logging

Throw `AppError` (or its helpers `notFound()`, `forbidden()`, `badRequest()`…) anywhere. The global handler turns it into:

```json
{ "error": { "code": "not_found", "message": "Project not found", "requestId": "…" } }
```

for the API, or an error page / flash message for the UI. Logs are one JSON line per request (`requestId`, `userId`, `status`, `durationMs`) and are searchable in **Workers Logs**.

---

## Adding a feature (recipe)

Say you want **Notes**:

1. **Migration**: `npm run db:new -- notes`, then write `CREATE TABLE notes (...)` in the new file. Apply it with `npm run db:migrate:local`.
2. **Schemas**: `src/features/notes/schemas.ts` with Zod schemas for the DTO and inputs. These drive validation, types and OpenAPI docs.
3. **Service**: `src/features/notes/service.ts`, with SQL and authorization in plain functions taking `(db, user, …)`.
4. **API**: `src/features/notes/api.ts` using `createApiRouter<AuthedEnv>()` and `createRoute(...)`, then mount it in `buildApi()` in `src/app.tsx` (`v1.route("/notes", notesApi)`). It shows up in `/api/docs` automatically.
5. **UI** (optional): add pages in `src/web/pages/` and handlers in `src/web/routes.tsx`, using plain forms and `redirectWith(...)` (Post/Redirect/Get).
6. **Tests**: copy `test/projects.test.ts`. The `signedIn(app, google, email)` helper gives you an authenticated test browser.

`features/projects/` is the worked example of every step.

## Extension points / next steps

- **Background work**: add a [Queue](https://developers.cloudflare.com/queues/) (`queues.producers`/`consumers` in `wrangler.jsonc`, plus a `queue()` handler in `src/index.ts`) for emails, webhooks or imports. Queues need the Workers Paid plan. Periodic jobs go in `src/scheduled.ts`.
- **Email invites**: sharing currently requires the other person to have signed in once. Add an `invites` table and claim invites in `/auth/callback`.
- **API tokens** for scripts/CLI: a `api_tokens` table storing SHA-256 hashes (same pattern as sessions), plus a `Bearer` branch in `attachUser`.
- **File uploads**: add an R2 bucket binding and presigned uploads.
- **Durable Objects** for realtime collaboration (WebSockets per project).
- **Other identity providers**: `features/auth/google.ts` is self-contained; add a sibling for GitHub or Microsoft and a provider column on `users`.
- **Custom domain**: add `routes` in `wrangler.jsonc` and set `APP_URL`.
- **Staging environment**: add an `env.staging` block in `wrangler.jsonc` with its own D1 database.

## Troubleshooting

- **`redirect_uri_mismatch` from Google**: the exact `<origin>/auth/callback` URL (scheme, host and port) must be listed in the OAuth client.
- **"This Google account isn't allowed"**: add the email to `ALLOWED_EMAILS`, or its Workspace domain to `ALLOWED_DOMAINS`.
- **Changed `wrangler.jsonc` bindings or vars?** Run `npm run cf-typegen` and commit `worker-configuration.d.ts`. CI checks it's up to date.
- **`no such table`** locally: run `npm run db:migrate:local`.
