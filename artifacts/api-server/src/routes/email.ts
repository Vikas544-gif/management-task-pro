import { Router } from "express";
import { SendTestEmailBody } from "@workspace/api-zod";
import { isEmailConfigured, getSenderEmail, sendEmail } from "../lib/emailService";
import { sendDailyDigest, sendDashboardDigest } from "../lib/scheduler";
import { requireBossOrMis } from "../middlewares/auth";

const router = Router();

// Email Settings is a Boss/MIS-only admin surface — gate every endpoint.
router.use(requireBossOrMis);

router.get("/settings", async (req, res) => {
  const configured = isEmailConfigured();
  return res.json({
    configured,
    smtpEmail: configured ? getSenderEmail() : null,
    smtpHost: null,
    smtpPort: null,
  });
});

router.post("/test", async (req, res) => {
  const parsed = SendTestEmailBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid input" });
  if (!isEmailConfigured()) {
    return res.json({ success: false, message: "Email not configured. RESEND_API_KEY is missing." });
  }
  const { ok, error } = await sendEmail({
    to: parsed.data.toEmail,
    subject: "Management Task Pro — Test Email",
    html: `<div style="font-family:sans-serif;padding:20px;max-width:500px">
        <div style="background:#6366f1;color:#fff;padding:14px 20px;border-radius:8px;margin-bottom:16px">
          <h2 style="margin:0">Management Task Pro</h2>
        </div>
        <p>This is a test email confirming your email setup is working correctly.</p>
        <p style="color:#64748b;font-size:13px">Auto emails will now be sent for task assignments and scheduled reminders.</p>
      </div>`,
  });
  return res.json({
    success: ok,
    message: ok ? "Test email sent successfully!" : (error ?? "Failed to send email"),
  });
});

router.post("/send-digest-now", async (req, res) => {
  if (!isEmailConfigured()) {
    return res.json({
      success: false,
      message: "Email not configured. RESEND_API_KEY is missing.",
      sent: 0,
      eligible: 0,
      skippedNoEmail: 0,
      failedSend: 0,
    });
  }
  const { sent, eligible, skippedNoEmail, failedSend } = await sendDailyDigest();
  const parts: string[] = [];
  if (sent > 0) parts.push(`${sent} reminder email${sent === 1 ? "" : "s"} sent`);
  if (skippedNoEmail > 0) parts.push(`${skippedNoEmail} skipped (no email set — add it on the Team page)`);
  if (failedSend > 0) parts.push(`${failedSend} failed to send (check the email address/domain)`);

  let message: string;
  if (eligible === 0) {
    message = "No one has a task due or pending today, so no reminders were sent.";
  } else {
    message = parts.join("; ") + ".";
  }
  // The job ran without throwing; success reflects execution, not "≥1 delivered".
  return res.json({ success: true, message, sent, eligible, skippedNoEmail, failedSend });
});

router.post("/send-dashboard-now", async (req, res) => {
  if (!isEmailConfigured()) {
    return res.json({
      success: false,
      message: "Email not configured. RESEND_API_KEY is missing.",
      sent: 0,
      eligible: 0,
      skippedNoEmail: 0,
      failedSend: 0,
    });
  }
  const { sent, eligible, skippedNoEmail, failedSend } = await sendDashboardDigest();
  const parts: string[] = [];
  if (sent > 0) parts.push(`${sent} dashboard email${sent === 1 ? "" : "s"} sent`);
  if (skippedNoEmail > 0) parts.push(`${skippedNoEmail} skipped (no email set — add it on the Team page)`);
  if (failedSend > 0) parts.push(`${failedSend} failed to send (check the email address/domain)`);
  const message = eligible === 0 ? "No dashboard recipients were found." : parts.join("; ") + ".";
  return res.json({ success: true, message, sent, eligible, skippedNoEmail, failedSend });
});

export default router;
