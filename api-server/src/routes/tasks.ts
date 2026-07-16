import { Router } from "express";
import { db } from "@workspace/db";
import { tasksTable, usersTable, taskTransfersTable } from "@workspace/db";
import { eq, and, desc, lt, ne } from "drizzle-orm";
import { CreateTaskBody, UpdateTaskBody, UpdateTaskStatusBody } from "@workspace/api-zod";
import { sendTaskAssignmentEmail, sendTaskCompletedEmail } from "../lib/emailService";
import { isRecurringType, periodKey } from "../lib/recurrence";
import { generateRecurringTasks, generateMyDailyTasks, sendDailyDigest, sendDueDateReminders } from "../lib/scheduler";
import { scopeTasks, canEditTask, canDoTask, isBoss, isAllCentersViewer, buildHierarchySet } from "../lib/scope";
import { syncComplianceStatusFromTask } from "../lib/complianceSync";
import { createNotifications } from "../lib/webPush";

const router = Router();

const ROUTINE_CATEGORY = "Routine";

/** Name of the Boss (used as the implicit assigner of company-wide Routine tasks). */
function bossNameFrom(users: { role: string; name: string | null }[]): string | null {
  return users.find((u) => u.role === "Boss")?.name ?? null;
}

/**
 * Display name of who assigned a task. Company-wide Routine tasks are issued by
 * the Boss but stored with `assignedBy = null` (so they don't trigger
 * assigner-only notifications/permissions); for display we surface the Boss as
 * their assigner. Tasks with a real `assignedBy` resolve to that person.
 */
function resolveAssignedByName(
  task: { assignedBy: number | null; category: string | null },
  userMap: Map<number, { name: string | null }>,
  bossName: string | null,
): string | null {
  if (task.assignedBy != null) return userMap.get(task.assignedBy)?.name ?? null;
  if (task.category === ROUTINE_CATEGORY) return bossName;
  return null;
}

async function enrichTask(task: typeof tasksTable.$inferSelect) {
  const users = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role }).from(usersTable);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const assignee = task.assignedTo ? userMap.get(task.assignedTo) : null;
  const assigner = task.assignedBy ? userMap.get(task.assignedBy) : null;
  const bossName = bossNameFrom(users);
  return {
    ...task,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    assignedToName: assignee?.name ?? null,
    assignedToEmail: assignee?.email ?? null,
    assignedByName: resolveAssignedByName(task, userMap, bossName),
    assignedByEmail: assigner?.email ?? null,
  };
}

router.get("/", async (req, res) => {
  const { assignedTo, status, type, category } = req.query;
  let query = db.select().from(tasksTable).orderBy(desc(tasksTable.createdAt));
  const tasks = await query;
  // Server-side authorization: restrict to the tasks this session user is
  // entitled to see (mirrors the client visibility rules) before any other
  // filtering, so the scope can't be bypassed from the client.
  const allUsers = await db.select().from(usersTable);
  let filtered = scopeTasks(req.user!, allUsers, tasks);
  if (assignedTo) filtered = filtered.filter((t) => t.assignedTo === parseInt(assignedTo as string));
  if (status) filtered = filtered.filter((t) => t.status === status);
  if (type) filtered = filtered.filter((t) => t.type === type);
  if (category) filtered = filtered.filter((t) => t.category === category);
  const userMap = new Map(allUsers.map((u) => [u.id, u]));
  const bossName = bossNameFrom(allUsers);
  res.json(
    filtered.map((task) => ({
      ...task,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      assignedToName: task.assignedTo ? (userMap.get(task.assignedTo)?.name ?? null) : null,
      assignedToEmail: task.assignedTo ? (userMap.get(task.assignedTo)?.email ?? null) : null,
      assignedByName: resolveAssignedByName(task, userMap, bossName),
    }))
  );
});

