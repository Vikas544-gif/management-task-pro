import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, tasksTable, notificationsTable, taskTransfersTable } from "@workspace/db";
import { eq, and, ne, isNotNull, inArray } from "drizzle-orm";
import { CreateUserBody, UpdateUserBody } from "@workspace/api-zod";
import { isBoss, isAllCentersViewer, isCenterHead, HEAD_OFFICE, allowedCentersFor, buildHierarchySet } from "../lib/scope";
import { resolveAssignableUsers } from "@workspace/assign-scope";

const router = Router();

type DbUser = typeof usersTable.$inferSelect;

function sanitize(u: DbUser, reportsToName: string | null) {
  const { password: _password, createdAt, ...rest } = u;
  return { ...rest, createdAt: createdAt.toISOString(), reportsToName };
}

/**
 * Returns the set of user IDs that are `rootId` plus all of its
 * descendants (direct & indirect reports). Used to reject reportsTo cycles.
 */
function descendantsOf(rootId: number, all: { id: number; reportsTo: number | null }[]): Set<number> {
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

router.get("/", async (req, res) => {
  const me = req.user!;
  const users = await db.select().from(usersTable);
  const managerMap = new Map(users.map((m) => [m.id, m.name]));
  // The user DIRECTORY (names/roles/centers — no passwords; those live on
  // /credentials) is intentionally NOT Head-Office-scoped for MIS/Director here.
  // The Assign Task picker needs MIS to see EVERY colleague (incl. Head Office).
  // Sensitive DATA scoping (tasks, reports, credentials) is enforced on those
  // endpoints independently, so exposing directory names to MIS does not leak
  // anything secret.
  //   - Per-user centerPermissions (Boss/MIS only) still narrows when explicitly set.
  //   - The viewer's own row is always kept.
  const allowed = allowedCentersFor(me, users);
  let visible = users.filter((u) => {
    if (u.id === me.id) return true;
    if (allowed && !(u.center != null && allowed.has(u.center))) return false;
    return true;
  });
  // Non-elevated viewers get a SERVER-enforced directory scope: the shared
  // assign-picker rule (@workspace/assign-scope — same code the web app and the
  // current mobile app run client-side) UNION their own org-chart subtree (so
  // Team / agent-tracking / reports keep their non-login Sales Agent rows).
  // Enforcing this here (not just in the clients) means older installed mobile
  // APKs — whose Assign Task screen showed the raw directory — also obey the
  // picker rule without needing a rebuild/reinstall.
  if (!isBoss(me) && !isAllCentersViewer(me)) {
    const assignVisible = new Set(resolveAssignableUsers(me, users).map((u) => u.id));
    const subtree = buildHierarchySet(me.id, users);
    visible = visible.filter(
      (u) => u.id === me.id || assignVisible.has(u.id) || subtree.has(u.id),
    );
  }
  res.json(
    visible.map((u) => sanitize(u, u.reportsTo ? (managerMap.get(u.reportsTo) ?? null) : null))
  );
});

// Returns login credentials (incl. plaintext password) so the Credentials page
// can display and reset them. Kept on a separate endpoint so passwords are never
// included in the broadly-used GET /users list.
//
// Scope is derived from the *authenticated session user* — NOT from client query
// params — so other centers' passwords can never be pulled by tampering with the
// request:
//   - Boss/Management: all credentials.
//   - Center Head: only their own center.
//   - MIS/Director: everything except Head Office.
//   - Anyone else: forbidden.
router.get("/credentials", async (req, res) => {
  const me = req.user!;
  let scope;
  if (isBoss(me)) {
    scope = isNotNull(usersTable.username);
  } else if (isCenterHead(me)) {
    // A Center Head sees their own center, but NOT the center's HR staff
    // (department "HR") — HR credentials are withheld from Center Heads. They
    // still see their Team Leaders and their own row.
    scope = and(
      isNotNull(usersTable.username),
      eq(usersTable.center, me.center),
      ne(usersTable.department, "HR"),
    );
  } else if (isAllCentersViewer(me)) {
    scope = and(isNotNull(usersTable.username), ne(usersTable.center, HEAD_OFFICE));
  } else {
    return res.status(403).json({ error: "Forbidden" });
  }
  // Per-user center restriction (Boss/MIS only): never return credentials for a
  // center this viewer isn't allowed to see, even via a direct API call.
  const allUsers = await db.select({ center: usersTable.center }).from(usersTable);
  const allowedCenters = allowedCentersFor(me, allUsers);
  if (allowedCenters && allowedCenters.size === 0) {
    // Restricted to zero centers -> nothing to show (also avoids `IN ()` SQL).
    return res.json([]);
  }
  if (allowedCenters) {
    scope = and(scope, inArray(usersTable.center, [...allowedCenters]));
  }
  const rows = await db
    .select({ id: usersTable.id, name: usersTable.name, username: usersTable.username, password: usersTable.password })
    .from(usersTable)
    .where(scope);
  return res.json(rows);
});

// Privileged (manager-level) roles/departments. Granting any of these makes a
// user a manager or admin, so only a full admin (Boss/MIS/Director) may grant
// them — a Center Head can manage their team's non-manager roles but cannot mint
// another Center Head/Boss or an admin-department account.
const ADMIN_DEPARTMENTS = ["Management", "MIS", "Director"];
const PRIVILEGED_ROLES = ["Boss", "Center Head"];
function grantsPrivilegedRole(role?: string, department?: string) {
  return (
    (role !== undefined && PRIVILEGED_ROLES.includes(role)) ||
    (department !== undefined && ADMIN_DEPARTMENTS.includes(department))
  );
}

router.post("/", async (req, res) => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  // Only a manager (Boss/MIS/Director/Center Head) may create users, and only a
  // full admin may create an admin-level account — this stops a non-admin from
  // minting a high-privilege user for themselves or anyone else.
  const me = req.user!;
  const isAdmin = isBoss(me) || isAllCentersViewer(me);
  const isTL = me.role === "Team Leader";
  if (!isAdmin && !isCenterHead(me) && !isTL) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!isAdmin && grantsPrivilegedRole(parsed.data.role, parsed.data.department)) {
    return res.status(403).json({ error: "Forbidden — only an admin can grant a manager-level role" });
  }
  // A Team Leader may only add a plain Sales Agent (no login) into their OWN center,
  // reporting into their own team (themselves or a TL beneath them) — never a manager,
  // a login-holding user, another center, or an agent outside their team.
  if (isTL && !isAdmin && !isCenterHead(me)) {
    const d = parsed.data;
    const okRole = d.role === "Sales Agent";
    const okNoLogin = !d.username && !d.password;
    const okCenter = d.center === me.center;
    let okReports = false;
    if (d.reportsTo != null) {
      const roster = await db
        .select({ id: usersTable.id, reportsTo: usersTable.reportsTo })
        .from(usersTable);
      okReports = buildHierarchySet(me.id, roster).has(d.reportsTo);
    }
    if (!okRole || !okNoLogin || !okCenter || !okReports) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }
  const [user] = await db.insert(usersTable).values(parsed.data).returning();
  return res.status(201).json(sanitize(user, null));
});

