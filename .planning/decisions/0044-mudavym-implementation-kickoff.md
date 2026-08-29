# 0044 — Mudavym design implementation kickoff

- **Status:** Locked (scope + rollout mechanics) · pages themselves remain founder-reviewed per flag flip
- **Date:** 2026-08-30
- **Decider:** Aldemir (founder), 2026-08-30 — four explicit answers, recorded verbatim below
- **Keywords:** implementation, feature flag, dashboard, orders, wordmark, motion map, TradeZella, seal
- **Links:** [[0042-iznik-seal-and-warm-charcoal]] (palette, locked), [[0043-mudavym-mark]] (mark, withdrawn — 41–43 land from the parallel design session's branch), `06-pages/MAKEOVER-VERDICTS.md`, `06-pages/DESIGN-FOUNDATION.md`, sketch `063-mudavym-motion-canvas`

## Context

Three sketch waves produced a decided palette (ADR 0042), a motion canvas of 133 live
demos with a founder-curated shortlist, and a page-by-page verdict sheet. On
2026-08-30 the founder ended the document-only phase: *"let's start to kick off, and
let me see those in actual files, in actual pages"* — with the standing instructions
to keep asking questions and keep documenting.

The founder also uploaded his own curated motion canvas
(`.planning/Mudavym Motion Canvas.dc.html`, 85 demos, 2026-08-29) and said it holds
*some* of the motions he really liked — making that file a curation signal, including
twelve "unafraid" signature ideas that exist nowhere in the 063 set.

## Decision — the founder's four answers, 2026-08-30

1. **First pages: Dashboard + Orders**, on a shared foundation (tokens, motion
   primitives, seal component) that ships first and that both pages consume. The
   Dashboard carries the verdict sheet's one big ask — the TradeZella-style sales
   calendar the founder called *"an important thing for me"* — plus the liked
   "Good evening / before service" opening and "Waiting on you" panel. Orders carries
   the seal ceremony, hold-to-approve, and the never-looks-sent AI-draft guardrail.
2. **Rollout: feature flag per page** — key `mudavym_design_<page>` in the existing
   per-restaurant feature-flag store, with a per-browser dev override, and a
   `PageGate` component swapping legacy/new. **Plus a second scope the founder named:
   a per-page motion map** — every rebuilt page documents *which motions it uses*.
   Convention: a **"Motions used"** table in that page's `06-pages/<slug>.md` note
   (id · name · where it fires), maintained the same way as §1a Features.
3. **The mark: build now, wordmark-only.** ADR 0043 is withdrawn and its successor
   has no vector source; pages ship with the "Mudavym." wordmark (Plus Jakarta Sans
   800, tracking −0.02em, İznik full stop) and no monogram. The seal *ceremony* is
   unaffected — the die (M above double rule) is specified by the sketches. The
   monogram slots in as a single swap when its vector exists.
4. **The uploaded canvas is curation.** What is on it is what the founder liked. Its
   twelve unafraid signatures port into 063 as `sig-17`–`sig-28` (part `sig-d`), and
   the canvas joins the makeover verdicts as a binding reference for implementation
   taste.

## Mechanics

- Branch `feat/mudavym-design-p1`, grown in an isolated worktree; additive only —
  zero visual change to any page whose flag is off. Old pages must render
  byte-identically.
- Motion runs on CSS + WAAPI with springs sampled into `linear()` easings — **no new
  npm dependency**; adopting the `motion` package is a separate, later decision.
- Foundation lands first (`src/styles/mudavym.css`, `src/lib/mudavym/*`,
  `src/components/mudavym/*`), then Dashboard and Orders build on it in parallel.

## Consequences

- **Easier:** page-by-page founder review in the running app (flip a flag, judge,
  flip back); the motion map makes every page's movement auditable against the canvas.
- **Harder / given up:** two rendering paths per flagged page until cutover; flag
  hygiene becomes real work; the monogram-shaped hole in the chrome until ADR 0043's
  successor gets a vector.
- **Numbering debt, recorded:** sketches 053–057 were claimed by agenda-canvas work
  on `main` while the design sketches 053–063 lived on the unpushed
  `docs/mudavym-design-kickoff` branch — the design sketch directories must be
  renumbered (or the collision otherwise resolved) before that branch lands.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-30 | Aldemir (founder) | Chose Dashboard+Orders, flag-per-page + motion-map scope, wordmark-only, canvas-as-curation |
