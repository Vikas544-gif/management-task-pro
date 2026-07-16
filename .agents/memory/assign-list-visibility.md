---
name: Assign-list visibility (users.assignable)
description: ISS Task Pro — controlling who appears in the Assign Task picker, and why its authz is field-level
---

# Assign-list visibility

- `users.assignable` (boolean, default true) controls ONLY whether a person shows in the "Assign Task" picker (AssignTask dropdown + TaskList EditModal reassign). It does NOT affect login, `status`, hierarchy, or existing tasks.
- Clients treat `assignable === undefined` as ON (back-compat for rows created before the column existed). Filter is `!!u.username && u.assignable !== false`.
- Managed from a Boss/MIS/Director-only "Manage who appears" panel on the Assign Task page (grouped by center). `canManage` mirrors the app's boss convention: `role === "Boss" || department === "Management" || isAllCentersViewer` (MIS/Director).

## Authz is FIELD-LEVEL on PUT /users/:id, not whole-endpoint
- The server guards `assignable` changes specifically: if the request body contains `assignable`, the caller must be `isBoss || isAllCentersViewer`, else 403. Other fields in the same body pass through.
- **Why:** `PUT /users/:id` is shared — the Team page uses it for edits that lower roles are legitimately allowed to make (e.g. a Center Head reassigning a Team Leader's `reportsTo`). Locking the entire endpoint to Boss/MIS/Director would break those flows. So only the new privileged field is gated.
- **How to apply:** when adding any other privilege-restricted user field, gate it the same field-level way inside the existing PUT handler rather than restricting the whole route.

## Assignee dropdowns show center
- Every assignee `<option>` label includes the person's center (e.g. `Name (Role) — Thane Center`) because the same person can exist across centers (esp. after onboarding per-center HR); name+role alone was ambiguous.
