import type { VercelRequest, VercelResponse } from "@vercel/node";
import { eq } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "../../../lib/db.js";
import { tasks, users } from "../../../lib/schema.js";
import { requireUser } from "../../../lib/auth.js";
import { sendPushToUser } from "../../../lib/webPush.js";

const FROM = "Management Task Pro <noreply@infinityservicesindia.com>";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const me = requireUser(req, res);
  if (!me) return;

  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ message: "Invalid task id" });

  if (req.method === "PATCH") {
    const { status, remark } = req.body || {};
    if (!status) return res.status(400).json({ message: "status is required" });

    const [existing] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!existing) return res.status(404).json({ message: "Task not found" });

    const update: Record<string, unknown> = { status, updatedAt: new Date() };
    if (remark !== undefined) update.remark = remark;

    const [updated] = await db.update(tasks).set(update).where(eq(tasks.id, id)).returning();

    if (status === "done" && existing.status !== "done" && existing.assignedBy) {
      void sendPushToUser(existing.assignedBy, "Task completed", `${existing.title} — completed by ${me.name}`);
    }

    if (status === "done" && existing.status !== "done" && existing.assignedBy && process.env.RESEND_API_KEY) {
      const [assigner] = await db.select().from(users).where(eq(users.id, existing.assignedBy)).limit(1);
      if (assigner?.email) {
        try {
          const resend = new Resend(process.env.RESEND_API_KEY);
          await resend.emails.send({
            from: FROM,
            to: assigner.email,
            subject: `Task completed: ${existing.title}`,
            html: `<p>Hi ${assigner.name},</p>
              <p><strong>${existing.title}</strong> has been marked complete by ${me.name}.</p>`,
          });
        } catch (e) {
          console.error("Task completion email failed:", e);
        }
      }
    }

    return res.status(200).json(updated);
  }

  return res.status(405).json({ message: "Method not allowed" });
}
