import { logger } from "../lib/logger";
import { isEmailConfigured } from "../lib/emailService";
import { runDailyDigestOnce, runDashboardDigestOnce } from "../lib/scheduler";

// Standalone entry point for the 9 AM daily emails, meant to be run by a Replit
// Scheduled Deployment (cron) — NOT the always-on web server. This lets the main
// app stay on Autoscale (same URL) while a separate scheduled job reliably fires
// the morning digest + dashboard summary every day.
//
// It runs the same jobs the in-process scheduler would have fired at 9 AM IST,
// then exits so the scheduled deployment's run completes cleanly.
async function main(): Promise<void> {
  if (!isEmailConfigured()) {
    logger.error("Daily emails job aborted: email not configured (RESEND_API_KEY missing).");
    process.exit(1);
  }

  logger.info("Daily emails job starting (digest + dashboard)");

  // Both go through the once-per-day claim, so if the in-app cron already sent
  // today's emails these return null and nothing is sent twice.
  const digest = await runDailyDigestOnce();
  logger.info({ digest }, digest ? "Daily digest finished" : "Daily digest skipped (already sent today)");

  const dashboard = await runDashboardDigestOnce();
  logger.info({ dashboard }, dashboard ? "Dashboard summary finished" : "Dashboard summary skipped (already sent today)");

  logger.info("Daily emails job complete");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Daily emails job failed");
  process.exit(1);
});
