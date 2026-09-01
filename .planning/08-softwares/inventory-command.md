---
type: software
slug: inventory-command
name: Inventory Command
division: restaurant
status: partial
tier: core
routes: ["/inventory"]
pages: [inventory]
api_modules: [inventory, inventory-ledger, storage-locations]
agents: [inventory_engine, ghost_inventory_agent, shrinkage_detective_agent, buffer_manager]
owner_unit: inventory-ledger
updated: 2026-09-01
links: ["[[inventory]]", "[[orders]]", "[[receiving]]", "[[receipts-invoice-match]]", "[[inventory-ledger-charter]]", "[[SOFTWARE-MAP]]"]
---

# Inventory Command

## §0 What it is

What you have, where it is, and how fast it is going. One live table of every bottle on the
premises: expand a row and you get the real count against the count the system expected,
how close you are to reordering, how quickly it sells and at what hours. You can count a
shelf by hand and have it stick even with no signal in the walk-in, move stock between
storage areas, photograph a wine list to add wines, and see another branch's stock without
leaving the page. It is also where a delivery gets checked against its paperwork before
anyone agrees to pay for it.

## §1 Features today

- The 9-column live stock table, with an attention rail putting low stock first
- Expand a row for detail: live vs shadow stock, par/reorder bar, velocity, busy-hours
  heatmap, order history, manual entry
- Spot counts with an offline-safe outbox — counts queue and sync when back online
- Add and remove wines; manage storage locations; a cellar map of storage zones
- Move stock between locations, and pour-down
- Scan a menu or wine-list photo to add wines
- Photo-assisted count estimates
- Switch branches and see another branch's stock
- Receiving verification as a **pinned task, not a popup** — verify a delivery against its
  documents; its output feeds [[receiving]]'s manager queue
- Market-price columns — **dark**: they render "—" because the producer has never run (§7)
- Contextual insights rail — **broken**: 401s, same defect as [[orders]]
  (`components/insights/ContextualInsights.tsx:104,118,121,176`)
- "View ledger" — **broken**: points at `/documents?ledger=…`, a route the app does not have
  (it has `/documents-reports`), so the click falls to the catch-all and lands on `/`
- Receipts & invoice depth in the row dropdown — built behind `mudavym_design_inventory`,
  flag **OFF** ([[inventory]] §1a)

## §2 Screens

- [[inventory]] — the whole software, one route. `/inventory` at `apps/web/src/App.tsx:279`,
  rendering `InventoryCommandPage` **directly**. Note it is *not* behind `PageGate`, unlike
  [[orders]], [[receiving]] and [[receipts-invoice-match]] — this page was rebuilt rather
  than flag-forked, so there is no legacy/next split to check.
- `/inventory-legacy` is a `Navigate` redirect to `/inventory` (`App.tsx:285`). It redirects
  rather than 404s because every capability it had was ported first
  ([ADR 0019](../decisions/0019-p2-build-scope.md) §B-parity); the legacy page was deleted
  2026-08-26.

## §3 Backend

Three modules, **34 endpoints**, all `@UseGuards(JwtAuthGuard)` at class level.

| Module | Endpoints | Controller |
|---|---|---|
| `apps/api-gateway/src/inventory/` | 18 | `@Controller("inventory")` `inventory.controller.ts:30`, guard `:31` |
| `apps/api-gateway/src/inventory-ledger/` | 8 | `@Controller("inventory-ledger")` `inventory-ledger.controller.ts:37`, guard `:38` |
| `apps/api-gateway/src/storage-locations/` | 8 | `@Controller("storage-locations")` `storage-locations.controller.ts:23`, guard `:24` |

The `inventory` 18 split into stock reads (`:35, :105, :119, :136, :155`), item writes
(`:53, :76, :288, :429`), movements (`:311` transfer, `:340` pour, `:368` count, `:402`
photo estimate) and the **POS bridge** (`:175, :193, :222, :245, :265` — Toast mapping,
lookup, bulk map, unmap).

`inventory-ledger` is the movement spine: transactions (`:48, :84, :114, :143`), balance and
history per item (`:177, :210`), summary (`:251`) and reconcile (`:287`).
`LEDGER_V1_DEPRECATED.md` sits in the same directory — the deprecation is written down
rather than assumed.

Unlike the `procurement` cluster, these three modules are **not** a shared grab-bag; each
serves this software only.

## §4 Automation

Four agents, and the honest split is two real / two stubs:

- `inventory_engine.py` (491 LOC) — tier **CORE**, depends on `buffer_manager`
  (`core/agent_registry.py:58-60`). Real. Two startup TODOs remain (`:64-65`).
- `buffer_manager.py` (538 LOC) — tier **CORE**, no dependencies
  (`agent_registry.py:53-56`), *"Processes POS events with buffering"*. Real.
- `ghost_inventory_agent.py` (43 LOC) — **stub.** *"This agent is a stub —
  process_message() logs and returns"* (`:12`). Its three TODOs are the entire job: compare
  POS vs physical counts into `inventory_discrepancies`, update `inventory_trust_scores`,
  correlate with `camera_movement_logs` (`:41-43`). Tier OPTIONAL.
