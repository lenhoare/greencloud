import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/**
 * Tests run inside the real Workers runtime (workerd via Miniflare) with the
 * bindings from wrangler.jsonc: a local D1 database, rate limiters, etc.
 * Each test file gets isolated storage; migrations are applied in setup.
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
            GOOGLE_CLIENT_SECRET: "test-secret",
            ALLOWED_EMAILS: "alice@example.com,bob@example.com,carol@example.com,unverified@example.com",
            ALLOWED_DOMAINS: "acme.test",
            ADMIN_EMAILS: "admin@example.com",
            CORS_ORIGINS: "https://frontend.example.com",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/setup.ts"],
    },
  };
});
