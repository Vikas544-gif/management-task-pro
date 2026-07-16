import { buildHierarchySet, isAllCentersViewer } from "@/lib/utils";

/**
 * A single navigation entry / controllable app section.
 *
 * Role-default visibility flags mirror the original Sidebar logic. Two special
 * markers exist:
 *   - `always`  → page can never be restricted (Dashboard). Everyone keeps it,
 *                 so a user can never be locked out of the app entirely.
 *   - `system`  → page is governed by role defaults ONLY and is never part of a
 *                 per-user override (Access Control itself). This stops a Boss
 *                 from accidentally removing their own access to this page.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: string;
  bossOnly?: boolean;
  teamOnly?: boolean;
  centerHead?: boolean;
  mis?: boolean;
  tl?: boolean;
  accounts?: boolean;
  always?: boolean;
  system?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/my-tasks", label: "My Tasks", icon: "✅" },
  { href: "/tasks", label: "All Tasks", icon: "📋" },
  { href: "/tasks/daily", label: "Daily Tasks", icon: "📅" },
  { href: "/tasks/weekly", label: "Weekly Tasks", icon: "📆" },
  { href: "/tasks/monthly", label: "Monthly Tasks", icon: "🗓" },
  { href: "/assign", label: "Assign Task", icon: "➕" },
  { href: "/team", label: "Team", icon: "👥" },
  { href: "/holidays", label: "Holidays", icon: "🎉" },
  { href: "/attendance", label: "Attendance", icon: "🗓", bossOnly: true, centerHead: true, mis: true },
  { href: "/eod", label: "EOD Report", icon: "📝", bossOnly: true, centerHead: true, tl: true, mis: true },
  { href: "/hierarchy", label: "Credentials & Hierarchy", icon: "🔑", bossOnly: true, centerHead: true, mis: true },
  { href: "/monitor", label: "Assignment Monitor", icon: "🕵", bossOnly: true, centerHead: true, mis: true },
  { href: "/access", label: "Access Control", icon: "🔐", bossOnly: true, mis: true, system: true },
  { href: "/reports", label: "Reports", icon: "📈" },
  { href: "/sales-report", label: "Sales Report", icon: "💰", bossOnly: true, centerHead: true, tl: true, mis: true },
  { href: "/settings", label: "Email Settings", icon: "✉", bossOnly: true, mis: true },
];

/** Sections a Boss/MIS may turn on/off per user (excludes always-on & system). */
export const CONTROLLABLE_ITEMS = NAV_ITEMS.filter((i) => !i.always && !i.system);

export interface PermUser {
  id: number;
  role?: string | null;
  department?: string | null;
  pagePermissions?: string[] | null;
}

export interface PermDirectoryUser {
  id: number;
  reportsTo?: number | null;
}

/**
 * Whether a section is visible to a user purely by their role/department/team —
 * the behaviour before any manual per-user override is applied.
 */
export function roleDefaultVisible(
  item: NavItem,
  user: PermUser | null | undefined,
  allUsers: PermDirectoryUser[]
): boolean {
  if (!user) return false;
  const isBoss = user.department === "Management" || user.role === "Boss";
  const isCenterHead = user.role === "Center Head";
  const isMis = isAllCentersViewer(user);
  const isTl = user.role === "Team Leader";
  const isAccounts = user.department === "Accounts";
  const hasTeam = buildHierarchySet(user.id, allUsers).size > 1;

  if (
    item.bossOnly &&
    !isBoss &&
    !(item.centerHead && isCenterHead) &&
    !(item.mis && isMis) &&
    !(item.tl && isTl) &&
    !(item.accounts && isAccounts)
  ) {
    return false;
  }
  if (item.teamOnly && !isBoss && !hasTeam && !(item.mis && isMis)) return false;
  return true;
}

/**
 * Final access decision for a given route, combining role defaults with the
 * per-user override. The override is **restriction-only**: it can hide sections
 * a role would normally see, but can NEVER grant a section the role isn't
 * entitled to. This keeps hard role-gated pages (e.g. Compliance, Credentials)
 * from being exposed to an unauthorized user via a custom list.
 *   - `always` items   → always accessible (Dashboard).
 *   - `system` items   → role defaults only (override is ignored).
 *   - override is null  → role defaults (status quo).
 *   - override is array → role-allowed AND explicitly listed.
 */
export function canAccessPage(
  user: PermUser | null | undefined,
  allUsers: PermDirectoryUser[],
  href: string
): boolean {
  if (!user) return false;
  const item = NAV_ITEMS.find((i) => i.href === href);
  if (!item) return true; // unknown route (e.g. detail pages) — not gated here
  if (item.always) return true;
  if (item.system) return roleDefaultVisible(item, user, allUsers);
  const roleAllowed = roleDefaultVisible(item, user, allUsers);
  const perms = user.pagePermissions;
  if (perms == null) return roleAllowed;
  return roleAllowed && perms.includes(href);
}

/**
 * The first nav destination this user is allowed to open, used as the landing
 * page. The Dashboard (`/`) is now Boss/MIS-only, so a non-Boss/MIS user who
 * hits the bare `/` URL is redirected here instead of an access-denied screen.
 * Falls back to "/my-tasks", which every logged-in user can access.
 */
export function firstAccessiblePath(
  user: PermUser | null | undefined,
  allUsers: PermDirectoryUser[]
): string {
  for (const item of NAV_ITEMS) {
    if (item.href === "/") continue;
    if (canAccessPage(user, allUsers, item.href)) return item.href;
  }
  return "/my-tasks";
}
