---
name: Unified DateRangePicker & EOD range semantics
description: How the shared date-range filter behaves across pages, and why EOD range uses "latest-in-window" instead of summing.
---

# Unified date filtering

Pages using the shared picker: Dashboard, Reports, Task Lists, My Tasks, EOD, **Assignment Monitor**, and **Attendance**.

All date-filtering pages share one reusable picker: a combined start–end field + calendar popover (quick presets: Today, Last 7 days, This week, This month, This year, All time) + a blue "Fetch" button. Selection edits a local draft; nothing applies until Fetch (or All time => empty range). Empty from/to means "all time" on the analytical pages.

**Why:** the user wanted one consistent control everywhere (per screenshot) while keeping the old quick options. Presets live inside the picker so each page no longer needs its own pill row / month input.

**How to apply:** pages keep their own `fromDate`/`toDate` (ISO `yyyy-mm-dd`, "" = unset) state; the picker is presentational and calls `onApply({from,to})`. Pass `disableFuture` where future dates are invalid (EOD).

## `openEnded` prop = "single day means from-that-day-onwards"
By default a single-day calendar pick collapses to that one day, which HID all future tasks on the task lists. The opt-in `openEnded` prop makes a single-day pick mean "that date and everything after" (future included). CRITICAL nuance: react-day-picker in range mode reports a single-day click as `to === from` (NOT `to` empty), so `openEnded` must treat BOTH `to` empty AND `to === from` as open-ended (`to=""`); a genuine multi-day range (`to` strictly after `from`) is preserved. Only checking for an empty `to` is the bug that lets single-day still collapse. Only **Task List + My Tasks** pass `openEnded` (those parents persist `toDate = to || ""`); the date-of-record pages (Team/EOD/Attendance with `disableFuture`, plus Reports/Dashboard/Assignment Monitor) intentionally keep single-day = exact day.
**Why:** user wanted picking a date on the task lists to reveal that day + upcoming tasks, but single-day-as-one-day is correct for attendance/EOD records — so it's per-consumer, not a global flip.

# EOD is single-day, range is read-only "latest snapshot"

EOD metrics are NOT additive across days: HC / Present / Absent are point-in-time headcounts and Sales MTD is already cumulative — summing them over a multi-day window produces misleading totals. So a multi-day (or empty) EOD window shows **each submitter's latest report within the window**, and is **read-only**. Fill/edit is enabled only when a single day is selected (`singleDay = from === to`). Default window is today..today, so default behavior is unchanged.

**Why:** naive per-metric summation (which the consolidated Grand Total does across rows for one day) would double-count headcount and MTD across days.

**How to apply:** keep single-day fetch server-date-scoped (`useListEodReports({ date: singleDay })`) for a light payload; only fetch-all (`{}`) and narrow client-side when a multi-day window is chosen. Gate `onSaveRow`/`editableUserId` (and the fill card) on `singleDay`.

# Attendance follows the same single-day/range pattern

Attendance is identical in shape to EOD: single day → mark + cards/table/today-breakdown; multi-day/empty window → read-only "pick a single day to mark" note + a day-wise clustered bar chart. `mark`/`markAllPresent`/"Mark all present" are gated on `singleDay`; fetch is `useListAttendance(singleDay ? { date: singleDay } : {})`.

# Day-wise cluster charts (EOD + Attendance)

Both pages render a day-wise grouped bar chart over the selected window: Attendance = Present/Half Day/Leave/Absent per day for the chosen center; EOD = Present vs Absent per day summed across visible centers. X-axis label is `date.slice(5).replace("-","/")` (MM/DD); single-day windows yield a 1-group chart. EOD's chart lives in the consolidated (seesAll) block.

**Why:** the user explicitly paired EOD + Attendance for the same day-wise cluster concept; present/absent keeps both on one shared scale.

# Data-scoping is intentionally client-side (do not "fix" as a security bug)

`GET /attendance` and `/eod` return all rows when no `date` is passed; range mode fetches all and narrows in the browser. An architect review may flag this as broken access control — it is **by design** for this internal tool (see `hierarchy-visibility.md`). Do NOT add server-side authz/row-scoping unless the user asks; it would contradict the established design and EOD already ships this exact pattern.
