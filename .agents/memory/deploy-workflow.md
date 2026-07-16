---
name: Dev vs live (publish) workflow
description: Why code changes don't appear in the user's published app until republish; how to verify live.
---

# Dev changes do NOT reach the live app until the user re-publishes

ISS Task Pro is an autoscale deployment (`.replit` `[deployment] deploymentTarget = "autoscale"`).
Agent edits land in the **development** workspace only. The user's **published/live**
app keeps serving the bundle from the **last publish** — it does NOT auto-update from dev.

**Why this keeps biting:** the user repeatedly tests the LIVE app, makes a fix
in chat, then reports "waise hi aa raha hai / nhi hua" — because the fix is correct in
dev but was never re-published to live. As of June 2026 they explicitly asked that every
change be reflected in LIVE ("aaj se jo kare vo live me kar").

**How to apply:**
- After ANY code change the user needs live, prompt a re-publish (`suggest_deploy`) and tell
  them to click Publish/Redeploy — the agent cannot push to production itself.
- The app has **no service worker/PWA**, and Vite hashes asset filenames, so stale JS is
  rarely browser cache; the usual cause is "not re-published yet". A hard refresh only
  helps with a cached `index.html`.
- DB/data changes (e.g. Access Control `assignVisibleUserIds`, role edits) DO take effect
  on live immediately *if* the reading code is already deployed — no republish needed for
  pure data. Code changes always need a republish.
- To verify the live bundle actually contains a code change, the hardcoded marker string
  (e.g. a name in a `SEES_*` Set) appears verbatim in the minified prod JS — grep the
  published `/assets/*.js` for it. (Dev domain serves unbundled Vite modules, so this
  check only works against the published `.replit.app` URL, not the dev domain.)
