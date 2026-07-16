import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function isOverdue(dueDate: string | null | undefined, status: string) {
  if (!dueDate || status === "done") return false;
  return new Date(dueDate) < new Date();
}

// ── Weekend / off-day rules ─────────────────────────────────────
// MIRROR of the server rule (api-server/src/lib/recurrence.ts →
// isNonWorkingDayFor) — keep the two in sync. Used only to decide when to
// show the Dashboard off-day banner; the server independently enforces the
// same policy when generating daily tasks.
//   • Sunday        — everyone is off.
//   • 1st Saturday  — the whole company (all centers + MIS) is off.
//   • Other Saturdays — Head Office is off EXCEPT the MIS department.
//   • Mon–Fri       — everyone works.

// Day of week (0=Sun .. 6=Sat) for a "YYYY-MM-DD" string, timezone-safe.
function dayOfWeekStr(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isFirstSaturdayStr(dateStr: string): boolean {
  return dayOfWeekStr(dateStr) === 6 && Number(dateStr.slice(8, 10)) <= 7;
}

export function isNonWorkingDayFor(
  user: { center?: string | null; department?: string | null } | null | undefined,
  dateStr: string,
): boolean {
  const dow = dayOfWeekStr(dateStr);
  if (dow === 0) return true; // Sunday: everyone off
  if (dow !== 6) return false; // Mon–Fri: everyone works
  if (isFirstSaturdayStr(dateStr)) return true; // monthly all-off Saturday
  const center = user?.center ?? "Head Office";
  const isMisDept = (user?.department ?? "") === "MIS";
  return center === "Head Office" && !isMisDept;
}

// Human label for WHY today is off — shown in the Dashboard banner.
export function nonWorkingDayLabel(dateStr: string): string {
  if (dayOfWeekStr(dateStr) === 0) return "Sunday";
  if (isFirstSaturdayStr(dateStr)) return "1st Saturday (monthly off)";
  return "Saturday (Head Office off)";
}

/**
 * "All-centers viewer": sees every OUTER center (Thane / Malad / Pune /
 * Navi Mumbai) and NEVER Head Office. Both the MIS department and the Director
 * department get this scope. Kept deliberately separate from the Boss check so a
 * Director is never treated as Boss (which would expose Head Office).
 */
export function isAllCentersViewer(
  u: { department?: string | null } | null | undefined
): boolean {
  return !!u && (u.department === "MIS" || u.department === "Director");
}

/**
 * Canonical display order of the company's centers. Head Office first, then the
 * outer centers. Anything not listed sorts after these, alphabetically.
 */
export const CENTER_ORDER = [
  "Head Office",
  "Thane Center",
  "Malad Center",
  "Pune Center",
  "Navi Mumbai Center",
];

/**
 * The set of centers a viewer is allowed to see, AFTER applying any per-user
 * `centerPermissions` restriction. Returns `null` when there is no center-level
 * restriction (the viewer is not a Boss/MIS-level all-centers viewer, OR has no
 * custom set) — callers treat `null` as "no extra restriction, use role default".
 *
 * Restriction-only: a custom set is intersected with the role ceiling, so it can
 * only narrow, never widen. The ceiling is every center for Boss, and every OUTER
 * center (never Head Office) for MIS/Director — so Head Office can never become
 * visible to an all-centers viewer through a custom set.
 */
export function resolveAllowedCenters(
  viewer:
    | { role?: string | null; department?: string | null; centerPermissions?: string[] | null }
    | null
    | undefined,
  allUsers: { center?: string | null }[]
): Set<string> | null {
  if (!viewer) return null;
  const perms = viewer.centerPermissions;
  if (perms == null) return null; // no custom set → role default
  const isBoss = viewer.department === "Management" || viewer.role === "Boss";
  const isAll = isAllCentersViewer(viewer);
  if (!isBoss && !isAll) return null; // center access is Boss/MIS only
  const ceiling = new Set(
    allUsers.map((u) => u.center).filter((c): c is string => Boolean(c))
  );
  if (isAll && !isBoss) ceiling.delete("Head Office"); // MIS/Director never Head Office
  return new Set([...ceiling].filter((c) => perms.includes(c)));
}

/**
 * Build a lookup of "userId|YYYY-MM-DD" for every attendance record whose
 * status means the person was away (absent / leave). Tasks due on such a day
 * for that person are hidden from the task views.
 */
export function buildAbsenceSet(
  attendance: { userId: number; date: string; status: string }[]
): Set<string> {
  const set = new Set<string>();
  for (const a of attendance) {
    if (a.status === "absent" || a.status === "leave") {
      set.add(`${a.userId}|${a.date}`);
    }
  }
  return set;
}

/**
 * A task is hidden when its assignee was marked absent/leave on the task's
 * due date. Only DAILY tasks are hidden by absence — weekly, monthly and
 * one-time tasks stay visible even if the assignee was away that day.
 * Tasks with no assignee or no due date are never hidden.
 */
export function isTaskHiddenByAbsence(
  task: { assignedTo?: number | null; dueDate?: string | null; type?: string | null },
  absenceSet: Set<string>
): boolean {
  if (String(task.type) !== "daily") return false;
  if (!task.assignedTo || !task.dueDate) return false;
  const day = String(task.dueDate).slice(0, 10);
  return absenceSet.has(`${task.assignedTo}|${day}`);
}

/**
 * Build the full recursive org-chart subtree under `rootId`.
 * Returns a Set of user IDs: rootId + all direct & indirect reports.
 * If rootId is null/undefined → returns null (means "see all").
 */
/**
 * Mirror of the server's task-permission rules so the UI hides/shows the right
 * controls (the server still enforces them).
 *   - Elevated (Boss / MIS / Director / the assignee's Center Head) → override.
 *   - EDIT / reassign / delete: the assigner (`assignedBy`), the assignee
 *     (`assignedTo`), or an elevated role.
 *   - DO (change status): the assignee (`assignedTo`), the assigner, or elevated.
 */
type PermActor = { id: number; role?: string | null; department?: string | null };
type PermTask = { assignedTo?: number | null; assignedBy?: number | null };

export function isElevatedForTask(
  user: PermActor,
  task: PermTask,
  allUsers: { id: number; center?: string | null }[]
): boolean {
  const isBoss = user.department === "Management" || user.role === "Boss";
  if (isBoss || isAllCentersViewer(user)) return true;
  if (user.role === "Center Head") {
    const centerOf = new Map(allUsers.map((u) => [u.id, u.center]));
    const myC = centerOf.get(user.id);
    const taskC = task.assignedTo != null ? centerOf.get(task.assignedTo) : null;
    return !!myC && !!taskC && myC === taskC;
  }
  return false;
}

export function canEditTask(
  user: PermActor,
  task: PermTask,
  allUsers: { id: number; center?: string | null }[]
): boolean {
  return (
    isElevatedForTask(user, task, allUsers) ||
    (task.assignedBy != null && task.assignedBy === user.id)
  );
}

/**
 * Who may OPEN the edit form to change a task's CONTENT (title, description,
 * due date, priority, status, remark, etc.) — the assigner / elevated roles
 * (canEditTask) PLUS the assignee editing their own task. The assignee can edit
 * content but NOT reassign, change the assigner, or delete — those stay gated by
 * canEditTask both in the UI and on the server.
 */
export function canOpenEditTask(
  user: PermActor,
  task: PermTask,
  allUsers: { id: number; center?: string | null }[]
): boolean {
  return (
    canEditTask(user, task, allUsers) ||
    (task.assignedTo != null && task.assignedTo === user.id)
  );
}

export function canDoTask(
  user: PermActor,
  task: PermTask,
  allUsers: { id: number; center?: string | null }[]
): boolean {
  return (
    isElevatedForTask(user, task, allUsers) ||
    (task.assignedTo != null && task.assignedTo === user.id) ||
    (task.assignedBy != null && task.assignedBy === user.id)
  );
}

// ── Assign-picker visibility ────────────────────────────────────────────────
// The assignee-picker audience rule (who a viewer may assign to/from) is SHARED
// with the native mobile app, so it lives in the @workspace/assign-scope lib to
// keep both clients in lockstep. See that package for the full rule + rationale.
export { resolveAssignableUsers, type AssignUser } from "@workspace/assign-scope";


export function buildHierarchySet(
  rootId: number,
  allUsers: { id: number; reportsTo?: number | null }[]
): Set<number> {
  const result = new Set<number>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const u of allUsers) {
      if (u.reportsTo === parentId && !result.has(u.id)) {
        result.add(u.id);
        queue.push(u.id);
      }
    }
  }
  return result;
}
