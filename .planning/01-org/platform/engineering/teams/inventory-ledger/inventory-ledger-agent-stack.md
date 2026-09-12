---
type: agent-stack
division: platform
department: engineering
team: inventory-ledger
status: designed
updated: 2026-08-27
metrics: [inventory.projection_divergence_rows, inventory.direct_write_paths]
links: ["[[inventory-ledger-charter]]", "[[inventory-ledger-schedule]]", "[[inventory-ledger-loops]]", "[[inventory-ledger-directive]]", "[[0034-agent-stack-artifact]]", "[[engineering-agent-stack]]", "[[skills-charter]]", "[[state-integrity-invariants-charter|sre-state-integrity]]"]
---

# Inventory & Ledger — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team's failure is a number that is quietly wrong, not an operation that errors
> ([[inventory-ledger-charter]] §Distinct from siblings) — a desynced projection returns
> `200 OK` and the UI renders it confidently. So the card is built around one asymmetry: the
> agent's reading is the only thing standing between a wrong integer and a human believing it,
> and the agent is forbidden from correcting what it reads. Mechanism references are
> [[engineering-agent-stack]]'s.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `ledger-divergence-sentinel` | Sample projections against lots daily, name the hop that lost or duplicated a movement, and never write stock | NEW |

## 2. Agent cards

```yaml
agent: ledger-divergence-sentinel
unit: inventory-ledger
triggers:
  - schedule: "daily — projection divergence sample (L-IL-1) and the alarm-state check"   # mirrored in [[inventory-ledger-schedule]]
  - schedule: "weekly — cross-hop duplication scan (L-IL-4), count adjustment provenance (L-IL-5)"
  - topic: stock.movement_applied         # publisher: NONE (gap — apply_stock_movement is a SQL function; nothing emits on a movement)
consumes:
  - "restaurant_inventory.stock_live / shadow_stock versus the sum of inventory_lots (publisher: the database)"
  - "scripts/check_no_direct_stock_writes.sh result (publisher: .github/workflows/ci.yml:345, run by [[state-integrity-invariants-charter|sre-state-integrity]])"
  - "apps/api-gateway/src/{inventory,inventory-ledger,storage-locations}/ route and service code"
  - "stock.events and pos.events on the bus (publisher: core/message_bus.py:479, fed by the POS webhook paths)"
emits:
  - "inventory.projection_divergence_rows daily → [[inventory-ledger-agenda-board]] and L-ENG-1 (consumer: [[engineering-agent-stack|eng-board-keeper]])"
  - "the alarm-state pair — green guard ∧ non-zero divergence (consumer: [[engineering-loops]] L-ENG-3, the only loop that can see it)"
  - "inventory.direct_write_paths, the paths a grep cannot see (consumer: [[inventory-ledger-agenda-full]] and the CI guard's owner)"
  - "nf_a events (task_type: divergence_sample) — consumer: NONE (gap, see §5)"
routing_class: judgment          # the query is trivial; triaging *which* divergence, and whether it is yesterday's cause again, is not ([[inventory-ledger-schedule]])
quality_bar: "the sample is its own verdict basis — rows where stock_live ≠ sum of lots, target zero, any non-zero is a P1 because it is undetectable from the UI ([[inventory-ledger-charter]] §Metrics). For the triage half: NONE (gap) — no grader exists for a cause attribution."
autonomy:
  read: autonomous
  propose: autonomous            # reconciliations land as PRs for a human to apply
  mutate_stock_money_outbound: confirm   # constant — and stock is literally this family
memory: inventory-ledger
escalates_to: "[[engineering-charter]]"
```

**The card's own hard rule:** the sentinel may read stock and may **propose** a reconciliation;
it may never write stock outside `apply_stock_movement`, and there is **no carve-out for
automated reconciliation** ([[inventory-ledger-schedule]] §Skills owned). An agent writing
directly is premortem M5 with better tooling — and the projection trigger would clobber it on
the next lot change anyway, which is exactly how the original bugs stayed invisible
(`scripts/check_no_direct_stock_writes.sh:4-8`).

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `stock-write-path-audit` | T2 | Any PR touching stock tables, `supabase/migrations/**` function bodies, or a Supabase client call | Every path that can mutate `stock_live` / `shadow_stock` is named with `path:line`, including dynamic table names and SQL function bodies the grep cannot reach; each is marked routed-through-`apply_stock_movement` or not | The guard records the instance in its own header: the two functions it was written against — `updateInventoryStock` and `reconcileShadowStock` in `apps/web/src/lib/supabase.ts` — **type-checked fine** while writing nonexistent columns (`inventory_id`, `live_stock`) on a loosely-typed client (`scripts/check_no_direct_stock_writes.sh:10-13`) | NEW |
| `movement-provenance-trace` | T2 | A non-zero divergence, or a suspected duplicate movement | The POS event → bridge → movement → projection walk names exactly one hop as lossy or duplicating, or states plainly that no hop can be named | The receiving-service and inventory-ledger bugs the guard was written against went undetected precisely because a direct write "gets silently clobbered by the projection trigger on the next lot change" — the failure mode this trace exists to unwind (`scripts/check_no_direct_stock_writes.sh:4-8`) | NEW |

