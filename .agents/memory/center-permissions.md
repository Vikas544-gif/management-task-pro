---
name: Per-user center access (centerPermissions)
description: The restriction-only invariant behind per-user center access in ISS Task Pro, and where it must be enforced.
---

`users.centerPermissions` lets an admin limit which company centers a Boss/MIS-level
(all-centers) viewer may see.

**Restriction-only invariant (the whole point):** a custom set can only ever NARROW
what the role already allows, never widen it. It is always intersected with the role
ceiling (all centers for Boss; outer centers only — never Head Office — for
MIS/Director). `null` = role default (no restriction). A custom set can therefore
never make Head Office visible to an MIS/Director viewer, nor grant any center the
role didn't already include.
**Why:** an access-control change must never escalate privilege — a UI bug or a
tampered request must not be able to grant beyond the role.

**Strict boundary (no own-task exception):** when a custom center set is active, the
restriction is absolute — a viewer does NOT keep their own (assigned-to/assigned-by)
tasks if those tasks live in a disallowed center. The own-task exception only applies
to BASE role scoping (when there is no custom restriction). Keeping the boundary
strict is what makes a direct `/tasks` call unable to leak disallowed-center data and
keeps the server consistent with the client's center filtering.

**Enforce on EVERY center-scoped server read, from `req.user` (never query params):**
`/tasks` (scopeTasks), `/users/credentials`, `/eod`, and the `GET /users` directory.
Two easy misses: (1) `GET /users` and `/eod` must apply the role ceiling
(MIS/Director exclude Head Office) even when `centerPermissions == null`, because
`allowedCentersFor` returns null at the default and would otherwise leak Head Office;
(2) on the directory/credentials reads keep the viewer's own row so a Head-Office MIS
user still sees themselves.

**Pitfall — client resolution:** the slim `currentUser` prop does NOT carry
`centerPermissions`; resolve it from the full user row in the users list, or the
restriction silently no-ops on the client.

**Role-grant authz (June 2026):** the user-mutating routes now field-guard
privilege escalation. `role`/`department`/`status` on `PUT /users/:id`, and account
creation on `POST /users`, require the caller to be a manager (Boss/MIS/Director OR
Center Head); `DELETE /users/:id` is manager-only. On top of that, granting a
*privileged* role (`Boss`/`Center Head`) or an admin department
(`Management`/`MIS`/`Director`) requires a FULL admin — a Center Head can manage their
team's non-manager roles but can never mint another manager/admin (incl. themselves).
**Why:** without this any authenticated user could `PUT`/`POST` themselves to Boss.
**How to apply:** keep `assignable`/`pagePermissions`/`centerPermissions` as the
admin-only field-guard, and keep role/dept/status on the manager+privileged-grant
guard; don't collapse the two — Center Heads need role/dept but not the admin fields.
Still NOT scoped per-center: a Center Head can currently edit users in other centers
(separate follow-up).