router.put("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  // Per-field authorization. PUT /:id is a shared endpoint used by several roles,
  // so we gate privileged fields individually (returning 403 for the field, not
  // rejecting the whole request) — that way a lesser role can still use this
  // endpoint for the edits it's legitimately allowed.
  const me = req.user!;
  const admin = isBoss(me) || isAllCentersViewer(me);

  // Assign-list visibility and page-/center-access overrides are Boss/MIS/Director-only.
  if (
    parsed.data.assignable !== undefined ||
    parsed.data.autoTasksEnabled !== undefined ||
    parsed.data.pagePermissions !== undefined ||
    parsed.data.centerPermissions !== undefined ||
    parsed.data.assignVisibleUserIds !== undefined
  ) {
    if (!admin) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  // `role` and `department` are privilege/escalation vectors: setting role "Boss"
  // or department "Management"/"MIS"/"Director" turns a user into a Boss or an
  // all-centers viewer. Only an admin (Boss/MIS) may change them — this is what
  // stops any logged-in user (including via a direct API call) from promoting
  // themselves or anyone else to a higher role.
  if (parsed.data.role !== undefined || parsed.data.department !== undefined) {
    if (!admin) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  // `status` (Active/Inactive) and `center` are agent-management fields edited from
  // the Team page's Agent Tracking view. Boss / MIS and Center Heads may set them for
  // anyone in scope. A Team Leader may set them ONLY for the Sales Agents in their own
  // team (their org-chart subtree) — never a manager or another team's agent. Regular
  // staff can change neither, even via a direct API call.
  if (parsed.data.status !== undefined || parsed.data.center !== undefined) {
    const isTL = me.role === "Team Leader";
    let tlManagesTarget = false;
    if (isTL && !admin && !isCenterHead(me)) {
      const roster = await db
        .select({
          id: usersTable.id,
          reportsTo: usersTable.reportsTo,
          role: usersTable.role,
          username: usersTable.username,
        })
        .from(usersTable);
      const target = roster.find((u) => u.id === id);
      const subtree = buildHierarchySet(me.id, roster);
      // A TL may only manage the login-less Sales Agents in their own subtree — never
      // a manager, a login-enabled account, another team's agent, or themselves.
      tlManagesTarget =
        !!target &&
        target.role === "Sales Agent" &&
        target.username == null &&
        id !== me.id &&
        subtree.has(id);
      // A TL keeps agents within their OWN center: a center change may only set the
      // agent's center to the TL's center (no cross-center transfers).
      if (
        tlManagesTarget &&
        parsed.data.center !== undefined &&
        parsed.data.center !== me.center
      ) {
        tlManagesTarget = false;
      }
    }
    if (!admin && !isCenterHead(me) && !tlManagesTarget) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  // Cycle prevention: a user cannot report to themselves or to one of their
  // own descendants (which would create a loop in the org chart).
  if (parsed.data.reportsTo != null) {
    if (parsed.data.reportsTo === id) {
      return res.status(400).json({ error: "User apne aap ko report nahi kar sakta" });
    }
    const all = await db.select({ id: usersTable.id, reportsTo: usersTable.reportsTo }).from(usersTable);
    const blocked = descendantsOf(id, all);
    if (blocked.has(parsed.data.reportsTo)) {
      return res.status(400).json({ error: "Cycle banega — apni hi team ke member ko report nahi kar sakta" });
    }
  }

  // Username must stay unique across users.
  if (parsed.data.username != null) {
    const [clash] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.username, parsed.data.username), ne(usersTable.id, id)));
    if (clash) return res.status(409).json({ error: "Username already taken" });
  }

  const [user] = await db.update(usersTable).set(parsed.data).where(eq(usersTable.id, id)).returning();
  if (!user) return res.status(404).json({ error: "Not found" });

  // Turning auto-tasks OFF: delete this person's existing tasks right away so the
  // change takes effect immediately (the boot cleanup is only a safety net + prod
  // path). Idempotent — deletes nothing once they're already empty.
  if (parsed.data.autoTasksEnabled === false) {
    const doomed = await db
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(eq(tasksTable.assignedTo, id));
    const taskIds = doomed.map((t) => t.id);
    if (taskIds.length) {
      await db.delete(notificationsTable).where(inArray(notificationsTable.taskId, taskIds));
      await db.delete(taskTransfersTable).where(inArray(taskTransfersTable.taskId, taskIds));
      await db.delete(tasksTable).where(inArray(tasksTable.id, taskIds));
      req.log.info({ userId: id, removed: taskIds.length }, "Deleted tasks for auto-tasks opt-out");
    }
  }

  const users = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
  const managerMap = new Map(users.map((m) => [m.id, m.name]));
  return res.json(sanitize(user, user.reportsTo ? (managerMap.get(user.reportsTo) ?? null) : null));
});

