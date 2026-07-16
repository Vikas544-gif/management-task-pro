// Pure, date-only (IST) helpers behind the Compliance Calendar's due-date
// highlighting and the server-side compliance task generator. Kept in a shared
// lib so the client (calendar UI) and the server (task generation) parse the
// same human due-date rules from one source of truth: a wrong parse here
// silently shows the wrong urgency, loses a completion tick across a period
// boundary, or generates a task with the wrong due date / period key.

const MONTH_IDX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const WD: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

// Minimal shape needed to compute a due date — the page passes a full
// ComplianceItem, but only these two fields matter.
export interface DueDateInput {
  dueDateText?: string | null;
  frequency: string;
}

export function istToday(): Date {
  const ymdStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${ymdStr}T00:00:00`);
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isoWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

// Period the activity is tracked by — completion resets each new period. Derived
// from the computed due date (not from "today") so the period key always agrees
// with the deadline being shown — e.g. a quarterly return due 31-Jul is tracked
// under that date's quarter, not whichever quarter the calendar happens to be in.
export function periodKeyForDate(frequency: string, d: Date): string {
  switch (frequency) {
    case "Daily":
      return ymd(d);
    case "Weekly": {
      const { year, week } = isoWeek(d);
      return `${year}-W${String(week).padStart(2, "0")}`;
    }
    case "Monthly":
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    case "Quarterly":
      return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    case "Annual":
      return String(d.getFullYear());
    default:
      return ymd(d);
  }
}

function firstInt(text: string): number | null {
  const m = text.match(/(\d{1,2})/);
  return m ? parseInt(m[1]!, 10) : null;
}

function parseMonthDay(text: string): { month: number; day: number } | null {
  const m = text.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
  if (!m) return null;
  const month = MONTH_IDX[m[1]!.toLowerCase()];
  const day = firstInt(text);
  if (month === undefined || day === null) return null;
  return { month, day };
}

export function nthWorkingDay(year: number, monthIdx: number, n: number): Date {
  let count = 0;
  for (let day = 1; day <= 31; day++) {
    const d = new Date(year, monthIdx, day);
    if (d.getMonth() !== monthIdx) break;
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) {
      count++;
      if (count === n) return d;
    }
  }
  return new Date(year, monthIdx, Math.min(7, n));
}

// Concrete due date for the current period, derived from the human due-date rule.
export function computeDueDate(item: DueDateInput, today: Date): Date | null {
  const text = item.dueDateText ?? "";
  const f = item.frequency;
  if (f === "Daily") return today;
  // "Month end" → last day of the current month; "Quarter end" → last day of
  // the current quarter. Checked before the month-name parser (neither text
  // contains a month name, but keep them early for clarity).
  if (/month\s*end|last\s*day/i.test(text)) {
    return new Date(today.getFullYear(), today.getMonth() + 1, 0);
  }
  if (/quarter\s*end/i.test(text)) {
    const qEndMonth = Math.floor(today.getMonth() / 3) * 3 + 2;
    return new Date(today.getFullYear(), qEndMonth + 1, 0);
  }
  if (f === "Weekly") {
    const m = text.toLowerCase().match(/sunday|monday|tuesday|wednesday|thursday|friday|saturday/);
    if (!m) return null;
    const wd = WD[m[0]]!;
    const d = new Date(today);
    d.setDate(d.getDate() + (wd - d.getDay()));
    return d;
  }
  const md = parseMonthDay(text);
  if (md) return new Date(today.getFullYear(), md.month, md.day);
  if (f === "Monthly") {
    if (/working day/i.test(text)) return nthWorkingDay(today.getFullYear(), today.getMonth(), firstInt(text) ?? 5);
    const n = firstInt(text);
    if (n !== null) return new Date(today.getFullYear(), today.getMonth(), n);
  }
  return null;
}

export type Urgency = "done" | "overdue" | "due-soon" | "upcoming" | "ok" | "none";

export function urgencyOf(due: Date | null, done: boolean, today: Date): Urgency {
  if (done) return "done";
  if (!due) return "none";
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "overdue";
  if (diff <= 3) return "due-soon";
  if (diff <= 14) return "upcoming";
  return "ok";
}
