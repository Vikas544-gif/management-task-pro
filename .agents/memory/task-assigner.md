---
name: Bulk-added JD/routine tasks are personal (no boss assigner)
description: When the user dictates a list of routine/JD/KRA tasks to bulk-add for a person/center, those are the person's OWN tasks — do NOT set assignedBy to the boss.
---

# Bulk-added routine/JD tasks must be personal, not "assigned by boss"

When the user dictates a list of role/JD/KRA recurring tasks to bulk-create for
a person or center, treat them as that person's **own** tasks.

**Rule:** set `assignedBy = NULL` (personal/own task) — NOT the boss (id 1)
and NOT a center head, unless the user explicitly says "X is assigning these to Y".

**Why:** The user objected strongly to cards showing "Assigned by: <the boss>"
on what are really each employee's routine responsibilities. These are personal
"log" tasks, not top-down assignments.

**How to apply:**
- UI already hides the "Assigned by" line when `assignedByName` is null
  (TaskList + MyTasks both guard on `assignedByName &&`). So null = clean card.
- The recurring scheduler copies `assignedBy` from the head into each clone,
  so nulling the head keeps all future occurrences clean too.
- A genuine top-down assignment (e.g. a real TL/Center Head assigning to their
  own team members, same center) keeps that person as `assignedBy` — that's fine
  and the user did NOT want those changed.

## EXCEPTION (June 2026): category 'Routine' tasks DO show the Boss as assigner
The user later reversed this for the **'Routine' category specifically** (e.g.
the auto-issued lunch reminders): those have `assignedBy = NULL` but should
DISPLAY "Assigned by: <Boss>" for everyone, because the Boss issued them.
**Implementation is display-only, server-side** (api-server tasks.ts
`resolveAssignedByName`): `assignedBy != null` → that person; else
`category === 'Routine'` → Boss name; else null. The stored `assignedBy` stays
NULL, so notifications/permissions are unchanged.
**Why:** keeps the data-level "personal task" rule above intact (no DB write, no
extra notify to the Boss) while satisfying the user's display preference. Only
the **Routine** category gets the Boss fallback — other null-assigner tasks stay
clean per the rule above.

## "Assigned by" is user-selectable, but it is an ELEVATED action
The assigner is editable per-task (TaskList Edit modal), but changing who
"assigned" a task must be gated server-side: only `canEditTask` actors
(assigner/Boss/MIS/Center Head) may persist `assignedBy`. For anyone else (e.g.
a plain assignee editing their own task) the field is silently stripped, NOT
rejected — silently ignoring an unauthorized field is the correct boundary
(don't 400 their otherwise-valid edit, don't leak whether an id is valid).
**Why:** reassigning credit for who gave the task is a privilege action, on par
with changing assignedTo; never let the assignee self-edit it.
