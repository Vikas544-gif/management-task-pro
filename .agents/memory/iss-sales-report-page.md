---
name: ISS Task Pro — Sales Report charts page
description: The /sales-report analytics page in iss-task-pro that charts Agent Tracking metrics (NOT the standalone sales-dashboard artifact)
---

`iss-task-pro` has its own `/sales-report` page (`src/pages/SalesReport.tsx`) — a Recharts dashboard over Agent Tracking metrics. Do NOT confuse it with the standalone `sales-dashboard` artifact's "Sales Report" page (see sales-dashboard.md) — different app, different data.

**Data:** reads `useListAgentMetrics({})` (all rows, no server range filter) + `useListUsers`; window-filters client-side by `[from,to]` (DateRangePicker, defaults This-month). Reuses the same roll-up rule as Team.tsx `aggregateMetricsByAgent`: DC/Prospect/Sales FD SUM across window; Sales MTD/Target/averages keep latest non-null per agent.

**Scoping:** Boss/MIS see all `role === "Sales Agent"` users; Center Head/TL see only their `buildHierarchySet` subtree. Boss/MIS-only center pill filter (shown when >1 center). Gated in NAV_ITEMS + route with `bossOnly+centerHead+tl+mis`.

**Why summing Sales MTD is OK here:** summing MTD across AGENTS = combined team MTD (each agent's MTD is their own). The "don't sum MTD" rule (sales-mtd.md) is about summing across DATES, not agents.

**Filters (web + mobile parity):** two pill/segmented filters — Center (Boss/MIS-only, >1 center) then Team Leader. Pipeline: `scopedAgents → centerAgents (center filter) → displayAgents (TL filter)`. TL filter narrows `centerAgents` to `buildHierarchySet(tlId)` — it can ONLY narrow, never widen scope. TL options = TLs whose subtree intersects `centerAgents`; shown only when >1 TL visible (so a lone TL viewing their own team never sees it). Changing Center resets TL to "All" (cascade). Same logic in `SalesReport.tsx` (buttons) and mobile `sales-report.tsx` (Segmented).
