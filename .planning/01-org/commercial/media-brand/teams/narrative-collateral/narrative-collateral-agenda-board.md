---
type: agenda-board
division: commercial
department: media-brand
team: narrative-collateral
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[narrative-collateral-charter]]"
  - "[[narrative-collateral-agenda-full]]"
  - "[[media-brand-agenda-board]]"
---

# Narrative & Collateral (M2) — Board

> **PROVISIONAL — no work done yet.**

## This team's documents

```dataview
TABLE type, status, updated
FROM "01-org"
WHERE team = this.team
SORT type ASC
```

## Sibling teams in this department

```dataview
TABLE WITHOUT ID team AS "Team", status AS "Grade", updated AS "Updated"
FROM "01-org"
WHERE department = this.department AND type = "charter" AND team != this.team
SORT team ASC
```

## Stale check

```dataview
TABLE type, updated
FROM "01-org"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Artifacts

- [ ] Company story — narrative, six-step structure, no visuals
- [ ] Internal reference deck — marked INTERNAL on every page
- [ ] Sentence frozen from `YC_WEDGE_PLAN.md:312`
- [ ] Demo script
- [ ] Demo recording — **gated** on `DEP-06`, or labelled a demo build
- [ ] Case study — **blocked** on one verified credit memo (S1)
- [ ] External deck — after story, sentence, and case study

## Blocked inputs

- [ ] **ElevenLabs pitch deck reference** — in the founder's personal Instagram saves.
      Not fetchable by anything in this org. Founder must export or screenshot it.
      Blocks *styling only*; structure proceeds without it.
- [ ] Verified dollars recovered — [[design-partner-operations-charter|S1]]
- [ ] `DEP-06` Toast credentials — [PROJECT.md:101](../../../../../PROJECT.md)
- [ ] Which room the first deck is for — founder

## Standing rules

- [ ] Every number carries a source line, or it does not ship
- [ ] G3 fact-check on anything outward
- [ ] One headline claim, checked per artifact, binary
- [ ] "and it also does X" lives after the ask, one line each, never before it

## Not ours

- Verified recovery number → Sales S1
- The decision to apply to YC → Strategy & Fundraising
- Whether a claim passes → Growth G3
- Metric production → Analytics & BI
