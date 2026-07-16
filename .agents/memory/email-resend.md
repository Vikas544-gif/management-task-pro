---
name: ISS Task Pro email via Resend
description: Why email uses Resend (not SMTP) and how sender/recipient config works
---

# Email delivery uses Resend, not company SMTP

ISS Task Pro sends all email (task-assignment, scheduled reminders, reports, test) through **Resend** via the `RESEND_API_KEY` secret. There is no SMTP/nodemailer anymore and no DB-stored credentials.

**Why:** The company's Microsoft/Office 365 Outlook SMTP rejected basic auth (`535 5.7.3 Authentication unsuccessful`) because Microsoft disables SMTP AUTH by default. The Replit Outlook OAuth connector also failed — the OAuth popup never opened in the user's canvas-iframe environment. Resend (API-key, no popup, no OAuth) was the only path that worked.

**Sender:** controlled by optional `FROM_EMAIL` env. Default is `ISS Task Pro <onboarding@resend.dev>`.

**Critical Resend test-mode rule:** with NO verified domain, Resend only delivers to the **account-owner's own signup email**. Sending anywhere else returns a 200-with-error like "You can only send testing emails to your own email address (...)". To send to all team members you MUST verify the company domain at resend.com/domains (add DNS records), then set `FROM_EMAIL` to an address on that domain.

**Current state (as of 2026-06-24):** domain `infinityservicesindia.com` is VERIFIED in Resend (GoDaddy DNS, DKIM+SPF+MX records added). `FROM_EMAIL` shared env var is set to `Management Task Pro <noreply@infinityservicesindia.com>` (app was renamed from "ISS Task Pro"; the FROM_EMAIL display name must match the app name, and changing it requires an api-server restart to take effect) and team-wide sending to any address is confirmed working. The Resend `RESEND_API_KEY` is a **send-only restricted key** — it cannot read the /domains API (returns 401 restricted_api_key), so domain status can only be checked by attempting a live send, not via API.

**How to apply:** `getSenderEmail()` returns a From header string (may include display name) — never reuse it as a recipient. `/email/test` surfaces Resend's exact error message back to the UI. `isEmailConfigured()` == `!!RESEND_API_KEY`.

**Digest skips users with no email (common "I got no reminder" cause):** the daily digest (`sendDailyDigest`) only emails users who BOTH have today-due/overdue open tasks AND have an `email` on their user row. Several seeded users — including the owner/boss account (id 1) — have a blank email, so they silently get nothing. Fix per-user via the Team page email field. The digest now returns `{sent, eligible, skippedNoEmail, failedSend}` and there is a manual trigger `POST /api/email/send-digest-now` (button on Email Settings) to fire it on demand instead of waiting for the 9 AM IST cron (node-cron does not replay missed runs).

## Firing 9 AM emails when the app sleeps (Autoscale) — invariants
**Why:** Autoscale sleeps so the in-app 9 AM cron is unreliable, and switching the web app off Autoscale risks changing the published `.replit.app` URL (a hard blocker for this user). So an EXTERNAL trigger must wake the app; the app must stay Autoscale.
- **Trigger has two entry paths, both must stay duplicate-safe:** a standalone one-shot job (for a Replit Scheduled Deployment) and a secret-gated HTTP endpoint (for an external cron that wakes Autoscale). Both, plus the in-app cron, funnel through `runDailyDigestOnce`/`runDashboardDigestOnce`.
- **Once-per-day lock (the core invariant):** those wrappers claim a per-(job,IST-date) row in `app_settings` via INSERT ON CONFLICT DO NOTHING; first writer wins, others skip. The claim is RELEASED if the send throws, so a failed run can retry the same day — never claim-and-forget before delivery. Manual Boss/MIS "send now" endpoints intentionally bypass the lock (also the hard-crash-mid-send recovery path).
- **Standalone job needs no web env:** it must not import `app.ts` (so no `SESSION_SECRET`/`PORT`), only `DATABASE_URL` + `RESEND_API_KEY`.
- **HTTP trigger security:** endpoint mounted before `requireAuth`, gated by `CRON_SECRET` (unset ⇒ disabled/503, bad token ⇒ 401, timing-safe compare). NEVER reuse `SESSION_SECRET` as the token (URL leak would expose the session-signing key); prefer the `x-cron-secret` header over `?token=` to avoid leaking via scheduler/proxy logs.
- **UI reality:** this project's simplified Publishing flow only edits the existing Autoscale deployment and did not surface a "Scheduled" deployment-type picker for this user, hence the external-trigger fallback. New routes require republishing the main app to ship (URL stays the same).