router.get("/summary", async (req, res) => {
  const allUsers = await db.select().from(usersTable);
  const tasks = scopeTasks(req.user!, allUsers, await db.select().from(tasksTable));
  const now = new Date().toISOString().split("T")[0];
  const overdue = tasks.filter((t) => t.dueDate && t.dueDate < now && t.status !== "done").length;
  res.json({
    total: tasks.length,
    pending: tasks.filter((t) => t.status === "pending").length,
    inProgress: tasks.filter((t) => t.status === "inProgress").length,
    done: tasks.filter((t) => t.status === "done").length,
    overdue,
    daily: tasks.filter((t) => t.type === "daily").length,
    weekly: tasks.filter((t) => t.type === "weekly").length,
    monthly: tasks.filter((t) => t.type === "monthly").length,
  });
});

router.get("/by-category", async (req, res) => {
  const allUsers = await db.select().from(usersTable);
  const tasks = scopeTasks(req.user!, allUsers, await db.select().from(tasksTable));
  const map = new Map<string, { count: number; done: number }>();
  for (const t of tasks) {
    const cat = t.category ?? "Uncategorized";
    if (!map.has(cat)) map.set(cat, { count: 0, done: 0 });
    const entry = map.get(cat)!;
    entry.count++;
    if (t.status === "done") entry.done++;
  }
  res.json(Array.from(map.entries()).map(([category, v]) => ({ category, ...v })));
});

router.get("/by-user", async (req, res) => {
  const users = await db.select().from(usersTable);
  const allTasks = await db.select().from(tasksTable);
  const tasks = scopeTasks(req.user!, users, allTasks);
  const visibleTaskIds = new Set(tasks.map((t) => t.id));
  const map = new Map<
    number,
    { name: string; department: string; total: number; done: number; pending: number; transferredAway: number; transferredIn: number }
  >();
  for (const u of users) {
    map.set(u.id, { name: u.name, department: u.department, total: 0, done: 0, pending: 0, transferredAway: 0, transferredIn: 0 });
  }
  for (const t of tasks) {
    if (!t.assignedTo) continue;
    const entry = map.get(t.assignedTo);
    if (!entry) continue;
    entry.total++;
    if (t.status === "done") entry.done++;
    else entry.pending++;
  }
  // Transfer credit/debit: a task reassigned away from a person counts as a
  // "minus" against them (they had it but didn't do it); the new holder gets a
  // "plus". Only count transfers whose task is within the viewer's scope.
  const transfers = await db.select().from(taskTransfersTable);
  for (const tr of transfers) {
    if (!visibleTaskIds.has(tr.taskId)) continue;
    const from = map.get(tr.fromUserId);
    if (from) from.transferredAway++;
    const to = map.get(tr.toUserId);
    if (to) to.transferredIn++;
  }
  res.json(
    Array.from(map.entries())
      .filter(([, v]) => v.total > 0 || v.transferredAway > 0 || v.transferredIn > 0)
      .map(([userId, v]) => ({ userId, ...v }))
  );
});

router.get("/recent", async (req, res) => {
  const allUsers = await db.select().from(usersTable);
  const allTasks = await db.select().from(tasksTable).orderBy(desc(tasksTable.updatedAt));
  const tasks = scopeTasks(req.user!, allUsers, allTasks).slice(0, 10);
  const userMap = new Map(allUsers.map((u) => [u.id, u]));
  const bossName = bossNameFrom(allUsers);
  res.json(
    tasks.map((task) => ({
      ...task,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      assignedToName: task.assignedTo ? (userMap.get(task.assignedTo)?.name ?? null) : null,
      assignedToEmail: task.assignedTo ? (userMap.get(task.assignedTo)?.email ?? null) : null,
      assignedByName: resolveAssignedByName(task, userMap, bossName),
    }))
  );
});

