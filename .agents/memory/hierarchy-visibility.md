---
name: ISS Task Pro hierarchy visibility
description: How hierarchy/role data-visibility is enforced (client UX + real server-side auth/scope as of June 2026)
---

> **UPDATE June 2026 — real server-side auth + scope now exist.** See
> [server-auth.md](server-auth.md). The client-side rules below are still the UX
> layer, but the API is no longer wide-open: every `/api` route (except health +
> `/auth/login`/`/auth/logout`) requires a signed session cookie, and the
> sensitive read endpoints (tasks incl. `:id`/aggregates, `/users/credentials`,
> notifications) are scoped/owned server-side too. Passwords were deliberately
> NOT hashed (Boss plaintext viewer kept). Treat the "client-side only" framing
> below as historical for those endpoints.

> **UPDATE June 2026 (2) — MIS/Director now SEE Head Office TASKS.** The long-standing
> "all-centers viewer = outer centers, NEVER Head Office" rule was reversed for TASK/DATA
> VISIBILITY at the owner's request ("MIS ko Head Office ke tasks bhi dikhao, sab jagah").
> `isAllCentersViewer` (MIS||Director) view-scope now includes Head Office on FOUR surfaces:
> **TaskList (All Tasks), Dashboard, Reports, Team** (each page's `isMis ? ... : ...` view-base
> now spans all users), AND server-side `scopeTasks` `baseVisible` allViewer branch = `centerOk(t)`
> (same entitlement as Boss). **STILL Head-Office-EXCLUDED for MIS (intentionally NOT changed):**
> AssignmentMonitor (client both-sides-non-HO privacy rule), EOD (`eod.ts` `roleCenters.delete(HEAD_OFFICE)`),
> `/users/credentials` (own `ne(center,HEAD_OFFICE)`), and the centerPermissions CEILING
> (`allowedCentersFor` server + `resolveAllowedCenters` client still `delete(HEAD_OFFICE)` for custom sets —
> so if a MIS user is ever GIVEN a custom centerPermissions set, Head Office silently drops again; no user
> has a custom set today so default null-path = sees all). **WRITE restrictions unchanged:** MIS still cannot
> assign/move anyone TO Head Office (Team/Hierarchy forms). Many "MIS never Head Office" comments below are
> now historical for the four view surfaces.

# Hierarchy-based visibility

Every task/user view is gated by `buildHierarchySet(currentUser.id, users)` in `lib/utils.ts` (BFS over `reportsTo`). Returns the user's own id + all direct/indirect reports.

