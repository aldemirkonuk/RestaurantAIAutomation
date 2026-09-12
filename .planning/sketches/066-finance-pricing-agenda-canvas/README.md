---
sketch: "066"
name: finance-pricing-agenda-canvas
question: "Can one page hold a whole department's first agenda — 21 tasks, two teams graded oppositely, their close-times, seams and locks — without letting the measured half lend credibility to the unmeasured half?"
winner: null
tags: [agenda, canvas, wave-3, finance, pricing, spend-ledger, cost-per-task, payment-rails, locks, close-times, seams, cards, adr-0039]
---

# Sketch 066: Finance &amp; Pricing · Agenda Canvas

## Design Question

The founder's brief for wave 3 is one canvas per department showing *its agenda as one
picture* — tasks, owners-by-team, close-times, and the seams it touches
([`GENERATION_BRIEF.md` §8.2.5](../../foundation/GENERATION_BRIEF.md)). For this unit
that is harder than for most, because its whole charter is a separation:

> **Two independent numbers and never one.** A measured F1 figure and an unmeasured F2
> figure fused into a single "finance" number is [[finance-pricing-premortem]] D1
> happening ([`finance-pricing-charter.md` §Metrics](../../01-org/commercial/finance-pricing/finance-pricing-charter.md)).

A canvas is a summarising surface, and summarising is exactly the failure mode. So the
design question is whether one page can hold both halves **without averaging them**.

## How to View

```
open .planning/sketches/066-finance-pricing-agenda-canvas/canvas.html
```

Self-contained: no build, no network, no assets.

## What it shows

| Region | What it carries |
|---|---|
| **Lock banner** | Both founder locks stated before any task is read — pricing model deferred, brand/landing visuals held (re-confirmed 2026-08-28) |
| **Time axis** | Nine dated close-times (Sep 11 → Nov 28) plus one **recurring** rail. A chip sits on its close-time; a chip with no close-time cannot exist |
| **Three lanes** | F1 `inference-cost` (EXISTS) · F2 `unit-economics-pricing` (NEW, dormant) · the sub-layer. Lanes never merge, and there is no total row anywhere on the page |
| **Chip colour** | The honesty grading from the agenda's §7: buildable now / gated / aspiration pending a decision. A burgundy border + `LOCK` tag marks the six chips that come near the pricing lock |
| **Seams** | Consumes / emits / **declared gaps** as three equal columns — the gaps get the same weight as the flows, which is the point |
| **Meters** | What each metric actually reads on 2026-08-28, measured in-worktree, colour-coded none / partial / ok |
| **Findings** | The six things no card and no loop can carry — including two corrections to this unit's own documents |

## The three design choices worth arguing with

1. **Close-time is the x-axis, not priority.** Priority is an opinion; a close-time is a
   promise that can be broken visibly. Anything without one is not on the page — which is
   also the agenda's deletion rule.
2. **Gaps are a column, not a footnote.** Three equal cards: what we consume, what we
   emit, and what has no publisher at all. A canvas that renders only the arrows that
   exist reads as a working system.
3. **No totals, anywhere.** No "N% complete", no aggregate metric, no combined finance
   figure. The one visual affordance a canvas naturally offers — the summary number — is
   the one thing this unit's charter forbids.

## What to look for

- Does the eye ever try to **add the two lanes together**? If it does, the canvas has
  failed its own charter and the lane separation needs to be harder.
- Does the **Sep 30 column** read as overloaded (three F1 chips land there — the first
  readout, the cap map, the first reconciliation)? That is either an honest month-end
  cluster or a scheduling smell.
- Do the **six locked chips** read as research, or do any of them read as a step toward a
  price? Any chip that reads as the second is a bug in the agenda, not in the canvas.
- Is the **findings list** legible as *not-work*? It is the part most likely to be
  mistaken for a backlog.

## Not decided here

No winner is recorded. The canvas is a reading of
[`finance-pricing-agenda-full.md`](../../01-org/commercial/finance-pricing/finance-pricing-agenda-full.md),
which is the source of truth for every task, doneability, close-time and citation; where
the two disagree, the agenda wins. Throwaway-grade per the sketch conventions.
