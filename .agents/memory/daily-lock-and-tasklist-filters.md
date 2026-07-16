---
name: TaskList filters (daily lock REMOVED)
description: ISS Task Pro TaskList — All-tab date default, My Tasks toggle; the daily past-date edit lock was removed at user request (July 2026).
---

# TaskList type-tab date defaults
- `defaultDateFilter(type)`: **all AND daily → mode "all" (no date restriction)**; weekly → current Mon–Sun; monthly → current month.
- **Why:** user wants previous (past-due) and future tasks to stay VISIBLE rather than disappear. Users narrow by date via the date filter when needed.

# Daily past-date lock — REMOVED (July 2026)
- The old rule (past-due daily tasks read-only except Boss/MIS/that-center's Center Head, `isPastDailyLocked` in `@/lib/utils` + 🔒 Locked badges in TaskList & MyTasks) was **fully removed on the user's explicit request ("locked system nikal de")**.
- Everyone can now edit/status-change/delete past daily tasks per the normal `canEditTask`/`canOpenEditTask`/`canDoTask` rules. Do NOT re-add the lock unless the user asks again.
- Reminder that still applies: the app has TWO task surfaces — `TaskList.tsx` (table) AND `MyTasks.tsx` (cards). Any behavior change must be applied to both.

# "My Tasks" quick filter
- A toggle pill (`onlyMine`) next to the type tabs; filters to `assignedTo === currentUser.id`. Orthogonal to the type tabs (can combine with Daily/Weekly/etc).

# KPI summary cards → drill-down task table modal
- TaskList's 5 KPI cards (Pending/In Progress/Completed/Total/Done Rate) **open a popup task table** (`openDetail`/`closeDetail`, state `detailStatus`/`detailPerson`/`detailSort`), NOT in-place `filterStatus` toggling anymore. This mirrors the modal that already exists in `Dashboard.tsx`.
- Modal base list = current `filtered` set → status subset → per-assignee chips with counts → A→Z/Z→A name sort → table (Task+category / Assigned To / status badge / Due).
- Row click calls `closeDetail()` then `setEditingTask(t)` to open the shared EditModal (both overlays are z-50, so closing detail before opening edit avoids stacking conflicts). Editability follows `canOpenEditTask`.
- **Why:** user wanted the same Dashboard-style drill-down table on TaskList; the pill filter panel still handles in-place status filtering separately.
