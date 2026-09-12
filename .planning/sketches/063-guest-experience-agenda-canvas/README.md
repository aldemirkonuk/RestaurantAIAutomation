# Sketch 063 · Guest Experience — Agenda Canvas

**Design question:** Can a department whose product is **held** show a year's worth of
ambition on one page without any of it looking like activation?

**Context:** The canvas for `product/guest-experience`'s wave-3 agenda
([[0039-activation-plan-of-record]] Track B). Nineteen documentation tasks —
the NF-B activation-readiness dossier under
[[0037-nfb-erasure-is-crypto-shredding]] — laid out by team, by close_time, and by
the seam each one crosses. Throwaway-grade thinking surface, not a product surface.

## Direction

A **sealed dossier**, not a dashboard. Warm paper, ink, burgundy — the same
burgundy the WineOps document uses (sketch 052) — and a `NF-B · HELD` stamp in the
corner that the whole page is organised around.

| | |
|--|--|
| **Domain** | Guest identity, consent, erasure, k-anonymity, the third user type |
| **Colour world** | Paper `#F7F4EF`, ink `#241F1C`, burgundy `#9E4249`, held-red `#8C2F39`, one hue per team |
| **Signature** | Metric tiles that render **why a zero is zero** — `0 (structurally)` and `undefined` are visually different states, never the same grey |
| **Rejects** | Progress bars (nothing progresses while held) · % complete · a "roadmap" gradient · any chip that implies a build |

## What the page shows

1. **Header + hold banner** — the stamp, and the two-sentence statement that the
   hold is the design rather than an obstacle.
2. **Metric strip** — the five `nf_b.*` metrics as a *set*, never an average, each
   printing its denominator state: `0 (structurally — HELD)`, `0 (no writer)`,
   `0 · wired` (the permanent gate), and two `undefined`. Zeros are burgundy-topped;
   undefineds are grey-topped. **A number over a zero denominator is a failed run.**
3. **The timeline** — five lanes (sub-layer + four teams) across Sep→Dec 2026 on a
   15-week grid. A chip's **right edge is its `close_time`**. Dashed fill = a
   **Reach** task with the thing it waits on named; dotted border = recurring, with
   cadence and first date.
4. **Seams** — the eight units this agenda touches and what each one owns, so no
   chip silently assumes another department's work.
5. **Locks** — NF-B held, OD-05/07 the founder's, pricing deferred, visuals held,
   A15, and the merge rule. Listed as a band, because respecting them is the design
   constraint the rest of the page has to survive.
6. **Findings / Declined** — the seven things the agenda records rather than fixes,
   and the four it turned down (including the tempting synthetic NF-B corpus).

## Layout mechanics

- One 15-column CSS grid per lane; each chip sets only `grid-column`, and grid
  auto-placement resolves collisions into extra rows. Verified: **0 chip overlaps,
  0 clipped labels, 0 horizontal overflow** at 1480px.
- Week rules are a `repeating-linear-gradient` on the lane background, so the grid
  reads as time without any extra elements.
- Self-contained: one file, no scripts, no external fonts or assets. System font
  stack with a Plus Jakarta Sans preference if the machine happens to have it.

## View

```
open .planning/sketches/063-guest-experience-agenda-canvas/canvas.html
```

## Relation to the agenda of record

The canvas is a picture of
`.planning/01-org/product/guest-experience/guest-experience-agenda-full.md`.
Where they disagree, **the agenda wins** — the canvas carries no task, doneability,
or date that the agenda does not.
