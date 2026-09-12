# Sketch 070 · Knowledge & Documentation — Agenda Canvas

**Design question:** Can a department agenda be read as one picture — its tasks, its
owners-by-team, its close-times, and the seams it touches — without the picture quietly
becoming prettier than the evidence underneath it?

**Context:** The department canvas required by
[ADR 0039](../../decisions/0039-activation-plan-of-record.md) Track B §8.2.5, one per
department. Source of every claim on it:
[`knowledge-documentation-agenda-full.md`](../../01-org/corporate/knowledge-documentation/knowledge-documentation-agenda-full.md)
(dated 2026-08-28). Throwaway-grade per the sketch conventions — a thinking surface, not a
product, and not a thing to keep in sync by hand.

## Direction

An accounting page, not a dashboard. The department's subject matter is this chapter, so
the canvas leads with the one number that grades the department against itself
(`kd.docs_added_vs_retired_ratio` = ∞) and with what **this very wave** adds to it.

| | |
|--|--|
| **Domain** | Corpus census, tombstones, staleness cliffs, link ambiguity, claim pinning |
| **Colour world** | Warm paper, ink, burgundy for the department's own numbers; slate / moss / amber to key the three teams |
| **Signature** | The ledger equation `+108 ÷ 0 = ∞`, and a timeline where the two staleness cliffs this wave creates are drawn as walls |
| **Rejects** | Progress bars over unmeasured metrics; a "0 of 16 done" completion ring; any chart whose denominator this department cannot currently read |

## What it shows

1. **The ledger** — both raw counts, never the ratio alone (the card's own quality bar,
   `knowledge-documentation-agent-stack.md:46`), beside what wave 3 itself adds.
2. **The timeline** — sixteen close-times from 2026-09-04 to 2026-10-23, with the two
   staleness cliffs (**2026-10-23**, 152 agendas · **2026-10-27**, 48 agendas) drawn where
   they fall and KD-5 landing seven days before the first.
3. **The four tracks** — every task with an ID, an owner keyed by team colour, and a
   close-time. Doneability lives in the agenda; the canvas does not restate it.
4. **Reach, graded** — three aspiration items with the grade printed on the card, so a
   reach cannot be mistaken for a plan.
5. **Findings and seams** — including the two loops this agenda deliberately does *not*
   mechanise this quarter.

## Honesty notes

- Every figure was measured on disk 2026-08-28 (`scripts/agents/run_card.py`,
  `scripts/watch_loops.py`, direct file counts). Nothing is forecast.
- The `46 → 70` README figure counts the READMEs **this wave adds**, this file included.
- The conflict-marker finding (F1) is stated on the canvas as needing verification against
  `origin/main` before it is filed as a corpus defect.
- No pricing and no brand/landing visual work appears anywhere on the canvas — both are
  locked (ADR 0039 §8.2.4).

## Files

- `canvas.html` — self-contained, no external assets, system font stack, light/dark aware.
