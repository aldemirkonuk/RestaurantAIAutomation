---
type: agenda-board
division: product
department: design
team: exploration-studio
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[exploration-studio-charter]]", "[[exploration-studio-agenda-full]]", "[[exploration-studio-loops]]", "[[exploration-studio-schedule]]", "[[exploration-studio-premortem]]", "[[design-agenda-board]]"]
---

# Exploration Studio — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/product/design"
WHERE team = this.team
SORT type ASC
```

## Where this team sits in Design

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Unit,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/product/design"
WHERE type = "charter"
SORT team ASC
```

## Stale — 60 days is finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/product/design"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops without a close-time

```dataview
LIST
FROM "01-org/product/design"
WHERE team = this.team AND type = "loops" AND !contains(file.content, "close_time")
```

## Standing counters

The two numbers on the first two lines are **opposite failure modes** and are always shown
together. Optimizing either alone produces the other within two quarters
([[exploration-studio-premortem]] M1 vs M4).

- [x] `design.resolved_question_rate` — **15 of 43** indexed rows carry a winner
- [ ] `design.options_per_sketch_median` — **uncounted**. Falling below 3 means convergence
      pressure has killed the exploration
- [x] `design.open_null_winner_count` — **28**. The number that must fall
- [x] `design.sketch_index_completeness` — **43 of 53** directories indexed
- [ ] `design.winner_shipped_conversion` — **2 of 53** (038 → `/inventory`;
      052 → `scripts/docgen/templates/wineops_document.html`)
- [ ] `design.winners_unqueued` — **at least 5** (050, 051, 048, 042, 033): decided, handed
      to nobody
- [ ] `design.wip_limit` — **not set**. With 28 open, the opening posture is a freeze

## The founding repair list

- [ ] **28 `Winner: null` rows** — 006, 007, 016, 020–026, 028–032, 034–041, 043–047
- [ ] **10 unindexed directories** — 005, 011, 012, 013, 014, 015, 017, 018, 019, 049
- [ ] **Phantom row 039** (`staff-performance-sidebar`, `MANIFEST.md:46`) — no directory on
      disk
- [ ] **Duplicate ID 038** — `038-inventory-command`, `038-manager-shift-desk`
- [ ] **Duplicate ID 048** — `048-interactive-guidance`, `048-profile-page`; the manifest
      lists one
- [ ] Manifest becomes the **ID authority** so duplicates stop being possible

## Null-draining priority (highest downstream value first)

- [ ] **043–046** motion — 9 motions fully specified, stack chosen at 042, zero winners →
      [[design-system-motion-substrate-charter]]
- [ ] **020–024, 028–032, 040, 041, 047** storage / cellar / inventory — largest coherent
      cluster, on during-service surfaces → [[ux-path-burn-down-charter]]
- [ ] **006, 007, 016, 025, 026, 034–039** settings / locations / comms / teams — several
      are likely honest withdrawals

## Open, blocking, named

- [ ] **Is "no winner — question withdrawn" an acceptable resolution?** The entire
      convergence mechanism rests on it
- [ ] **What is N** (the WIP limit)?
- [ ] **Who breaks a tie the studio cannot settle?** Today the answer is "it stays null" —
      which is how the corpus reached 28
- [ ] Resolved sketches must be **frozen**. Editing a settled sketch is premortem M5
