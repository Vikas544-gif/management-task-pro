---
name: Lunch reminders (not tasks)
description: Why the "lunch" nudges are a banner + bell, never task-list rows, and how they fire.
---

The two daily lunch nudges ("order by 12", "lunch at 1") are intentionally NOT
tasks. They used to be `type=daily` recurring tasks (assignedBy NULL) that
cluttered the task list AND leaked into the 9 AM digest email as pending tasks —
the user explicitly wanted them out of tasks and out of email.

**Now they live as:**
- A static dashboard banner (top of `Dashboard.tsx`) — visible to everyone.
- In-app bell notifications only (NO email): `sendLunchReminder("order"|"eat")`
  inserts one `lunch_reminder` notification per recipient.

**Recipients = active + login-capable** (`status='Active' AND username IS NOT NULL`).
**Why:** an in-app bell is only meaningful to users who can log in; notifying
login-less records (e.g. Sales Agents tracked without accounts) just creates dead
rows. The banner already covers literally everyone, so "reminder for everyone" is
satisfied by banner(all) + bell(login users). This is a deliberate choice, not a
miss — do not "fix" it by removing the username filter.

**Firing:** in-app cron at 12:00 / 13:00 IST when the Autoscale app is awake, plus
external trigger `GET|POST /api/cron/lunch-reminder?kind=order|eat` (same
`CRON_SECRET` gate + `x-cron-secret` header as the digest). Reuses the same
once-per-day claim lock (`runClaimedJob` → keys `lunch-order` / `lunch-eat`) so
duplicate fires across cron + external trigger are impossible. Because Autoscale
sleeps, the external cron-job.org triggers are what actually make them reliable —
two schedules beyond the 9 AM digest one.

**retireLunchTasks() footgun:** a boot-time cleanup deletes tasks whose title is
exactly "Order your lunch at 12:00 PM" / "Go for lunch at 1:00 PM" with
assignedBy NULL, running BEFORE boot recurring generation (so they can't
re-clone) and self-healing prod on deploy. Consequence: never legitimately create
a task with those exact titles — it will be wiped on the next restart.

## Banner is time-gated to IST lunch hours (July 2026)
The Dashboard lunch banner renders only 11:30 AM–2:00 PM IST (Asia/Kolkata),
not all day. Gate = `showLunchBanner` derived from the existing live `now` clock
via `Intl.DateTimeFormat` timeZone Asia/Kolkata, so it follows IST regardless of
the viewer's browser tz. Still shown to all users/centers; 12PM/1PM bell crons
unchanged. **Why:** user found the all-day banner noisy.