router.get("/transfers", async (req, res) => {
  const me = req.user!;
  const allUsers = await db.select().from(usersTable);
  const userMap = new Map(allUsers.map((u) => [u.id, u]));
  const allTasks = await db.select().from(tasksTable);
  const taskMap = new Map(allTasks.map((t) => [t.id, t]));
  // Visibility relies entirely on scopeTasks (which already honours Boss /
  // all-centers / center-permission restrictions). No separate "sees all"
  // bypass, otherwise a center-restricted all-centers viewer would see
  // transfers outside their allowed centers.
  const visibleTaskIds = new Set(scopeTasks(me, allUsers, allTasks).map((t) => t.id));
  const subtree = buildHierarchySet(me.id, allUsers);
  const transfers = await db.select().from(taskTransfersTable).orderBy(desc(taskTransfersTable.createdAt));
  const visible = transfers.filter(
    (tr) =>
      visibleTaskIds.has(tr.taskId) ||
      subtree.has(tr.fromUserId) ||
      subtree.has(tr.toUserId)
  );
  res.json(
    visible.map((tr) => {
      const task = taskMap.get(tr.taskId);
      return {
        ...tr,
        createdAt: tr.createdAt.toISOString(),
        taskTitle: task?.title ?? null,
        taskStatus: task?.status ?? null,
        fromUserName: userMap.get(tr.fromUserId)?.name ?? null,
        toUserName: userMap.get(tr.toUserId)?.name ?? null,
        transferredByName: tr.transferredBy ? (userMap.get(tr.transferredBy)?.name ?? null) : null,
      };
    })
  );
});

router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) return res.status(404).json({ error: "Not found" });
  // Enforce visibility scope: a task outside the user's scope is treated as
  // not found so it can't be fetched directly by id.
  const allUsers = await db.select().from(usersTable);
  if (scopeTasks(req.user!, allUsers, [task]).length === 0) {
    return res.status(404).json({ error: "Not found" });
  }
  return res.json(await enrichTask(task));
});

router.post("/", async (req, res) => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  const { sendEmail, ...taskData } = parsed.data;
  const lastRunDate = isRecurringType(taskData.type) ? periodKey(taskData.type) : null;
  const [task] = await db
    .insert(tasksTable)
    .values({ ...taskData, lastRunDate })
    .returning();
  const enriched = await enrichTask(task);

  // In-app notification for the assignee (if assigned to someone other than the creator)
  if (task.assignedTo && task.assignedTo !== task.assignedBy) {
    const byText = enriched.assignedByName ? ` (by ${enriched.assignedByName})` : "";
    await createNotifications([{
      userId: task.assignedTo,
      type: "task_assigned",
      message: `New task assigned to you: "${task.title}"${byText}`,
      taskId: task.id,
    }]);
  }

  // Send email if requested and assignee has email
  if (sendEmail && enriched.assignedToEmail && enriched.assignedToName) {
    await sendTaskAssignmentEmail({
      toEmail: enriched.assignedToEmail,
      toName: enriched.assignedToName,
      taskTitle: task.title,
      taskDescription: task.description,
      priority: task.priority,
      dueDate: task.dueDate,
      type: task.type,
      assignedByName: enriched.assignedByName,
    });
  }
  return res.status(201).json(enriched);
});

