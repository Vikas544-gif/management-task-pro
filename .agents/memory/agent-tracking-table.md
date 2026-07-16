---
name: Agent Tracking table (Team page)
description: Conventions for the Excel-like per-agent tracking table on the Team page (iss-task-pro)
---

# Agent Tracking table

A toggle on the Team page (Cards | Agent Tracking) renders `AgentTrackingTable`. Per-agent editable
row of metrics + attendance for a selected date.

## Tenure is always DERIVED from DOJ (never stored/editable)
- Label format the user requires: `"X Year(s) Y Month(s) Z Day(s)"` (e.g. "1 Year 4 Months 15 Days").
- Bucket has EXACTLY 3 values: `0-3 Months`, `3-6 Months`, `6+ Months` (boundaries at 3 and 6 whole months).
- **Why:** user explicitly asked for the long-form label and only-3 buckets.
- **How to apply:** parse DOJ with `parseDojLocal` (split YYYY-MM-DD into local components) — NOT `new Date(doj)`,
  which UTC-shifts and can break month/day math at edges. `tenureMonths` derives from `tenureBreakdown`.

## TL assignment, NOT credentials, in this table
- The table does **not** show agent Username / New Password columns (user reversed the earlier credential-edit ask).
- The "TL Name" column is an editable `<select>` (assign/change TL) shown only to Boss/Center Head on **non-TL rows**;
  it writes `users.reportsTo` via the user-update endpoint, so the hierarchy/table reflect the new TL immediately.
- TL dropdown options come from a dedicated `tlPool` prop (center-scoped, NOT department-tab-scoped), NOT from the
  rendered `agents` list. **Why:** deriving from `agents` let the active department tab empty the TL dropdown even when
  valid TLs existed. `tlPool = trackingBase Team Leaders filtered by centerFilter only`.
- **Why:** "CenterHead TL assign karega; jo TL ke under ho wo dikhe; TL change ho to reflect ho."

## Tracking rows = TLs/agents only; Center Head filter
- `trackingBase` excludes role==="Center Head" and role==="Boss" — managers are NOT tracked rows; only their TLs/agents appear.
  **Why:** user complained Center Heads were showing as rows in Agent Tracking ("Center Head q show ho raha, udhar agents show").
- A **Center Head filter** pill row shows in tracking view (only when >1 head): "All Heads" + each head; selecting one shows
  that head's people. Match via `headAncestorId(id)` which walks `reportsTo` up to the first Center Head (guarded ≤20).
- Department tabs render in **cards view only**; the head-pill row replaces them in tracking view.
- `headFilter` (number|"All") resets to "All" on view toggles + center-pill clicks; a useEffect also auto-resets it if the
  selected head leaves scope so the table never silently empties.

## Agent Tracking is CENTERS-only; Boss/MIS see all 4 centers
- The tracking view excludes Head Office entirely: `trackingBase = teamToShow minus Head Office`; `displayBase =
  view==="tracking" ? trackingBase : teamToShow` drives centerOptions/deptSource/filtered. Cards view is unchanged.
- Boss visibility is **role-guaranteed, not hierarchy-derived**: `isBoss` (department==="Management" || role==="Boss")
  → `teamToShow = allUsers except self`. MIS → non-Head-Office users. Others → org subtree via hierarchyIds.
  **Why:** relying on `reportsTo` chains meant a broken/missing org link could hide a whole center from the Boss; the
  user requires Boss to always see Thane/Pune/Navi Mumbai/Malad (same as MIS).
- In tracking view, `centerOptions` always offers the 4 standard centers (Thane/Malad/Pune/Navi Mumbai) as pills even
  if a center has 0 members; empty centers just yield an empty-state table (safe). Switching to tracking resets
  `centerFilter` to "All" if it was "Head Office".
- Center Head "Add Member" form defaults its center to the adder's own center (`myCenter` from allUsers).

## Metrics
- All numeric/avg fields (DC, Prospect Count, Sales FD, Sales MTD, Last 3M/6M Avg) are MANUAL, save-on-blur,
  keyed per (agentId, date) in `agent_metrics` (unique agentId+date). Attendance dropdown saves on change.