- `shrinkage_detective_agent.py` (41 LOC) — **stub**, same shape (`:12`). TODOs: analyse
  patterns into `shrinkage_alerts`, update `staff_correlation_data` and `anomaly_patterns`
  (`:40-41`). Tier OPTIONAL.

So the shrinkage and ghost-stock story this software appears to tell is **not built**. What
runs is the engine and the POS buffer.

⚠️ The `buffer_manager → procurement_agent` chain feeds off the **dormant Python**
`pos_integration_agent`, while live depletion runs through the NestJS `toast`/`pos-hub`
path ([[ECOSYSTEM-PLAN]] §2) — so the automation attached to this software is wired to the
wrong pipeline. That is the E1 seam.

## §5 Data

Verified from the three services' `.from(…)` calls, and present in `supabase/`:

- **Owned:** `restaurant_inventory`, `inventory_transactions` (the ledger),
  `storage_locations`, `wine_location_mappings`, `photo_count_suggestions`
  (`supabase/migrations/20260827100000_photo_count_suggestions.sql:31` — OD-59, P3.0).
- **Read, owned elsewhere:** `master_wine_library`, and the views
  `inventory_lot_rollup`, `inventory_analytics`, `inventory_location_breakdown`.

`inventory_events` is written by [[orders]]'s delivery path, not here.

## §6 Owner

[[inventory-ledger-charter]] — team `inventory-ledger`, department `engineering`, division
Platform (`01-org/platform/engineering/teams/inventory-ledger/`). The charter's
owned-outright list is an exact match for this note's §3: *"The inventory API surface —
`apps/api-gateway/src/inventory/` (18 endpoints), `apps/api-gateway/src/inventory-ledger/`
(8), `apps/api-gateway/src/storage-locations/` (8)"* (`inventory-ledger-charter.md:28-29`).
It also claims `agents/inventory_engine.py` (`:36`) and the ledger-v1 deprecation (`:37`).

The charter states the mandate as: nothing is *written directly* — the team owns the ledger,
the movement function, and the projections (`:21`). Its primary metric is
`inventory.projection_divergence_rows` (rows where `stock_live` ≠ the sum of its lots), with
the leading indicator `inventory.direct_write_paths` (`:62-66`).

Explicitly **not** theirs: the ledger DDL, which belongs to [[schema-migrations-charter]] —
*"we specify, they author"* (`:53`) — and this page's layout and comprehension, which
belongs to [[client-surfaces-charter]] (`:58`).

## §7 Maturity & seams

**partial**, inherited from [[inventory]] §10. The stock spine is real and the writes land
in a ledger; one column has no producer and one embedded panel is dead.

What is real: spot counts go through `set_stock_absolute` with
`transaction_type=reconciliation`, `source=mobile_count` and a client idempotency key
`count:{inventoryId}:{clientCountId}` — and stamp `last_counted_at` even on a no-change
count (`inventory.controller.ts:368-390`). Offline is genuinely offline: counts queue in
`lib/spotCountOutbox.ts:82-96` and the page refetches on drain.

Seams:
1. **The market column has a producer that has never produced.** `marketPrice` reads
   `master_wine_library.retail_price_avg` (`inventory.service.ts:77`); its only writer is
   the Celery task `score.rescore_stale_wines`, scheduled nightly — but
   `services/agent-orchestrator/railway.toml` declares **only a web service with a
   `/health` check**. There is no worker or beat process in any deploy config in the repo.
   Consistent with `v3.0-TECH-DEBT.md:432-440` ("null on all 442 rows").
2. **Derived advice inherits the null** — `marketDeltaPct` returns `null` when `marketPrice`
   is falsy, so the "priced under market" / "cost above market" notes are dead branches
   rather than wrong ones (`bits.tsx:23-26`). Honest failure.
3. **Two of its four agents are stubs** (§4) — ghost stock and shrinkage are named
   capabilities with 41 and 43 lines behind them.
4. **`ReceiptDepth` shows doc-level rows only.** The per-item invoice line needs an
   order-line join the web API does not expose; deliberately not faked with description
   matching ([[inventory]] §9).
5. **"View ledger" is a dead link** (§1).
6. **The insights rail 401s** — the same defect as [[orders]] §7, one shared component.

## §8 Where it's going

- [ADR 0049](../decisions/0049-ecosystem-division-layer.md) §3a: **Restaurant** division,
  phases **E1** (the hop-4 bridge) and **E4** (hop-10 write-back).
- `INVENTORY_SOTA_PLAN.md` phases **2–3** (§6, §7) remain unbuilt; Phase 1 is what this page
  ships (`v3.0-TECH-DEBT.md:357`). Phase 0's ground-truth check is still worth running,
  against the new page.
- [[ECOSYSTEM-PLAN]] §2 names the live gap: **deplete→reorder is unwired**, and the POS
  pipeline unification is E1's job.
- The charter's own leading metric — `inventory.direct_write_paths` — has no instrumentation
  in the repo; counting it is **unscheduled**.

