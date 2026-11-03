# CLAUDE.md

Guidance for AI assistants (and humans) working in this repo.

## Commands
- `npm run check`: typecheck + tests. Run before every commit.
- `npm test`: Vitest inside workerd (no network or Google needed; `test/helpers.ts` has a fake Google).
- `npm run dev`: local server on :8787 (needs `.dev.vars`; see `.dev.vars.example`).
- `npm run db:new -- <name>`: new migration. Never edit an applied migration.
- `npm run cf-typegen`: after changing bindings/vars in `wrangler.jsonc`.

## Conventions
- Feature folders in `src/features/<name>/`: `schemas.ts` (Zod, also used for OpenAPI and forms), `service.ts` (SQL + authorization, plain functions taking `db, user`), `api.ts` (OpenAPI routes). `projects/` is the reference implementation.
- Routes that need a user are typed `AuthedEnv` and sit behind `requireUser`. Helpers usable from both kinds of route take `AnyContext`.
- Throw `AppError` helpers (`notFound`, `forbidden`, …) from `src/lib/errors.ts`; don't build error responses by hand.
- Return 404 (not 403) when a user isn't a member of a resource.
- D1: ids are `crypto.randomUUID()`, timestamps are epoch ms integers, API DTOs expose ISO strings. Use `db.batch()` for multi-statement writes (it's transactional).
- Web UI: plain forms + Post/Redirect/Get with `redirectWith()` flash messages. htmx `hx-boost` is on globally. Put `hx-confirm` on the `<form>`, and use `hx-boost="false"` on links that leave the site.
- CSP forbids inline scripts and `style=""` attributes; add CSS classes in `public/styles.css`.
- Record security-relevant actions with `audit(c, {...})`.
- Every new endpoint or rule gets a test.
