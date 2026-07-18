import type { VercelRequest, VercelResponse } from "@vercel/node";
import { eq } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "../../lib/db.js";
import { tasks, taskTransfers, users } from "../../lib/schema.js";
import { requireUser } from "../../lib/auth.js";

const FROM = "Management Task Pro <noreply@infinityservicesindia.com>";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PATCH, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const me = requireUser(req, res);
  if (!me) return;

  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ message: "Invalid task id" });

  if (req.method === "GET") {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!task) return res.status(404).json({ message: "Task not found" });
    return res.status(200).json(task);
  }

  if (req.method === "PATCH" || req.method === "PUT") {
    const {
      title, description, status, priority, dueDate, reminderTime,
      type, category, department, company, remark, sendEmailNotification,
      assignedTo, // presence of this = a transfer/reassignment
    } = req.body || {};

    const [existing] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!existing) return res.status(404).json({ message: "Task not found" });

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (title !== undefined) update.title = title;
    if (description !== undefined) update.description = description;
    if (status !== undefined) update.status = status;
    if (priority !== undefined) update.priority = priority;
    if (dueDate !== undefined) update.dueDate = dueDate;
    if (reminderTime !== undefined) update.reminderTime = reminderTime;
    if (type !== undefined) update.type = type;
    if (category !== undefined) update.category = category;
    if (department !== undefined) update.department = department;
    if (company !== undefined) update.company = company;
    if (remark !== undefined) update.remark = remark;
    if (sendEmailNotification !== undefined) update.sendEmailNotification = sendEmailNotification;

    if (assignedTo !== undefined && assignedTo !== existing.assignedTo) {
      update.assignedTo = assignedTo;
      await db.insert(taskTransfers).values({
        taskId: id,
        fromUserId: existing.assignedTo,
        toUserId: assignedTo,
        transferredBy: me.id,
      });
    }

    const [updated] = await db.update(tasks).set(update).where(eq(tasks.id, id)).returning();

    if (assignedTo !== undefined && assignedTo !== existing.assignedTo && assignedTo && process.env.RESEND_API_KEY) {
      const [assignee] = await db.select().from(users).where(eq(users.id, assignedTo)).limit(1);
      if (assignee?.email) {
        try {
          const resend = new Resend(process.env.RESEND_API_KEY);
          await resend.emails.send({
            from: FROM,
            to: assignee.email,
            subject: `Task assigned to you: ${updated?.title ?? "Task"}`,
            html: `<p>Hi ${assignee.name},</p>
              <p>A task has been assigned to you: <strong>${updated?.title ?? ""}</strong></p>
              <p>Assigned by: ${me.name}</p>
              <p>Priority: ${updated?.priority ?? "medium"}</p>`,
          });
        } catch (e) {
          console.error("Task reassignment email failed:", e);
        }
      }
    }

    return res.status(200).json(updated);
  }

  if (req.method === "DELETE") {
    const [deleted] = await db.delete(tasks).where(eq(tasks.id, id)).returning();
    if (!deleted) return res.status(404).json({ message: "Task not found" });
    return res.status(200).json({ message: "Task deleted" });
  }

  return res.status(405).json({ message: "Method not allowed" });
}