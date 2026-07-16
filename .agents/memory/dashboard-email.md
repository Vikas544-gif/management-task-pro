---
name: Dashboard summary email
description: ISS Task Pro daily Dashboard Summary email — recipients keyed by user ID, per-recipient scoped KPIs.
---

# Dashboard Summary email

A daily morning email (9 AM IST cron) sending a snapshot of the live Dashboard
(KPI cards + by-category / by-team-member breakdowns) to a fixed set of people.

## Key decisions
- **Recipients are keyed by stable user ID, NOT name.** Duplicate names exist in
  this DB (TL-with-login vs Sales-Agent-no-login), so name matching can misroute
  a scoped summary to the wrong person/email. The seeded user IDs are identical
  in dev and prod, so a hardcoded ID list is safe.
  **Why:** code review flagged name-matching as a data-disclosure risk.
- Each recipient's KPI numbers are scoped with `scopeTasks(recipient, ...)` so
  the email shows exactly what that person would see on the Dashboard page.
- A manual admin-gated trigger (`POST /email/send-dashboard-now`, Boss/MIS only)
  + an EmailSettings button exist for testing on the live app.

## Gotcha
- Resend is test-mode until the user verifies a domain — real delivery to the
  external @equentis / @infinityservicesindia addresses won't happen until then.
- Cron jobs only fire when the app is published (always-on).