`projection-divergence-sample` — the team's own primary job — is **deliberately not a row here.**
The sample has never been taken: [[inventory-ledger-charter]] §Evidence states the daily sampling
job "is not cited", so there is no past instance and README §3.3 deletes the row. It appears in
[[inventory-ledger-schedule]] as a proposed skill and becomes a row here after its first run.
That absence is this team's most important fact, not a formatting detail.

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]]); running the CI
guard ([[state-integrity-invariants-charter|sre-state-integrity]] — author ≠ auditor,
`technology.md:860`); the DDL for ledger tables ([[schema-migrations-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates from consolidation go to
  [[skill-harvesting-charter]]'s queue through the §3.3 gate.
- **Episodic** — nf_a `task_type: divergence_sample` and `movement_trace`. Needs
  `context.inventory_id`, `context.divergence_rows` and `context.attributed_hop` as jsonb keys,
  because the triage question is never "is there divergence" but "is this the same cause as
  yesterday" — which is a query over history or it is a re-investigation every morning.
- **Semantic** — `memory/` beside this file, `inventory-ledger-MEMORY.md` as index. Its founding
  facts: the dual-bookkeeping root cause and that the fix is architectural rather than a bug
  queue ([[inventory-ledger-charter]] §Distinct from siblings), the guard's own admitted blind
  spot (`check_no_direct_stock_writes.sh:10`), and the ledger v1 deprecation
  (`apps/api-gateway/src/inventory-ledger/LEDGER_V1_DEPRECATED.md`). Provenance frontmatter per
  ADR 0034; every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. `INVENTORY_SOTA_PLAN.md`
  and `INVENTORY_ADD_REMOVE_SCENARIOS.md` are grep-and-excerpt targets by section, never loaded
  whole (CLAUDE.md §2).

**Consolidation** — monthly, mirrored in [[inventory-ledger-schedule]]: read the divergence slice
since the last run; distill durable facts, failures first — every non-zero day becomes a fact
naming the hop and the code path, never "divergence appeared"; a recurring attribution becomes a
skill candidate; expire facts unverified for 90 days. One PR; "no delta" stated when true, and a
month of zero divergence is the intended outcome, recorded as such.

## 5. Async contract

Cross-unit interaction is loops in [[inventory-ledger-loops]], NF-A events, vault PRs, and skill
candidates only. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `inventory.projection_divergence_rows` has no producer | The metric is specified "sampled daily" and no sampler is cited ([[inventory-ledger-charter]] §Evidence). Until it runs, this team's primary number is unread and the department board shows `unreadable` |
| `stock.movement_applied` has no publisher | `apply_stock_movement` is a SQL function; nothing emits on a movement, so duplication can only be found by scanning rather than by reacting. The weekly cross-hop scan bounds the blind spot at 7 days |
| The alarm state has no automatic detector | Green CI ∧ non-zero divergence is the condition that matters most and it requires both readings to exist; one of the two does not. Recorded so the alarm's absence is not mistaken for silence |
| `divergence_sample` NF-A events have no declared consumer | Beyond this team's own board row and L-ENG-3 |

## 6. Evidence today

- **EXISTS — the ledger and the guard.** The 34 inventory endpoints across three modules, the
  `apply_stock_movement` extension and race/pour-idempotency migrations, `inventory_count_service.py`,
  `inventory_engine.py`, and the written-down v1 deprecation — all cited in
  [[inventory-ledger-charter]] §Evidence. The direct-write guard runs at
  `.github/workflows/ci.yml:345` and is candid at `:10` that it is a grep.
- **NEW — everything that produces a number.** No divergence sampler, no direct-write-path count
  beyond what the grep sees, no movement provenance trace. Both §3 skills describe procedures
  that were reasoned through once, when the guard was written, and have not been repeated.
- **NEW — `ledger-divergence-sentinel`.** Nothing performs this role; `inventory_engine.py` is a
  domain agent, not an auditor of the projections.
