---
type: agenda-board
division: corporate
department: strategy-fundraising
status: provisional
metrics: [strategy.claim_to_evidence_coverage, strategy.citation_drift_rate, strategy.claim_overstatement_count, strategy.wedge_metric_instrumentation, strategy.diligence_pack_completeness]
updated: 2026-08-24
links: ["[[strategy-fundraising-charter]]", "[[strategy-fundraising-agenda-full]]", "[[strategy-fundraising-premortem]]", "[[strategy-fundraising-directive]]", "[[strategy-fundraising-loops]]", "[[strategy-fundraising-schedule]]", "[[positioning-fundraise-readiness-agenda-board]]", "[[OPEN-DECISIONS]]"]
---

# Strategy & Fundraising — Board

> **PROVISIONAL — no work done yet.**

## Every Strategy & Fundraising artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/corporate/strategy-fundraising"
SORT default(team, "") ASC, type ASC
```

Expected row count: **14** — 7 department + 7 team. One team, fourteen documents, one
inherited artifact. That ratio is the live argument in **CORP-F1 / OD-17**, and this table is
where it is visible rather than asserted.

## Charters by evidence grade

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Unit,
  status AS Evidence,
  metrics AS "Metrics moved"
FROM "01-org/corporate/strategy-fundraising"
WHERE type = "charter"
SORT status ASC
```

Two rows, two different grades, deliberately. The **department** reads `new` — everything
it owns is unbuilt. The **team** reads `partial`, transcribing `corporate.md:476`, because
one strong inherited document exists. The reconciliation is in
[[strategy-fundraising-charter]] §"Why this charter says NEW where `corporate.md` says
PARTIAL"; if this query ever shows them agreeing, one of them was edited without the other.

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  updated AS "Last touched"
FROM "01-org/corporate/strategy-fundraising"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

For a department with no raise in flight, this query is the **most likely** one to fire.
It cannot see a date-only bump, so the quarterly sweep in [[strategy-fundraising-schedule]]
reads `git log --stat` alongside it and counts a content-free diff as untouched.

## Loops missing a close-time

```dataview
LIST
FROM "01-org/corporate/strategy-fundraising"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Overstatement watch — the department's own vault

```dataview
LIST
FROM "01-org/corporate/strategy-fundraising"
WHERE (contains(lower(file.content), "dollars recovered") OR contains(lower(file.content), "recovered across"))
  AND !contains(lower(file.content), "we asked")
```

Expected result: **empty**. Any file in this tree that uses the recovery phrasing without
carrying the `YC_WEDGE_PLAN.md:31-33` qualifier alongside it is
[[strategy-fundraising-premortem]] M1 happening inside the unit that is supposed to prevent
it — the cheapest possible place to catch it.

## Blocked-figure watch

```dataview
LIST
FROM "01-org/corporate/strategy-fundraising"
WHERE contains(file.content, "573 insight") OR contains(file.content, "375 insight")
```

Both numbers are in the corpus and one of them is wrong (`corporate.md:206-213`). Hits here
are fine **inside a discussion of the contradiction** and are a defect **inside a claim**.
The query cannot tell the difference; the reader can, which is the point of listing rather
than counting.

## Standing counters — hand-entered, no jobs exist

- [ ] `strategy.claim_to_evidence_coverage` — **no register exists.** Unmeasurable, not 0%
- [ ] `strategy.citation_drift_rate` — **≈29%** on the only available sample (2+ of 7 sources in `YC_WEDGE_PLAN.md` §6 drifted or inverted)
- [ ] `strategy.claim_overstatement_count` — **0 published.** An unread zero; nothing has been published
- [ ] `strategy.wedge_metric_instrumentation` — **slide, not query.** *"Dollars recovered"* is named at `YC_WEDGE_PLAN.md:315` and instrumented nowhere
- [ ] `strategy.diligence_pack_completeness` — **0%.** No checklist, no data room, no cap table
- [ ] Raise position stated in writing — **not stated.** Assumed "not yet"; unconfirmed

## Known defects in the department's founding artifact

Carried here rather than buried in the charter, because these are the first work items.

- [ ] `YC_WEDGE_PLAN.md:401` — cites `ReceivingWorkspace.tsx:233,265`; **finding holds, lines are now `:401,440`**
- [ ] `YC_WEDGE_PLAN.md:401` — cites `:92` for `invoiceQty` defaulting to `stockedQty`; now `null` at `:168` by deliberate design change
- [ ] `YC_WEDGE_PLAN.md:404` — asserts ux-optimizer has 0 `@UseGuards`; `ux-optimizer.controller.ts:55` has one. **Contradicts `:339` in the same document**
- [ ] `YC_WEDGE_PLAN.md:5` — header says *"REVISION 2"*; §*"REVISION 3"* opens at `:9`
- [ ] `YC_WEDGE_PLAN.md:339` — Track **A** labelled "Security" ✅; scope is ux-optimizer only, while 94 endpoints are unguarded by omission and OD-20 is open and urgent
- [ ] 375-vs-573 insight types — unresolved; blocks publishing either figure

## Gates that must exist before the thing they gate arrives

- [ ] Claim register — **before the first outward artifact**, not after the twentieth
- [ ] Verb-strength send gate — before Growth, Sales or Media publish a recovery number
- [ ] Citation re-verification on send — before any `path:line` leaves the building
- [ ] Raise position in writing — before anyone outside asks

## Open forks

- [ ] **OD-23** — *$20k MRR in 30 days* vs locked $20–50/mo. **Central open question, unresolved. Founder call** ([[OPEN-DECISIONS]]:27). Status reported monthly, by name, including when nothing changed
- [ ] **CORP-F3** — one team until a term sheet; confirm the trigger or split now (`corporate.md:496`)
- [ ] **CORP-F1 / OD-17** — 7 artifacts per team. See the first query on this page
- [ ] **OD-14** — root `SKILLS.md` still branded WineOps; a diligence-surface item
- [ ] **375 vs 573 insight types** — not yet staged as an OD
