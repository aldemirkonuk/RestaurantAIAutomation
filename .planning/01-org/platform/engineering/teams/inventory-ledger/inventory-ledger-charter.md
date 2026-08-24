---
type: charter
division: platform
department: engineering
team: inventory-ledger
status: exists
metrics: [inventory.projection_divergence_rows, inventory.direct_write_paths]
updated: 2026-08-24
links: ["[[engineering-charter]]", "[[inventory-ledger-premortem]]", "[[inventory-ledger-agenda-full]]", "[[inventory-ledger-agenda-board]]", "[[inventory-ledger-directive]]", "[[inventory-ledger-loops]]", "[[inventory-ledger-schedule]]", "[[inventory-ledger-charter|eng-inventory-ledger]]", "[[procurement-vendor-network-charter]]", "[[schema-migrations-charter]]", "[[state-integrity-invariants-charter|sre-state-integrity]]", "[[INVENTORY_SOTA_PLAN]]"]
---

# Inventory & Ledger — Charter

Division **Platform** → Department [[engineering-charter]] → Team `inventory-ledger`
(§2.2 of `.planning/foundation/teams/technology.md:102-125`).

## Mandate

**Lots are the single source of truth for stock.** Every mutation flows through
`apply_stock_movement`; `stock_live` and `shadow_stock` remain projections and are never
written directly. This team owns the ledger, the movement function, the projections, and
the invariant that binds them.

## Boundaries

Owns outright:

- **The inventory API surface** — `apps/api-gateway/src/inventory/` (18 endpoints),
  `apps/api-gateway/src/inventory-ledger/` (8), `apps/api-gateway/src/storage-locations/` (8).
- **`apply_stock_movement`** and the movement semantics layered on it — extension,
  race handling, pour idempotency.
- **The projections** — `stock_live`, `shadow_stock`, and the rule that they are derived.
- **The direct-write guard** — `scripts/check_no_direct_stock_writes.sh`, wired into
  `.github/workflows/ci.yml`.
- **Counting** — `services/agent-orchestrator/services/inventory_count_service.py`,
  `agents/inventory_engine.py`.
- **The deprecation of ledger v1**, which is already written down rather than assumed.

## Distinct from siblings because

Its failure is **a number that is quietly wrong**, not an operation that errors
(`.planning/foundation/teams/technology.md:107-109`). Every other Engineering team fails
loudly enough for a test, a 500, or a user complaint. A desynced projection returns
`200 OK` with the wrong integer, and the UI renders it confidently. The dual-bookkeeping
root cause is documented and the fix is **architectural, not a bug queue** — which is
exactly why it needs an owner rather than a backlog.

## Explicit non-goals

| Not ours | Whose it is |
|---|---|
| What was ordered, from whom, at what price | [[procurement-vendor-network-charter]] — they own the order; we own the lot it becomes |
| Authoring the DDL for ledger tables and functions | [[schema-migrations-charter]] — we specify, they author |
| Running the drift/parity gates in CI | [[state-integrity-invariants-charter|sre-state-integrity]] — author ≠ auditor (`technology.md:860`) |
| Whether a POS event was delivered correctly | [[integration-engineering-charter]] |
| Whether POS telemetry is *fit to use* as L0 | [[pos-operational-telemetry-ingest-charter|dat-pos-telemetry-ingest]] |
| Agents that reason about depletion or reorder | [[agent-fleet-charter]] *(Applied AI)* |
| The inventory UI's layout and comprehension | [[client-surfaces-charter]] |

## Metrics it moves

**Primary: `inventory.projection_divergence_rows`** — rows where `stock_live` ≠ sum of
lots, **sampled daily**. Target zero; **any non-zero is a P1 because it is undetectable
from the UI** (`technology.md:119-120`).

Secondary, and the leading indicator: `inventory.direct_write_paths` — code paths that
mutate stock without going through `apply_stock_movement`. The CI guard finds the ones it
can see syntactically; this number is the ones that actually exist.

## Evidence today

**EXISTS** (`.planning/foundation/teams/technology.md:111-117`).

**API surface**
- `apps/api-gateway/src/inventory/` — 18 endpoints
- `apps/api-gateway/src/inventory-ledger/` — 8 endpoints
- `apps/api-gateway/src/storage-locations/` — 8 endpoints

**The deprecation is already written down**
- `apps/api-gateway/src/inventory-ledger/LEDGER_V1_DEPRECATED.md`

**CI guard**
- `scripts/check_no_direct_stock_writes.sh:1-13`, wired into `.github/workflows/ci.yml`.
  The script is candid about its own limits at `:10` — it is a `grep`.

**Migrations**
- `supabase/migrations/20260805130000_extend_apply_stock_movement.sql`
- `supabase/migrations/20260805131000_stock_race_and_pour_idempotency.sql`

**Design corpus**
- `.planning/INVENTORY_SOTA_PLAN.md`
- `.planning/INVENTORY_ADD_REMOVE_SCENARIOS.md`

**Runtime**
- `services/agent-orchestrator/services/inventory_count_service.py`
- `services/agent-orchestrator/agents/inventory_engine.py`

**What is *not* in evidence:** a daily divergence sampling job. The metric is specified
("sampled daily") and the sampler is not cited. Until it runs, the team's primary number
is unread — see [[inventory-ledger-agenda-full]].
