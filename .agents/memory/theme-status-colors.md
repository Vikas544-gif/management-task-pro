---
name: Theme-aware status colors
description: Why hardcoded Tailwind status colors break on this app's dark themes and how to keep them readable.
---

ISS / Management Task Pro supports 11 themes (8 dark, 3 light). Dark mode is applied by toggling a `.dark` class on `<html>` (see `src/lib/theme.tsx`), and `src/index.css` has `@custom-variant dark (&:is(.dark *))`, so Tailwind `dark:` variants work.

**Rule:** any hardcoded light-only status color (`bg-red-50`, `bg-amber-100`, `text-red-700`, `border-red-300`, etc.) MUST carry a matching `dark:` variant, or it stays light on the 8 dark themes while `text-foreground`/`text-muted-foreground` turn near-white → invisible/faint text.

**Why:** the classic failure was overdue task cards: `bg-red-50` card + `text-foreground` title = white-on-light-pink on dark themes. Fixed with `dark:bg-red-950/40 dark:border-red-800` on the card.

**How to apply** (standard mapping used across the app):
- `bg-{c}-50` → add `dark:bg-{c}-950/40`; `bg-{c}-100` → `dark:bg-{c}-900/40`; `bg-{c}-200` (active) → `dark:bg-{c}-900/60`
- `text-{c}-600/700/800` → `dark:text-{c}-300`; `text-{c}-500` → `dark:text-{c}-400`
- `border-{c}-200` → `dark:border-{c}-800`; `border-{c}-300` → `dark:border-{c}-700`
- hover variants get matching `dark:hover:` equivalents
- Leave alone: solid saturated buttons (`bg-{c}-600 text-white`) and semantic tokens (`text-foreground`, `bg-card`, `bg-muted`, `bg-background`, `border-border`, `bg-primary`, `text-primary`) — those already adapt.

Quick audit grep: `rg -n "bg-(red|amber|green|blue|emerald|yellow|orange)-(50|100)" <file> | rg -v "dark:"` should return nothing.
