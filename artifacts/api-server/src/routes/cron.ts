import { Router, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { isEmailConfigured } from "../lib/emailService";
import {
  runDailyDigestOnce,
  runDashboardDigestOnce,
  runLunchReminderOnce,
  isLunchReminderKind,
} from "../lib/scheduler";

const router = Router();

// Public (session-less) trigger for the daily 9 AM emails, meant to be called by
// an EXTERNAL scheduler (e.g. a free cron service or a Replit Scheduled
// Deployment) once a day. This lets the main app stay on Autoscale (same URL):
// the incoming request wakes the app, which then sends the emails. Duplicate
// sends are impossible because runDailyDigestOnce/runDashboardDigestOnce claim a
// once-per-day lock in the DB.
//
// Protected by a shared secret in CRON_SECRET. If that env var is not set the
// endpoint is disabled so it can never be triggered anonymously.
function tokenOk(provided: string | undefined): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Shared secret gate for every cron endpoint. Returns true if the caller is
// authorised; otherwise it has already written the error response.
function authorizeCron(req: Request, res: Response): boolean {
  const provided =
    (typeof req.query.token === "string" ? req.query.token : undefined) ??
    (req.get("x-cron-secret") ?? undefined);

  if (!process.env.CRON_SECRET) {
    req.log?.warn("Cron trigger called but CRON_SECRET is not set — endpoint disabled");
    res.status(503).json({ success: false, message: "Cron trigger not configured." });
    return false;
  }
  if (!tokenOk(provided)) {
    res.status(401).json({ success: false, message: "Invalid or missing token." });
    return false;
  }
  return true;
}

async function handleDailyEmails(req: Request, res: Response) {
  if (!authorizeCron(req, res)) return;
  if (!isEmailConfigured()) {
    return res.status(500).json({ success: false, message: "Email not configured (RESEND_API_KEY missing)." });
  }

  req.log?.info("Cron trigger: running daily emails (digest + dashboard)");
  const digest = await runDailyDigestOnce();
  const dashboard = await runDashboardDigestOnce();
  return res.json({
    success: true,
    digest: digest ?? "skipped (already sent today)",
    dashboard: dashboard ?? "skipped (already sent today)",
  });
}

// Fun lunch reminder (in-app bell only, no email). ?kind=order fires the noon
// "order your lunch" nudge, ?kind=eat fires the 1 PM "lunch break" nudge. Same
// once-per-day claim lock as the digest, so an external scheduler can safely
// hit it while the in-app cron also runs.
async function handleLunchReminder(req: Request, res: Response) {
  if (!authorizeCron(req, res)) return;
  const kind = req.query.kind;
  if (!isLunchReminderKind(kind)) {
    return res
      .status(400)
      .json({ success: false, message: "Missing or invalid 'kind' (expected 'order' or 'eat')." });
  }
  req.log?.info({ kind }, "Cron trigger: running lunch reminder");
  const result = await runLunchReminderOnce(kind);
  return res.json({
    success: true,
    kind,
    result: result ?? "skipped (already sent today)",
  });
}

// GET is supported so simple external cron services (which usually issue a GET)
// can trigger it by opening a URL; POST is also accepted.
router.get("/daily-emails", handleDailyEmails);
router.post("/daily-emails", handleDailyEmails);
router.get("/lunch-reminder", handleLunchReminder);
router.post("/lunch-reminder", handleLunchReminder);

export default router;
