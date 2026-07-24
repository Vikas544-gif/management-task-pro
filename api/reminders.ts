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

  // Group every task that should be reminded about, per assignee, so each
  // person gets ONE digest email instead of one email per task.
  const byAssignee = new Map<number, { title: string; description: string | null; dueDate: string | null; priority: string; reason: string }[]>();
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
        reason = "daily";
      } else if (t.type === "weekly" && t.dueDate && weekdayIST(today) === weekdayIST(t.dueDate)) {
        shouldSend = true;
        reason = "weekly";
      } else if (t.type === "monthly" && t.dueDate && dayOfMonth(today) === dayOfMonth(t.dueDate)) {
        shouldSend = true;
        reason = "monthly";
      }
    }

    if (!shouldSend) continue;
    const list = byAssignee.get(t.assignedTo) ?? [];
    list.push({ title: t.title, description: t.description, dueDate: t.dueDate, priority: t.priority, reason });
    byAssignee.set(t.assignedTo, list);
  }

  let sent = 0;
  for (const [userId, items] of byAssignee) {
    const assignee = usersById.get(userId)!;
    const rows = items
      .map(
        (i) => `<tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">${i.title}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-transform:capitalize">${i.reason}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-transform:capitalize">${i.priority}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">${i.dueDate ?? "—"}</td>
        </tr>`
      )
      .join("");
    try {
      await resend.emails.send({
        from: FROM,
        to: assignee.email!,
        subject: `Your ${items.length} task reminder${items.length === 1 ? "" : "s"} for today`,
        html: `<p>Hi ${assignee.name},</p>
          <p>Here ${items.length === 1 ? "is your task" : `are your ${items.length} tasks`} for today:</p>
          <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px">
            <thead><tr style="background:#f4f4f5;text-align:left">
              <th style="padding:6px 10px">Task</th><th style="padding:6px 10px">Type</th>
              <th style="padding:6px 10px">Priority</th><th style="padding:6px 10px">Due</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>`,
      });
      sent++;
    } catch (e) {
      console.error("Digest reminder email failed for", assignee.email, e);
    }
  }

  return res.status(200).json({ success: true, window, today, isTodayHoliday, sent, skippedNoEmail, checked: allTasks.length, recipientsWithTasks: byAssignee.size });
}