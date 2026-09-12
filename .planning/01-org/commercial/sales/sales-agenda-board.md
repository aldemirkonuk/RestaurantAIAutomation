---
type: agenda-board
division: commercial
department: sales
status: active
metrics: [sales.verified_dollars_recovered, sales.unprompted_sessions_7d, sales.time_to_first_connection, sales.design_partner_touch_streak, sales.blocker_age_max, sales.sending_identity_isolated]
updated: 2026-08-28
links: ["[[sales-charter]]", "[[sales-premortem]]", "[[sales-agenda-full]]", "[[sales-loops]]", "[[sales-schedule]]", "[[sales-directive]]", "[[sales-agent-stack]]", "[[sales-questions]]", "[[design-partner-operations-agenda-board]]", "[[outbound-engine-agenda-board]]", "[[decision-office-charter]]", "[[analytics-bi-charter]]", "[[0039-activation-plan-of-record]]"]
---

# Sales — Board

**Live as of 2026-08-28.** Tasks and their evidence live in [[sales-agenda-full]]; this
board is the query surface and the counters. Canvas: `sketches/068-sales-agenda-canvas/`.

## The only thing that matters right now

- [ ] **SAL-01 — settle `DEP-06`'s true state.** The citation every document in this
  department uses (`.planning/PROJECT.md:101`) **no longer exists**; the live row is
  `.planning/07-reference/REQUIREMENTS.md:333` and it reads **`[x]`**, inside a ledger
  its own header calls historical. **97 references across 46 live files** are anchored to
  the dead one. **close_time 2026-09-04.** Thirteen of the fourteen tasks are downstream of the
  answer. Nothing outranks it.

## Unit status — live query

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  team AS Team,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/commercial/sales"
SORT team ASC, type ASC
```

## Stale check — anything untouched for 60 days

```dataview
TABLE WITHOUT ID file.link AS Doc, updated AS "Last touched"
FROM "01-org/commercial/sales"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Open questions across the unit

```dataview
TABLE WITHOUT ID file.link AS Doc, open_questions AS Open, updated AS Updated
FROM "01-org/commercial/sales"
WHERE type = "questions" AND open_questions > 0
SORT open_questions DESC
```

## Counters

- `sales.verified_dollars_recovered` — **$0** (landed, not requested)
- `sales.time_to_first_connection` — **day 4** of an uncapped clock, *and possibly already
  stopped without anyone noticing* — SAL-01
- `sales.unprompted_sessions_7d` — **unmeasurable**; `env.example` is 194 lines with no
  analytics key, and `apps/web/src` has no PostHog/Amplitude/Mixpanel/Segment reference
  (re-verified 2026-08-28)
- `sales.design_partner_touch_streak` — **0 weeks**
- `sales.blocker_age_max` — **undefined** (no queue exists yet — SAL-04)
- `sales.qualified_conversation_rate` — **dormant**, and correctly so
- `sales.sending_identity_isolated` — **false** (`gmail.service.ts:79` — the charters' `:76-78` has drifted)
- `nf_b.source_count` — **0**; NF-B itself is *held on OD-05/OD-07*, not on us (`STATE.md` P3 table)
- loops running : loops declared — **0 : 5**
- unit docs : outcomes — **21 : 0**

## Blocking

- [ ] **SAL-01 unresolved** — the department's spine cites a file location that no longer exists
- [ ] No product analytics anywhere — blocks [[sales-premortem]] M1's only signal (SAL-05)
- [ ] Invoice half is hand-typed (`ReceivingWorkspace.tsx:400,438`) — blocks `overbilled_vs_ship`; the manual path (SAL-09) is open regardless
- [ ] One sending identity for everything — blocks any safe outbound; SAL-10 measures it without needing it fixed
- [ ] **CM-F3 unfiled** — 61 citations in 24 files, the most-cited unfiled fork in the corpus (`FORK-REGISTRY.md:560,653`); dated trigger ≈2026-11-22 (SAL-13)
- [ ] **OD-77** — customer mail still leaves a personal Google account; its own text says sequence it *before* customer onboarding (SAL-12)
- [ ] Target list founder-deferred — S2 dormant by construction, and every task respects it
- [ ] Pricing locked-deferred and owned by [[finance-pricing-charter]] — Sales sets none

## Gates in force

- **No recovery figure in any artifact** until `verified_dollars_recovered > 0` — becoming an executable claim under SAL-02
- **No cold send** until `sending_identity_isolated == true`
- **S2 does not staff, spend, purchase, or register a domain** until the number exists **and** the list un-defers
- **No task, card, or agenda item may generate or assume a target list** (ADR 0039, re-confirmed 2026-08-28)

## Dated triggers

- [ ] **2026-10-23** — the synchronized 60-day staleness tick (`scripts/watch_loops.py`). This department is out of the cohort as of today's `updated:`; its **teams are not**.
- [ ] **2026-11-22** — PROD-F2 / CM-F3 day-90 team-dissolution trigger. Fires against nothing unless SAL-13 lands first.
- [ ] **2026-11-24** — department review. `DEP-06` unresolved **and** `verified_dollars_recovered == $0` ⇒ fold Sales into [[growth-charter]]. Pre-agreed; `watch_loops.py` already watches it (SAL-14).

## Teams

- [[design-partner-operations-charter]] — `partial` — carries SAL-03…SAL-09; the only real surface
- [[outbound-engine-charter]] — `new`, **dormant by construction** — carries SAL-10…SAL-12; a machine, never a list

## ⚠️ Do not miscite

`prospects` in this codebase means **vendors emailing a restaurant**, not Mudavym's
pipeline (`apps/api-gateway/src/common/orchestrator/prospects.service.ts:36-42`). See
[[sales-charter]] §The `prospects` naming trap.
