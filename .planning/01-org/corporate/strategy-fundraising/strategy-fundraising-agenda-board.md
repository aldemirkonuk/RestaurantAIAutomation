---
type: agenda-board
division: corporate
department: strategy-fundraising
status: active
metrics: [strategy.claim_to_evidence_coverage, strategy.citation_drift_rate, strategy.claim_overstatement_count, strategy.wedge_metric_instrumentation, strategy.diligence_pack_completeness]
updated: 2026-08-28
links: ["[[strategy-fundraising-charter]]", "[[strategy-fundraising-agenda-full]]", "[[strategy-fundraising-premortem]]", "[[strategy-fundraising-directive]]", "[[strategy-fundraising-loops]]", "[[strategy-fundraising-schedule]]", "[[strategy-fundraising-agent-stack]]", "[[strategy-fundraising-questions]]", "[[positioning-fundraise-readiness-agenda-board]]", "[[positioning-fundraise-readiness-agenda-full]]", "[[0039-activation-plan-of-record]]", "[[OPEN-DECISIONS]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[standards-verification-charter]]", "[[metric-contract-truth-assurance-charter]]", "[[skills-charter]]"]
---

# Strategy & Fundraising — Board

> Live board for [[strategy-fundraising-agenda-full]] (2026-08-28). Counters are
> hand-entered — **no job writes them yet**, and STR-3 is the task that changes that.
> Every number below carries the date it was measured, never the date this file was
> touched ([[strategy-fundraising-directive]] R2).

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

Expected row count: **16** — 8 department + 8 team. One team, sixteen documents, one
inherited artifact, and that artifact is **71% drifted** (below). That ratio is the live
argument in **CORP-F1 / OD-17**, and this table is where it is visible rather than
asserted. It grew by two since 2026-08-24 (the agent-stacks, ADR 0034), which is the
fork's evidence moving in one direction only.

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
It cannot see a date-only bump — `scripts/watch_loops.py:74` reads `updated:` and nothing
else — so the quarterly sweep in [[strategy-fundraising-schedule]] reads `git log --stat`
alongside it and counts a content-free diff as untouched. Filed as F3 in
[[strategy-fundraising-agenda-full]].

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
carrying the `YC_WEDGE_PLAN.md:32` qualifier alongside it is
[[strategy-fundraising-premortem]] M1 happening inside the unit that is supposed to prevent
it — the cheapest possible place to catch it. STR-5 makes the sweep deliberate rather than
incidental.

## Stale-certainty watch — *new 2026-08-28*

```dataview
LIST
FROM "01-org/corporate/strategy-fundraising"
WHERE contains(lower(file.content), "locked $20") OR contains(lower(file.content), "locked $20–50")
  OR contains(lower(file.content), "locked 20–50")
```

**Every hit is a defect, including in this department's own charter.**
OD-23 (`OPEN-DECISIONS.md:35`) records that **no ADR sets any price**, so calling $20–50/mo
*locked* is a claim about our own company that the register does not support — R1 applied
inward. Cleared by **STR-9**. This query is the counterpart to the overstatement watch:
that one catches a verb too strong for its evidence, this one catches a *certainty* too
strong for its record.

## Blocked-figure watch

```dataview
LIST
FROM "01-org/corporate/strategy-fundraising"
WHERE contains(file.content, "573 insight") OR contains(file.content, "375 insight")
```

**The block lifted on 2026-08-26** — OD-33 (`OPEN-DECISIONS.md:40`) settled the count at
**573** by transpiling `insight-catalog.ts` standalone. Hits are now fine inside a
discussion and a defect inside a *block* that no longer has grounds (STR-10). The residual
risk moved: `apps/api-gateway/src/analytics/insights/insight-catalog.spec.ts:10` still
asserts `toBeGreaterThanOrEqual(200)`, so 348, 375 and 573 all pass — filed as STR-X2.

## Stale-citation watch — this vault's own anchors

```dataview
LIST
FROM "01-org/corporate/strategy-fundraising"
WHERE contains(file.content, "YC_WEDGE_PLAN.md:404") OR contains(file.content, "YC_WEDGE_PLAN.md:339")
  OR contains(file.content, "OPEN-DECISIONS]]:27")
```