**Rules in effect:**
- Boss (`seesAll` = allowedIds.size >= users.length) sees everything; short-circuit returns all tasks.
- Non-boss sees a task only when `assignedTo` is in their subtree OR `assignedBy === currentUser.id` (delegated). Unassigned tasks are NOT shown to non-boss — do not re-add a `!t.assignedTo` allowance (that was a leak).
- Member filter pills and TaskList EditModal reassignment list are built from the subtree, not the full user list.
- **AssignTask assignee dropdown** — NOT gated by `buildHierarchySet` (user explicitly wanted ANY user assignable so anyone can be emailed a task). Do not re-add the hierarchy gate. **Exception:** a **Center Head OR Team Leader** (`isCenterScoped = role==='Center Head' || role==='Team Leader'`) is center-scoped — they can assign within their own center **PLUS Boss & Head-Office MIS** (escalation path), and nobody else from Head Office. (TLs were added to this scope June 2026 — previously only Center Heads were scoped and TLs saw everyone, which the user reported as a bug.) Predicate: `u.center===myCenter || u.role==='Boss' || (u.department==='MIS' && u.center==='Head Office')`. Use `role==='Boss'` (NOT `department==='Management'`) and gate MIS to `center==='Head Office'` — broader predicates leaked other Management/MIS staff (architect flagged). Future depts added to the head's own center (e.g. HR) appear automatically via `center===myCenter`. Current user's role+center are derived from the loaded `users` list (`me = users.find(id)`) because the `currentUser` prop only carries `{id,name}`. Boss, MIS, and all other staff keep the full list. Center values are full strings: `"Head Office"`, `"Thane Center"`, `"Malad Center"`, `"Pune Center"`, `"Navi Mumbai Center"`. AssignTask Department dropdown (`DEPTS`) includes `"Operations"` so selecting a Center Head (dept Operations) auto-fills/displays correctly.
- `Reports` is open to **ALL logged-in users** (June 2026 — nav gating removed from the `/reports` item in Sidebar). Scoping is hierarchy-wise: Boss/MIS/Director = seesAll (outer centers), Center Head = own center, everyone else = their `buildHierarchySet` subtree (so a Team Leader downloads their own team incl. their agents/reports). Only the **email-send** UI stays `isBoss`-gated and `useGetEmailSettings` is `enabled: isBoss`; the Download CSV button + center pills are universal/`seesAll`-gated. Agents have no tasks so they add no rows, but TLs still get their team scope.
- `Credentials & Hierarchy` is accessible to boss AND Center Heads (`role==='Center Head'`), but Center Heads are scoped to **their own center only**: page derives `myCenter` from the users list, `baseUsers` filters to that center, and center filter pills + inline center editing are boss-only (center read-only for heads). **Server-scoped credentials:** `GET /users/credentials` takes an optional `?center=` query param — Center Heads pass their center so other centers' plaintext passwords never reach the client cache (boss omits it → gets all). The query key includes the param so boss/head caches don't collide. This is the one place where server-side scoping IS applied (passwords are sensitive), unlike the otherwise client-only visibility model.
- `Assignment Monitor` (who-assigned-what) is visible to **Boss + MIS department** (both `seesAll` → all centers) AND **Center Heads** (own center only). Route is open in App.tsx; the page enforces `canView`. Center-Head scoping is **strict**: a row shows only when BOTH `assignedBy` and `assignedTo` map to the head's center (AND, not OR — OR leaked the other center's participant names; architect flagged). Filter dropdowns + stats all derive from the scoped rows. Center mapping is via `userCenter` (userId→center), same client-side rule as Dashboard (tasks have no center column).
- **MIS sees "All Tasks" (TaskList) scoped to outer centers (June 2026)**: MIS reports to Boss with no subtree, so `buildHierarchySet` alone gave it only its own tasks. TaskList now mirrors the Dashboard MIS pattern — `isMis` short-circuits `allowedIds` to all non-Head-Office user ids, and the delegated-task clause is gated `(!isMis && t.assignedBy===currentUser.id)` so MIS's own Head-Office delegated tasks never leak in. Sidebar `/tasks` item got `mis:true` and the `teamOnly` gate now allows MIS (`!(it.mis && isMis)`) so the nav link shows. **Why:** user wanted a role that sees ALL outer centers' data, Head Office excluded — `department:"MIS"` is that role everywhere now (Dashboard/Team/EOD/Attendance/Reports/Hierarchy/Monitor + now All Tasks). Keep the MIS scope predicate identical across Dashboard & TaskList if you touch either.
- **My Tasks shows both sides of a task** (user request: "a task should show to both the giver and the receiver"): `assignedTo===me || assignedBy===me`. But tasks you only *delegated* (`assignedBy===me && assignedTo!==me`) are **monitoring-only** — status renders as a read-only badge, and edit/delete are hidden. **Why:** giving the giver full controls let them mark someone else's task done from My Tasks, firing wrong completion semantics (architect flagged). Manage delegated tasks from Task List instead.

**Data export / download:** Tasks report download (client-side CSV, Excel-openable, UTF-8 BOM) lives on the Task List header and is available to **all** users — it exports the current `filtered` task set, no passwords. **Do NOT add a credentials/password export** — the user explicitly rejected ("aisa mat kar") a boss-only Hierarchy CSV that included plaintext passwords. Any hierarchy/user export must exclude passwords.

**Why it was client-side only (historical):** Originally an internal tool with no real auth — login identity lived in `localStorage` (`iss_user`), API had no authn/authz, and the boss credential-viewer (plaintext passwords) is an intentional feature. Architect repeatedly flagged the missing server-side authz. **As of June 2026 the user asked for real auth and it was added** (signed session cookie + server-side scope) — see [server-auth.md](server-auth.md). The client rules above remain as the UX layer (still drive nav/visibility), but they are no longer the only enforcement for the protected read endpoints.

## "Director" department = MIS visibility twin (June 2026)
The "all outer centers, never Head Office" viewer scope is now centralized in
`isAllCentersViewer(u)` in `lib/utils.ts` = `department === "MIS" || department === "Director"`.
Every CURRENT-VIEWER `isMis` flag across pages + Sidebar (Dashboard, TaskList, Eod,
Team [both `isMisUser` and `isMis` + add-form center default], Attendance, Reports,
Hierarchy, AssignmentMonitor) is computed from this helper, so a **Director mirrors
MIS exactly** (visibility, seesAll, canView, canMark, tracking-table edit rights, nav).
"Director" is a **department** (added to Hierarchy `DEPTS` + Team add-member dropdown),
NOT a role — chosen because department is a controlled dropdown and, critically, avoids
the boss-trap: `isBoss = department === "Management" || role === "Boss"`, so a Director
must never be put in Management dept or given role Boss (would leak Head Office).
**Leave untouched** the OTHER-USER (target) MIS predicates — they are NOT viewer flags:
AssignTask escalation (`u.department === "MIS" && u.center === "Head Office"`) and
Reports `scopeBaseUsers` (`(u.center !== "Head Office") || u.department === "MIS"`).
**Why:** user wanted a senior person under the Boss with MIS-identical reach but a
non-MIS label. To add another such role later, just extend `isAllCentersViewer`.

