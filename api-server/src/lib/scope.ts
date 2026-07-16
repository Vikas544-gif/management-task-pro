import { usersTable, tasksTable } from "@workspace/db";

type DbUser = typeof usersTable.$inferSelect;
type DbTask = typeof tasksTable.$inferSelect;

export const HEAD_OFFICE = "Head Office";

/**
 * Server-side mirror of the frontend visibility rules. The client already
 * scopes what each role can see; these helpers re-enforce the same rules on
 * the server so the scoping can't be bypassed by editing localStorage or
 * calling the API directly.
 */
export function isBoss(u: { department: string; role: string }): boolean {
  return u.department === "Management" || u.role === "Boss";
}

export function isAllCentersViewer(u: { department: string }): boolean {
  return u.department === "MIS" || u.department === "Director";
}

export function isCenterHead(u: { role: string }): boolean {
  return u.role === "Center Head";
}

/**
 * The set of centers a Boss/MIS-level viewer is allowed to see, AFTER applying
 * any per-user `centerPermissions` restriction. Returns `null` when there is no
 * center-level restriction in effect:
 *   - the viewer is not a Boss/MIS-level (all-centers) viewer, OR
 *   - the viewer has no custom set (`centerPermissions == null`) — role default.
 *
 * Restriction-only: a custom set is intersected with the role ceiling, so it can
 * only narrow what the role already allows, never widen it. The ceiling is every
 * center for Boss, and every OUTER center (never Head Office) for MIS/Director —
 * so Head Office can never become visible to an all-centers viewer via a custom set.
 */
export function allowedCentersFor(
  user: { department: string; role: string; centerPermissions?: string[] | null },
  allUsers: { center: string | null }[],
): Set<string> | null {
  const perms = user.centerPermissions;
  if (perms == null) return null; // no custom set → role default, no extra restriction
  const boss = isBoss(user);
  const allViewer = isAllCentersViewer(user);
  if (!boss && !allViewer) return null; // center access is Boss/MIS only
  const ceiling = new Set(
    allUsers.map((u) => u.center).filter((c): c is string => Boolean(c)),
  );
  if (allViewer && !boss) ceiling.delete(HEAD_OFFICE); // MIS/Director never Head Office
  return new Set([...ceiling].filter((c) => perms.includes(c)));
}

/** rootId + all of its direct & indirect reports (org-chart subtree). */
export function buildHierarchySet(
  rootId: number,
  all: { id: number; reportsTo: number | null }[],
): Set<number> {
  const result = new Set<number>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const u of all) {
      if (u.reportsTo === parentId && !result.has(u.id)) {
        result.add(u.id);
        queue.push(u.id);
      }
    }
  }
  return result;
}

/**
 * Whether `user` has an elevated/override role over `task` — Boss and
 * MIS/Director see and control everything, and a Center Head controls tasks
 * whose assignee belongs to their own center. Elevated users bypass the
 * assigner/assignee edit rules below.
 */
export function isElevatedForTask(
  user: DbUser,
  task: { assignedTo: number | null },
  allUsers: DbUser[],
): boolean {
  if (isBoss(user) || isAllCentersViewer(user)) return true;
  if (isCenterHead(user)) {
    const centerOf = new Map(allUsers.map((u) => [u.id, u.center]));
    const c = task.assignedTo != null ? centerOf.get(task.assignedTo) : null;
    return !!c && c === user.center;
  }
  return false;
}

/**
 * Who may EDIT a task (change its details / reassign it / delete it): the
 * person who assigned it (`assignedBy`) or an elevated role. NOTE: the assignee
 * editing their OWN task (content, not reassignment) is handled directly in the
 * PUT /tasks/:id route via an `(isAssignee && !reassigning)` allowance — it is
 * intentionally NOT folded in here, because this helper also gates DELETE,
 * transfer-target validation, and the `assignedBy` field, which must stay
 * restricted to the assigner / elevated roles.
 */
export function canEditTask(user: DbUser, task: DbTask, allUsers: DbUser[]): boolean {
  return (
    isElevatedForTask(user, task, allUsers) ||
    (task.assignedBy != null && task.assignedBy === user.id)
  );
}

/**
 * Who may change a task's STATUS (do / complete it): the assignee
 * (`assignedTo`, the person it went to), the assigner, or an elevated role.
 */
export function canDoTask(user: DbUser, task: DbTask, allUsers: DbUser[]): boolean {
  return (
    isElevatedForTask(user, task, allUsers) ||
    (task.assignedTo != null && task.assignedTo === user.id) ||
    (task.assignedBy != null && task.assignedBy === user.id)
  );
}

/**
 * Maximal set of tasks a user is entitled to across every page. Each page
 * narrows this further for display; the server never returns a task outside
 * this entitlement.
 *   - Boss/Management: everything.
 *   - MIS/Director: every center's tasks (including Head Office).
 *   - Center Head: own center's tasks + own.
 *   - Everyone else (incl. Team Leaders): their subtree + tasks they delegated.
 */
export function scopeTasks<T extends DbTask>(user: DbUser, allUsers: DbUser[], tasks: T[]): T[] {
  const me = user.id;
  const centerOf = new Map(allUsers.map((u) => [u.id, u.center]));

  // Per-user center restriction (Boss/MIS only). When a custom set is in effect the
  // boundary is STRICT: a task is visible only if its assignee belongs to an allowed
  // center. There is intentionally no own-task exception here — the restriction must
  // hold even for tasks the viewer assigned or was assigned, so a direct /tasks call
  // can never return data from a disallowed center, and the server stays consistent
  // with the client's center filtering.
  const allowedCenters = allowedCentersFor(user, allUsers);
  const centerOk = (t: T): boolean => {
    if (!allowedCenters) return true;
    const c = t.assignedTo != null ? centerOf.get(t.assignedTo) : null;
    return !!c && allowedCenters.has(c);
  };

  const boss = isBoss(user);
  const allViewer = isAllCentersViewer(user);
  const centerHead = isCenterHead(user);
  const myCenter = user.center;
  const allowed = buildHierarchySet(me, allUsers);

  // Compliance tasks mirror Compliance Calendar access: visible ONLY to the
  // Accounts department plus the overseers (Boss + MIS/Director). Boss and MIS see
  // every compliance task; Accounts members see their org-chart subtree; everyone
  // else (other centers/departments) never sees them, even in All Tasks.
  const complianceVisible = (t: T): boolean => {
    if (boss) return centerOk(t);
    // MIS/Director see every center's compliance tasks, narrowed only by any
    // custom centerPermissions via centerOk — same as baseVisible, so a
    // center-restricted overseer can never see compliance data outside it.
    if (allViewer) return centerOk(t);
    if (user.department === "Accounts")
      return (t.assignedTo != null && allowed.has(t.assignedTo)) || t.assignedBy === me;
    return false;
  };

  const baseVisible = (t: T): boolean => {
    if (boss) return centerOk(t);
    // MIS/Director now see every center's tasks (including Head Office), narrowed
    // only by any custom centerPermissions via centerOk — same entitlement as Boss.
    if (allViewer) return centerOk(t);
    if (centerHead)
      return (
        (t.assignedTo != null && centerOf.get(t.assignedTo) === myCenter) ||
        t.assignedTo === me ||
        t.assignedBy === me
      );
    return (t.assignedTo != null && allowed.has(t.assignedTo)) || t.assignedBy === me;
  };

  return tasks.filter((t) => (t.complianceItemId != null ? complianceVisible(t) : baseVisible(t)));
}
