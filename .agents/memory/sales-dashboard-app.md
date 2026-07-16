---
name: Sales dashboard is static HTML, not React
description: artifacts/sales-dashboard renders from a self-contained index.html, not the React scaffold — don't judge "built" state from App.tsx
---

# Infinity Sales Performance Dashboard architecture

The `artifacts/sales-dashboard` app renders from a **self-contained static
`index.html`** (inline CSS + inline JS + CDN Chart.js/datalabels), NOT from the
React scaffold. `index.html` has **no `<div id="root">` and no `<script type="module">`**,
so `src/main.tsx`/`src/App.tsx` never mount — those files are inert scaffold leftovers.
The page's inline `sdBootstrap()` fetches `/api/sales-dashboard/data` (public) and
renders every section (Overview, Sales Performance, Headcount, Mandays & Conversion,
Agent & TL Performance).

**Why:** Vite still serves/builds a plain `index.html` with no module entry, so the
static dashboard is the real, live app even though the artifact is a react-vite template.

**How to apply:**
- Do NOT infer the app is "empty/unbuilt" from an `App.tsx` placeholder — check
  `index.html` first. A stale note once claimed the frontend was empty; it wasn't.
- Edit the dashboard by editing `index.html` (the inline JS), not React components.
- Keep `src/App.tsx` a trivial stub so `pnpm --filter @workspace/sales-dashboard run typecheck` stays green.
- Sales aggregation here is legitimate: `ATL_RAW` rows are per-agent-per-month completed
  sales counts, so summing across agents/months (TL "Total Sales", FY annual totals) is
  correct — this is NOT the iss-task-pro "Sales MTD running figure" that must never be totaled.
