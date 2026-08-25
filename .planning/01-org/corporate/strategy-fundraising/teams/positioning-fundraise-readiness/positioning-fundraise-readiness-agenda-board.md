---
type: agenda-board
division: corporate
department: strategy-fundraising
team: positioning-fundraise-readiness
status: provisional
metrics: [strategy.claim_to_evidence_coverage, strategy.citation_drift_rate, strategy.claim_overstatement_count, strategy.wedge_metric_instrumentation, strategy.diligence_pack_completeness]
updated: 2026-08-24
links: ["[[positioning-fundraise-readiness-charter]]", "[[positioning-fundraise-readiness-agenda-full]]", "[[positioning-fundraise-readiness-premortem]]", "[[positioning-fundraise-readiness-directive]]", "[[positioning-fundraise-readiness-loops]]", "[[positioning-fundraise-readiness-schedule]]", "[[strategy-fundraising-agenda-board]]", "[[OPEN-DECISIONS]]"]
---

# Positioning & Fundraise Readiness — Board

> **PROVISIONAL — no work done yet.**

## This team's seven artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/corporate/strategy-fundraising/teams/positioning-fundraise-readiness"
SORT type ASC
```

## Where this team sits in its department

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  type AS Type,
  updated AS Updated
FROM "01-org/corporate/strategy-fundraising"
WHERE type = "charter" OR type = "loops"
SORT default(team, "") ASC
```

Four rows. **One team, one department, and the department layer exists only to hold the
boundaries** — [[strategy-fundraising-loops]]'s five loops all cross out of the department;
[[positioning-fundraise-readiness-loops]]'s five all stay inside it. If that ever stops
being true, one of the two layers has become redundant, and this query is where it shows.

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  updated AS "Last touched"
FROM "01-org/corporate/strategy-fundraising/teams/positioning-fundraise-readiness"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

**One deliberate exception to how this query is read.** If nothing is being sent, the claim
register is *correctly* untouched — [[positioning-fundraise-readiness-premortem]] P1 makes
that a true signal rather than a defect, because the register is only ever touched as part
of sending. A stale register during a quiet quarter is honest. A stale register during a
quarter where artifacts shipped is P1 happening.

## Overstatement watch — inside our own vault

```dataview
LIST
FROM "01-org/corporate/strategy-fundraising/teams/positioning-fundraise-readiness"
WHERE (contains(lower(file.content), "dollars recovered") OR contains(lower(file.content), "recovered across"))
  AND !contains(lower(file.content), "we asked")
```

Expected: **empty**. The recovery phrasing without the `YC_WEDGE_PLAN.md:31-33` qualifier,
inside the team that exists to prevent exactly that, is the cheapest possible place to catch
[[strategy-fundraising-premortem]] M1.

## Collateral-drift watch — [[positioning-fundraise-readiness-directive]] R5

```dataview
LIST
FROM "01-org/corporate/strategy-fundraising/teams/positioning-fundraise-readiness"
WHERE contains(lower(file.content), "slide 1") OR contains(lower(file.content), "tagline:") OR contains(lower(file.content), "headline copy")
```

Expected: **empty**. A hit means this team started writing the artifact it is supposed to
check — [[positioning-fundraise-readiness-premortem]] P3, visible in our own directory
before it is visible as a conflict of interest.

## Register health — hand-entered until the register exists

- [ ] Claim register exists — **no.** Nothing else on this board can move until it does
- [ ] Seed claims entered and graded — **0 of 7**
- [ ] Rows with `channel: spoken` — **0.** After any month with an external conversation, zero is P5, not restraint
- [ ] Verification events carrying a **result** (not just a date) — **n/a.** A bare date is P2
- [ ] Register touched only as part of sending — **rule not yet in force**

## Standing counters

- [ ] `strategy.claim_to_evidence_coverage` — **unmeasurable.** No register. Primary metric (`corporate.md:449-452`)
- [ ] `strategy.citation_drift_rate` — **≈29%** (≥2 of 7 `YC_WEDGE_PLAN.md` §6 sources drifted or inverted). Measurable today, before this team has produced anything
- [ ] `strategy.claim_overstatement_count` — **0 published.** Unread zero
- [ ] `strategy.wedge_metric_instrumentation` — **slide, not query**
- [ ] `strategy.diligence_pack_completeness` — **0%**, and measured against *questions*, not slots (P4)

## Seed-claim backlog

- [ ] 1 · *Dollars recovered* — ⚠️ enters weak or not at all (`YC_WEDGE_PLAN.md:31-33`)
- [ ] 2 · 573 insight types — 🔴 **BLOCKED**, corpus says 375 and 573 (`corporate.md:206-213`)
- [ ] 3 · Track A "Security" ✅ — ⚠️ label overstates; ships only with scope restored
- [ ] 4 · Four-way match · credit ledger · X12 · two-stage receiving — ✅ needs a **demo**
- [ ] 5 · MarginEdge competitive read — ✅ re-verify before every use
- [ ] 6 · Cost drift caught — ⛔ computable but not computed (`YC_WEDGE_PLAN.md:361-364`)
- [ ] 7 · The wedge sentence — ✅ the constant (`YC_WEDGE_PLAN.md:312`)

## Founding-artifact defects — the first work items

- [ ] `YC_WEDGE_PLAN.md:401` → `ReceivingWorkspace.tsx:233,265`; **finding holds, lines now `:401,440`**
- [ ] `YC_WEDGE_PLAN.md:401` → `:92` `invoiceQty` default; now `null` at `:168` by design change
- [ ] `YC_WEDGE_PLAN.md:404` → ux-optimizer "0 `@UseGuards`"; `ux-optimizer.controller.ts:55` has one. Contradicts `:339`
- [ ] `YC_WEDGE_PLAN.md:5` → "REVISION 2" while §REVISION 3 opens at `:9`
- [ ] `YC_WEDGE_PLAN.md:339` → Track A label vs scope

## Deferred until the split trigger — do not start

`corporate.md:457-458` · [[positioning-fundraise-readiness-directive]] R4

- [ ] Data room — **deferred**
- [ ] Diligence pack artifacts — **deferred** (the one-page *index* is not deferred)
- [ ] Cap-table hygiene — **deferred**
- [ ] Any request into [[instruments-equity-charter]] — **deferred**
- [ ] YC application — event, not cadence; founder decision in front of it

Starting any of these before a term-sheet conversation is
[[positioning-fundraise-readiness-premortem]] P4, and it is how the second team this
department declined to charter arrives anyway.

## Open forks

- [ ] **OD-23** — *$20k MRR in 30 days*. **Founder call, unresolved.** Recorded in [[strategy-fundraising-agenda-full]]; what changes here per outcome is in [[positioning-fundraise-readiness-agenda-full]]
- [ ] **CORP-F3** — one team until a term sheet (`corporate.md:496`)
- [ ] **375 vs 573 insight types** — blocks seed claim 2; owner is [[standards-verification-charter]]
- [ ] Headline: *cost drift caught* or *dollars recovered*? Free until the first artifact
- [ ] Is a recorded demo acceptable as primary investor evidence?
