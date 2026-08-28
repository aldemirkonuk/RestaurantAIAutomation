# Sketch 061 · Product & Vision agenda canvas

**Design question:** Can a department's whole agenda — 24 tasks, 6 lanes, 5 close windows,
its locks and its findings — be read as **one picture** without the picture quietly hiding
which tasks are blocked and which are only aspiration?

**Context:** Wave 3 / [ADR 0039](../../decisions/0039-activation-plan-of-record.md) Track B
asks for one HTML canvas per department alongside the rewritten agenda. The tasks and their
evidence live in
[`product-vision-agenda-full.md`](../../01-org/product/product-vision/product-vision-agenda-full.md);
the counters live in the board. This file is the thinking surface, not a product — it is
throwaway-grade by the sketch conventions.

## Direction

| | |
|--|--|
| **Domain** | Department agenda: Ask AI (P3.C), inbound Phase 1, route portfolio, POS input audit, supply denominator, the department's own board |
| **Color world** | Warm paper `#f6f2ee` + wine burgundy `#722F37` — the shipped-component burgundy from sketch 050/052, not the `#CD2D5B` sketch-theme default |
| **Signature** | A lane × close-time grid. Time runs left→right in five windows; every chip carries its **doneability line in the hover title**, so the picture cannot show a task without showing how it closes |
| **Rejects** | A kanban of "in progress" columns (nothing is in progress — this is a first agenda); a burndown chart (there is no velocity to chart); any chip without a doneability line; a status colour that means "on track", which nothing here has earned |

## What the canvas encodes

1. **The finding strip, above the board.** Five claims from the planning corpus struck
   through beside what the tree actually holds, measured 2026-08-28 — including the one that
   reorders the agenda: **zero** planning documents mention `ai_proposed_actions` while the
   Ask AI slice is shipped, wired and graded. The strip is first because the agenda's first
   task is repairing it.
2. **Three chip states, and only three.** Scheduled work · **gate** (a number published
   beside its pair or not at all — PV-02's refusal correctness, PV-24's grader) · **blocked
   on a named unblocker** (PV-05 needs a restaurant; PV-23 needs a team wave). There is no
   "at risk" or "on track": both would be inventions.
3. **Empty cells are left empty.** The inbound lane has nothing due in August and the supply
   lane nothing until September 30. A canvas that fills every cell is a canvas that invents
   work, which is the exact failure the department's premortem M1 names.
4. **Seams, findings and locks as three peers at the bottom.** The locks panel is
   deliberately the same size as the others: *pricing deferred* and *brand visuals held* are
   as much a part of this agenda as anything scheduled.

## Layout

```
┌───────────────────────────────────────────────────────────────┐
│  Product & Vision — the agenda as one picture      2026-08-28 │
├───────────────────────────────────────────────────────────────┤
│  THE FINDING  claimed ──┼── measured on disk   (5 rows)        │
├──────────┬────────┬──────────┬──────────┬────────┬────────────┤
│ lane     │ Aug 31 │ Sep 11-18│ Sep 30   │ Oct 15 │ standing   │
│ Ask AI   │ PV-01  │ 02·04·06 │ 03 · 05▣ │        │ PV-07      │
│ Inbound  │        │ PV-09    │ 08 · 10  │ PV-11  │            │
│ Surface  │        │          │ 12·13·14·15│      │            │
│ Floor    │        │ 16 · 18  │ PV-17    │        │            │
│ Supply   │        │          │ 19 · 20  │        │            │
│ Dept     │ PV-21  │ PV-24◆   │ PV-23▣   │        │ PV-22      │
├──────────┴────────┴──────────┴──────────┴────────┴────────────┤
│  seams touched   │   findings (not tasks)  │   locks          │
└───────────────────────────────────────────────────────────────┘
        ◆ gate      ▣ blocked on a named unblocker
```

## Open

- The grid has no room for *dependency* edges (PV-02 gates PV-05's refusal number; PV-01
  gates nothing but embarrasses everything). Left out on purpose — arrows across a six-lane
  grid cost more legibility than they buy. If a second version is ever wanted, the dependency
  view is a different picture, not a busier one.
- Single-file, no JS beyond the native `title` tooltip, no external assets. It will still
  render when the vault is opened from disk in five years.
