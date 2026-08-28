# Sketch 054 · Data — Agenda Canvas

**Design question:** Can one page hold a department's entire first agenda — 21 tasks across
five teams, each with its close_time, its doneability, and the seams it touches — without
collapsing four incompatible truth guarantees into a single progress number?

**Context:** Wave 3 / [ADR 0039](../../decisions/0039-activation-plan-of-record.md) Track B —
one canvas per department, showing that department's agenda as one picture. Source of record
is [`data-agenda-full.md`](../../01-org/platform/data/data-agenda-full.md); this canvas
renders it, it does not extend it. Throwaway-grade per the sketch conventions: a thinking
surface, not a product screen.

## The structural choice

Every planning board reaches for **status columns** (todo / doing / done). This one refuses
them, because status is the one axis this department must not have: a board with a "done"
column invites a rollup, and a rollup across four truth guarantees is exactly
[[data-premortem]] M1 and M2. So the two axes are:

| Axis | What it is | Why |
|---|---|---|
| **Row (lane)** | The **truth guarantee** the team produces — probabilistic · human-verified · true-by-construction · observed · audited | The only line the department splits on (`technology.md:555-560`). Colour is the guarantee, so a task's epistemic status is visible before its text is read |
| **Column** | The **close_time** — the date the task must have moved by | §8.2's rule made spatial: a task that cannot say when it should have moved is not on the board because it does not exist |

There is no "in progress". A task is at its date or it is late, and lateness is a finding
(`DAT-4`, the staleness watcher).

## What the canvas shows

1. **The three L0 numbers strip** — wine `144 / 1,448` on the *wrong* denominator, dish `0`,
   sales `— not measured`. Today's honest state, printed first, so the board underneath reads
   as a plan against a real floor rather than an ambition in a vacuum.
2. **The lane board** — 21 task chips, each carrying its ID, its one-line doneability, and its
   cadence. Three chips are marked **● SPINE**: the substrate report that emits itself (DAT-1),
   coverage on the true denominator (DAT-5), and the first POS line-resolution rate ever
   computed (DAT-12). One chip is **dashed** — DAT-17 is gated on a column this department does
   not own, and a gated task is drawn differently rather than described as scheduled.
3. **Seams** — five asks addressed to other units' `questions.md`, each with what Data gives
   back. An ask with nothing offered in return is a request, not a seam.
4. **Findings** — eight things no card and no loop can carry, filed rather than scheduled.
5. **The three reaches, graded** — two `achievable`, one `aspiration pending decisions we do
   not own`, in the same visual weight, so the ambition and its honesty arrive together.
6. **Locks** — pricing deferred, visuals held, forks untouched, on the page rather than in a
   footnote.

## Rejected directions

| Rejected | Why |
|---|---|
| Kanban with status columns | Invites a "% done" rollup — the exact failure the department is built to prevent |
| A dependency graph of the 21 tasks | Truthful and unreadable; the four real gates (DAT-16→17, DAT-9/11→20) are carried on the chips instead |
| A single progress ring / L0 % | Structurally forbidden. [[data-premortem]] M1 and M3 are both this picture |
| Colour by team | Teams are an implementation of the guarantee split; colouring by guarantee makes the department's design claim visible without a legend |
| Charts of the metrics | There are no values yet. A chart of zeros dressed as a trend is the reporting-format failure, drawn |

## Notes

- Self-contained: no external fonts, scripts, or assets — system font stacks only, opens from
  the filesystem.
- Palette follows the house sketch language (chalk / limestone / ink / wine), with one hue per
  truth guarantee.
- The board scrolls horizontally below ~1320px rather than reflowing, because the column *is*
  the close date and compressing the time axis would lie about the sequencing.
