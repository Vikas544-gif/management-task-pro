---
name: Categories & Company scoping
description: Center-scoped task categories and Head-Office-only Company picker
---

# Categories are center-scoped (July 2026)

- `categories.center` (text, NOT NULL, default "Head Office"); uniqueness is per `(center, name)` — NOT global. Two centers can both have "Work".
- Server (`routes/categories.ts`) enforces scope: Boss/MIS/Director (`isBoss || isAllCentersViewer`) see/manage ALL centers' categories; everyone else sees only own center. POST forces `center` from the session user (client can't pick); case-insensitive per-center dup → 409. DELETE own-center or elevated only.
- **Why:** centers were seeing Head Office categories and couldn't add their own (the old global `unique(name)` made "Work" collide across centers).
- **How to apply:** frontend has NO center filtering for categories — the server-filtered list is the source of truth. Client-side duplicate pre-checks were removed on purpose (they falsely blocked all-centers viewers); rely on the server 409 (`err.status === 409` in `onError`). Don't re-add a `.some(name match)` pre-check.

# Company (optional) picker is Head-Office-only

- Hidden for non-HO viewers in AssignTask, TaskList EditModal (`showCompany` prop), MyTasks (`currentUser.center === "Head Office"`).
- UI-gate only; `/compliance/companies` endpoints stay public. EditModal's " - {Company}" title suffix parse/re-append logic is kept for ALL users (safe: parsed company is re-appended on save even when the picker is hidden).
