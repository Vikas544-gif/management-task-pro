---
name: Task edit-vs-do permissions & transfers
description: How ISS Task Pro gates who can edit/reassign/delete a task vs only change its status, plus the transfer-history audit.
---

# Edit vs Do permission model

- The **assigner** (`assignedBy`) or an **elevated role** (Boss / all-centers viewer / the assignee's Center Head) may EDIT, reassign, or delete a task → `canEditTask`.
- The **assignee** (`assignedTo`) may **fully edit their own task** (title/desc/due/priority/etc.) but may **NOT reassign** it — `PUT /tasks/:id` allows `(isAssignee && !reassigning)` where `reassigning` = changing `assignedTo`. Reassignment + delete stay `canEditTask`-only.
- `canDoTask` (assignee/giver/elevated) still governs the status/remark "do the task" flow.

**Why the assignee can full-edit (June 2026):** product owner wanted **every** user to edit the tasks assigned to them, on both My Tasks AND the All-Tasks (`TaskList`) page — not just the assigner/elevated. The relaxation is content-only; reassign/delete/assigner-change stay restricted.

**Two CLIENT predicates — keep them split (the load-bearing rule):** `canEditTask` (utils.ts) mirrors the server = assigner/elevated only → gates **Delete** + **reassign** (EditModal's `canReassign`, which hides the "Assign To"/"Assigned By" dropdowns) + the assigner field. `canOpenEditTask` = `canEditTask || assignedTo===me` → gates **opening the content edit form** (TaskList `mayEdit`/`rowEditable`). Do NOT collapse these into one — an earlier attempt widened `canEditTask` itself and accidentally also showed Delete/reassign to assignees (server then 403s silently). MyTasks shows Edit on all non-locked rows (no predicate); Delete there is `assignedTo===me`.

**Server stays the source of truth:** `scope.ts` `canEditTask` is assigner/elevated only and gates DELETE + transfer-target validation + the `assignedBy` strip. Assignee content edits are allowed ONLY by the PUT handler's `(isAssignee && !reassigning)` clause. Never widen server `canEditTask` to include the assignee — it would grant delete/reassign/assigner-spoof.

**Why the status/remark-only PUT exception still exists:** the "move task back to pending with a reason" UX submits via `PUT /tasks/:id` with `{status, remark}` (NOT PATCH, which carries no remark). `PUT` allows it when changed keys ⊆ `{status, remark}` AND `canDoTask` — covers a giver/elevated who isn't the assignee.

# Task transfer audit (credit/debit)

- Reassigning a task (`assignedTo` changes, old & new both non-null & different) inserts a `task_transfers` row inside the same PUT. `GET /tasks/transfers` enriches names + task title/status.
- UI shows per-member **Transferred Away (-N)** / **Transferred In (+N)**; `by-user` aggregate also carries `transferredAway`/`transferredIn`.
- **Anyone who can SEE a task can transfer it (June 2026):** `PUT /tasks/:id` allows a **pure transfer** (changed keys == only `assignedTo`) when `scopeTasks` shows the task to the requester — gated by the `transferOnly && canSeeTask` clause, separate from `canEditTask`. The All-Tasks (`TaskList`) page shows a per-row **Transfer** button + a **Transfer History** modal for **every** user (non-locked rows). **Why:** product owner wanted hand-offs open to all, not just assigner/elevated. After transferring a task away, the giver can no longer see/act on it (it left their scope) — a 403 on trying to pull it back is correct, not a bug.
- **Transfer target is validated server-side:** a non-elevated transfer must target a real, assignable user (`target.username` present, `assignable !== false`) else 400 — prevents assigning to arbitrary/garbage ids. Elevated `canEditTask` callers skip this guard.

**Why transfers visibility must NOT add a `seesAll` bypass:** `scopeTasks` already honours Boss / all-centers / center-permission restrictions. An extra `isBoss||isAllCentersViewer` shortcut leaks transfer history outside a center-restricted viewer's allowed centers. Scope transfers purely via `scopeTasks` + the requester's hierarchy subtree.

# Due-date reminders & manual triggers

- `sendDueDateReminders` is **holiday-aware (June 2026)**: instead of `dueDate == IST-today + 2`, it loads `holidaysTable` (excluding `type === "half"`), and for each open task (`dueDate` non-null, `status != done`) computes `reminderDateFor(dueDate)` = step back from the due date over **2 non-holiday days**, then keeps stepping back until it lands on a non-holiday day; it fires when that date == IST today. **Why:** the reminder must arrive *before* a holiday, so a holiday inside the 2-day lead window shifts the fire date earlier. `addDaysStr` does UTC-safe `YYYY-MM-DD` arithmetic; compare against the IST-today string. Notifies each assignee (in-app type `due_reminder` + email) and sends Boss a consolidated list. Crons at 10:00 & 15:00 IST.
- Any manual scheduler-trigger route (e.g. `POST /tasks/send-due-reminders`) fires real emails/notifications to everyone, so it MUST be admin-gated (Boss / all-centers viewer), not just `requireAuth`.
