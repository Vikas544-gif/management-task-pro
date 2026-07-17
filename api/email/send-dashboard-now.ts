import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import { eq } from "drizzle-orm";
import { db } from "../../lib/db.js";
import { emailSettings, users, tasks } from "../../lib/schema.js";
import { requireUser } from "../../lib/auth.js";

const FROM = "Management Task Pro <noreply@infinityservicesindia.com>";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const me = requireUser(req, res);
  if (!me) return;

  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  if (!process.env.RESEND_API_KEY) {
    return res.status(200).json({ success: false, message: "RESEND_API_KEY is not set in Vercel yet", sent: 0, eligible: 0, skippedNoEmail: 0 });
  }
  const resend = new Resend(process.env.RESEND_API_KEY);

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
