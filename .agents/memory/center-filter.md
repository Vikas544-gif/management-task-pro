---
name: Center filter convention
description: How the company-center filter works consistently across ISS Task Pro list/overview pages
---

The Center filter lets the boss (and MIS on Assignment Monitor) scope a page to one company center.

**Rule:** a task has NO center column. A task's center is derived from its *assignee* (`assignedTo` userId → `user.center`). All pages build a `userCenter` Map and filter `userCenter.get(t.assignedTo) === selectedCenter`.

**Where:** Dashboard, Team, TaskList, AssignmentMonitor, Reports, EOD. Dashboard/Team/TaskList/Reports/EOD use pill rows; AssignmentMonitor uses a `<select>` to match its dropdown filter bar. EOD pills are primary-token styled (not Dashboard's cyan hero theme) and use `visibleCenters` (All → all centers, else the one) which drives both the grand-totals block and the per-center card list; selecting a single center hides the now-redundant grand-totals (gated on `visibleCenters.length>1`). EOD has no task-center mapping (it aggregates EOD rows by center directly), so the `userCenter` rule below doesn't apply there.

**Reports role scoping (differs):** boss/MIS (`seesAll = isBoss || isMis`) see all centers + get the Center filter; a Center Head sees their WHOLE center (`u.center === myCenter`) + their own assigned tasks — NOT just their hierarchy subtree; everyone else falls back to `buildHierarchySet` subtree. Reports also derives its Department filter options from the scoped users (don't hardcode — the old list was missing Operations/Management).

**Display order:** `["Head Office","Thane Center","Malad Center","Pune Center","Navi Mumbai Center"]`, unknowns last, then alphabetical.

**Gating:** only render the control when there is more than one center in scope (`centerOptions.length > 1`), and on AssignmentMonitor only for boss/MIS (`seesAll`). Center Heads naturally see a single center so the control hides itself.

**MIS = 4 outer centers only, NEVER Head Office (as of June 2026):** MIS (isMis = `department==="MIS"`) sees/manages ONLY Thane/Malad/Pune/Navi Mumbai — never Head Office. This SUPERSEDES the old "MIS = Boss-level full access". Only the Boss (`isBoss`) is truly full-access. The MIS rule everywhere = users where `center && center !== "Head Office"`.
**Why:** Head Office holds Boss+MIS+management; MIS must not view their credentials or manage them.
**How to apply (read paths):** Dashboard `allowedIds`, Reports `scopeBase`, Team list, AssignmentMonitor (require BOTH assigner AND assignee non-Head-Office) all filter out Head Office for MIS. Credentials are *server*-filtered: `GET /users/credentials?excludeCenter=Head Office` (Hierarchy sends this for MIS) so Head Office passwords never reach the MIS client.
**How to apply (write paths — easy to miss):** every center-write must enforce the allowlist for MIS, not just reads: Hierarchy add (`handleAdd` coerce + add-form reset default to an outer center), Hierarchy row edit (constrained `<select>` of `centerChoices` + `handleField` rejects "Head Office"), Team `MemberDetail` edit (constrained select + save guard). Free-text center inputs are a recurring leak — use a select for MIS.
`canView = isBoss || isMis || isCenterHead`.

**Sidebar nav gating (`components/layout/Sidebar.tsx`):** NAV items use `bossOnly`/`centerHead`/`mis` flags. `/hierarchy` and `/reports` are visible to Boss+CenterHead+MIS; `/monitor` same. If you scope a page for a role, you MUST also add that role's flag to its NAV item or the page is unreachable for them.

**Add-user center dropdown:** the New-User center field (Hierarchy `allCenterOptions`, Team `CENTERS`) always offers all 5 standard centers (CENTER_ORDER) unioned with discovered centers, so Boss can pick a center even when no user exists there yet.

**Why:** keeps boss overview consistent and avoids clutter for single-center users. **How to apply:** when adding the filter to a new list page, reuse the same Map + ordered-options + reset-dependent-filters-on-change pattern; selecting a center should reset dept/member selections to "All".
