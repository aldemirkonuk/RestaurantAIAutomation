---
type: agenda-board
division: corporate
department: legal
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[legal-charter]]", "[[legal-agenda-full]]", "[[legal-loops]]", "[[legal-schedule]]", "[[legal-premortem]]", "[[instruments-equity-agenda-board]]", "[[commercial-workforce-agreements-agenda-board]]"]
---

# Legal — Board

> **PROVISIONAL — no work done yet.**

## Every Legal artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/corporate/legal"
SORT default(team, "") ASC, type ASC
```

## Charters by evidence grade — expect every row to read `new`

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Unit,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/corporate/legal"
WHERE type = "charter"
SORT status ASC, team ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  updated AS "Last touched"
FROM "01-org/corporate/legal"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

This is the query that fires first if [[legal-premortem]] M1 is happening. It cannot see a
**date-only** bump, though — so the quarterly sweep in [[legal-schedule]] reads
`git log --stat` on this directory alongside it, and counts a content-free diff as
untouched.

## Loops missing a close-time

```dataview
LIST
FROM "01-org/corporate/legal"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Anything in this vault that drifted into clause language — [[legal-directive]] R7

```dataview
LIST
FROM "01-org/corporate/legal"
WHERE file.name != this.file.name
  AND (contains(lower(file.content), "hereby")
    OR contains(lower(file.content), "whereas,")
    OR contains(lower(file.content), "the parties agree"))
```

Expected result: **empty**. A hit means a file that charters a function started drafting
one instead — the cheapest, earliest visible form of [[legal-premortem]] M5, caught in our
own directory rather than at a counterparty.

The `file.name != this.file.name` clause is not incidental: without it the query matches
**itself**, because listing the trigger words is how you search for them. A self-matching
detector that is always red is a detector nobody reads — the same reason
[[engineering-agenda-board]] measures unguarded routes rather than routes carrying a guard.

## Standing counters (hand-entered; no jobs exist yet)

- [ ] `legal.instrument_chain_integrity` — **0 of 0.** Only 100% passes
- [ ] `legal.counsel_gate_compliance` — **0 of 0.** No counsel engaged
- [ ] `legal.clause_library_hit_rate` — **0%.** No library exists
- [ ] `legal.request_to_executable_draft_days` — **unmeasurable.** No requests, no library
- [ ] `legal.annex_satisfiability_signoff` — **0 of 0.** Gate not wired to Compliance
- [ ] `nf_a.doneability_verdict` on assisted drafts — **n/a.** `.claude/skills/` does not exist

## Gates that must exist before the thing they gate arrives

- [ ] Counsel engaged — before the first one-way-door instrument
- [ ] Two-signature DPA/BAA gate — before the first enterprise DPA lands
- [ ] Instrument register — before the second instrument (the first can be tracked by memory; the second cannot)
- [ ] Merge condition L-LEG-5 recorded as a dated commitment

## Open forks

- [ ] **OD-C2** — DPA/BAA: instrument (Legal) vs obligation (Compliance). Staged, not yet in `OPEN-DECISIONS.md`
- [ ] **OD-C1 / OD-17** — 7 artifacts per team, or fewer. 21 documents, zero artifacts
- [ ] **The trim** — one team or two (`corporate.md:116-121`)
