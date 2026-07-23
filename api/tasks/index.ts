import type { VercelRequest, VercelResponse } from "@vercel/node";
import { eq, desc } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "../../lib/db.js";
import { tasks, users, notifications } from "../../lib/schema.js";
import { requireUser } from "../../lib/auth.js";
import { sendPushToUser } from "../../lib/webPush.js";

const FROM = "Management Task Pro <noreply@infinityservicesindia.com>";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const me = requireUser(req, res);
  if (!me) return;

  if (req.method === "GET") {
    const allTasks = await db.select().from(tasks).orderBy(desc(tasks.id));
    const allUsers = await db.select().from(users);
    const nameOf = new Map(allUsers.map((u) => [u.id, u.name]));
    const enriched = allTasks.map((t) => ({
      ...t,
      assignedByName: t.assignedBy != null ? nameOf.get(t.assignedBy) ?? null : null,
      assignedToName: t.assignedTo != null ? nameOf.get(t.assignedTo) ?? null : null,
    }));
    return res.status(200).json(enriched);
  }

  if (req.method === "POST") {
    const {
      title, description, assignedTo, priority, dueDate, reminderTime,
      type, category, department, company, remark, sendEmailNotification,
    } = req.body || {};
    if (!title) return res.status(400).json({ message: "Task title is required" });

    const [created] = await db
      .insert(tasks)
      .values({
        title,
        description: description || null,
        assignedTo: assignedTo ?? null,
        assignedBy: me.id,
        priority: priority || "medium",
        dueDate: dueDate || null,
        reminderTime: reminderTime || null,
        type: type || "oneTime",
        category: category || null,
        department: department || null,
        company: company || null,
        remark: remark || null,
        sendEmailNotification: sendEmailNotification ?? true,
      })
      .returning();

    if (assignedTo) {
      // In-app bell notification (notifications table)
      try {
        await db.insert(notifications).values({
          userId: assignedTo,
          title: `New task assigned: ${title}`,
          message: `${title} — assigned by ${me.name}${dueDate ? ` (due ${dueDate})` : ""}`,
          type: "task_assigned",
          taskId: created.id,
        });
      } catch (e) {
        console.error("Failed to create in-app notification:", e);
      }

      // Browser push notification (awaited so Vercel does not freeze the
      // function before the network call to the push service completes)
      try {
        await sendPushToUser(assignedTo, "New task assigned", `${title} — assigned by ${me.name}`);
      } catch (e) {
        console.error("Push send failed:", e);
      }
    }

    if ((sendEmailNotification ?? true) && assignedTo && process.env.RESEND_API_KEY) {
      const [assignee] = await db.select().from(users).where(eq(users.id, assignedTo)).limit(1);
      if (assignee?.email) {
        try {
          const resend = new Resend(process.env.RESEND_API_KEY);
          await resend.emails.send({
            from: FROM,
            to: assignee.email,
            subject: `New task assigned: ${title}`,
            html: `<p>Hi ${assignee.name},</p>
              <p>You've been assigned a new task: <strong>${title}</strong></p>
              <p>Assigned by: ${me.name}</p>
              ${description ? `<p>${description}</p>` : ""}
              ${dueDate ? `<p>Due: ${dueDate}</p>` : ""}
              <p>Priority: ${priority || "medium"}</p>`,
          });
        } catch (e) {
          console.error("Task assignment email failed:", e);
        }
      }
    }

    return res.status(201).json(created);
  }

  return res.status(405).json({ message: "Method not allowed" });
}