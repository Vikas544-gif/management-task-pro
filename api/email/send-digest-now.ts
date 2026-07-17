import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import { ne } from "drizzle-orm";
import { db } from "../../lib/db.js";
import { tasks, users } from "../../lib/schema.js";
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

  const pendingTasks = await db.select().from(tasks).where(ne(tasks.status, "done"));
  const allUsers = await db.select().from(users);
  const usersById = new Map(allUsers.map((u) => [u.id, u]));

  // Group pending task counts by assignee.
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
