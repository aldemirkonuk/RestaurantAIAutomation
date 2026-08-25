---
type: agenda-board
division: commercial
department: sales
status: provisional
metrics: [sales.verified_dollars_recovered, sales.unprompted_sessions_7d, sales.time_to_first_connection, sales.sending_identity_isolated]
updated: 2026-08-24
links: ["[[sales-charter]]", "[[sales-premortem]]", "[[sales-agenda-full]]", "[[sales-loops]]", "[[sales-schedule]]", "[[sales-directive]]", "[[design-partner-operations-agenda-board]]", "[[outbound-engine-agenda-board]]"]
---

# Sales — Board

> **PROVISIONAL — no work done yet.**

## The only thing that matters right now

- [ ] **`DEP-06` — Toast credentials for the design partner** (`.planning/PROJECT.md:101`)
  — connector already built (`apps/api-gateway/src/toast/`), config placeholders already
  written (`env.example:49-56`). **Five values and one conversation.** Nothing else on
  this board outranks it.

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

## Counters

- `sales.verified_dollars_recovered` — **$0** (credits landed, not requested)
- `sales.time_to_first_connection` — **running**, day 0 of an uncapped clock
- `sales.unprompted_sessions_7d` — **unmeasurable**, no product analytics configured
- `sales.design_partner_touch_streak` — **0 weeks**
- `sales.qualified_conversation_rate` — **dormant**, undefined until the list un-defers
- `sales.sending_identity_isolated` — **false** (`gmail.service.ts:76-78`)
- `nf_b.source_count` — **0**, and gated on `DEP-06`
- unit docs : outcomes — **21 : 0**

## Blocking

- [ ] `DEP-06` unchecked — blocks the number, the case study, the demo, and NF-B entirely
- [ ] No product analytics anywhere in `env.example` (187 lines) — blocks
      [[sales-premortem]] M1's only signal
- [ ] Invoice half is hand-typed (`ReceivingWorkspace.tsx:400,438`) — blocks
      `overbilled_vs_ship`, the headline verdict
- [ ] One sending identity for everything (`gmail.service.ts:76-78`) — blocks any safe
      outbound
- [ ] **CM-F3 open** — distributor connectivity, Sales vs
      [[supplier-distributor-network-charter]]. Proposed line in [[sales-charter]], not
      claimed. *(Brief called it CM-F6; [[commercial]] §6 numbers it CM-F3.)*
- [ ] Target list founder-deferred — S2 dormant by construction
- [ ] Pricing founder-deferred and owned by [[finance-pricing-charter]] — Sales sets none

## Gates in force

- **No recovery figure in any outbound copy** until `verified_dollars_recovered > 0`
- **No cold send** until `sending_identity_isolated == true`
- **S2 does not staff or spend** until the number exists **and** the list un-defers

## Review date

- [ ] **2026-11-24** — if `DEP-06` unchecked and `verified_dollars_recovered == $0`, fold
      Sales into [[growth-charter]] and delete 14 of these 21 documents
      ([[sales-premortem]] M5). Pre-agreed, not a judgement call.

## Teams

- [[design-partner-operations-charter]] — `partial` — the one real surface
- [[outbound-engine-charter]] — `new`, **dormant by construction** — machine, not list

## ⚠️ Do not miscite

`prospects` in this codebase means **vendors emailing a restaurant**, not Mudavym's
pipeline (`apps/api-gateway/src/common/orchestrator/prospects.service.ts:36-42`). See
[[sales-charter]] §The `prospects` naming trap.
