import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ne } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "../lib/db.js";
import { tasks, users, holidays } from "../lib/schema.js";

const FROM = "Management Task Pro <noreply@infinityservicesindia.com>";

function todayIST(): string {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

function weekdayIST(dateStr: string): number {
  return new Date(dateStr + "T00:00:00Z").getUTCDay();
}

function dayOfMonth(dateStr: string): number {
  return Number(dateStr.slice(8, 10));
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function shiftBackFromHoliday(dateStr: string, holidaySet: Set<string>): string {
  let d = dateStr;
  let guard = 0;
  while (holidaySet.has(d) && guard < 14) {
    d = addDays(d, -1);
    guard++;
  }
  return d;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(200).json({ success: false, message: "RESEND_API_KEY not set", sent: 0 });
  }

  const window = String(req.query.window || "morning");
  const today = todayIST();

  const [allTasks, allUsers, allHolidays] = await Promise.all([
    db.select().from(tasks).where(ne(tasks.status, "done")),
    db.select().from(users),
    db.select().from(holidays),
  ]);

  const usersById = new Map(allUsers.map((u) => [u.id, u]));
  const holidaySet = new Set(allHolidays.map((h) => h.date));
  const isTodayHoliday = holidaySet.has(today);

  const resend = new Resend(process.env.RESEND_API_KEY);
  let sent = 0;
  let skippedNoEmail = 0;

  for (const t of allTasks) {
    if (t.assignedTo == null) continue;
    const assignee = usersById.get(t.assignedTo);
    if (!assignee?.email) { skippedNoEmail++; continue; }

    let shouldSend = false;
    let reason = "";

    if (t.dueDate) {
      const effectiveDue = shiftBackFromHoliday(t.dueDate, holidaySet);
      if (effectiveDue === today) {
        shouldSend = true;
        reason = "due today";
      }
    }

    if (!shouldSend && window === "morning" && !isTodayHoliday) {
      if (t.type === "daily") {
        shouldSend = true;
        reason = "daily reminder";
      } else if (t.type === "weekly" && t.dueDate && weekdayIST(today) === weekdayIST(t.dueDate)) {
        shouldSend = true;
        reason = "weekly reminder";
      } else if (t.type === "monthly" && t.dueDate && dayOfMonth(today) === dayOfMonth(t.dueDate)) {
        shouldSend = true;
        reason = "monthly reminder";
      }
    }

    if (!shouldSend) continue;

    try {
      await resend.emails.send({
        from: FROM,
        to: assignee.email,
        subject: `Task reminder (${reason}): ${t.title}`,
        html: `<p>Hi ${assignee.name},</p>
          <p>This is a reminder for your task: <strong>${t.title}</strong></p>
          ${t.description ? `<p>${t.description}</p>` : ""}
          ${t.dueDate ? `<p>Due: ${t.dueDate}</p>` : ""}
          <p>Priority: ${t.priority}</p>
          <p>Status: ${t.status}</p>`,
      });
      sent++;
    } catch (e) {
      console.error("Reminder email failed for", assignee.email, e);
    }
  }

  return res.status(200).json({ success: true, window, today, isTodayHoliday, sent, skippedNoEmail, checked: allTasks.length });
}