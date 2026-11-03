import { getConfig } from "./config";
import { pruneAuditEvents } from "./features/audit/repo";
import { deleteExpiredSessions } from "./features/auth/sessions";
import { createLogger } from "./lib/logger";

/**
 * Cron-triggered background work (schedule in wrangler.jsonc `triggers`).
 *
 * Add more maintenance or periodic jobs here. For work triggered by user
 * actions (sending email, processing uploads, webhooks) prefer Cloudflare
 * Queues — see README "Background work".
 */
export async function runScheduled(controller: ScheduledController, env: Env): Promise<void> {
  const logger = createLogger({ cron: controller.cron, scheduledTime: controller.scheduledTime });
  const config = getConfig(env);

  const sessions = await deleteExpiredSessions(env.DB);
  const auditEvents = await pruneAuditEvents(env.DB, config.auditRetentionMs);

  logger.info("maintenance complete", { expiredSessionsDeleted: sessions, auditEventsPruned: auditEvents });
}