- Data scoping is client-side only (consistent with the app's no-server-authz internal-tool design).

## Active/Inactive status + Add/Remove agents (June 2026)
- `users.status` is an enum text column (`Active` default | `Inactive`), constrained as an OpenAPI enum on User/UserInput/UserUpdate.
- Agent Tracking view has a Status filter pill row (Active | Inactive | All) defaulting to **Active**, applied in `filtered` only in tracking view.
- "+ Add Agent" button (tracking view only) opens a form: name, email, DOJ, center, reportsTo (TL or Center Head of chosen center, **required** to avoid orphan agents outside non-boss hierarchy visibility), status. Username auto-generated unique from email local-part/name slug. New agents are role "Sales Agent", dept "Sales", with the shared dev default password.
- Per-row ✕ removes an agent via the existing handleDelete (passed as `onRemove` prop).
- **Gotcha:** adding an `enum` to a string field in openapi.yaml makes orval generate a literal-union type (UserInputStatus/UserUpdateStatus); plain-`string` values at mutation call sites then fail TS2322 and need `as "Active" | "Inactive"` casts.
- The 88 real agents (Infinity_List Excel) were imported once via the REST API (no xlsx pkg in env; unzip + parse sharedStrings.xml/sheet1.xml), mapped center "Thane"→"Thane Center" etc. Not in source — a one-time data op.

## Cards vs Tracking are role-SEPARATED (June 2026)
- **Cards view** renders managers ONLY: `filtered` keeps `role === "Team Leader" || role === "Center Head"` (Sales Agents excluded). **Why:** user wanted TLs/agents un-mixed — "cards me bas TL, agents nahi".
- **Agent Tracking view** renders Sales Agents ONLY: `trackingBase` is now a positive allowlist `role === "Sales Agent"` (no longer just excluding Head/Boss/TL). Each agent's TL auto-fills from `reportsTo` (nameById lookup / pre-selected dropdown).
- **Gotcha:** since trackingBase excludes Team Leaders, `tlPool` (TL-assignment dropdown source) MUST derive from `teamToShow`, NOT trackingBase, or the dropdown goes empty.
- Center pills in tracking add all four centers ONLY for Boss/MIS (`isBoss || isMis`); a Center Head sees just their own center(s) — earlier code force-added all 4 to everyone. centerOptions deps include isBoss/isMis.
- Some agents report directly to a Center Head (centers with no TL, e.g. Navi Mumbai) — their TL column shows the head name / "Unassigned" in the reassign dropdown; expected, not a bug.

## Sales Agents have NO login (June 2026)
- `users.username` and `users.password` are NULLABLE (Postgres unique index allows many NULLs). OpenAPI User/UserInput no longer require username/password. **Why:** user insisted agents must not have an id/password — only managers who actually use the app get credentials.
- Sales Agents are created with `username=null, password=null`; existing agents had creds nulled in DB. Login matches by username so null-username users simply can't log in (intended).
- `/users/credentials` filters `isNotNull(username)` so agents never appear in the boss/head credential viewer.
- **Rule:** Sales Agents (no login) must be excluded from ALL credential/member-selector lists, not just the credentials endpoint. Client-side these views filter `!!u.username`: Hierarchy credentials table, Dashboard "All Members" bubble filter, Reports member filter. **Why:** user repeatedly flagged agents cluttering these manager-facing lists; agents live only in the Team-page agent table. If a new page adds a member/people picker, apply the same `!!u.username` filter.
- **Gotcha:** any UI reading `user.username` must null-guard (e.g. Hierarchy inputs use `u.username ?? ""`) or typecheck/render breaks.

## Add Agent / TL form (role toggle)
- The tracking-view "+ Add Agent / TL" form has a role dropdown (Sales Agent | Team Leader). TL choice reveals required Username/Password and restricts "Reports to" to Center Heads; agents get null creds, TLs get entered creds. This is how a NEW Team Leader is created.

## TL filter in Agent Tracking
- Pill row mirrors the Center Head filter: pick a TL → see only that TL's agents (`u.reportsTo === tlFilter`). tlOptions derive from tlPool scoped by center + selected head; tlFilter resets to All on view/center/head change + a safeguard effect when the TL leaves scope.

## Agent Tracking is a TL DRILL-DOWN, not a flat list (June 2026)
- Default tracking view (`tlFilter === "All"`) renders a **TL TABLE** (rows = tlOptions entries — TLs + direct-owning Center Heads; cols = TL Name w/ avatar, Role, Center, Agents count, Sales FD, Sales MTD, DC, Prospect Count, "View team →"). Clicking a row sets tlFilter and opens only that TL's `AgentTrackingTable` under a `"{name}'s Team"` heading. **Why:** user wanted "ek TL view, TL click karu tabhi uske agent ka data" — not all agents at once; AND explicitly asked the TL roll-up be a TABLE matching the Agent Tracking grid, NOT cards/boxed tiles ("ye box type mat de", "aisa type chaiye TL ka").
- Clickable `<tr>` MUST stay keyboard-accessible: `role="button"` + `tabIndex={0}` + `onKeyDown` Enter/Space + focus-visible ring; action column header needs an `sr-only` label. (architect fails the build otherwise.)
- TL roll-up per row = a per-team SUM for the selected `trackDate`: agent count + SUM of the team's agents' Sales FD, Sales MTD, DC, Prospect Count. **Why:** "TL me sab agent ka sales/dc/count sum hoke dikhe."
- Roll-up = a `tlAgg` memo grouped by `reportsTo`, using the SAME center/head/status scope as `filtered` (minus tlFilter) so a card's numbers match the table that opens on click. It builds a metricByAgent map from `useListAgentMetrics({ date: trackDate })` (lifted to TeamPage) and sums `Number(m.field) || 0` (null-safe). Sales MTD is summed across agents = team combined MTD for that date (per-agent MTD is each agent's own month-to-date).
- AgentTrackingTable has a `<tfoot>` **Grand Total** row: a `colTotals` memo sums each numeric metric column (DC, Prospect, Sales FD, Sales MTD, Last 3M/6M Avg) from the live `drafts` across `displayAgents` (so it respects tenure/name filters AND reflects unsaved inline edits), + a present-headcount from statusByAgent (present=1, half_day=0.5). Footer = colSpan 7 label + metric cells + 2 trailing empties = 16 cols. **Note:** Last 3M/6M Avg are SUMMED like the rest (not averaged) — revisit if user wants avg semantics.
- The TL pill row is the in-drill quick-switcher: render it whenever `tlFilter !== "All"` (do NOT gate on `tlOptions.length > 1`, or a single-TL scope loses its `← All TLs` back control). Inside that row tlFilter is narrowed to `number`, so the back pill is a plain button (no `tlFilter === "All"` comparison — that's a TS2367).

## Center Heads appear alongside TLs anywhere an agent's manager is listed (June 2026)
- An agent may report directly to a Center Head (not only a TL), so Center Heads must show in BOTH the "Team Leader" filter pills AND the per-row "TL Name" assignment `<select>`, labeled `"<name> (Center Head)"`.
- Per-row dropdown: parent passes a `headPool` prop (Center Heads in `teamToShow`, center-scoped, non-Head-Office) next to `tlPool`; the component's `tlOptions` lists heads first, then TLs.
- **Gotcha:** `teamToShow` EXCLUDES the viewer (`u.id !== currentUser.id`), so a Center Head viewing their own team would get an empty `headPool` and couldn't assign an agent to THEMSELVES. `headPool` must add the viewer back when they are an in-scope Center Head (10+ Thane agents report directly to their head, so self-assignment is real). The filter-pill heads don't hit this because they resolve via `userById` (all users), not teamToShow.
- Filter pills: `tlOptions` appends Center Heads that DIRECTLY own ≥1 agent — derive them from a **center-scoped** agent set (`trackingBase` filtered by `centerFilter`), NOT raw trackingBase, or an out-of-center head can be picked → empty table (and the reset-to-All safeguard won't catch it since it only checks tlOptions membership).
- **Why:** user repeatedly flagged "Center Head q nahi ho raha, uske paas team hai na" — heads with direct reports were missing from both the filter and the assign dropdown.

## MIS/Boss editing, header dropdowns, Remark column (June 2026)
- **Permissions:** `canAssignTl` = Boss || MIS || Center Head (MIS added). `canAssignCenter` = Boss || MIS only — Center becomes an editable `<select>` (options = AGENT_CENTERS: Thane/Malad/Pune/Navi Mumbai) for them; `saveCenter` updates `users.center`. No "Unassigned" option (agents always have a center; UserUpdate.center is non-nullable so sending undefined would no-op).
- Changing center does NOT reconcile `reportsTo` — cross-center TL is allowed by design (the per-row TL `<select>` is filter-scoped, not per-agent-center scoped, so cross-center assignment was already possible). Don't "fix" this by auto-clearing reportsTo.
- **Header dropdowns:** Agent Name `<select>` = sort A→Z/Z→A; Agent Tenure `<select>` = bucket filter (All/0-3/3-6/6+ Months). Both applied in a `displayAgents` memo; tenure filter uses SAVED `a.doj` (intentionally stable — not the draft, so rows don't vanish while typing a DOJ). Render `displayAgents`, not `agents`.
- **Remark column:** per agent+date, stored as `agent_metrics.remark` (text). Seeded into `remarkDraft` from metrics; saved through the SHARED `saveMetrics` upsert (blur on remark writes ALL metric drafts too — intentional coupling). Full-stack: schema + OpenAPI AgentMetric/AgentMetricInput + server upsert pass-through + codegen.

## Name-sort dropdown convention (app-wide, June 2026)
- The A→Z/Z→A header `<select>` (local `nameSort: "az"|"za"` state, replicated from Team.tsx) lives on the people/name column of EVERY roster/people table: Team "Agent Name", Attendance "Name", Eod CenterConsolidated "Team", Dashboard detail-modal "Assigned To". Add it to any NEW people table too.
- Always sort a COPY (`[...rows]`/`[...list]`) for display only — never reorder the source used for totals/KPIs (Eod aggregates + Attendance counts must stay order-independent). Add `nameSort` to memo deps where the sorted list is memoized (Attendance). Use `normal-case` on the select since header rows are uppercased.

## Sales Agents are tracking-only (product rule, user-confirmed June 2026)
Sales Agents exist ONLY in Team page → Agent Tracking. They have NO login (username/password null), NO tasks, and must NOT be added or surfaced anywhere else (excluded from Team Cards view, never in task views). Purpose: performance tracking only — the TL talks to each agent, collects their numbers, and manually enters the per-(agentId,date) metrics on their behalf. Agents never use the app themselves. Don't "helpfully" give Sales Agents logins, tasks, or Cards-view presence.

## Agent Tracking view access (restricted, June 2026)
The Team page's "Agent Tracking" toggle/view is visible ONLY to Boss, MIS (isAllCentersViewer), Center Head, and Team Leader (`canSeeTracking`). Regular staff (e.g. Accounts Executive) get the Cards view only — toggle hidden + a useEffect forces view back to "cards". Also gate the tracking data hooks (useListAgentMetrics, useListAttendance) with `enabled: canSeeTracking` so unauthorized users don't fetch agent names/metrics over the network even with the tab hidden.
**Why:** TLs must enter their agents' numbers so they need access; everyone else seeing agent names was the reported bug. Backend /api/agent-metrics + /api/attendance are NOT role-scoped (client-side scoping only, DEV) — revisit if this ever ships to prod.

## Team Leaders manage their own team server-side (July 2026)
Team Leaders can add/remove and edit status/center of ONLY the login-less Sales Agents in their OWN org-chart subtree — server-enforced in users.ts, matching the UI affordances they already saw (which used to 403).
- **Server gate rule** (POST create, PUT status/center, DELETE): a TL branch is allowed only when target `role === "Sales Agent"`, `username == null` (no login), `id !== me.id`, and `buildHierarchySet(me.id, roster).has(id)`. Center changes by a TL must keep `center === me.center` (no cross-center transfers). Admin (Boss/MIS) and Center Head paths are unchanged.
- **Why:** the login-less + subtree + own-center constraints prevent a TL from promoting, editing, or deleting managers, login-enabled accounts, other teams' agents, or themselves via the shared PUT/DELETE endpoint (broken-access-control risk the architect flagged).
- **UI:** for a TL the Add Agent form locks role to Sales Agent, center to `myCenter`, and reportsTo to their own subtree (`hierarchyIds`); the inline center dropdown in the tracking table is limited to `myCenter`. Keep UI restrictions in lockstep with the server gate so TLs never see an affordance that 403s.

## Sales MTD highlight + progress bar (June 2026)
Agent Tracking's Sales MTD column highlights zero (red cell tint + red input border/text) and shows a per-agent progress bar UNDER the input. Bar is scaled RELATIVE to the top performer's Sales MTD among currently-displayed agents (`maxMtd` memo), NOT an absolute target — there is no target field. Fill color is percentile-graded (orange<34 / amber<67 / green≥67); zero shows an empty red track. Blank input is treated as 0 (so unfilled agents also light up red — intended, makes "no sales" easy to spot).
**Why:** user wanted to spot zero-sales agents fast + visual ranking. If product later wants absolute target tracking, add a configurable target and compute against it instead of maxMtd.

- **Target column (July 2026):** added a per-(agentId,date) manual `target` integer metric alongside dc/prospectCount/salesFd/salesMtd (schema+openapi+route+Team.tsx METRIC_FIELDS). Rendered right after Sales MTD; summed in Grand Total (unlike Sales MTD which is not summed).

- **Sales MTD % = achievement vs Target:** the Sales MTD progress bar in Team.tsx shows salesMtd/target (capped 100), NOT '% of top performer' (old maxMtd logic removed). Shows '—' when the agent has no target set.
- **Date is a [from,to] WINDOW, not a single day (July 2026):** the tracking date picker now feeds `trackFrom`/`trackTo` (child props `from`/`to`; was single `date`). **Why:** picking any preset range (e.g. "This month") used to drop `to` and collapse to one usually-empty day → all zeros. `isSingleDay = from && from===to` is the ONLY editable mode (day-scoped metric/attendance queries, `enabled: isSingleDay`). Any wider selection — a range OR "All time" (from empty) — is READ-ONLY and rolled up per agent via aggregateMetricsByAgent() over `windowMetrics` (all rows filtered `date>=from && date<=to`; the API has NO range filter so window client-side). `isAllDates` var = `!isSingleDay` (means "aggregated/read-only", covers ranges too). Roll-up: dc/prospectCount/salesFd SUM across in-window dates; salesMtd/target/averages/remark keep LATEST non-null (rows newest-first). presentByAgent uses windowAttendance (present-days); statusByAgent uses the single day. Grand Total, CSV export (filename reflects range), per-TL tlAgg all use the window aggregate. saveMetrics/saveAttendance write `date: from`, guarded `if(!from) return`, invalidate {date:from}+{} keys. Never save in aggregated mode.

- **Target carries forward (standing goal, not daily):** Target is a per-agent goal, not a daily figure. Even though it's stored per (agent,date) in agent_metrics, the UI carries the last-set (latest non-null) target onto every date incl. future ones, and never sums it. Implemented via a separate all-metrics query (useListAgentMetrics({})) → latestTargetByAgent, used to prefill the single-date draft when that date has no target. aggregateMetricsByAgent keeps latest NON-NULL (not just first-row) for ALL point-in-time fields (salesMtd/target/avgs/remark) so a blank newest day doesn't wipe an earlier value. saveMetrics MUST invalidate BOTH getListAgentMetricsQueryKey({date}) AND ({}) or carry-forward goes stale until reload.
- **Sales MTD % uncapped label:** achievement % label shows the real value even >100 (e.g. 6/target 4 = 150%, green), while the progress-bar FILL width is clamped 0–100 (barPct). Don't re-cap the label at 100 — that misreads overachievement as exactly on-target.