router.put("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  // Permission: only the assigner (who gave the task) or an elevated role
  // (Boss / MIS / the assignee's Center Head) may edit or reassign a task.
  // Exception: a status/remark-only change (the "do the task" flow, e.g. moving
  // a task back to pending with a reason) is allowed for anyone who can DO it.
  const allUsers = await db.select().from(usersTable);
  const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  const editedKeys = Object.keys(parsed.data);
  const statusOnly = editedKeys.length > 0 && editedKeys.every((k) => k === "status" || k === "remark");
  // The assignee (the person the task is assigned to) is allowed to fully edit
  // their own task from the My Tasks page — but never to reassign it to someone
  // else. Reassignment stays restricted to the assigner / elevated roles.
  const isAssignee = existing.assignedTo === req.user!.id;
  const reassigning =
    parsed.data.assignedTo != null && parsed.data.assignedTo !== existing.assignedTo;
  // A pure transfer (only the assignee changes) is allowed for anyone who can
  // SEE the task — the Transfer action on the All Tasks page lets any user hand
  // a task they can see to someone else. Full edits still require the assigner
  // or an elevated role (canEditTask).
  const transferOnly = reassigning && editedKeys.every((k) => k === "assignedTo");
  const canSeeTask = scopeTasks(req.user!, allUsers, [existing]).length > 0;
  const allowed =
    canEditTask(req.user!, existing, allUsers) ||
    (isAssignee && !reassigning) ||
    (statusOnly && canDoTask(req.user!, existing, allUsers)) ||
    (transferOnly && canSeeTask);
  if (!allowed) {
    return res.status(403).json({ error: "You don't have permission to edit this task." });
  }

  // A transfer may only target a real, assignable user — never an arbitrary id.
  // (Elevated full edits via canEditTask are trusted and skip this guard.)
  if (transferOnly && !canEditTask(req.user!, existing, allUsers)) {
    const target = allUsers.find((u) => u.id === parsed.data.assignedTo);
    if (!target || !target.username || target.assignable === false) {
      return res.status(400).json({ error: "Invalid transfer target." });
    }
  }

  // Changing the assigner ("Assigned by") is an elevated action — only the
  // assigner / Boss / MIS / Center Head (canEditTask) may set it. Strip it for
  // anyone else (e.g. an assignee editing their own task), and reject an
  // assigner id that doesn't belong to a real user.
  if ("assignedBy" in parsed.data) {
    if (!canEditTask(req.user!, existing, allUsers)) {
      delete (parsed.data as { assignedBy?: number | null }).assignedBy;
    } else if (
      parsed.data.assignedBy != null &&
      !allUsers.some((u) => u.id === parsed.data.assignedBy)
    ) {
      return res.status(400).json({ error: "Invalid assigner." });
    }
  }

  // The full edit form goes through this PUT, so notifications must fire here
  // too (reassignment, completion), exactly like POST (assign) and PATCH
  // (complete). Read the previous state and apply the update inside one
  // transaction with a row lock (FOR UPDATE) so two concurrent edits flipping
  // the task to "done" can't both observe before.status !== "done" and double
  // notify — the second waits for the first to commit, then sees "done".
  const outcome = await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id))
      .for("update");
    if (!before) return null;
    const [updated] = await tx
      .update(tasksTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(tasksTable.id, id))
      .returning();
    return { before, task: updated };
  });
  if (!outcome) return res.status(404).json({ error: "Not found" });
  const { before, task } = outcome;
  const enriched = await enrichTask(task);

  // The edit form can change status too, so mirror completion back to the
  // compliance grid here as well (no-op for non-compliance tasks).
  await syncComplianceStatusFromTask(task, req.user!.id);

  // (a) Reassignment → notify the new assignee (skip self / the assigner).
  if (
    task.assignedTo &&
    task.assignedTo !== before.assignedTo &&
    task.assignedTo !== task.assignedBy
  ) {
    const byText = enriched.assignedByName ? ` (by ${enriched.assignedByName})` : "";
    await createNotifications([{
      userId: task.assignedTo,
      type: "task_assigned",
      message: `New task assigned to you: "${task.title}"${byText}`,
      taskId: task.id,
    }]);
  }

  // (a2) Reassignment also records a transfer row: the previous holder is
  //      debited (minus) and the new holder credited. Only when it moved from
  //      one real person to another (not a first-time assignment).
  if (task.assignedTo && before.assignedTo && task.assignedTo !== before.assignedTo) {
    await db.insert(taskTransfersTable).values({
      taskId: task.id,
      fromUserId: before.assignedTo,
      toUserId: task.assignedTo,
      transferredBy: req.user!.id,
    });
  }

  // (b) Completion (status flipped to done) → notify + email the task giver,
  //     guarded on the previous status so re-saving a done task won't re-notify.
  if (
    task.status === "done" &&
    before.status !== "done" &&
    task.assignedBy &&
    task.assignedBy !== task.assignedTo
  ) {
    const whoText = enriched.assignedToName ?? "Someone";
    await createNotifications([{
      userId: task.assignedBy,
      type: "task_completed",
      message: `${whoText} completed your task: "${task.title}"`,
      taskId: task.id,
    }]);
    if (enriched.assignedByEmail && enriched.assignedByName) {
      await sendTaskCompletedEmail({
        toEmail: enriched.assignedByEmail,
        toName: enriched.assignedByName,
        taskTitle: task.title,
        completedByName: enriched.assignedToName,
      });
    }
  }

  return res.json(enriched);
});

