import { applyD1Migrations, env } from "cloudflare:test";

// Runs before each test file, against that file's isolated database.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
