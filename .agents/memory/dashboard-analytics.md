---
name: Dashboard date filter & analytics
description: How ISS Task Pro Dashboard filters by date and buckets timeline charts — keep the date basis consistent.
---

# Dashboard date filtering & timeline charts

The Dashboard date filter (All Time / Date Range / Month) and ALL timeline charts
(daily trend, done-vs-pending, goal progress) place a task on the timeline using
`dueDate || createdAt` — NOT `updatedAt`.

**Why:** Originally trend charts bucketed by `updatedAt` over fixed "last 7/30 days"
windows. After adding the date filter, selecting a historical month showed empty
charts because those tasks weren't recently updated. Aligning everything on
`dueDate || createdAt` + a period-derived day window (`periodDays`) makes the filter
and every chart agree.

**How to apply:** When adding a new timeline/period chart, derive its day buckets
from the `periodDays` memo and bucket tasks with the `taskDateOf` helper. Don't
reintroduce `updatedAt`-based or fixed rolling windows, or the date filter will look
broken again.

Note: the thin gray dashed reference lines on the Line charts (Target / Total Due)
are intentional — only the CartesianGrid dashes were removed per the user's request.