router.patch("/:id/status", async (req, res) => {
  const id = parseInt(req.params.id);
  const parsed = UpdateTaskStatusBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  // Permission: the assignee (who the task went to), the assigner, or an
  // elevated role may change a task's status.
  const statusUsers = await db.select().from(usersTable);
  const [statusTask] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!statusTask) return res.status(404).json({ error: "Not found" });
  if (!canDoTask(req.user!, statusTask, statusUsers)) {
    return res.status(403).json({ error: "You don't have permission to update this task." });
  }

  // Completing a task: do the transition atomically so concurrent requests
  // can't both fire the "task completed" notification/email. Only the single
  // request that actually flips status pending/in-progress -> done gets a row.
  if (parsed.data.status === "done") {
    const [transitioned] = await db
      .update(tasksTable)
      .set({ status: "done", updatedAt: new Date() })
      .where(and(eq(tasksTable.id, id), ne(tasksTable.status, "done")))
      .returning();

    if (transitioned) {
      const enriched = await enrichTask(transitioned);
      // Mirror completion back to the compliance grid for compliance tasks.
      await syncComplianceStatusFromTask(transitioned, req.user!.id);
      // Notify + email the task giver (only when assigned to someone else).
      if (transitioned.assignedBy && transitioned.assignedBy !== transitioned.assignedTo) {
        const whoText = enriched.assignedToName ?? "Someone";
        await createNotifications([{
          userId: transitioned.assignedBy,
          type: "task_completed",
          message: `${whoText} completed your task: "${transitioned.title}"`,
          taskId: transitioned.id,
        }]);
        if (enriched.assignedByEmail && enriched.assignedByName) {
          await sendTaskCompletedEmail({
            toEmail: enriched.assignedByEmail,
            toName: enriched.assignedByName,
            taskTitle: transitioned.title,
            completedByName: enriched.assignedToName,
          });
        }
      }
      return res.json(enriched);
    }

    // Already "done" (or not found) — return current state without re-notifying.
    const [current] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (!current) return res.status(404).json({ error: "Not found" });
    await syncComplianceStatusFromTask(current, req.user!.id);
    return res.json(await enrichTask(current));
  }

  // Any other status change — plain update.
  const [task] = await db
    .update(tasksTable)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(eq(tasksTable.id, id))
    .returning();
  if (!task) return res.status(404).json({ error: "Not found" });
  // Reopening a compliance task clears the period's completion in the grid.
  await syncComplianceStatusFromTask(task, req.user!.id);
  return res.json(await enrichTask(task));
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  // Permission: only the assigner or an elevated role may delete a task.
  const delUsers = await db.select().from(usersTable);
  const [delTask] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!delTask) return res.json({ success: true });
  if (!canEditTask(req.user!, delTask, delUsers)) {
    return res.status(403).json({ error: "You don't have permission to delete this task." });
  }
  await db.delete(tasksTable).where(eq(tasksTable.id, id));
  return res.json({ success: true });
});

// Self-serve for someone who IS working on an off day (Sunday / 1st
// Saturday): generate TODAY's occurrences of the caller's own daily tasks,
// bypassing the weekend skip. Idempotent and scoped to the logged-in user
// only, so it's safe for any authenticated user.
router.post("/generate-my-daily", async (req, res) => {
  const created = await generateMyDailyTasks(req.user!.id);
  res.json({ created });
});

// Manual triggers (also run automatically on schedule) — useful for testing.
router.post("/generate-recurring", async (_req, res) => {
  const created = await generateRecurringTasks();
  res.json({ created });
});

router.post("/send-daily-digest", async (_req, res) => {
  const sent = await sendDailyDigest();
  res.json({ sent });
});

router.post("/send-due-reminders", async (req, res) => {
  // Manual trigger fires real emails + notifications to everyone, so restrict
  // it to admins (Boss / all-centers viewers) — not just any logged-in user.
  if (!isBoss(req.user!) && !isAllCentersViewer(req.user!)) {
    return res.status(403).json({ error: "Only the Boss or MIS can trigger reminders." });
  }
  const result = await sendDueDateReminders("Manual");
  return res.json(result);
});

export default router;
