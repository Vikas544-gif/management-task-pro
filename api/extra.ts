import type { VercelRequest, VercelResponse } from "@vercel/node";
import { eq, and, ne } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "../lib/db.js";
import {
  attendance, categories, complianceCompanies, notifications,
  users, emailSettings, tasks,
} from "../lib/schema.js";
import { requireUser } from "../lib/auth.js";

const FROM = "Management Task Pro <noreply@infinityservicesindia.com>";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const me = requireUser(req, res);
  if (!me) return;

  const resource = String(req.query.resource || "");

  // ── TASKS ────────────────────────────────────────────────────────────
  if (resource === "tasks") {
    if (req.method === "GET") {
      const allTasks = await db.select().from(tasks);
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
        await db.insert(notifications).values({
          userId: assignedTo,
          title: `New task assigned: ${title}`,
          message: `Assigned by ${me.name}${dueDate ? ` — due ${dueDate}` : ""}`,
        });
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
  }

  // ── ATTENDANCE ──────────────────────────────────────────────────────
  if (resource === "attendance") {
    if (req.method === "GET") {
      const { userId } = req.query;
      const rows = userId
        ? await db.select().from(attendance).where(eq(attendance.userId, Number(userId)))
        : await db.select().from(attendance);

      const allUsers = await db.select().from(users);
      const nameOf = new Map(allUsers.map((u) => [u.id, u.name]));
      const enriched = rows.map((r) => ({ ...r, userName: nameOf.get(r.userId) ?? null }));
      return res.status(200).json(enriched);
    }

    if (req.method === "POST") {
      const { userId, date, status, note } = req.body || {};
      if (!userId || !date || !status) {
        return res.status(400).json({ message: "userId, date and status are required" });
      }
      const [created] = await db
        .insert(attendance)
        .values({ userId, date, status, note: note || null })
        .returning();
      return res.status(201).json(created);
    }
  }

  // ── CATEGORIES ──────────────────────────────────────────────────────
  if (resource === "categories") {
    if (req.method === "GET") {
      const all = await db.select().from(categories);
      return res.status(200).json(all);
    }

    if (req.method === "POST") {
      const { name } = req.body || {};
      if (!name) return res.status(400).json({ message: "Category name is required" });
      const [created] = await db.insert(categories).values({ name }).returning();
      return res.status(201).json(created);
    }
  }

  // ── COMPLIANCE COMPANIES ────────────────────────────────────────────
  if (resource === "complianceCompanies") {
    if (req.method === "GET") {
      const all = await db.select().from(complianceCompanies);
      return res.status(200).json(all);
    }

    if (req.method === "POST") {
      const { name, gstDueDay, tdsDueDay, notes } = req.body || {};
      if (!name) return res.status(400).json({ message: "Company name is required" });
      const [created] = await db
        .insert(complianceCompanies)
        .values({
          name,
          gstDueDay: gstDueDay ?? null,
          tdsDueDay: tdsDueDay ?? null,
          notes: notes || null,
        })
        .returning();
      return res.status(201).json(created);
    }
  }

  // ── NOTIFICATIONS ───────────────────────────────────────────────────
  if (resource === "notifications") {
    if (req.method === "GET") {
      const { userId } = req.query;
      const targetId = userId ? Number(userId) : me.id;
      const rows = await db.select().from(notifications).where(eq(notifications.userId, targetId));
      return res.status(200).json(rows);
    }

    if (req.method === "POST") {
      const { userId, title, message } = req.body || {};
      if (!userId || !title) {
        return res.status(400).json({ message: "userId and title are required" });
      }
      const [created] = await db
        .insert(notifications)
        .values({ userId, title, message: message || null })
        .returning();
      return res.status(201).json(created);
    }

    if (req.method === "PATCH") {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ message: "Notification id is required" });
      const [updated] = await db
        .update(notifications)
        .set({ read: true })
        .where(and(eq(notifications.id, id)))
        .returning();
      return res.status(200).json(updated);
    }
  }

  // ── EMAIL ───────────────────────────────────────────────────────────
  if (resource === "email") {
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

  return res.status(404).json({ message: "Unknown resource or method" });
}