Three anchors this vault quotes that have all moved: the ux-optimizer bullet is at `:406`
(not `:404`), the Track A sequence row is at `:340` (not `:339`) **and is not the
overstatement we said it was** — the unscoped word is the `:188` heading (STR-8) — and
OD-23 sits at `OPEN-DECISIONS.md:35`, not `:27`. A non-empty result here is the department
failing its own R2 in its own files.

## Standing counters — hand-entered, no jobs exist

- [ ] `strategy.claim_to_evidence_coverage` — **no register exists.** Unmeasurable, not 0%. First value lands with **STR-1** (2026-09-04)
- [ ] `strategy.citation_drift_rate` — **71%** (5 of 7), measured **2026-08-28** across all seven sources in `YC_WEDGE_PLAN.md:398-406`. **Supersedes the ≈29% carried in 12 documents of this vault**, which came from a 2-source sample. Per-source results in [[strategy-fundraising-agenda-full]] STR-7
- [ ] `strategy.claim_overstatement_count` — **0 published.** Still an unread zero; nothing has been published. **Inward count for 2026-08-28: 3** — *locked pricing* (STR-9), the mis-anchored Track A finding (STR-8), and a block outliving its cause (STR-10)
- [ ] `strategy.wedge_metric_instrumentation` — **slide, not query.** *"Dollars recovered"* named at `YC_WEDGE_PLAN.md:315`, instrumented nowhere. STR-12 makes both candidates one implementation away
- [ ] `strategy.diligence_pack_completeness` — **0%**, and correctly so. R4 permits one page (STR-14) and nothing else before the split trigger
- [ ] `strategy.rejected_claim_count` / `strategy.weakened_claim_count` — **no register.** Weakening is the success state; a rejection count stuck at zero while claims ship means the gate is not being run
- [ ] `strategy.unattributed_target_citations` — **unmeasured.** First sweep 2026-09-11 (STR-9, L-STR-4)
- [ ] `strategy.split_trigger_age_days` — **uncomputable, no publisher.** STR-16 replaces the phantom event with two dated founder-set fields
- [ ] Raise position stated in writing — **not stated.** Assumed *"not yet"*; unconfirmed. Absence is the finding (STR-15, due 2026-09-11)

## The split trigger — two dates, not an event *(STR-16)*

- [ ] `first_term_sheet_conversation` — **null** as of 2026-08-28
- [ ] `first_instrument_issued` — **null** as of 2026-08-28
- [ ] Twelve-month not-needed condition — reads from the first non-null of the two, or from
      the department's founding date (2026-08-24) if both stay null. **Not firing is a
      finding, not a silence** (L-STR-5)

## OD-23 — reported monthly, by name, including when nothing changed

- [ ] **2026-08-28 — still open. Day 4 of this department's watch, and the entry moved
      under us.** OD-23 (`OPEN-DECISIONS.md:35`) now records three corrections: no ADR sets
      a price (so $20–50/mo is *open*, not locked), the source master plan is not in this
      repo, and `PROJECT.md:73` reads *"No revenue pressure: Build right, not fast."* The
      row also moved from `:27` to `:32`. **Nothing was resolved; the question got
      sharper.** Next report 2026-09-28; two consecutive unmoved months escalate to
      [[decision-office-charter]] (STR-X5)

## Open forks

- [ ] **OD-23** — the revenue target, its price, and its source document. **Founder call**, unresolved (`OPEN-DECISIONS.md:35`)
- [ ] **CORP-F3** — one team until a term sheet; confirm the trigger or split now (`corporate.md:496`). STR-16 makes both directions readable
- [ ] **CORP-F1 / OD-17** — artifacts per unit. See the first query: **16 documents, one team**
- [ ] **OD-19** — the residual unguarded-by-omission routes (`OPEN-DECISIONS.md:34`); it is what claim #9 (*"Security complete"*) must be weakened against
- [ ] **375 vs 573** — **closed** by OD-33 (`OPEN-DECISIONS.md:40`) on 2026-08-26. Carried here only until STR-10 removes the block from this vault's three remaining mentions

