---
name: Access Control (per-user page access)
description: ISS Task Pro per-user section/page visibility override on top of role defaults
---

# Access Control

Boss/MIS-only page (`/access`) to control, per user, which app sections appear/are reachable.

## Model
- `users.pagePermissions`: `string[] | null`. **NULL = follow role defaults** (status quo); a non-null array is the list of route hrefs the user may open.
- **Overrides are RESTRICTION-ONLY:** `canAccessPage` = role-allowed AND (perms==null OR href in perms). A custom list can only *hide* sections the role already allows — it can NEVER *grant* a section the role isn't entitled to. **Why:** otherwise a crafted/edited list could expose a hard role-gated page (Compliance, Credentials) to an unauthorized user. So the AccessControl UI shows non-role sections disabled ("not for this role").
- Single source of truth lives in client `lib/permissions.ts`: `NAV_ITEMS` (role-default flags), `roleDefaultVisible()` (mirrors the old Sidebar role logic), `canAccessPage()`. Sidebar AND App.tsx route guards both consume `canAccessPage` so a hidden section can't be reached by typing its URL.

## Lockout / escalation invariants (don't remove)
- Email Settings `/settings` is **Boss/MIS-only** (`bossOnly+mis`). Because it's role-gated (not `always`/`system`) it appears in the AccessControl checklist as restrictable for Boss/MIS and "not for this role" for everyone else.
- **Dashboard `/` is now OPEN TO EVERYONE (June 2026, reversed an earlier Boss/MIS-only decision):** NAV_ITEM lost `bossOnly/mis`. Safe because the Dashboard is fully client-scoped per viewer (`buildHierarchySet`/`allowedIds`/`isAllCentersViewer`) — a non-Boss/MIS user only sees their own hierarchy, and the center-filter pills render only for `seesAll||isMis`. Do NOT re-add the gating unless the user reverses this.
- **All Tasks `/tasks` is now OPEN TO EVERYONE (June 2026):** its NAV_ITEM lost the `teamOnly/mis` flags so regular employees see it in the sidebar and can reach the per-row **Transfer** button (transfer feature was useless otherwise). Safe because the task list is server-scoped via `scopeTasks` exactly like the always-open Daily/Weekly/Monthly pages (same component/data) — a regular user only sees their own scoped tasks. Do NOT re-add the gating unless the user reverses this.
- **Reports `/reports` is now OPEN TO EVERYONE (reverted June 2026), data scoped per viewer.** The nav item lost its `bossOnly/mis` flags and `reports.ts` dropped `requireBossOrMis`; each report route + the `/send` paths now scope tasks via `scopeTasks(req.user!, users, ...)` inside `buildReport`. So a non-Boss user gets 200 and sees only their own scoped data. Do NOT re-add `requireBossOrMis` to reports unless the user reverses this.
- Lockout is prevented NOT by `always` but by `firstAccessiblePath()` (permissions.ts): App.tsx `/` route redirects a non-Boss/MIS user to their first accessible page (My Tasks) instead of an access-denied Dashboard. My Tasks has no role flags so every login keeps it.
- `system` items (Access Control `/access` itself) are governed by role defaults ONLY and are never part of an override array → a Boss can't accidentally remove their own access, and the page can't be granted to a non-eligible user via a custom list.
- **Why:** an explicit allow-list could otherwise (a) lock the editor out of the very page that fixes it, or (b) be used to surface a privileged page. Keep the `system` marker on `/access`; keep the `/` redirect when touching NAV_ITEMS.
- Server side: Dashboard reads (tasks/users) already scope per role; Reports (`/reports/*`) is now public-but-scoped (see above); Email (`/email/*`) router is still gated by `requireBossOrMis` middleware (middlewares/auth.ts, reuses scope.ts `isBoss`/`isAllCentersViewer`) → non-Boss/MIS get 403.

## Enforcement boundary (intentional)
- `pagePermissions` is a **UI route/nav gate only**. Sensitive DATA endpoints (compliance, credentials, etc.) keep their own server-side role/subtree scoping — adding a section via a custom list only adds the menu link; the page's own hard gate still applies. If stronger page-level guarantees are ever needed, add matching server authz.
- Server write side IS guarded per-field on `PUT /users/:id` (shared endpoint, 403 the FIELD not the whole request):
  - `assignable` / `pagePermissions` / `centerPermissions` → admin only (`isBoss || isAllCentersViewer`).
  - `role` / `department` → admin only. **Why:** these are escalation vectors (role "Boss", or department "Management"/"MIS"/"Director" flips `isBoss`/`isAllCentersViewer`); without this gate any logged-in user could self-promote. Hierarchy.tsx role/department cells are read-only for non-admins (`seesAll`) to match.
  - `status` (Active/Inactive) → admin + Center Head + Team Leader. **Why:** it's agent-management (Team-page Agent Tracking), used by the same `canSeeTracking` roles; NOT a privilege vector, so don't lock it to admins or you break legit Center Head/TL agent edits.
  - All other fields (name, username, center, reportsTo, email, doj, password) stay open to any authed role (broader per-row scoping is a separate concern).
