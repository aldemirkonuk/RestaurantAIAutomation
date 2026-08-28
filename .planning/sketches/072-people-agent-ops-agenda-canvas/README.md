# Sketch 072 · People & Agent Ops — Agenda Canvas

**Design question:** Can one page hold a department's whole first agenda — two
non-commensurable metric sets, two agent populations that must never be summed, 17 tasks
on eight close-times, and five seams owned elsewhere — without producing the single
roll-up number the department's charter forbids?

**Context:** Wave 3 canvas for
[`people-agent-ops-agenda-full.md`](../../01-org/corporate/people-agent-ops/people-agent-ops-agenda-full.md),
authored under [ADR 0039](../../decisions/0039-activation-plan-of-record.md) Track B and
`foundation/GENERATION_BRIEF.md` §8.5. Throwaway-grade thinking surface, not a product
surface.

## The constraint that shaped it

This department is the one place in the vault where **a dashboard that looks healthy is
the failure mode** — premortem M3 is literally "`success_rate` became the metric because
it already existed." So the canvas is built to make the wrong reading *visually
impossible*:

| Pressure | What the canvas does |
|---|---|
| One roll-up number | There is no summary tile anywhere. The top strip is a **delta strip** (was → is), not a score |
| Two populations merged | Cards and modules sit in two separate panels with a literal `102 + 24 ≠ 126` line between them |
| The available number standing in for the real one | A dedicated `≠` panel: `27/39` on the left, **not emitted** on the right, an alarm-coloured `≠` between them |
| Reach items reading as commitments | `REACH` badges in alarm colour, with the missing dependency written into the doneability line |
| Findings quietly becoming assignments | Seams are a separate table addressed *to* other units, and findings-no-loop-can-carry are a numbered list with no dates |

## Layout

1. **Masthead** — the thesis in three lines
2. **Re-grade strip** — six `was → is` deltas from four days of movement, five green and
   one deliberately red (`maturity_evidenced 0% → 0%`), so the strip cannot read as a
   victory lap
3. **Two populations** — declared (102 cards) vs runtime (24 modules), progress bars per
   population, with the non-addition rule printed between them
4. **The `≠` panel** — the board's founding rule as one picture
5. **Task lanes** — eight date columns, tasks coloured by owning team, every card carrying
   its `done:` line
6. **Seams & findings** — what leaves the department, and what nothing can carry

## Colour

| | |
|--|--|
| **Roster-lifecycle** | cool slate-blue — facts checkable against the filesystem |
| **Performance-doneability** | amber — judgements that need a verdict we mostly do not have |
| **Department-level** | violet — spans both teams |
| **Seams** | green — leaves the department |
| **Alarm red** | reserved for two things only: the metric that did not move, and reach items |

Deliberately not a "premium product" palette — this is an instrument panel, and the sketch
conventions' design direction (burgundy/glass onboarding) is for customer surfaces, not
for an internal board.

## Data provenance

Every figure is measured, none illustrative. Sources, in the footer of the canvas itself:

- `00-index/cards.json` — 102 cards, 58 with `quality_bar: NONE (gap)`, 188 declared gaps
  across 92 cards, 36/36/30 routing mix
- `scripts/agents/run_card.py` `IMPLEMENTED` — 8 of 102 cards execute
- the agent-fleet census fact `memory/2026-08-28-fleet-census.md` — 24 modules, 23
  registered, 1 unregistered (**consumed, never recomputed** — ADR 0035 §3)
- `scripts/check_task_types_are_graded.py` via `gate-runner` — 39 emit / 27 graded / 12
  exempt / 0 ungraded (**consumed, never recomputed** — TECH-F3)
- `services/agent-orchestrator/services/spend_logger.py:269,326-327` and
  `core/base_agent.py:308` — ambient agent attribution
- `core/orchestrator.py:245` + 5 `IS_STUB = True` modules — the 18-can-start figure the
  census does not currently report

## View

```
open .planning/sketches/072-people-agent-ops-agenda-canvas/canvas.html
```

## Manifest row

```
| 072 | people-agent-ops-agenda-canvas | Can one page hold two non-commensurable metric sets, two agent populations that must never be summed, 17 tasks on 8 close-times, and 5 seams — without ever producing a roll-up number? | — | org, agenda, wave-3, people-agent-ops, personnel-files, roster, doneability, verdict-coverage, cards-json, instrument-panel |
```

*Not added to `MANIFEST.md` by this agent — the orchestrating session owns that file.*
