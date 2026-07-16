import { Router } from "express";
import { db } from "@workspace/db";
import { tasksTable, usersTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { SendReportBody } from "@workspace/api-zod";
import { sendReportEmail } from "../lib/emailService";
import { scopeTasks } from "../lib/scope";

const router = Router();

function startOfDay(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function fmt(d: Date) {
  return d.toISOString().split("T")[0];
}

async function buildReport(
  from: Date,
  to: Date,
  period: string,
  viewer: Parameters<typeof scopeTasks>[0],
) {
  const users = await db.select().from(usersTable);
  // Reports are visible to everyone now, so the data is scoped to what the
  // viewer is entitled to see (Boss/MIS get everything; others get their own
  // team's tasks) — exactly like the /tasks endpoints.
  const allTasks = scopeTasks(
    viewer,
    users,
    await db.select().from(tasksTable).orderBy(desc(tasksTable.createdAt)),
  );
  const f = fmt(from);
  const t = fmt(to);
  const tasks = allTasks.filter((task) => {
    const d = task.createdAt.toISOString().split("T")[0];
    return d >= f && d <= t;
  });
  const now = new Date().toISOString().split("T")[0];

  const catMap = new Map<string, { count: number; done: number }>();
  for (const task of tasks) {
    const cat = task.category ?? "Uncategorized";
    if (!catMap.has(cat)) catMap.set(cat, { count: 0, done: 0 });
    const e = catMap.get(cat)!;
    e.count++;
    if (task.status === "done") e.done++;
  }

  const userMap = new Map<number, { name: string; department: string; total: number; done: number; pending: number }>();
  for (const u of users) userMap.set(u.id, { name: u.name, department: u.department, total: 0, done: 0, pending: 0 });
  for (const task of tasks) {
    if (!task.assignedTo) continue;
    const e = userMap.get(task.assignedTo);
    if (!e) continue;
    e.total++;
    if (task.status === "done") e.done++;
    else e.pending++;
  }

  const userEnriched = await Promise.all(
    tasks.map(async (task) => {
      const assignee = task.assignedTo ? userMap.get(task.assignedTo) : null;
      return {
        ...task,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
        assignedToName: assignee?.name ?? null,
        assignedToEmail: null,
        assignedByName: null,
      };
    })
  );

  return {
    period,
    from: f,
    to: t,
    totalTasks: tasks.length,
    completedTasks: tasks.filter((t) => t.status === "done").length,
    pendingTasks: tasks.filter((t) => t.status !== "done").length,
    overdueTask: tasks.filter((t) => t.dueDate && t.dueDate < now && t.status !== "done").length,
    byCategory: Array.from(catMap.entries()).map(([category, v]) => ({ category, ...v })),
    byUser: Array.from(userMap.entries())
      .filter(([, v]) => v.total > 0)
      .map(([userId, v]) => ({ userId, ...v })),
    tasks: userEnriched,
  };
}

router.get("/daily", async (req, res) => {
  const today = startOfDay(new Date());
  res.json(await buildReport(today, today, "Daily", req.user!));
});

router.get("/weekly", async (req, res) => {
  const now = new Date();
  const start = startOfDay(new Date(now));
  start.setDate(now.getDate() - now.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  res.json(await buildReport(start, end, "Weekly", req.user!));
});

router.get("/monthly", async (req, res) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  res.json(await buildReport(start, end, "Monthly", req.user!));
});

router.post("/send", async (req, res) => {
  const parsed = SendReportBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid input" });
  const { type, toEmail } = parsed.data;
  const recipient = toEmail?.trim();
  if (!recipient) return res.json({ success: false, message: "Recipient email is required" });

  let report;
  const now = new Date();
  if (type === "daily") {
    report = await buildReport(startOfDay(now), startOfDay(now), "Daily", req.user!);
  } else if (type === "weekly") {
    const start = startOfDay(new Date(now));
    start.setDate(now.getDate() - now.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    report = await buildReport(start, end, "Weekly", req.user!);
  } else {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    report = await buildReport(start, end, "Monthly", req.user!);
  }

  const ok = await sendReportEmail({
    toEmail: recipient,
    period: report.period,
    from: report.from,
    to: report.to,
    total: report.totalTasks,
    completed: report.completedTasks,
    pending: report.pendingTasks,
    overdue: report.overdueTask,
    byCategory: report.byCategory,
    byUser: report.byUser,
  });
  return res.json({ success: ok, message: ok ? "Report sent successfully!" : "Failed to send report" });
});

export default router;
