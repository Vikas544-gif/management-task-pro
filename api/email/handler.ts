import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import { eq, ne } from "drizzle-orm";
import { db } from "../../lib/db.js";
import { emailSettings, users, tasks } from "../../lib/schema.js";
import { requireUser } from "../../lib/auth.js";

const FROM = "Management Task Pro <noreply@infinityservicesindia.com>";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const me = requireUser(req, res);
  if (!me) return;

  const route = String(req.query.route || "");

  if (route === "settings" && req.method === "GET") {
    const [row] = await db.select().from(emailSettings).limit(1);
    const configured = Boolean(process.env.RESEND_API_KEY);
    return res.status(200).json({
      id: row?.id,
      smtpEmail: configured ? FROM : (row?.smtpEmail ?? undefined),
      configured,
    });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(200).json({ success: false, message: "RESEND_API_KEY is not set in Vercel yet", sent: 0, eligible: 0, skippedNoEmail: 0 });
  }
  const resend = new Resend(process.env.RESEND_API_KEY);

  if (route === "test" && req.method === "POST") {
    const { toEmail } = req.body || {};
    if (!toEmail) return res.status(400).json({ success: false, message: "Recipient email is required" });
    try {
      await resend.emails.send({
        from: FROM,
        to: toEmail,
        subject: "Test email — Management Task Pro",
        html: `<p>This is a test email. If you're reading this, email sending is working! ✅</p>`,
      });
      return res.status(200).json({ success: true, message: "Test email sent successfully" });
    } catch (e: any) {
      return res.status(200).json({ success: false, message: e?.message || "Failed to send test email" });
    }
  }

  if (route === "send-digest-now" && req.method === "POST") {
    const pendingTasks = await db.select().from(tasks).where(ne(tasks.status, "done"));
    const allUsers = await db.select().from(users);
    const usersById = new Map(allUsers.map((u) => [u.id, u]));

    const byAssignee = new Map<number, number>();
    for (const t of pendingTasks) {
      if (t.assignedTo == null) continue;
      byAssignee.set(t.assignedTo, (byAssignee.get(t.assignedTo) ?? 0) + 1);
    }

    const eligibleUserIds = [...byAssignee.keys()];
    let sent = 0;
    let skippedNoEmail = 0;

    for (const uid of eligibleUserIds) {
      const u = usersById.get(uid);
      if (!u?.email) { skippedNoEmail++; continue; }
      try {
        await resend.emails.send({
          from: FROM,
          to: u.email,
          subject: "Pending task reminder — Management Task Pro",
          html: `<p>Hi ${u.name}, you have ${byAssignee.get(uid)} pending task(s). Please check your dashboard.</p>`,
        });
        sent++;
      } catch (e) {
        console.error("Reminder failed for", u.email, e);
      }
    }

    return res.status(200).json({
      success: true,
      message: `Reminder sent to ${sent} of ${eligibleUserIds.length} people`,
      sent,
      eligible: eligibleUserIds.length,
      skippedNoEmail,
    });
  }

  if (route === "send-dashboard-now" && req.method === "POST") {
    const [settings] = await db.select().from(emailSettings).limit(1);
    let recipients: string[] = settings?.dashboardRecipients?.length ? settings.dashboardRecipients : [];
    if (!recipients.length) {
      const [meRow] = await db.select().from(users).where(eq(users.id, me.id)).limit(1);
      recipients = [meRow?.email].filter((e): e is string => Boolean(e));
    }

    const allTasks = await db.select().from(tasks);
    const total = allTasks.length;
    const pending = allTasks.filter((t) => t.status === "pending").length;
    const inProgress = allTasks.filter((t) => t.status === "inProgress").length;
    const done = allTasks.filter((t) => t.status === "done").length;
    const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;

    let sent = 0;
    const skippedNoEmail = 0;

    for (const to of recipients) {
      try {
        await resend.emails.send({
          from: FROM,
          to,
          subject: "Daily dashboard summary — Management Task Pro",
          html: `<p>Today's dashboard summary:</p>
            <ul>
              <li>Total tasks: ${total}</li>
              <li>Pending: ${pending}</li>
              <li>In progress: ${inProgress}</li>
              <li>Completed: ${done} (${completionRate}%)</li>
            </ul>`,
        });
        sent++;
      } catch (e) {
        console.error("Dashboard email failed for", to, e);
      }
    }

    return res.status(200).json({
      success: true,
      message: `Dashboard summary sent to ${sent} of ${recipients.length} people`,
      sent,
      eligible: recipients.length,
      skippedNoEmail,
    });
  }

  return res.status(404).json({ message: "Not found" });
}
