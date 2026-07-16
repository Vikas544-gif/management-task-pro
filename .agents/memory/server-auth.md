---
name: ISS Task Pro server-side auth & scope
description: How the real session auth + server-side authorization works, and the deliberate decisions behind it
---

# Server-side auth & scope (added June 2026)

The app went from "client-side identity only, wide-open API" to real session auth
+ server-enforced data scope, at the user's explicit request.

## Key decisions (the non-obvious "why")
- **Passwords are still plaintext, NOT hashed — on purpose.** The Boss
  credential-viewer (`GET /users/credentials` returns plaintext passwords) is a
  wanted feature, and hashing would break it / risk locking users out. The user
  chose "session auth + server lock, keep the viewer". Do NOT add hashing unless
  the user reverses this.
- **No express-session / no DB session store.** Auth is a single signed httpOnly
  cookie carrying the user id, signed with `SESSION_SECRET` via the
  already-present `cookie-parser`. Boot throws if `SESSION_SECRET` is missing.
  Keep it this lightweight unless there's a real reason to add a store.
- **Cookie is not `Secure`** (works behind the Replit HTTPS proxy over the
  non-secure dev cookie); `sameSite: lax`, httpOnly, signed, ~30-day maxAge.
- **DEV-only work — do NOT publish** this change without the user saying so. The
  9AM digest cron only runs when published anyway (separate concern).

## How it's wired
- `app.ts`: `trust proxy`, `cors({ origin: true, credentials: true })`,
  `cookieParser(SESSION_SECRET)`.
- `middlewares/auth.ts`: `requireAuth` reads/validates the signed cookie, loads
  the user row onto `req.user`, else 401. Exports `SESSION_COOKIE`, `AuthUser`.
- `routes/index.ts`: health + `/auth` mounted public, THEN
  `router.use(requireAuth)` gates everything below. `/auth/me` self-gates.
- `lib/scope.ts`: server twins of the client visibility rules — `isBoss`,
  `isAllCentersViewer`, `isCenterHead`, `buildHierarchySet`, `scopeTasks`.
- Frontend: `custom-fetch.ts` sends `credentials: "include"`; `App.tsx` bootstraps
  from `GET /auth/me` (server is source of truth, NOT localStorage), logs out via
  `POST /auth/logout`, and a global QueryCache/MutationCache 401 handler resets
  the me-cache so any 401 bounces the user back to Login.

## Scope is enforced on EVERY sensitive read, not just the list (architect caught this)
The first pass only scoped `GET /tasks`. Alternate task endpoints leaked org-wide
data and notification mutations had IDOR. **Rule: any new task/notification
endpoint must apply the same scope/ownership.** Currently enforced:
- All task reads: `GET /tasks`, `/tasks/:id` (out-of-scope → 404), `/tasks/recent`,
  `/tasks/summary`, `/tasks/by-category`, `/tasks/by-user` all run `scopeTasks`.
- `/users/credentials`: scope derived from the SESSION user (boss=all, center
  head=own center, MIS/Director=exclude Head Office, else 403). Client `?center`
  param is IGNORED — never trust it again.
- Notifications: list scoped to `req.user.id`; `read-all`/`clear-all` use
  `req.user.id` and IGNORE any body `userId`; `PATCH /:id/read` and `DELETE /:id`
  enforce ownership via `WHERE id = :id AND userId = req.user.id`.

## Known scope boundary (accepted for this pass)
Mutation endpoints (POST/PUT/DELETE on tasks/users/etc.) and the read endpoints
attendance / eod / reports / agent-metrics / categories are behind `requireAuth`
but NOT role-scoped. Authenticated-only is the agreed boundary here; add role
gates only if the user asks.
