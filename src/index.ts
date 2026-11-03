import { createApp } from "./app";
import { runScheduled } from "./scheduled";

const app = createApp();

export default {
  fetch: app.fetch,
  scheduled: (controller, env, ctx) => ctx.waitUntil(runScheduled(controller, env)),
} satisfies ExportedHandler<Env>;
