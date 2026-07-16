---
name: Assign Task assignee-picker scoping
description: How the Assign Task people dropdown decides who's visible — the code-based rule shape, and why it is NOT in the DB.
---

# Assign Task picker visibility

The picker is a client-side UX convenience; the server enforces real auth/scope
separately (see server-auth.md). `assignable=false` on a row hides a person from
EVERYONE (Boss/MIS toggle this in the Assign-Task "manage" panel).

## The rule lives in a SHARED LIB (July 2026): `@workspace/assign-scope`
`resolveAssignableUsers(me, allUsers)` + the named audience Sets now live in
`lib/assign-scope/src/index.ts`, imported by BOTH the web app AND the native
mobile app (artifacts/iss-mobile/app/assign-task.tsx) so the two clients never
drift. Web `lib/utils.ts` just re-exports it (`export { resolveAssignableUsers,
type AssignUser } from "@workspace/assign-scope"`), so all web callers are
unchanged. The lib carries its OWN internal `isAllCentersViewer` (MIS||Director)
so it needs no artifact imports (artifacts can't import each other). To change the
rule, edit the lib ONCE. Mobile only scopes the Assign screen picker; its other
useListUsers screens (eod/team/reports/attendance/all-tasks) keep the full
directory for name lookups — do NOT scope those.
**Earlier (June 2026):** the same helper had lived in web lib/utils.ts, shared by
the Assign Task page AND the TaskList Edit Task modal. This is the **ASSIGN scope**, kept
deliberately SEPARATE from a viewer's task-DATA scope (`visibleUsers`): a viewer
may assign to people whose tasks they cannot otherwise see. The Edit modal passes
`editAssignUsers` (= helper result + the task's current assignee/assigner merged
in so existing select values never render blank), NOT `visibleUsers`.
**Why:** the user complained the Edit Task assign dropdown showed almost nobody —
it was wrongly bound to the narrow data scope. Broadening the data scope was
explicitly rejected ("DATA nahi dikhana, sirf assign me sab companies dikhe").
**How to apply:** change the audience RULE in one place (utils.ts Sets); never
re-bind an assign picker to `visibleUsers`/hierarchy data scope.

## The rule lives in CODE, not the DB (June 2026)
Per-viewer DB overrides (`users.assignVisibleUserIds`) proved NON-durable — they
were silently wiped (checkpoint/rollback reset every row to null), which regressed
the whole rule. So the systematic visibility rule is now encoded entirely in named
Sets at the top of AssignTask.tsx (committed = durable, survives restarts/rollbacks).
**How to apply:** express any company-wide visibility RULE in those code Sets; reserve
the DB override only for genuine one-off per-person tweaks, and never rely on it for
rules that must survive a reset.

## Current rule shape (names live ONLY in the code Sets, never here)
- `seesEveryone` = Boss (role) + MIS (department) + a named Accounts pair → see all
  login users. `canManage` (Access Control rights) is Boss/MIS/Director only and is
  intentionally separate from `seesEveryone` (the Accounts pair sees all but can't manage).
- `SEES_ALL_HEAD_OFFICE` (a few named Head-Office staff incl. the HO IT person) → see
  every Head-Office colleague and nothing outside HO, EXCEPT one named HR viewer who
  also sees every center's HR (`ALSO_SEES_ALL_CENTER_HR`).
- Everyone else = branch viewers (Center Head / Team Leader / branch HR), center-scoped:
  own center + Boss + MIS + a fixed IT-support person (`IT_SUPPORT`, all roles). Center
  Heads + HR ALSO see the Accounts pair (`ACCOUNTS_PAIR`); Team Leaders are excluded
  from the Accounts pair.

**Why this shape:** the user iterated toward a role/group model (CH vs TL vs branch-HR
vs specific HO people) rather than per-person maps. The Accounts-pair role gate and the
HO IT person's own view have flip-flopped repeatedly — treat both as user-tunable, not
fixed. Unspecified-on-last-spec defaults baked in: branch HR mirrors Center Head; the
HO IT person mirrors the other HO staff (sees all HO) — flagged to the user for correction.

## Server directory (GET /users) — NOW server-enforced for non-elevated viewers (July 2026)
`GET /users` returns the full directory ONLY to elevated viewers (Boss/Management, MIS/Director — with `centerPermissions` narrowing still applied). For everyone else the server filters to: self ∪ `resolveAssignableUsers(me, users)` (the shared assign-scope rule) ∪ own org-chart subtree (`buildHierarchySet` — keeps non-login Sales Agent rows for Team/agent-tracking/reports).
**Why:** old installed mobile APKs (built before the shared assign-scope lib) showed the RAW directory in their Assign Task picker, so restricted branch users saw everyone; the user refused to redistribute a new APK, so the picker rule had to be enforced server-side. Verified a branch TL leaks zero other-center users while Boss still gets the full list.
**How to apply:** if a non-elevated page ever needs a user outside this union (e.g. name lookups), widen the UNION in users.ts — do NOT revert to an unscoped directory. The subtree part is what keeps Sales Agents visible; don't drop it.
An earlier MIS/Director "exclude Head Office" directory rule was REMOVED because it starved the Assign Task picker — elevated viewers must keep the full directory.

## Admin override (still present, but secondary)
`users.assignVisibleUserIds` (jsonb number[] | null), set by Boss/MIS on Access Control,
still short-circuits an individual viewer's picker when non-null (empty `[]` = nobody).
NULL = use the code rule. Do NOT use it to encode systematic rules (see durability note).

## Head Office visible to everyone (July 2026)
The assign pickers (Assign To + Assigned By, via resolveAssignableUsers) now show
ALL Head Office staff to EVERY viewer, regardless of center — added `if (u.center
=== "Head Office") return true;` at the top of `isVisible`. Branch viewers (TLs,
Center Heads, HR) previously saw only own center + Boss + MIS + IT support; now they
also see all Head Office colleagues. Boss/MIS (seesEveryone) unchanged.
**Why:** user wanted anyone to be able to assign to/from any Head Office person.
