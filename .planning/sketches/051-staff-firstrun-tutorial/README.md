# Sketch 051 · Staff First-Run + Per-Page First-Visit Tutorial

**Design question:** Staff (non-owner/manager) don't upload menus or invite teammates — what does their first-run look like instead? And separately: how do first-visit page tutorials show up on every protected route on first visit without becoming the one-tour-per-session nag the current `GuidanceProvider` was designed to prevent?

**Context:** Extends the existing driver.js spotlight engine (`apps/web/src/guidance/`) from 4 tours / 24 routes to full coverage, and gives every page a consistent question-mark replay control plus an Ask-AI re-entry into `/sommelier`.

## Direction

| | |
|--|--|
| **Domain** | Role-gated get-started, per-page spotlight tours, help re-entry, Ask-AI hand-off |
| **Color world** | Wine burgundy `#722F37`, driver.js overlay `rgba(15,23,42,0.55)` — unchanged from shipped |
| **Signature** | First visit = automatic short spotlight; every later visit = passive `?` replay only |
| **Rejects** | Forcing staff through upload/invite steps; auto-tours firing every session; a second competing help icon; Wine Agent as the tutorial narrator |

## A — Staff get-started (role branch)

```
┌─ Get started ─────────────────────────────────┐
│  "Welcome to WineOps — here's what you'll     │
│   use day to day."                             │
│                                                 │
│  ✓ Your restaurant's wine list is ready        │
│    (uploaded by your manager)                  │
│                                                 │
│  [ Check inventory & alerts →  ]               │
│  [ Create & track orders →     ]               │
│  [ Ask the Wine Agent →        ]               │
│                                                 │
│  No upload step. No invite step. No threshold  │
│  step — those are owner/manager actions.       │
└─────────────────────────────────────────────────┘
```
Role check happens against `user_restaurant_access`. If the restaurant already has an active `restaurant_menus` row, staff (and invited managers) never see "Upload your wine menu" as a pending task — it auto-satisfies. Staff *can* still optionally link Google / subscribe to calendar, since those are personal, not restaurant-scoped.

## B — First-visit page tutorial (the actual mechanism change)

Today: `tipVisibleFor` in `GuidanceProvider.tsx` caps auto-offers to one page per session, to avoid nagging. That cap is correct for *repeat* visits but wrong for a route the user has genuinely never opened.

```
Visit orders/create for the very first time
  → tip.status === 'unseen' AND never-visited-this-route
  → auto-show spotlight immediately, ignore the 1-per-session cap
  → mark tour.status = 'completed' (or 'skipped') on exit

Visit orders/create again later
  → tip.status !== 'unseen'
  → silent; only the (?) button can replay it
  → session cap still applies to any *other* unseen page's tip strip
```

The distinction: the one-per-session cap governs unsolicited *nudges* on already-seen pages ("hey, want a tour?"). It never governed true first visits, and shouldn't — a first visit is a teaching moment, not a nag.

```
┌──────────────────────────────────────────────┐
│  Orders                              [ ? ]   │  ← TourHelpButton, already
│  ┌ spotlight step 1/3 ─────────────┐         │     mounted route-aware in
│  │ "Create an order from a         │         │     DashboardLayout
│  │  low-stock alert or from        │         │
│  │  scratch here."          [Next] │         │
│  └──────────────────────────────────┘         │
└──────────────────────────────────────────────┘
```

## C — Help + Ask-AI re-entry (single funnel, not two)

```
Every protected page
  └─ (?) TourHelpButton  →  replays this page's spotlight tour
  └─ Wine Agent FAB      →  navigates to /sommelier
                              with router state { prompt: "Explain this page" }
                              (SommelierAI currently reads no preset prompt —
                               this sketch adds that hand-off, it does not
                               invent a second chat surface)
```
No new help icon. `TourHelpButton` is already mounted in `DashboardLayout` for both mobile and desktop and is already route-aware — it becomes the canonical per-page tutorial replay for the 6 newly-covered routes (`orders-create`, `communications`, `reports`, `sommelier`, `settings-services`, `calendar`), same as the 4 it already serves.

## Kill / success gates

**Kill if:** staff sees an upload/invite step; a tutorial auto-fires on a route the user has already visited; a second `?`-shaped icon appears anywhere; Ask-AI hand-off requires a new chat component instead of seeding `/sommelier`'s existing input.
**Ship if:** staff reach a working dashboard with zero setup steps; every one of the 6 newly-covered routes shows its spotlight exactly once automatically and is replayable forever after via `(?)`; Ask-AI opens `/sommelier` with page context pre-filled.

**Winner: B's first-visit-overrides-session-cap rule — this is the one mechanism change everything else depends on.**
