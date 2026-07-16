---
name: Force everyone to re-login (global logout)
description: How an admin invalidates every session at once, and why sessions carry an epoch.
---

# Global logout via auth epoch

Sessions are stateless signed httpOnly cookies (no DB session store), so there
is no row to delete to "log someone out". To support an admin "force everyone to
re-login" action, the cookie carries `<userId>.<authEpoch>` and a single global
epoch is stored in DB (`app_settings` key/value table, key `authEpoch`).

- `requireAuth` rejects any cookie whose epoch != the current global epoch.
- An admin endpoint bumps the global epoch → every outstanding cookie becomes
  stale at once. The endpoint re-issues the *caller's* cookie with the new epoch
  so the admin who triggered it stays logged in; everyone else gets 401 on their
  next request and is bounced to login.

**Why this design:** the user wanted, after publishing an update, to force all
staff onto the fresh version with one click instead of messaging everyone to log
out manually. Republish itself does NOT log anyone out (SESSION_SECRET persists),
so a deliberate epoch bump is the mechanism.

**Invariants / gotchas:**
- Cookie format MUST stay `<userId>.<epoch>`. Legacy id-only cookies parse to a
  NaN epoch and are rejected (one-time re-login when this shipped) — don't add a
  fallback that accepts epoch-less cookies or global logout breaks.
- Default epoch is 0 (no row yet); first bump = 1. The bump is an atomic single
  SQL UPSERT increment — do not revert to read-then-write (concurrent bumps would
  lose an increment).
- The action is Boss/MIS/Director-only, enforced server-side (not just UI).
