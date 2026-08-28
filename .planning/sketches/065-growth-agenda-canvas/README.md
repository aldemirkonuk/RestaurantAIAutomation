# Sketch 065 · Growth Agenda Canvas

**Design question:** Can a near-greenfield department's whole agenda — sixteen tasks, five
team lanes, three two-owner seams, four graded reach items — be read in one screen without
either flattening into a backlog or hiding that most of it is blocked?

**Context:** Wave 3 of [ADR 0039](../../decisions/0039-activation-plan-of-record.md) Track B,
per `GENERATION_BRIEF` §8.5. One canvas per department. Source of truth is
[`growth-agenda-full.md`](../../01-org/commercial/growth/growth-agenda-full.md); if the two
disagree, the agenda wins and this file is stale.

**File:** `canvas.html` — self-contained, no build step, no external assets. Open it directly.
The sketch-theme palette (`../themes/default.css`) is inlined rather than linked so the file
survives being moved or opened from anywhere.

## Direction

| | |
|--|--|
| **Domain** | Growth's first real agenda: OD-53 settlement, the publishing-target blocker, the answer-surface program, the funnel that cannot be measured without breaking a published promise |
| **Color world** | Sketch-theme burgundy `#CD2D5B`, with status carrying semantic color — red = blocked, green = runnable today, amber = re-specified, violet = reach item |
| **Signature** | Status is never implicit. Every pipeline stage wears its own blocked/runnable badge, and the four reach items are labelled REACH in the task row itself, not in a footnote |
| **Rejects** | A landing-page look (brand visuals are HELD); a kanban board (implies a flow that does not exist yet); a progress bar or completion percentage (nothing is complete, and a 0% bar reads as failure rather than as accuracy); any composite "growth score" |

## Structure, top to bottom

```
header            dated 2026-08-28, active, counts (16 tasks / 4 reach / 6 loops / locks honoured)
OD-53 settled     the two fetched halves side by side, verdict chips, source+date lines,
                  and one amber band for the residual unknown that did NOT close
pipeline strip    the founder's six stages, each graded against what is actually possible;
                  the refeed arrow called out separately as the thing that makes it a loop
five lanes + dept 16 task cards: id · title · close_time chip · doneability · evidence line
three seams       left = decides, right = objects, per growth-directive
locks + zeros     what this agenda will not do, and the three hard zeros, side by side
```

## Why this shape

**The pipeline strip earns its place at the top.** Growth's central failure mode
([`growth-premortem`](../../01-org/commercial/growth/growth-premortem.md) M1) is running the
pipeline at full speed with nowhere to publish. A canvas that listed tasks without showing
that four of six stages are blocked would reproduce the failure it is meant to prevent. The
strip is the honest picture: one stage runnable, one re-specified today, four blocked.

**Doneability sits in the card, not in a legend.** §8.2 requires every task to name how you
would know it is done. Putting that in a tooltip or a legend makes it optional at reading
time, which is how a task quietly becomes a wish.

**Blocked rows are shown, not filtered.** A blocked task that records "blocked" every
close-time is doing its job; a blocked task quietly omitted from the board is how a
department discovers in month nine that nothing was measured
([`growth-loops`](../../01-org/commercial/growth/growth-loops.md)).

**The locks get a panel, dashed and grey.** Making the prohibitions visible is the cheapest
guard against the next session quietly scheduling past one.

## What it deliberately does not show

- **No progress percentage, no burndown.** Sixteen tasks at zero progress rendered as a bar
  reads as failure; rendered as a dated list it reads as a plan.
- **No agent-autonomy diagram.** That is the agent-stack artifact's job; duplicating it here
  would be two sources of truth for the same contract.
- **No per-task owner names.** The lane *is* the owner. A name column on a one-founder
  department is organizational fiction (fork CM-F1 is open on exactly that point).

## Status

Throwaway-grade thinking surface. Not a product design, not a route, not a component.
It is regenerated from the agenda, never the reverse.

## MANIFEST row (not applied here — the wave-3 orchestrator owns MANIFEST.md)

```
| 065 | growth-agenda-canvas | Can a near-greenfield department's whole agenda — 16 tasks, 5 team lanes, 3 two-owner seams, 4 graded reach items — be read in one screen without flattening into a backlog or hiding that most of it is blocked? | — | growth, agenda, wave-3, adr-0039, seo, answer-surface, editorial-gate, funnel, od-53, seams, locks, canvas |
```
