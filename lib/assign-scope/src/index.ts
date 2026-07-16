// ── Assign Task assignee-picker scope ──────────────────────────────────────
// WHO appears in a viewer's "Assign To" / "Assigned By" pickers. SHARED between
// the web app (Assign Task page + Edit Task modal) and the native mobile app so
// both clients stay in lockstep. This is the ASSIGN scope, deliberately SEPARATE
// from a viewer's task-DATA scope: a viewer may assign to people whose tasks they
// cannot otherwise see.
//
// The audience rules live in CODE (durable across restarts/rollbacks) rather than
// per-viewer DB rows, with one exception: an admin-set `assignVisibleUserIds`
// override (Access Control) takes precedence over everything when present.

const HEAD_OFFICE_NAME = "Head Office";

// People who SEE EVERYONE in their picker. Boss (role) + Management/MIS/Director
// (department) qualify automatically; these named staff get the same all-access
// view but do NOT get picker-manage rights.
const SEES_EVERYONE = new Set<string>(["Rupali Pawar", "Sonali Pawar", "Ketaki Vaidya"]);
// Head-Office staff who see every Head-Office colleague (and nothing outside HO).
const SEES_ALL_HEAD_OFFICE = new Set<string>([
  "Mahesh Doifode",
  "Saloni Bhosale",
  "Rohit Tetgure",
]);
// On TOP of all-Head-Office, these viewers also see EVERY center's HR people.
const ALSO_SEES_ALL_CENTER_HR = new Set<string>([]);
// Viewers who see EVERY outer center fully, but in Head Office only the core
// set (Boss + MIS + Accounts pair).
const SEES_ALL_CENTERS = new Set<string>(["Shridhar Walawalkar"]);
// IT support person every branch viewer (all roles, any center) can always see.
const IT_SUPPORT = new Set<string>(["Shridhar Walawalkar"]);
// Accounts staff that branch Center Heads + HR can see (NOT Team Leaders).
const ACCOUNTS_PAIR = new Set<string>(["Rupali Pawar", "Sonali Pawar"]);

/** All-centers viewer predicate (MIS or Director department). */
function isAllCentersViewer(
  u: { department?: string | null } | null | undefined
): boolean {
  return !!u && (u.department === "MIS" || u.department === "Director");
}

export type AssignUser = {
  id: number;
  name: string;
  username?: string | null;
  role?: string | null;
  department?: string | null;
  center?: string | null;
  assignable?: boolean | null;
  assignVisibleUserIds?: number[] | null;
};

/**
 * Resolve the set of people `me` may pick in an assign dropdown, from the full
 * user list. Returns only login users (no Sales Agents) who aren't hidden via
 * `assignable === false`. Precedence:
 *   1. `me.assignVisibleUserIds` (admin override) — when non-null it is the SINGLE
 *      source of truth (even `[]` = show nobody); all rules below are bypassed.
 *   2. "Sees everyone" (Boss / Management / MIS / Director / named all-access) → all.
 *   3. Named all-Head-Office / all-centers audiences.
 *   4. Default branch scoping: all Head Office staff + own center + Boss + MIS +
 *      IT support, plus the Accounts pair for Center Heads / HR.
 */
export function resolveAssignableUsers<T extends AssignUser>(
  me: T | null | undefined,
  allUsers: T[]
): T[] {
  const loginUsers = allUsers.filter((u) => !!u.username && u.assignable !== false);
  if (!me) return [];
  const customVisible = me.assignVisibleUserIds ?? null;
  if (customVisible !== null) {
    const allowSet = new Set(customVisible);
    return loginUsers.filter((u) => allowSet.has(u.id));
  }
  const canManage =
    me.role === "Boss" || me.department === "Management" || isAllCentersViewer(me);
  const seesEveryone = canManage || SEES_EVERYONE.has(me.name);
  if (seesEveryone) return loginUsers;
  const seesAllHeadOffice = SEES_ALL_HEAD_OFFICE.has(me.name);
  const seesAllCenters = SEES_ALL_CENTERS.has(me.name);
  const myCenter = me.center ?? null;
  const isVisible = (u: T): boolean => {
    // Everyone can assign to / from any Head Office colleague — Head Office staff
    // are visible in every viewer's picker regardless of the viewer's center.
    if (u.center === HEAD_OFFICE_NAME) return true;
    if (seesAllCenters) {
      if (u.center !== HEAD_OFFICE_NAME) return true;
      if (u.role === "Boss") return true;
      if (u.department === "MIS") return true;
      if (ACCOUNTS_PAIR.has(u.name)) return true;
      return false;
    }
    if (seesAllHeadOffice) {
      if (u.center === HEAD_OFFICE_NAME) return true;
      if (ALSO_SEES_ALL_CENTER_HR.has(me.name) && u.department === "HR") return true;
      return false;
    }
    if (u.center === myCenter) return true;
    if (u.role === "Boss") return true;
    if (u.department === "MIS") return true;
    if (IT_SUPPORT.has(u.name)) return true;
    if ((me.role === "Center Head" || me.department === "HR") && ACCOUNTS_PAIR.has(u.name))
      return true;
    return false;
  };
  return loginUsers.filter(isVisible);
}
