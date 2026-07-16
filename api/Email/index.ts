import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import { db } from "../../lib/db.js";
import { emailSettings, users } from "../../lib/schema.js";
import { requireUser } from "../../lib/auth.js";

const FROM = "Management Task Pro <onboarding@resend.dev>"; // swap once a verified domain is added

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const me = requireUser(req, res);
  if (!me) return;

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ message: "RESEND_API_KEY is not set in Vercel yet" });
  }
  const resend = new Resend(process.env.RESEND_API_KEY);

  if (req.method === "GET") {
    const [settings] = await db.select().from(emailSettings).limit(1);
    return res.status(200).json(
      settings ?? { smtpEmail: null, resendApiKeySet: true, dashboardRecipients: [] }
    );
  }

  if (req.method === "POST") {
    const { action, recipient } = req.body || {};

    if (action === "test") {
      if (!recipient) return res.status(400).json({ message: "Recipient email is required" });
      try {
        await resend.emails.send({
          from: FROM,
          to: recipient,
          subject: "Test email — Management Task Pro",
          html: `<p>This is a test email. If you're reading this, email sending is working! ✅</p>`,
        });
        return res.status(200).json({ message: "Test email sent" });
      } catch (e: any) {
        return res.status(500).json({ message: e?.message || "Failed to send test email" });
      }
    }

    if (action === "reminder") {
      // Simple version: email every active user who has a real email set.
      const all = await db.select().from(users);
      const targets = all.filter((u) => u.active && u.email);
      let sent = 0;
      for (const u of targets) {
        try {
          await resend.emails.send({
            from: FROM,
            to: u.email as string,
            subject: "Pending task reminder — Management Task Pro",
            html: `<p>Hi ${u.name}, you have tasks due today. Please check your dashboard.</p>`,
          });
          sent++;
        } catch (e) {
          console.error("Reminder failed for", u.email, e);
        }
      }
      return res.status(200).json({ message: `Reminder sent to ${sent} people` });
    }

    if (action === "dashboard") {
      const [settings] = await db.select().from(emailSettings).limit(1);
      const recipients = settings?.dashboardRecipients?.length ? settings.dashboardRecipients : [me.email].filter(Boolean);
      if (!recipients.length) return res.status(400).json({ message: "No recipients configured" });
      for (const to of recipients) {
        try {
          await resend.emails.send({
            from: FROM,
            to: to as string,
            subject: "Daily dashboard summary — Management Task Pro",
            html: `<p>Here is today's dashboard summary.</p>`,
          });
        } catch (e) {
          console.error("Dashboard email failed for", to, e);
        }
      }
      return res.status(200).json({ message: `Dashboard summary sent to ${recipients.length} people` });
    }

    return res.status(400).json({ message: "Unknown action" });
  }

  return res.status(405).json({ message: "Method not allowed" });
}
