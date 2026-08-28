---
type: agenda-board
division: product
department: product-vision
status: active
metrics: []
updated: 2026-08-28
links: ["[[product-vision-charter]]", "[[product-vision-agenda-full]]", "[[product-vision-loops]]", "[[product-vision-schedule]]", "[[product-vision-premortem]]", "[[product-vision-agent-stack]]", "[[product-vision-questions]]"]
---

# Product & Vision — Board

**Dated 2026-08-28.** The tasks live in [[product-vision-agenda-full]]; this file is the
instrument. Queries first, hand-entered counters last — and every counter reads a value,
the word **unmeasured**, or the word **undefined**, never a 0 that means "we did not look".

## Every Product & Vision artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/product/product-vision"
SORT default(team, "") ASC, type ASC
```

## Charters by evidence grade

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Team,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/product/product-vision"
WHERE type = "charter"
SORT status ASC, team ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  updated AS "Last touched"
FROM "01-org/product/product-vision"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Agendas still provisional — PV-23 is the task that clears this

```dataview
TABLE WITHOUT ID
  file.link AS Agenda,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/product/product-vision"
WHERE contains(type, "agenda") AND status = "provisional"
SORT default(team, "") ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/product/product-vision"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Teams still provisional across every artifact — nothing real has started

```dataview
TABLE WITHOUT ID
  team AS Team,
  length(rows) AS "Provisional artifacts"
FROM "01-org/product/product-vision/teams"
WHERE status = "provisional"
GROUP BY team
SORT length(rows) DESC
```

## Sibling units this department's boundaries depend on

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  department AS Department,
  status AS Evidence
FROM "01-org/product"
WHERE type = "charter" AND department != "product-vision"
SORT department ASC, team ASC
```

## Standing counters (hand-entered until PV-21 makes them a read)

Re-measured against the working tree **2026-08-28**. Where a line changed since 2026-08-26,
the previous value is kept beside it — a counter that silently improves teaches nothing.

**Ask AI — the stage moved, and the corpus had not noticed (see [[product-vision-agenda-full]] §0)**

- [ ] `askai.allowlist_family_count` — **2** (`procurement`, `communications`), founder call
      2026-08-27, enforced twice: `ask-ai-actions.ts:32` and the `family` CHECK in
      `20260827140000_ai_proposed_actions.sql`. Target is **stable**, not growing · PV-06
- [ ] `askai.entry_point_count` — **4**; target **1**. Global composer
      (`DashboardLayout.tsx:91`) + Reports pill/palette (`Reports.tsx:1107,1115`) +
      `/sommelier` + mobile `WineAgentFab.tsx`. *Was 4 with two of them placeholders; the
      placeholders were retired 2026-08-26 and the composer took the slot* · PV-03
- [ ] `askai.confirm_without_edit_rate` — **unmeasured, and now measurable**:
      `executed_payload IS NULL` is the numerator by construction
      (`20260827170000_ai_proposed_actions_edits.sql`). No non-fixture rows exist · PV-05
- [ ] `askai.refusal_correctness` — **undefined**: no refusal corpus exists anywhere in
      `apps/`, `scripts/`, `datasets/` (grep 2026-08-28). `NEW-906` unimplemented · PV-02
- [ ] Role gating (`NEW-900`) — **absent**; the service carries no permission branch · PV-04
- [ ] Verdict bases recorded on this surface — **3**: `proposal_v1` (`ask-ai.service.ts:230`),
      `edit_v1` (`:475`), `confirmation_v1` (`:536`). Readings: **none**
- [ ] Planning documents mentioning `ai_proposed_actions` — **0** of the whole corpus · PV-01

**Inbound understanding**

- [ ] `inbound.proposal_accept_without_edit_rate` — **unmeasured** across all 3 modules
- [ ] `inbound.false_accept_count` — **undefined**; no correction path, so
      `proposal.corrected` has no publisher · PV-09
- [ ] Shadow classifier — **persisted and logged, gating nothing**
      (`inbound-responder.service.ts:125-128`); agreement rate **unmeasured** · PV-08
- [ ] Human-gate primitives in the product — **2** (`one-tap-actions/`,
      `ai_proposed_actions`); contract naming the correct number: **none** · PV-10

**Surface portfolio**

- [ ] Route denominator — **contested**: `06-pages/` holds **47** route notes (matching
      `STATE.md:116`), [[PAGE_MAP]]'s header reads **48**. Coverage cannot be published
      against two denominators · PV-12
- [ ] `surface.unowned_surface_count` — **unmeasured against a settled denominator**;
      **12** route components unresolved. Verdicts issued: **0** · PV-12, PV-13
- [ ] Live route duplications awaiting a verdict — **0**. All three closed by retirement
      (`/wine-agent`+`/wineagent`, `/inventory-legacy`, `/calendar-classic`), not by
      deduplication — [ADR 0019](../../../decisions/0019-p2-build-scope.md) §B-parity
- [ ] Intentionally-cold routes declared correct — **0 named**; the target number is not
      zero and has not been committed to · PV-15

**Service floor**

- [ ] `floor.providers_emitting_table_and_server` — **0 verified**; the audit that would
      say otherwise has never run · PV-16
- [ ] `floor.providers_emitting_kitchen_ready` — **0**; no `ready`/`fired`/`kitchen`
      concept exists in `pos-hub/pos-types.ts` · PV-18
- [ ] `floor.kitchen_ready_to_waiter_p95_seconds` — **unmeasurable**; `server_name`,
      `covers`, `table_id`, `total` are **0 of 47 rows**
- [ ] Universal ingest path available today — **`generic_webhook`, `CAP_FULL`**
      (`pos-provider.registry.ts:29-43`). The blocker is a counterparty, not a capability · PV-17

**Supply discovery**

- [ ] `supply.needed_sku_denominator_size` — **undefined** for every restaurant · PV-19
- [ ] `supply.sku_dual_price_coverage_pct` — **undefined**, never 0% · PV-19
- [ ] `supply.price_freshness_p50_days` — **unmeasured**; prices shown without an age: **uncounted** · PV-20

**Department-wide reality check — unchanged, and it is the point**

- [ ] `restaurants` **10**, all test fixtures · `pos_checks` **0** · `analytics_insights`
      **0** · `recommendation_actions` **0** · `procurement_orders` **1**
      ([[AGENT_NATIVE_UI_DECISION]]:59). Until one of these moves, every number above is a
      property of the code, not of a restaurant's month · PV-05, finding F4