## Known defects in the department's founding artifact — re-measured 2026-08-28

All seven §6 sources, not a sample. `holds` · `drifted` · `gone` · `inverted`.

- [x] `invoice-match.ts` — **holds.** The only §6 citation with no line anchor, and the only one that survived unambiguously
- [ ] `ReceivingWorkspace.tsx:233,265` — **drifted.** Inputs now `:394` (`aria-label="Quantity invoiced"`) and `:434` (`aria-label="Invoice unit price"`); this vault recorded `:401,440` one day earlier
- [ ] `ReceivingWorkspace.tsx:92` — **superseded.** `invoiceQty` initialises to `null` at `:168` by deliberate design change
- [ ] `InvoiceScannerModal.tsx:88,126` — **gone.** No such file under `apps/`; zero repo references to `invoices/scan`. **Recorded by no previous sweep**
- [ ] `scan-parser.service.ts:43–65` — **drifted.** Model call is `claude-haiku-4-5` at `:289`
- [ ] `pos-hub.controller.ts:18,44` — **drifted.** `generic_webhook` description at `:76`
- [x] `procurement.controller.ts:33` — **holds**, exactly
- [ ] `YC_WEDGE_PLAN.md:406` — **inverted.** `ux-optimizer.controller.ts:55` carries `@UseGuards(JwtAuthGuard)`. **Second instance at `:194`**, previously unrecorded
- [ ] `YC_WEDGE_PLAN.md:5` — **holds as a defect.** The header still reads *"REVISION 2 — in progress"* while `## REVISION 3 — the document flow` opens at `:9`. The one vault citation about this document that has not drifted in four days is the one recording that the document lies about its own status
- [ ] `YC_WEDGE_PLAN.md:188` — `### Track A — Security` is the unscoped label; the `:340` sequence row is scoped and accurate. **This vault has been citing the wrong one** (STR-8)

## Gates that must exist before the thing they gate arrives

- [ ] Claim register — **before the first outward artifact**, not after the twentieth (STR-1, 2026-09-04)
- [ ] `claim-provenance-check` in CI — the diligence answer becomes a **run**, not a date (STR-3, 2026-09-18)
- [ ] Symbol rule at parse time — a `path:line` with no symbol is rejected (STR-4)
- [ ] Verb-strength gate — before Growth, Sales or Media publish a recovery number (STR-11)
- [ ] Spoken-claim capture — before the next external conversation, not after it (STR-13)
- [ ] Raise position in writing — before anyone outside asks (STR-15)

## Task board — [[strategy-fundraising-agenda-full]], 17 tasks

| close_time | Tasks | Owner |
|---|---|---|
| 2026-09-04 | STR-1 register v1 · STR-2 twelve seed claims · STR-7 drift baseline · STR-8 correct our own anchor | team · team · dept · dept |
| 2026-09-11 | STR-9 strike *locked* · STR-10 unblock 573 · STR-15 raise position | dept · team · dept → founder |
| 2026-09-18 | STR-3 `claim-provenance-check` in CI · STR-4 symbol rule · STR-13 spoken claims | dept · team · team |
| 2026-09-25 | STR-5 sweep our own vault · STR-11 verb fixtures · STR-16 split-trigger dates | dept · team · dept |
| 2026-10-02 | STR-6 demo evidence *(reach)* · STR-12 instrument the headline | team · dept |
| 2026-10-16 | STR-14 diligence index · STR-17 adversarial read *(reach)* | team · dept → [[red-team-charter]] |

**No weekly row, deliberately** — the register is empty and a weekly reading of zero is
the theatre [[ORG_STRUCTURE]] §4's 60-day rule marks as fiction.

## What this board will never show

A deck, a data room, a cap table, an instrument, a price, or an investor. Those are
either the founder's, [[instruments-equity-charter]]'s, or triggered work — and a board
that started tracking them would be the second team this department declined to charter,
arriving through a dashboard instead of the org chart.
