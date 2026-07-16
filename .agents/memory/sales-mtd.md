---
name: Sales MTD feature
description: Design decisions for the per-user month-to-date sales tracking feature in ISS Task Pro.
---

# Sales MTD

A self-service page where each person records their own month-to-date (MTD) sales figure.

## Core data model
One row per `(userId, month)` (unique index). `amount` is the CURRENT month-to-date number, **overwritten** when the person updates it — it is NOT a sum of daily entries.

**Why:** The user was explicit ("isme total mat karega... vo zyada hoga aayega number"): each entry is already cumulative MTD, so summing days would double-count and inflate. `lastDate` records the day of the last amount update; `target` is an optional monthly goal.

**How to apply:** Never aggregate the amount column by summing across days/rows for one person. The latest stored value *is* the MTD. The UI deliberately shows NO grand total of the amount column (People / Filled / Avg-achieved% only). Summing across people would be a legitimate total, but it was omitted to honor the user's "don't total" instruction — only add it back if the user asks.

## Permissions / scoping (client-side, no server authz — app convention)
- Everyone can edit their OWN amount; managers (Boss / Center Head / MIS-or-Director) can edit anyone in scope and set targets.
- Roster scope mirrors the rest of the app: Boss/MIS see all (center filter), Center Head sees own center, others see their `buildHierarchySet` subtree.
- **Head Office visibility:** only Boss and the real MIS *department* (`department === "MIS"`) may see Head Office. A Director (`isAllCentersViewer` true but not MIS-dept) shares MIS's outer-centers reach but must be excluded from Head Office — same rule as the Attendance page. Forgetting this is a scope-leak regression.

## Partial-field upsert
`POST /sales-mtd` builds its `onConflictDoUpdate` set from only the fields actually present in the body (`!== undefined`), so a manager setting a target does not wipe the person's amount, and a person updating their amount does not wipe a target.
