# Sketch 075 · Red Team — Agenda Canvas

**Design question:** A premortem written inside the wave it premortems shares every mechanism
it names — so can one page show the difference between *a mechanism someone worried about*
and *a mechanism measured on disk*, by putting the counterfactual next to every claim?

**Context:** Wave 3 ([[0039-activation-plan-of-record]] Track B, `GENERATION_BRIEF.md` §8).
The picture of [`red-team-agenda-full.md`](../../02-advisory/red-team/red-team-agenda-full.md)
dated 2026-08-28 — six graded failure mechanisms, three rejected seeds, and eleven scheduled
rows under a cap of seven open findings. Throwaway-grade thinking surface per the sketch
conventions, not a product.

## Direction

| | |
|--|--|
| **Domain** | Decisions, not systems. Locked ADRs · open forks · undeclared decisions · premortem mechanisms |
| **Organising idea** | **Every mechanism carries the number that produced it.** The page opens with the counterfactual — the same scan with and without files dated 2026-08-28 — because that single measurement is what separates *the wave caused this* from *this was already here*, and every card below inherits its credibility from it |
| **Color world** | Dark control-board. Orange = LIVE mechanism, amber = LATENT, slate = REJECTED, wine reserved for two things only: a date the org already owns, and a founder-locked target. It never decorates |
| **Rejects** | A findings dashboard (there are zero findings; a dashboard of zeros teaches nothing); a risk matrix (probability × impact is exactly the un-disconfirmable form this function's directive rejects); an org chart (advisory sits outside the line — the chart is a box beside a box) |

## What the page shows, in order

1. **The counterfactual strip.** `watch_loops.py`'s dated-trigger scan run twice: without
   wave-3 files (0 events, 0 unit-slots) and with them (6 events, 18 unit-slots, all false).
   It is first because nothing else on the page is trustworthy without it.
2. **Six mechanism cards, graded LIVE / LATENT / REJECTED**, each with its number, its
   *earliest observable signal*, and a counter-pressure that is a mechanism rather than a
   caution. W3 is the one deliberately graded down: 4% of task rows carry no evidence at all
   and 63% carry no strict `file:line` — the page leads with the **4%**, because leading with
   63% would be this function's own failure mode wearing a statistic.
3. **Rejected seeds, with the reason** — including a measurement that was built, found to be
   reading the wrong table column, and **discarded rather than published**.
4. **The cap, spent.** Seven slots filled, two deferrals shown dashed and named. The cap is
   the page's only piece of arithmetic and it is the charter's one structural defence against
   becoming an objection machine.
5. **The timeline**, lanes by track, columns by `close_time` (Sep 04 → Nov 24). Dashed chips
   are reach items, graded as such on the page rather than in a footnote.
6. **The two dates the page is bracketed by** — 2026-10-27 (its own staleness cliff, written
   as the disconfirming observation) and 2026-11-24 (this function judging whether it should
   still exist).
7. **Self-emission table** — the four disciplines this page applies to itself before asking
   anyone else, with what was verified on 2026-08-28.
8. **Locks**, stated out loud: pricing deferred, brand visuals held, NF-B HELD, zero forks
   resolved, zero other units' files edited.

## Why the counterfactual and not a chart of findings

Both places where the obvious page would have been wrong:

- **The counterfactual is the argument.** "Twenty-four agendas in one day causes noise" is a
  worry. "The 30-day horizon holds 0 events without these files and 6 with them, and every one
  of the six is false" is a finding. The page is built around the second sentence because the
  first is what this function is supposed to catch other people saying.
- **A findings dashboard would have shown zeros and read as progress.** This unit has filed
  nothing, ever. The honest surface is a queue with a spent cap and a deferral list — which
  shows the constraint doing work — not a gauge showing a number that has never moved.

## Verification

Rendered from a local static server at 1600×1100 and 1500×950; the timeline sits in its own
`overflow-x: auto` container and the mechanism grid reflows to one column below ~700px
without the page scrolling horizontally. Two SVG label collisions found and fixed at the
10-27/11-24 end of the timeline. Self-contained: no external stylesheets, fonts, scripts or
images; system font stack only. Tag structure validated (`html.parser`: zero unclosed tags,
zero mismatches). 26 KB.

## MANIFEST row

Not added here — the manifest is edited by the orchestrating session
([`GENERATION_BRIEF.md`](../../foundation/GENERATION_BRIEF.md) §8.4). The row is:

```
| 075 | red-team-agenda-canvas | A premortem written inside the wave it premortems shares every mechanism it names — can one page separate a worry from a measurement by putting the counterfactual next to every claim? | — | red-team, advisory, agenda, wave-3, premortem, counterfactual, watch-loops, staleness-cliff, finding-cap, decision-attack, findings-only |
```

**Note for whoever adds it:** 30 of the 73 sketch directories currently have no manifest row,
and **10 of those predate this wave** (`005`, `011`–`015`, `017`–`019`, `049`). That is the
subject of finding **F-W5** in this unit's agenda — the deferred-row procedure has already
failed ten times, so this row is worth adding on the same pass that reads it.
