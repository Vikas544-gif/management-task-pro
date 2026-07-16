// ── Recurrence period helpers ──────────────────────────────────
// Recurring tasks (daily/weekly/monthly) are auto-generated once per
// period. A "period key" uniquely identifies the current period for a
// given task type so we never generate the same occurrence twice.
// All dates are computed in India Standard Time so day boundaries match
// the team's local day (cron also runs in this timezone).
export const SCHEDULER_TZ = "Asia/Kolkata";

export const RECURRING_TYPES = ["daily", "weekly", "monthly", "quarterly", "annual"] as const;

export function isRecurringType(type: string): boolean {
  return (RECURRING_TYPES as readonly string[]).includes(type);
}

// "YYYY-MM-DD" for the given instant, in IST.
export function istDateStr(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: SCHEDULER_TZ });
}

// A chronologically-sortable key identifying the period a date falls in.
//   daily   -> "YYYY-MM-DD"
//   weekly  -> Monday of that week, "YYYY-MM-DD"
//   monthly -> "YYYY-MM"
// String comparison (<, >) on keys of the same type is chronological.
export function periodKey(type: string, d: Date = new Date()): string {
  const dateStr = istDateStr(d);
  if (type === "annual") return dateStr.slice(0, 4); // "YYYY"
  if (type === "quarterly") {
    const month = Number(dateStr.slice(5, 7));
    return `${dateStr.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`;
  }
  if (type === "monthly") return dateStr.slice(0, 7);
  if (type === "weekly") {
    const [y, m, day] = dateStr.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, day));
    const dow = dt.getUTCDay(); // 0 Sun .. 6 Sat
    const diff = dow === 0 ? -6 : 1 - dow; // shift back to Monday
    dt.setUTCDate(dt.getUTCDate() + diff);
    return dt.toISOString().slice(0, 10);
  }
  return dateStr; // daily
}

// ── Working-day rules (weekend policy, July 2026) ──────────────
// Daily recurring tasks are only generated on days the assignee actually
// works:
//   • Sunday        — everyone is off (someone working anyway can use the
//                     "Generate Today's Tasks" button on the Dashboard).
//   • 1st Saturday  — the whole company (all centers + MIS) is off.
//   • Other Saturdays — Head Office is off EXCEPT the MIS department;
//                     Thane/Malad/Pune/Navi Mumbai centers and MIS work.
//   • Mon–Fri       — everyone works.
// NOTE: the same rule is mirrored client-side in the iss-task-pro app
// (isNonWorkingDayFor in src/lib/utils.ts) to decide when to show the
// off-day banner — keep the two in sync.
export const HEAD_OFFICE_CENTER = "Head Office";
export const MIS_DEPARTMENT = "MIS";

// Day of week (0=Sun .. 6=Sat) for a "YYYY-MM-DD" string — pure UTC math,
// timezone-safe.
export function dayOfWeekStr(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// True when the date is the FIRST Saturday of its month.
export function isFirstSaturdayStr(dateStr: string): boolean {
  return dayOfWeekStr(dateStr) === 6 && Number(dateStr.slice(8, 10)) <= 7;
}

// Whether `dateStr` is a non-working day for the given user. A missing user
// (unassigned task) is treated as Head Office non-MIS — the most restrictive
// weekend rule.
export function isNonWorkingDayFor(
  user: { center: string | null; department: string | null } | undefined | null,
  dateStr: string,
): boolean {
  const dow = dayOfWeekStr(dateStr);
  if (dow === 0) return true; // Sunday: everyone off
  if (dow !== 6) return false; // Mon–Fri: everyone works
  if (isFirstSaturdayStr(dateStr)) return true; // monthly all-off Saturday
  const center = user?.center ?? HEAD_OFFICE_CENTER;
  const isMisDept = (user?.department ?? "") === MIS_DEPARTMENT;
  return center === HEAD_OFFICE_CENTER && !isMisDept;
}
