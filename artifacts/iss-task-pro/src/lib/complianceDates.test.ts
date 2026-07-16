import { describe, it, expect } from "vitest";
import {
  computeDueDate,
  periodKeyForDate,
  urgencyOf,
  nthWorkingDay,
  isoWeek,
  ymd,
  type DueDateInput,
} from "./complianceDates";

// Local date-only constructor — mirrors how the page builds `today` (midnight,
// no timezone surprises). All assertions compare via ymd() so they are agnostic
// to the machine's timezone offset.
const d = (y: number, m1: number, day: number) => new Date(y, m1 - 1, day);

const due = (input: DueDateInput, today: Date) => {
  const r = computeDueDate(input, today);
  return r ? ymd(r) : null;
};

// `today` used for the relative (Monthly / Daily / Weekly) phrases. Picked so the
// month is January 2026 and the day-of-week of `today` is Thursday — both matter
// for the working-day and weekday cases below.
const TODAY = d(2026, 1, 15); // 2026-01-15 is a Thursday

// ──────────────────────────────────────────────────────────────────────────
// computeDueDate — every DISTINCT (dueDateText, frequency) pair in the seed
// (artifacts/api-server/src/lib/complianceSeed.ts). Kept inline rather than
// imported because artifacts must not import from each other.
// ──────────────────────────────────────────────────────────────────────────

describe("computeDueDate — Daily", () => {
  it("'Daily' resolves to today itself", () => {
    expect(due({ frequency: "Daily", dueDateText: "Daily" }, TODAY)).toBe("2026-01-15");
  });
});

describe("computeDueDate — Weekly", () => {
  it("'Every Wednesday' snaps to the Wednesday of today's week", () => {
    // today = Thu 2026-01-15 → that week's Wednesday is 2026-01-14 (the day before)
    expect(due({ frequency: "Weekly", dueDateText: "Every Wednesday" }, TODAY)).toBe("2026-01-14");
  });

  it("returns null when a weekly phrase names no weekday", () => {
    expect(computeDueDate({ frequency: "Weekly", dueDateText: "weekly" }, TODAY)).toBeNull();
  });
});

describe("computeDueDate — Monthly (day-of-month phrases)", () => {
  // The parser deliberately ignores the words "next"/"every" and uses today's
  // month with the extracted day number.
  const cases: [string, string][] = [
    ["6th of next month", "2026-01-06"],
    ["9th of next month", "2026-01-09"],
    ["11th of next month", "2026-01-11"],
    ["15th of next month", "2026-01-15"],
    ["19th of next month", "2026-01-19"],
    ["By 10th of every month", "2026-01-10"],
    ["By 15th of every month", "2026-01-15"],
    ["By 22nd of every month", "2026-01-22"],
  ];
  for (const [text, expected] of cases) {
    it(`'${text}' → ${expected}`, () => {
      expect(due({ frequency: "Monthly", dueDateText: text }, TODAY)).toBe(expected);
    });
  }
});

describe("computeDueDate — Monthly working-day rule", () => {
  it("'By 5th working day' → 5th business day of the month (skips weekends)", () => {
    // Jan 2026: 1=Thu,2=Fri,(3-4 weekend),5=Mon,6=Tue,7=Wed → 5th working day = Jan 7
    expect(due({ frequency: "Monthly", dueDateText: "By 5th working day" }, TODAY)).toBe("2026-01-07");
  });
});

describe("computeDueDate — Quarterly (DD-Mon phrases)", () => {
  // Quarterly/Annual dated phrases take the month/day from the text and the
  // YEAR from today.
  const cases: [string, string][] = [
    ["31-Jul", "2026-07-31"],
    ["31-Oct", "2026-10-31"],
    ["31-Jan", "2026-01-31"],
    ["31-May", "2026-05-31"],
    ["15-Jun", "2026-06-15"],
    ["15-Sep", "2026-09-15"],
    ["15-Dec", "2026-12-15"],
    ["15-Mar", "2026-03-15"],
  ];
  for (const [text, expected] of cases) {
    it(`'${text}' → ${expected}`, () => {
      expect(due({ frequency: "Quarterly", dueDateText: text }, TODAY)).toBe(expected);
    });
  }
});

describe("computeDueDate — Annual (mixed free-text phrases)", () => {
  const cases: [string, string][] = [
    ["31 December following FY", "2026-12-31"],
    ["Generally 31 October (audit cases)", "2026-10-31"],
    ["30-Sep", "2026-09-30"],
    ["30-Jun", "2026-06-30"],
    ["30-May", "2026-05-30"],
    ["By 30 April (internal target)", "2026-04-30"],
    ["By 30 September", "2026-09-30"],
    ["By 15th December", "2026-12-15"],
  ];
  for (const [text, expected] of cases) {
    it(`'${text}' → ${expected}`, () => {
      expect(due({ frequency: "Annual", dueDateText: text }, TODAY)).toBe(expected);
    });
  }
});

