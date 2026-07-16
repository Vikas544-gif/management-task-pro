---
name: ISS Task Pro native mobile app
description: Expo mobile client architecture, auth wiring, and Orval-hook gotchas for the iss-mobile artifact
---

# ISS Task Pro — Expo mobile app (`artifacts/iss-mobile`)

Native mobile client for ISS/Management Task Pro. Talks to the SAME `api-server` backend and the SAME Orval-generated `@workspace/api-client-react` hooks as the web app. Built phase-wise; phase 1 = login, dashboard, my tasks, notifications, task detail, more/logout.

## Auth wiring (the non-obvious part)
- Server supports **cookie (web) OR Bearer (mobile)** in one middleware. Mobile login returns a `token` (HMAC signed with `SESSION_SECRET`, see `lib/mobileToken.ts`); OpenAPI login 200 = `UserWithToken` (allOf User + optional token). Do NOT break the web cookie path when touching auth.
- Client base URL: Expo runs OUTSIDE the web proxy, so `setBaseUrl(\`https://${process.env.EXPO_PUBLIC_DOMAIN}\`)` MUST run at module top of `app/_layout.tsx`. `EXPO_PUBLIC_DOMAIN` is wired in the workflow env.
- Token getter: `setAuthTokenGetter(() => currentToken)` registered at import of `context/AuthContext.tsx` against a module-level `currentToken` so the fetch layer reads it outside React render.
- **Auth boundary rules (learned via code review):** bootstrap only authenticates when BOTH token AND cached user exist (a user without token must NOT unlock routes); `queryClient.clear()` on BOTH signIn and signOut to stop cross-account cache leakage (dashboard summary uses a global key).

## Orval hook gotcha
- react-query v5: passing `options.query` to a generated hook REQUIRES `queryKey` (type error otherwise). Always include e.g. `queryKey: getListTasksQueryKey(params)` alongside `enabled`/`refetchInterval`. Getters: `getListTasksQueryKey`, `getListNotificationsQueryKey`, `getGetTaskQueryKey`, `getGetTaskSummaryQueryKey`.

## Phase 2 feature screens
- Added stack screens (pushed over tabs, native header w/ back): `all-tasks`, `assign-task`, `team`, `attendance`, `eod`, `reports` — registered in `app/_layout.tsx` and reached from the More tab (role-gated list).
- Form primitives live in `components/ui.tsx`: `TextField`, `Select` (Modal picker), `Segmented`, `FieldLabel`, `Option`.
- Menu gating helper is `lib/permissions.ts` (`canSeeAttendance`/`canSeeEod`/`canManage`) mirroring web `permissions.ts`. It ONLY hides menu items — real enforcement is server-side.
- **`useListUsers` takes ONLY options** (`useListUsers({ query: { queryKey } })`) — it has NO params arg, unlike `useListTasks(params, options)`. Passing a params first-arg is a TS2554.
- **EOD row key is `(submittedBy, date)` server-side.** When editing an existing center's report, send `existing.submittedBy` (often a Team Leader's id), NOT always the caller's id, or you overwrite the wrong row. New reports use caller id. Server authorizes POST by role (Boss/MIS/CenterHead/TL) and enforces TL `submittedBy===me.id`.

## Server authz gap (pre-existing, affects web too)
- `/api/attendance` (GET+POST) and `/api/tasks` POST have **no role/center authorization** — the web app relies on client menu-gating + the fact that `/api/users` IS server-scoped. Mobile matches this parity. Hardening these routes is a separate cross-app security task (would change web behavior); do NOT silently add it inside mobile work. (EOD, by contrast, IS fully server-authorized.)

