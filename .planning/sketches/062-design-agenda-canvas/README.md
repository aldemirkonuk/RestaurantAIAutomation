# Sketch 062 · Design — Agenda Canvas

**Design question:** Can a department's whole agenda — tasks, owning team, close-times, the
seams it crosses, and the locks it must not cross — be read as **one picture** without
collapsing five non-commensurable metrics into a single number?

**Context:** Wave 3 of [ADR 0039](../../decisions/0039-activation-plan-of-record.md)
Track B. One canvas per department; this one covers
[`design-agenda-full.md`](../../01-org/product/design/design-agenda-full.md) dated
2026-08-28. Throwaway-grade per the sketch conventions — a thinking surface, not a product.

## What it shows

| Element | Encoding |
|---|---|
| **Locks band** (top) | The three holds this department is most exposed to, each with its citation. Deliberately above the work, because they bind hardest here |
| **Lanes** (rows) | The four teams + the department itself. Colour is identity only — lanes are **never summed** ([[design-directive]] opposed-metrics rule) |
| **Columns** | Close-times: 2026-09-04, -09-11, -09-18, -09-25, -10-09, -10-23. A task sits in the column it must have **moved by**, not the one it starts in |
| **Chips** | ID · task · the doneability line in one sentence. Hatched = a graded reach (agenda §4) |
| **The wall** | 2026-10-27 — this file's own staleness date, per `scripts/watch_loops.py:11-13` |
| **Lower panels** | Seams (who receives what), findings no card or loop can carry, and the counters re-measured 2026-08-28 |

## Constraints it was drawn under

- **It commissions no visual.** Brand/landing visuals are held until *"structure + brand
  exist"* (`decisions/README.md:81`). The canvas is a planning surface; nothing in it
  proposes a look for the product.
- **It picks nothing for OD-106.** The two burgundies (`#9E4249` in
  `apps/web/tailwind.config.js:31`, `#CD2D5B` in `sketches/themes/default.css:6`) appear as
  **labelled evidence dots** — the divergence is already documented in
  [`DESIGN-FOUNDATION.md`](../../06-pages/DESIGN-FOUNDATION.md) §1. No side-by-side mock,
  no direction implied. OD-106 is documentation-only until the founder reopens it.
- **No aggregate number appears anywhere on it.** The counters panel is a list, not a score.
- Its own palette is deliberately neutral ink-on-paper so that no reader mistakes a canvas
  chrome choice for a product token proposal.

## Self-containedness

`canvas.html` is one file: no build step, no external CSS, JS, fonts, or images. Open it
directly in a browser. It reflows to a single column under 820px, where each lane becomes a
stack and each cell prints its own date.

## Status

**Winner: —** (not applicable — this is a reporting canvas, not an option set). Its
conversion is measured instead: under agenda task **T3.5**, the ~24 wave-3 canvases are
cohort #1 of the sketch program and are graded on whether a receiving team acted on them,
against today's baseline of `design.winner_shipped_conversion = 2 of 53`.

## MANIFEST row

Not added here — the orchestrating session owns `MANIFEST.md` for this wave
([`GENERATION_BRIEF.md`](../../foundation/GENERATION_BRIEF.md) §8.4). Proposed row:

```
| 062 | design-agenda-canvas | Can a department's whole agenda — tasks, owners-by-team, close-times, seams and locks — be read as one picture without ever summing its five non-commensurable metrics? | — | agenda, design, wave-3, canvas, close-times, locks, od-106, brand-hold, teams, planning-surface |
```