router.delete("/:id", async (req, res) => {
  // Deleting a user is a manager action; a regular employee must not be able to
  // remove accounts via a direct API call. A Team Leader may remove ONLY a Sales
  // Agent from their own team (org-chart subtree) — never a manager or another
  // team's agent.
  const me = req.user!;
  const isTL = me.role === "Team Leader";
  if (!isBoss(me) && !isAllCentersViewer(me) && !isCenterHead(me) && !isTL) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const id = parseInt(req.params.id);
  if (isTL && !isBoss(me) && !isAllCentersViewer(me) && !isCenterHead(me)) {
    const roster = await db
      .select({
        id: usersTable.id,
        reportsTo: usersTable.reportsTo,
        role: usersTable.role,
        username: usersTable.username,
      })
      .from(usersTable);
    const target = roster.find((u) => u.id === id);
    const subtree = buildHierarchySet(me.id, roster);
    // A TL may only remove the login-less Sales Agents in their own subtree — never a
    // manager, a login-enabled account, another team's agent, or themselves.
    if (
      !target ||
      target.role !== "Sales Agent" ||
      target.username != null ||
      id === me.id ||
      !subtree.has(id)
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }
  await db.delete(usersTable).where(eq(usersTable.id, id));
  return res.json({ success: true });
});

export default router;