## Conventions to keep
- Status values are `pending`/`inProgress`/`done` (match web). ALL UI text English.
- Colors synced from web `index.css` into `constants/colors.ts` (light+dark). `useColors()` picks palette by scheme; `radius` is a top-level number on the colors object (don't cast the whole object to a Record — breaks on the numeric radius).
- Tabs: NativeTabs when `isLiquidGlassAvailable()`, else classic `Tabs`; 4 tabs = index/my-tasks/notifications/more.
- Verify with `pnpm --filter @workspace/iss-mobile run typecheck` + restart workflow `artifacts/iss-mobile: expo`; suggestDeploy only after a real iOS build.

## Branding & "look like web" parity
- Display name must read **"Management Task Pro"** (matches web), NOT "Task Pro". But the Expo **`slug` and android `package` are frozen** — they're bound to the existing EAS project; renaming either breaks builds. Change only the human-facing name fields.
- The app owner keeps asking to make the mobile app "look like the web app". A native phone app can't be pixel-identical to the wide desktop web layout (sidebar + multi-chart dashboard) — set that expectation explicitly, then mirror the *recognisable* web pieces (brand hero, KPI cards) rather than promising 1:1.
- **Any visual/name change is invisible until a fresh EAS APK is rebuilt & installed** (≈15 min, owner-run) — so batch ALL pending look/name asks before requesting a rebuild.
- The home dashboard mirrors the web Task Analytics Dashboard by computing everything CLIENT-SIDE from the full task list (not the summary endpoint): KPIs, per-type quick analytics, and 4 charts, with Center/Department/Member filter pills. **Why:** the summary endpoint lacks per-type done/pending + chart buckets, and the web derives all of it the same way — replicating keeps the numbers identical. Reuse the web's aggregation contract (taskDateOf = dueDate||createdAt; daily-only absence-hide for absent/leave assignees) or mobile counts drift from web.
- Charts are hand-drawn with **react-native-svg** (already installed — no extra native module, so no new crash surface). Prefer SVG primitives over adding a chart lib to avoid an SDK-version-mismatch native crash.

## Phone push notifications (Expo push)
- Web uses web-push/VAPID; mobile uses **Expo push** — BOTH fire from the same server `createNotifications()` in `webPush.ts`. Any new notification source MUST route through `createNotifications()` or the phone won't buzz.
- Server sends via plain HTTPS POST to `https://exp.host/--/api/v2/push/send` (no expo-server-sdk dependency); tokens Expo reports as `DeviceNotRegistered` are pruned. Push is fire-and-forget — never block/fail the request on it.
- Device tokens live in `expo_push_tokens` table (`token` unique, upsert re-owns for caller — shared-phone safe). Routes: `POST /push/expo-subscribe {userId,token}` + `/push/expo-unsubscribe {token}` (auth-gated, owner-scoped).
- Client: `lib/push.ts` `registerForPush(userId)` requests perms, gets Expo token via `Notifications.getExpoPushTokenAsync({projectId})` (projectId from `app.json` extra.eas.projectId), calls generated `subscribeExpoPush()`. Wired in AuthContext signIn + session-restore; `unregisterForPush()` on signOut (before clearing token). `Notifications.setNotificationHandler` shows foreground banners. `expo-notifications` plugin added to app.json. Real banners only appear in the installed APK, not Expo Go / dev.

## Full page parity (all web pages now on mobile)
- Every web page under `iss-task-pro/src/pages` now has a mobile screen in `iss-mobile/app`: sales-report, assignment-monitor, hierarchy (credentials), holidays, access-control, email-settings (plus the earlier set). Reached from the More tab, role-gated.
- **Menu-gate roles MUST match each web page's route policy** (web `NAV_ITEMS` in `iss-task-pro/src/lib/permissions.ts`), or mobile over-exposes a page. Notably Sales Report is NOT public: web restricts it to Boss / MIS-Director / Center Head / Team Leader. **Why:** a first pass exposed Sales Report to everyone with no in-screen guard (broken-access-control flag). **How to apply:** any sensitive mobile screen needs BOTH the More-menu gate AND an in-screen `canView` deny path with `enabled: canView` on its queries — menu-hiding alone isn't enough.

## EAS build in this sandbox (IMPORTANT)
- `.git/` is write-protected in the main agent — EAS's default git-archive step fails with `.git/index.lock` "Destructive git operations are not allowed" whenever the working tree has UNCOMMITTED changes (a clean tree/checkpoint builds fine, which is why the first build worked).
- Fix: run the build with **`EAS_NO_VCS=1`** (tarballs the working directory directly, skipping git). Command: `cd artifacts/iss-mobile && EAS_NO_VCS=1 nohup npx --yes eas-cli@latest build -p android --profile preview --non-interactive --no-wait > /tmp/eas.log 2>&1 &` then poll the log. **Why:** cannot `rm .git/index.lock` (sandbox blocks all `.git/*` writes), and cannot commit from main agent, so bypassing VCS is the only path.
- **`npx eas-cli` "Cannot find module 'fdir'" = corrupted npx cache**, not a code problem. Fix: `rm -rf ~/.npm/_npx/*` (or the specific hash dir under `~/.npm/_npx`) then re-run — npx reinstalls eas-cli fresh. Don't keep retrying the same command; it fails identically until the cache is cleared.
- **`npm error code ECOMPROMISED` / "Lock compromised"** during `npx eas-cli` = stale/corrupt npm cache lock (distinct from the fdir issue). Fix: `rm -rf ~/.npm/_npx/* ~/.npm/_cacache/tmp/* ~/.npm/_locks/*` then **`npm cache verify`**, then re-run the build. Retrying without the verify fails identically.

## Theme system (user-selectable, mirrors web) — supersedes old "light pinned"
- Mobile now has the SAME theme picker as web: 11 themes (Light/Dark/Midnight/Slate/Sepia/Ocean/Forest/Sunset/Coffee/Neon/Bubblegum) + 13 accent colors, chosen from the More tab. Do NOT re-pin to light-only.
- Palettes live in `constants/themes.ts` as `"H S% L%"` HSL triplets; `buildColors(theme,accent)` returns an `AppColors` object using RN `hsl(H, S%, L%)` **comma-format** strings (RN supports hsl()); accent overrides `primary`/`ring`. `context/ThemeContext.tsx` persists the pair to AsyncStorage key **`iss_theme`** (same key name as web localStorage). `hooks/useColors.ts` just returns `useTheme().colors` — device `useColorScheme` is NOT used.
- StatusBar + tab-bar BlurView tint are driven by `useTheme().isDark` (dark themes → dark chrome). **Why device dark-mode was originally disabled:** owner wanted web parity, and web ignores OS scheme — so palette is driven ONLY by the explicit picker, never `useColorScheme`.
- **Persist gotcha:** persist via a single `useEffect([theme,accent,hydrated])` gated on a `hydrated` flag — NOT inside the setters (setter-time persist captures stale partner value on rapid toggles, and would clobber storage before hydration).

## Dashboard date filter
- Dashboard has a "FILTER BY DATE" pill row (All dates / Today / This Week / This Month) mirroring web. `scopedTasks` = center/dept/member/absence filtered; `tasks` = scopedTasks + date-window (rangeFor). KPIs/quick-analytics/status/priority use `tasks`; the 7-day trend/weekly charts use `scopedTasks` (time-series stays meaningful regardless of the single window).

## Dashboard KPI drill-down (mirrors web) & filter cascade
- KPI cards (Pending/In Progress/Completed/Total) open a bottom-sheet `TaskDetailModal` filtered by status over the already-filtered `tasks` set — they do NOT route to My Tasks. The "Done Rate" card is intentionally NON-clickable (matches web, where it's a plain div). `all` = whole `tasks` set.
- The modal ALSO has an in-modal per-member chip row (name + task count, "All" first, sorted by count desc) mirroring web's `detailPerson` filter — tapping a chip narrows the list to that assignee. Reset to "All" whenever the modal (status) changes. **Why:** owner expected to filter the drill-down by member inside the modal, like web.
- Filter cascade must match web: selecting a Center clears BOTH department + member; selecting a Department clears member; the "All"/"All Centers" reset pills also clear their downstream filters. **Why:** keeping a stale downstream filter after changing an upstream one yields empty/misleading drill-downs.

## Standalone APK crash-on-launch (fixed)
- Symptom: EAS `preview` APK opens then instantly closes (native crash, NOT caught by ErrorBoundary — happens before/at native module init). Dev/typecheck were clean because it's the first real on-device run.
- Root cause: `expo-secure-store` was pinned to a wrong major (57.0.0) instead of the SDK-54 version (~15.0.8). SecureStore runs at startup in `AuthProvider`, so the mismatched native module crashed immediately.
- Fix: keep every native module on its SDK-aligned version. Run `npx expo-doctor` + `npx expo install --check` BEFORE any EAS build; do not `pnpm add` expo-* packages (grabs latest). expo-* deps live in devDependencies here.