describe("computeDueDate — edge cases", () => {
  it("null/empty due text on a non-daily frequency yields no date", () => {
    expect(computeDueDate({ frequency: "Monthly", dueDateText: null }, TODAY)).toBeNull();
    expect(computeDueDate({ frequency: "Annual", dueDateText: "" }, TODAY)).toBeNull();
  });

  it("uses today's year, not a hardcoded one", () => {
    expect(due({ frequency: "Quarterly", dueDateText: "31-Jul" }, d(2030, 2, 1))).toBe("2030-07-31");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// nthWorkingDay — standalone, including a month that starts on a weekend
// ──────────────────────────────────────────────────────────────────────────

describe("nthWorkingDay", () => {
  it("Jan 2026 (starts Thu): 5th working day is the 7th", () => {
    expect(ymd(nthWorkingDay(2026, 0, 5))).toBe("2026-01-07");
  });

  it("Mar 2026 (1st is Sunday): 5th working day is the 6th", () => {
    // Mar 1 2026 = Sun; 2=Mon..6=Fri → 5 working days land on Mar 6
    expect(ymd(nthWorkingDay(2026, 2, 5))).toBe("2026-03-06");
  });

  it("Aug 2026 (1st is Saturday): 1st working day is the 3rd", () => {
    // Aug 1 2026 = Sat, 2 = Sun, 3 = Mon → first working day Aug 3
    expect(ymd(nthWorkingDay(2026, 7, 1))).toBe("2026-08-03");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// periodKeyForDate — one assertion per frequency plus rollover boundaries
// ──────────────────────────────────────────────────────────────────────────

describe("periodKeyForDate — per frequency", () => {
  it("Daily keys by the exact day", () => {
    expect(periodKeyForDate("Daily", d(2026, 1, 15))).toBe("2026-01-15");
  });

  it("Monthly keys by year-month", () => {
    expect(periodKeyForDate("Monthly", d(2026, 1, 6))).toBe("2026-01");
    expect(periodKeyForDate("Monthly", d(2026, 12, 31))).toBe("2026-12");
  });

  it("Annual keys by year", () => {
    expect(periodKeyForDate("Annual", d(2026, 6, 30))).toBe("2026");
  });

  it("Weekly keys by ISO year-week", () => {
    expect(periodKeyForDate("Weekly", d(2026, 1, 14))).toBe("2026-W03");
  });
});

describe("periodKeyForDate — Quarterly boundaries", () => {
  const cases: [Date, string][] = [
    [d(2026, 1, 1), "2026-Q1"],
    [d(2026, 3, 31), "2026-Q1"], // last day of Q1
    [d(2026, 4, 1), "2026-Q2"], // first day of Q2
    [d(2026, 6, 30), "2026-Q2"],
    [d(2026, 7, 1), "2026-Q3"],
    [d(2026, 9, 30), "2026-Q3"], // last day of Q3
    [d(2026, 10, 1), "2026-Q4"],
    [d(2026, 12, 31), "2026-Q4"], // last day of the year/quarter
  ];
  for (const [date, expected] of cases) {
    it(`${ymd(date)} → ${expected}`, () => {
      expect(periodKeyForDate("Quarterly", date)).toBe(expected);
    });
  }
});

describe("periodKeyForDate — Weekly ISO rollover across the year boundary", () => {
  it("late-December days can belong to the next ISO year", () => {
    // 2024-12-31 (Tue) is ISO week 1 of 2025
    expect(isoWeek(d(2024, 12, 31))).toEqual({ year: 2025, week: 1 });
    expect(periodKeyForDate("Weekly", d(2024, 12, 31))).toBe("2025-W01");
  });

  it("early-January days can belong to the previous ISO year", () => {
    // 2022-01-01 (Sat) is ISO week 52 of 2021
    expect(isoWeek(d(2022, 1, 1))).toEqual({ year: 2021, week: 52 });
    expect(periodKeyForDate("Weekly", d(2022, 1, 1))).toBe("2021-W52");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Invariant: the period key is derived from the DUE date, not from "today".
// This is the bug-prone part — a quarterly return due 31-Jul must be tracked
// under Q3 even when the calendar is sitting in some other quarter.
// ──────────────────────────────────────────────────────────────────────────

describe("period key follows the computed due date, not today", () => {
  const periodKeyOf = (input: DueDateInput, today: Date) =>
    periodKeyForDate(input.frequency, computeDueDate(input, today) ?? today);

  it("quarterly '31-Jul' is tracked under Q3 even when today is in Q1", () => {
    const today = d(2026, 2, 10); // February → Q1
    expect(periodKeyOf({ frequency: "Quarterly", dueDateText: "31-Jul" }, today)).toBe("2026-Q3");
  });

  it("quarterly '15-Mar' is tracked under Q1 even when today is in Q4", () => {
    const today = d(2026, 11, 20); // November → Q4
    expect(periodKeyOf({ frequency: "Quarterly", dueDateText: "15-Mar" }, today)).toBe("2026-Q1");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// urgencyOf — bucketing thresholds and completion override
// ──────────────────────────────────────────────────────────────────────────

describe("urgencyOf", () => {
  const today = d(2026, 1, 15);
  const offset = (days: number) => d(2026, 1, 15 + days);

  it("done always wins, regardless of date", () => {
    expect(urgencyOf(offset(-10), true, today)).toBe("done");
    expect(urgencyOf(null, true, today)).toBe("done");
  });

  it("no due date (and not done) is 'none'", () => {
    expect(urgencyOf(null, false, today)).toBe("none");
  });

  it("past due → overdue", () => {
    expect(urgencyOf(offset(-1), false, today)).toBe("overdue");
  });

  it("today and up to 3 days out → due-soon", () => {
    expect(urgencyOf(offset(0), false, today)).toBe("due-soon");
    expect(urgencyOf(offset(3), false, today)).toBe("due-soon");
  });

  it("4 to 14 days out → upcoming", () => {
    expect(urgencyOf(offset(4), false, today)).toBe("upcoming");
    expect(urgencyOf(offset(14), false, today)).toBe("upcoming");
  });

  it("more than 14 days out → ok", () => {
    expect(urgencyOf(offset(15), false, today)).toBe("ok");
  });
});