**Director is STRICTER than MIS — it must NOT see MIS's own Head-Office data.**
MIS has a couple of "see my own Head-Office stuff" extras that Director must NOT
inherit. Those spots are gated on **real MIS dept** via
`isMisDept = currentUser.department === "MIS"` (NOT the `isAllCentersViewer` helper):
- `Reports.tsx` `scopeBase`: the `|| u.department === "MIS"` inclusion (which pulls
  MIS members into a non-boss seesAll viewer's scope) is now `(isMisDept && u.department === "MIS")`.
- `Attendance.tsx` `centerOptions`: Head Office is offered only for `isBoss || isMisDept`.
Everywhere else (Dashboard/TaskList/Team/Eod/AssignmentMonitor/Hierarchy) MIS already
scopes by `center !== "Head Office"`, so Director excludes Head Office (hence MIS) for free.
Director CAN still **assign** tasks to MIS & Boss — AssignTask isn't center-scoped for
Director (`isCreScoped` only covers Center Head/Team Leader), so it gets the full list;
"don't SEE MIS data" ≠ "can't assign TO MIS". Director creation: Boss + MIS both reach
the Hierarchy add form (canView) and "Director" is in the dept dropdown.

## MIS Reports scope includes own MIS-department tasks (June 2026)
In Reports.tsx, MIS users are scoped to the four outer centers PLUS their own
MIS-department members (`(center !== 'Head Office') || department === 'MIS'`), so
MIS (the MIS Executive sitting in Head Office) can see & CSV-download
their OWN tasks. All OTHER Head Office staff (management/boss) stay hidden from MIS.
**Why:** user wanted "MIS ko apna data download karne do" without exposing management.
A "Head Office" center pill now appears for MIS but only contains MIS members.

## Own-tasks must always be visible (MIS Head-Office edge case)
MIS (isAllCentersViewer) is scoped to the four OUTER centers and excludes Head Office. Since MIS users themselves sit in Head Office, a task they created/own (assignedTo or assignedBy === me) was being filtered OUT of their own All Tasks view (TaskList hierarchyTasks). Rule: every visibility filter must ALWAYS include the user's own tasks (assignedTo===me OR assignedBy===me) ON TOP of hierarchy/center scope — this is narrow (only their own tasks, not broad Head Office work) and mirrors the My Tasks page + server scope.ts. Also: the "👤 My Tasks" quick-filter pill on All Tasks must use assignedTo===me OR assignedBy===me (not assignedTo only), else it goes blank for the Boss who has 0 tasks assigned to himself.

## Server/client scope parity (verified) + Center-Head invariant
Verified by simulating both scopeTasks (server) and TaskList hierarchyTasks (client) against live data: they return the SAME task set for all users — IF a Center Head's reporting subtree (buildHierarchySet) equals their center membership. Server scopes CH by center; client scopes CH by reportsTo subtree. Currently every center member chains up to its Center Head, so the two are identical. CAVEAT: if a user is ever placed in a center but reports to someone outside that center's CH subtree, the client All Tasks page will hide that user's tasks from the CH even though the server returns them. Keep reportsTo consistent with center, or switch the client CH scope to center-based to match the server.

## Center Head credentials view hides HR (July 2026)
On the Credentials & Hierarchy page, a **Center Head's** view HIDES their center's
HR staff (department "HR") entirely — both username (ID) and password — while still
showing their Team Leaders AND their own row. Enforced server-side in
`GET /users/credentials` (isCenterHead scope adds `ne(department,"HR")`) AND mirrored
in Hierarchy.tsx `loginUsers` filter (`hideHrFromCenterHead = isCenterHead && !seesAll`).
**Boss and MIS/Director views are unchanged** (MIS still sees all non-Head-Office
login users incl. branch HR + Center Heads). **Why:** the original "HR/Center-Head creds
not show" request was about the Center Head's own view, NOT the MIS view — an initial
MIS-scoped attempt was rejected ("aisa nhi") and reverted.
