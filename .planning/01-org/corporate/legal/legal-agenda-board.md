---
type: agenda-board
division: corporate
department: legal
status: active
metrics: []
updated: 2026-08-28
links: ["[[legal-charter]]", "[[legal-agenda-full]]", "[[legal-loops]]", "[[legal-schedule]]", "[[legal-premortem]]", "[[legal-agent-stack]]", "[[legal-questions]]", "[[instruments-equity-agenda-board]]", "[[commercial-workforce-agreements-agenda-board]]"]
---

# Legal — Board

Live queries over this department, plus the counters no query can compute yet.
Tasks live in [[legal-agenda-full]] (2026-08-28); this file is how they are watched.

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

This is the query that fires first if [[legal-premortem]] M1 is happening. It cannot see
a **date-only** bump — and neither can the org's watcher: `scripts/watch_loops.py:74`
reads `frontmatter(updated)` and nothing else (verified 2026-08-28). That gap is filed as
finding **F1 / ask LEG-X3** in [[legal-agenda-full]]. Until it closes, the quarterly sweep
in [[legal-schedule]] reads `git log --stat` on this directory alongside this query and
counts a content-free diff as untouched.

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
own directory rather than at a counterparty. Checked by hand against the 2026-08-28
agenda rewrite: clean.

The `file.name != this.file.name` clause is not incidental: without it the query matches
**itself**, because listing the trigger words is how you search for them. A self-matching
detector that is always red is a detector nobody reads — the same reason
[[engineering-agenda-board]] measures unguarded routes rather than routes carrying a guard.

## Standing counters (hand-entered; no jobs exist yet)

- [ ] `legal.instrument_chain_integrity` — **0 of 0.** Only 100% passes
- [ ] `legal.counsel_gate_compliance` — **0 of 0.** No counsel engaged — LEG-11
- [ ] `legal.clause_library_hit_rate` — **0%**, and the *denominator* is undefined until
      LEG-14 names the sections. 0% over an undefined denominator teaches nothing
- [ ] `legal.request_to_executable_draft_days` — **unmeasurable.** No requests, no library
- [ ] `legal.annex_satisfiability_signoff` — **0 of 0.** Gate not wired — LEG-7
- [ ] `nf_a.doneability_verdict` on assisted drafts — **n/a.** No drafting skill exists.
      (`.claude/skills/` now holds **4** committed skills, none of them Legal's —
      `.claude/skills/README.md:6-9`, corrected 2026-08-28)

## Census counters — the department's one running question

- [ ] Outbound send paths found: **14 non-test files** — 9 gateway, 5 orchestrator
      (measured 2026-08-28)
- [ ] Runtime files reaching the commitment guardrail: **3** —
      `inbound-responder.service.ts`, `provider_conversation_agent.py`,
      `constraint_engine.py` — plus `provider_communication_agent.py` **transitively**
      via `check_hard_constraints` (LEG-2's worked example)
- [ ] Channels covered by a census row: **0 of 5** (email · SMS · voice · webhook · in-app)
- [ ] Vendor-facing channels with **no** guard on the path: **voice** —
      `plivo_voice_client.py:514-545`, dormant, no in-repo caller (LEG-3)
- [ ] Sent-corpus scan (`procurement_conversations`, counts only): **never run** — LEG-5

## Gates that must exist before the thing they gate arrives

- [ ] Counsel engaged — before the first one-way-door instrument (LEG-11)
- [ ] Two-signature DPA/BAA gate — before the first enterprise DPA lands (LEG-7, LEG-8)
- [ ] Instrument register — before the second instrument; the first can be tracked by
      memory, the second cannot (LEG-10)
- [ ] A **number** on the waiting period — R2 and IE-1 promise one and name none (LEG-13)
- [ ] Merge condition L-LEG-5 as two dates: **2026-11-27**, **2027-02-26** (LEG-16)

## Open forks

- [ ] **CORP-F2** — DPA/BAA: instrument (Legal) vs obligation (Compliance). Verified
      2026-08-28: **still not in `OPEN-DECISIONS.md`.** LEG-9 stages it
- [ ] **CORP-F1 / OD-17** — artifacts per unit. Now **9** each across 3 units; sharper,
      not answered
- [ ] **The trim** — one team or two (`corporate.md:116-121`). Dated by LEG-16, decided by
      evidence rather than by argument
