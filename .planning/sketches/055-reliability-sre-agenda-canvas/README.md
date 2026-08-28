---
sketch: "055"
name: reliability-sre-agenda-canvas
question: "Can a department agenda be read as one picture — dated spine, cadence, and the seams it cannot close alone — without collapsing five incommensurable numbers into one?"
winner: null
tags: [agenda, canvas, reliability, sre, wave-3, adr-0039, timeline, swimlane, dlq, restore-drill, runner-cron, ops]
---

# Sketch 055: Reliability / SRE Agenda Canvas

## Design Question

[[reliability-sre-agenda-full]] is a 2026-08-28 agenda with 22 tasks across a department
and four teams, each carrying a doneability and a close_time. The prose is correct and
unglanceable. **Can the same agenda be read in one screen** — what closes when, who owns
it, and which parts this department cannot close by itself — without doing the one thing
the charter forbids, which is rolling five incommensurable numbers into a health score?

The specific constraint that shaped the layout: the department's card quality bar says
every board row must render *a measured value*, the word **`unmeasured`**, or **`never
happened`**. A canvas that renders "never happened" as an empty cell, a grey dash, or a
0% bar would be the M1 failure (absence looking like calm) drawn in CSS.

## How to View

```
open .planning/sketches/055-reliability-sre-agenda-canvas/canvas.html
```

Self-contained: no external fonts, scripts, or assets. Dark only — this is an ops surface,
and the department's brand rule (burgundy `#CD2D5B`) survives as the team-task accent.

## Structure

| Band | What it answers | Form |
|---|---|---|
| Header | Why this department exists this quarter | One sentence + seven measured denominators as chips |
| **The five numbers** | What is actually known today | Five cards, top-border colour = *class of not-knowing*: red `never happened`, amber `unmeasured`, blue `partial`. Each names its **liveness twin** or says it has none |
| **Dated work** | What closes when, and how you would know | Swimlane timeline: 5 lanes (department + 4 teams) × 10 date columns, Sep 05 → Oct 31. Every card is `id · task · doneability` |
| **Cadence** | What closes repeatedly | Lane rows of chips with the closed-vocabulary cadence (`weekly`/`monthly`/`quarterly`/`per-pr`) as a coloured tag |
| **Seams / questions / not-scheduled** | Where the department stops | Three columns: cross-unit seams with the units tagged, the six founder questions, and the deliberate non-goals struck through |

## Decisions taken while drawing it

1. **Absence is a colour, not a gap.** `never happened` gets the strongest treatment on
   the page (red border, tinted card). The one metric that has *never had a value* should
   be the most visually present thing in the five-number band, not the emptiest.
2. **The spine is red across lanes, not grouped.** The three seeds (restore drill, DLQ
   consumer, runner cron) live in three different lanes. Colouring rather than grouping
   them keeps the ownership honest — the spine is not a team.
3. **Doneability is on the card, not in a tooltip.** Every card's bottom line is how you
   would know it is done. A timeline that shows only titles and dates is a Gantt chart, and
   a Gantt chart is exactly the artefact §8.2 was written against.
4. **Two cards may share a date column.** They stack. Compressing them into one row would
   have meant dropping a task or faking a date.
5. **No progress bars, no percentages, no score.** Nothing on this page aggregates.

## Known rough edges (throwaway-grade, per the sketch conventions)

- The lane-cell grid has its own padding, so internal columns drift a few pixels from the
  header's date ticks. Readable, not aligned.
- Static: every value is hand-transcribed from the agenda on 2026-08-28. It has no data
  source and will rot the moment a task closes — which is correct for a sketch and would
  be a defect in a board.
- Below ~1180px the timeline scrolls horizontally rather than reflowing. Deliberate: the
  date axis is the point.

## Relationship to the vault

Renders [[reliability-sre-agenda-full]] (the tasks, §2–§6), [[reliability-sre-agenda-board]]
(the five numbers and the denominators) and [[reliability-sre-loops]] (the cadences). It
is a *view*, never a source — if the canvas and the agenda disagree, the agenda is right.
