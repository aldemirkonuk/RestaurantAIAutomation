# Sketch 067 · Media & Brand — Agenda Canvas

**Design question:** Can one page hold a department's whole first agenda — 18 tasks, 4 teams,
6 close-times and 5 standing locks — so that **what is forbidden is as legible as what is
scheduled**?

**Context:** Wave 3 of [ADR 0039](../../decisions/0039-activation-plan-of-record.md) Track B.
One canvas per department, throwaway-grade, a thinking surface rather than a product. The
source of truth is
[`media-brand-agenda-full.md`](../../01-org/commercial/media-brand/media-brand-agenda-full.md);
if this canvas disagrees with it, the canvas is stale.

## Direction

| | |
|--|--|
| **Domain** | A department agenda under four standing locks, three of four metrics unmeasurable |
| **Color world** | Warm paper `#F7F4EF`, ink `#1A1614`, existing repo burgundy `#9E4249` as the single accent; one hue per team |
| **Signature** | The locks table is a **first-class panel**, not a footnote — forbidden work is rendered at the same weight as scheduled work |
| **Rejects** | A kanban board (implies pull, and half of this agenda cannot be pulled); a Gantt chart (implies duration, and these tasks have close-times, not estimates); any brand treatment at all |

## Why this shape

Three ordinary agenda layouts were considered and dropped.

- **Kanban columns (todo / doing / done).** Wrong primitive. Nothing here is "doing", and the
  interesting state — *gated behind a lock that a person must lift* — has no column.
- **A Gantt/duration chart.** The brief requires a `close_time` per task, which is the date by
  which a task must have **moved**, not how long it takes. A bar with a length would invent a
  number nobody measured.
- **A plain table of 18 rows.** Legible, and it loses the two things worth seeing at a glance:
  which team carries the load (M1 carries 8 of 18) and which work is forbidden rather than
  merely unscheduled.

What is here instead: six columns keyed to **close-time** (7d · 10d · 14d · 21d · GATED ·
RECURRING), team as a left-rail color, and two panels below — the **locks**, each with an
explicit *forbids / still permits* pair, and the **findings** from re-measuring on 2026-08-28.

## The measured strip is the argument

The header tiles are not decoration. They carry the fact that reordered the agenda: the
department's one measurable metric moved **away from** its target in four days with zero guards
in place — name `351 → 360` lines, domain `33 → 39`. That is why the ratchet (MB-4) is scheduled
before the sweep (MB-7), rather than after it.

## Lock note

**This is an agenda diagram, not brand visual work.** The brand and landing visuals hold
(`decisions/README.md:76`, re-confirmed by the founder 2026-08-28) is untouched by this file: it
proposes no mark, no palette, no type system and no treatment, and it reuses color values already
present in the repo rather than choosing new ones. Voice, naming and tone-of-voice groundwork are
the permitted half of that lock and are the agenda's spine; commissioning a visual is the
forbidden half and appears on this canvas only inside the locks panel, as a prohibition.

## Files

- `canvas.html` — the one-pager. Self-contained: no scripts, no external stylesheets, fonts or
  images. Validated as well-formed; **rendering was not verified in a browser** — the Browser
  pane was at its tab cap with sibling wave-3 agents and both `file://` and `http://`
  navigations were declined in this non-interactive session.

## Manifest row

```
| 067 | media-brand-agenda-canvas | Can one page hold a department's whole first agenda — 18 tasks, 4 teams, 6 close-times, 5 standing locks — so that what is forbidden is as legible as what is scheduled? | — | agenda, wave-3, media-brand, commercial, brand-voice, rename-burndown, consent-gate, locks, close-times, canvas |
```
