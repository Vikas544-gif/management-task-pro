---
name: Duplicate user records & dashboard member filter
description: Same-person users can exist twice (TL with login vs Sales Agent without), confusing the dashboard member filter
---

## Symptom
"A person's tasks don't show on the Dashboard" when clicking their member pill.

## Root cause
Some people exist as TWO user rows:
- A **Team Leader** row WITH a username/login but **0 tasks**.
- A **Sales Agent** row (department Sales) with **NO username** but holding the real tasks.

The Dashboard member-filter pills (`visibleMembers`) only include users WITH a username (Sales Agents are excluded by design, "tracked on Team page"). So the pill shown is the empty TL row; clicking it → 0 tasks. The Sales-Agent's tasks DO still count in dashboard totals and appear in the "All Tasks" KPI drill-down (attributed via assignedToName).

## Note
This is a DATA duplication issue (likely from Agent Tracking adding Sales Agents separately from login users), not purely a code bug. Confirm with the user whether the two rows are the same person before merging/cleaning — do not code around duplicates blindly.

## How to merge such duplicates safely
KEEP the login/Team-Leader record and absorb the Sales-Agent duplicate: repoint ALL user-id columns (tasks.assigned_to/assigned_by, notifications.user_id, attendance.user_id/marked_by, agent_metrics.agent_id/updated_by, sales_mtd.user_id/updated_by, eod_reports.submitted_by, users.reports_to) from the dup id to the keeper id, then delete the dup. No FK constraints exist, so check each table manually. Watch unique indexes (attendance_user_date_uq, sales_mtd_user_month_uq, agent_metrics_agent_date_uq, eod_user_date_uq) for clashes before repointing.
