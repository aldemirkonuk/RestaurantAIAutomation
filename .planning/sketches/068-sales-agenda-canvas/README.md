# Sketch 068 · Sales Agenda Canvas

**Design question:** Can a department whose honest state is *one customer, zero sends, and
a locked-away target list* show its whole agenda as one picture — without the picture
flattering it? Specifically: does a close-time-across / owner-down board make the
department's real shape (one lane doing everything, one lane correctly idle, one gate
holding all of it) visible at a glance, in a way the prose agenda cannot?

**Context:** Wave 3 / ADR 0039 Track B canvas for `01-org/commercial/sales`. Renders
[[sales-agenda-full]]'s fourteen tasks. Companion board: [[sales-agenda-board]].

## Direction

| | |
|--|--|
| **Domain** | Department agenda — tasks, owners-by-team, close-times, cross-unit seams |
| **Color world** | Warm near-black `#141110`, wine `#9E4249` (the accent sketch 052 established for the match document), amber for S1, slate-blue for S2 |
| **Signature** | The lane label carries the *honest grade* — S2's reads "dormant by construction", and its row is visibly emptier than S1's. Emptiness is information, not a layout bug. |
| **Rejects** | A burndown chart (nothing has burned); a funnel (there is no funnel); a pipeline board (there is no pipeline — and the `prospects` module is not one); progress bars on tasks whose completion is another party's act |

## Structure

```
┌ header ─ constraint chips: 1 customer · 0 sends · $0 · 0:5 loops · 2 LOCK chips ┐
├ §0 alert ─ the agenda opens by correcting its own load-bearing citation          ┤
├ board ── owners down × close-times across ─────────────────────────────────────┤
│          Sep 4 │ Sep 11 │ Sep 18 │ Sep 25–27 │ Oct 9–12 │ Oct 23–27 │ Nov 22–24 │
│  Sales   SAL-01│        │ 02, 13 │           │          │           │ SAL-14    │
│  S1      03,05 │        │        │ SAL-06    │ 04,08,07 │           │ SAL-09    │
│  S2            │ 10, 12 │        │           │          │ SAL-11    │           │
├ seams (11 units, direction-marked) │ gates · dated triggers · refusals ─────────┤
└─────────────────────────────────────────────────────────────────────────────────┘
```

Three reading affordances the prose version does not have:

1. **The empty cells are the argument.** S2 occupies two cells out of seven. A viewer sees
   the dormancy rather than reading a paragraph asserting it — which is the anti-M5 device
   ([[sales-premortem]] M5: a dormant team acquiring activity to look busy).
2. **Aspiration is flagged in place**, on the card, not in a footnote — SAL-07 (no consent
   gate exists) and SAL-09 (the credit landing is the counterparty's act).
3. **Seams carry direction arrows.** `←` is something Sales is owed; `→` is something Sales
   owes. The department is owed exactly two things and owes six — visible in one scan, and
   the reason SAL-05 is filed as an ask rather than listed as a build.

## What the canvas is deliberately not

Not a status dashboard: nothing on it is live, nothing polls, and every number is stamped
2026-08-28. Not a plan of record either — [[sales-agenda-full]] is, and the canvas is
regenerated from it, never the reverse. Throwaway grade per the sketch conventions: if the
agenda changes, redraw or delete it.

## Kill / success gates

**Kill if:** a viewer reads it as live status; a task card acquires a percentage; the S2
lane fills up (that is the department failing, not the canvas succeeding); any card, chip,
or seam names a prospect, a domain, or a criterion for finding one.

**Ship if:** a reader who has never opened the agenda can state, in one look, what the
department is doing this quarter, who owns each piece, what is blocked on whom, and which
two tasks are aspiration rather than plan.

**Winner: the close-time-across × owner-down board.** The alternative considered — a
dependency graph — drew beautifully and hid the only thing that matters, which is *when*.
