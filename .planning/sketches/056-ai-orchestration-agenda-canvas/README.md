# Sketch 056 · AI Orchestration Agenda Canvas

**Design question:** Can one page hold a department agenda so that the *spine* is
visible as a spine — five teams, twenty-one tasks, six close-dates, and the one open
fork (OD-03) every other lane is arranged around — without collapsing into a Gantt
chart that implies precision nobody has?

**Context:** Companion to
[`ai-orchestration-agenda-full.md`](../../01-org/applied-ai/ai-orchestration/ai-orchestration-agenda-full.md)
and [`…-agenda-board.md`](../../01-org/applied-ai/ai-orchestration/ai-orchestration-agenda-board.md),
written under [ADR 0039](../../decisions/0039-activation-plan-of-record.md) Track B /
`GENERATION_BRIEF.md` §8.5 (*one canvas per department: its tasks, owners-by-team,
close-times, and the seams it touches*). Throwaway-grade: a thinking surface, not a
product. **If the canvas and the agenda disagree, the agenda is right.**

## What it shows

| Band | Holds |
|---|---|
| **Metric strip** | Eight numbers measured on 2026-08-28 by `python3 scripts/agents/run_card.py`, each with the task it points at. "not emitted" / "unmeasured" / "unmeasurable" are rendered as *no value*, never as zero — [ADR 0020](../../decisions/) discipline. |
| **The grid** | Rows = the five teams + the department seam lane; columns = the six close-dates (Sep 4 → Oct 9). Every chip is one task with an ID that resolves in the agenda. |
| **Colour = track, not priority** | Red = Track A1 (the OD-03 bake-off, the spine) · Blue = Track A3 (the single action schema) · Purple = Tracks A2/A4 · Green = per-team work. A dashed chip is blocked, and names its dependency on the chip itself. |
| **Lower deck** | Seams (which other unit is on the other end of each dependency) and the four findings no card or loop can carry. |
| **Locks band** | The founder's two standing locks plus the OD-03 diet, each with the sentence saying how this agenda stayed inside it. |

## Reading it

The shape the layout is arguing for: **the spine is a single lane that starts early
and ends late, and almost nothing else waits on it.** That was the design test. An
agenda whose every task hung off the bake-off would be one decision wearing a
department's clothes; an agenda with no spine would be five teams doing unrelated
chores. The grid should make it visible in one glance that AIO-6 (the diet guard)
holds the line even if AIO-4 (the run) slips — the fallback is drawn, not just written.

**Deliberately not drawn:** dependency arrows between chips. They were tried and
removed — with 21 tasks the arrow layer read as precision the schedule does not have,
and the blocking relation is already stated in words on each blocked chip.

## Constraints honoured

- Self-contained single file, no external assets, no fonts, no scripts.
- Every number on the page came from a command that re-runs; nothing was estimated.
- No open fork is resolved on the canvas — OD-03, OD-04, TECH-F3, TECH-F5 and TECH-F6
  all appear as open.
- No pricing surface, no visual-brand surface (both locked).

## Files

- `canvas.html` — the one-pager. Open directly in a browser.
