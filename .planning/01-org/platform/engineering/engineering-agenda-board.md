---
type: agenda-board
division: platform
department: engineering
status: active
metrics: []
updated: 2026-08-28
links: ["[[engineering-charter]]", "[[engineering-agenda-full]]", "[[engineering-loops]]", "[[engineering-schedule]]", "[[engineering-agent-stack]]", "[[0039-activation-plan-of-record]]"]
---

# Engineering — Board

> **Live board, 2026-08-28.** The agenda it reflects is [[engineering-agenda-full]].
> L-ENG-1's rule governs this page: **eight numbers, never summed.** A row carries a
> measured value or the literal word `unreadable` — an omitted metric reads as green.

## Every Engineering artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/platform/engineering"
SORT default(team, "") ASC, type ASC
```

## Charters by evidence grade

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  team AS Team,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/platform/engineering"
WHERE type = "charter"
SORT status ASC, team ASC
```

## Agendas still provisional — should be none below the department

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  updated AS Updated
FROM "01-org/platform/engineering"
WHERE type = "agenda-full" AND status = "provisional"
SORT default(team, "") ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  updated AS "Last touched"
FROM "01-org/platform/engineering"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/platform/engineering"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## The eight numbers (hand-entered until the jobs exist)

Re-measured **2026-08-28** where a measurement was possible. Task ids are
[[engineering-agenda-full]] §3.

| Metric | Reading | Task that gives it a producer |
|---|---|---|
| `platform.endpoints_protected_by_default_pct` | **0%** — `app.module.ts:127-133` registers only `RateLimitGuard` and `TenantGuard` globally. Beside it, and never instead of it: **457 of 463 routes (98.7%) are guarded or explicitly `@Public()`**; **6** unguarded-by-omission, all `auth` credential routes | PA-1, PA-3 |
| `surfaces.reachable_route_ratio` | `unreadable` — the 24-orphan baseline came from a one-time analysis, not a job. Second, independent number: **7** page notes declare themselves dead-ends | CS-4 |
| `integration.verified_signature_coverage` | `unreadable` — no per-route unsigned-request test exists; 25 `@Public()` routes are the denominator | IE-1 |
| `identity.false_merge_count` | `unreadable` — the CI gate is wired (`ci.yml:552-555`); the labelled set it scores against does not exist | CI-1 |
| `inventory.projection_divergence_rows` | `unreadable` — no daily sampler is cited anywhere | IL-1 |
| `messaging.duplicate_delivery_rate` / `.drop_rate` | `unreadable` — no `notification_id`-keyed ledger. For SMS it is *structurally* unreadable: the delivery-status callback points at a domain we do not own (`plivo_client.py:196`) | MD-1, MD-2 |
| `procurement.order_to_delivery_reconciliation_rate` | `unreadable` — no reconciliation measurement exists | PV-1 |
| `schema.days_since_hand_applied_ddl` | readable from the parity job (`schema-parity.yml`, cron `0 6 * * *`); the production arm is red while migrations dated after 2026-08-27 are unapplied | SM-2 |

## Standing corrections (2026-08-28)

Published here rather than edited into the charter, which is a wave-1 artifact.

- 448 routes / 44 controllers → **463 / 48**
- 137 unguarded endpoints → **6**
- `recurring-orders`, 6 unguarded money-moving routes → **guarded** (`recurring-orders.controller.ts:35`)
- 62 migrations → **79**
- 3 CI guards exist on disk and are invoked by nothing: `check_display_name_parity.py`,
  `check_beverage_kind_regression.py`, `check_log_sanitizer_usage.py`
- **0 of Engineering's 9 declared agent cards is `mechanical`**, so none executes
  under `scripts/agents/run_card.py`
