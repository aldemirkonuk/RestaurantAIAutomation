---
type: scenario
id: S04
slug: pos-order-flows-to-inventory
class: happy-path
actors: [server, pos-terminal, pos-bridge, inventory-ledger, owner]
modules: ["[[pos-bridge-charter|pos-bridge]]", "[[inventory-ledger-charter|inventory-ledger]]", "[[connector-platform-trust-charter|connector-platform-trust]]"]
signals: [pos_webhook, canonical_check, stock_movement, pos_unresolved_line, nf_a]
insights_class: [depletion-velocity, stock-variance, live-stock, wine-yield]
tier: core
sim_harness: simpos
status: proposed
updated: 2026-08-24
links: ["[[SCENARIO-CONTRACT]]", "[[pos-bridge-charter]]", "[[inventory-ledger-charter]]"]
---

# S04 — POS order flows to inventory

## 1. Trigger
A server closes a check on the POS. Bounded: from the close-webhook landing at
`POST /pos-hub/webhook/:provider/:restaurantId` to stock decremented and the real-time
low-stock check fired. This is the golden path — the whole POS→analytics stack lights up
from this one event. Prior art is real and wired end to end: the hub normalizes any
provider payload, upserts `pos_checks`, and — for **closed checks only** — depletes stock
(`pos-hub.service.ts:24,209-219`).

## 2. Actors
Server (closes the check on the POS, no Mudavym account) · the POS terminal (external
system, push or pull) · the pos-bridge ingestion path · the inventory ledger (owns the
stock RPCs) · owner (sees the §6 story later). No human is in the loop at ingest time —
this path runs unattended, which is exactly why its failure modes are silent (§8).

## 3. Signals
- **Signed webhook** — HMAC-SHA256 over the raw body, hex, in `X-Pos-Hub-Signature`,
  keyed by `POS_HUB_WEBHOOK_SECRET`. **Fails closed**: unset secret rejects every request
  (`pos-hub.service.ts:96-121`; enforced at the controller, `pos-hub.controller.ts:72`).
- **Canonical check** — `external_check_id`, line items (name, qty, price, category),
  `closedAt`, table/server refs, covers, subtotal/total/tip → upserted to `pos_checks`,
  idempotent on `(restaurant_id, source, external_check_id)` (`:202-204`).
- **Per-line stock target** — `inventory_id` + `sale_unit` resolved mapping-table-first
  from `pos_item_mappings` (B21, `:254-284`); the mapping is the *only* source of a stock
  target (B36: sale unit is never inferred from the item name).
- **Stock movement** — `apply_stock_movement` / `record_glass_pour`, each stamped with an
  idempotency key `pos:{source}:{check}:{item}:{lineNo}` (B15, `:370`) so replays are safe.
- **Honest gaps.** (a) Only lines with an `inventory_id` deplete — today that is wine;
  **food is persisted verbatim to `pos_checks.items` but has no inventory row, so it never
  decrements stock** (B36/A11, `:328-335`) — this is by design, not a leak, but it caps
  food-level depletion insight. (b) An **open** check is analytics-only until `closedAt`
  lands (`:209-212`). (c) NF-A/NF-B agent events are **not emitted** on this path — the
  same known L4 gap S02 carries. (d) Unmapped wine goes to `pos_unresolved_lines`, never
  depletes (B20, `:341-367`).

## 4. Queries the product must answer
- "Did this check deplete the *right* stock, in the right unit?" — glass vs bottle (`:378`).
- "Which lines couldn't be resolved to inventory?" — the `pos_unresolved_lines` queue.
- "What is live stock after this service?" — post-depletion ledger state.
- "Did any depletion silently fail?" — supabase-js resolves RPC failures as `{ error }`,
  so the error field is checked explicitly or success is reported falsely (`:373-377,415`).

## 5. Outputs (in the moment)
- Real-time low-stock **edge alert** for every wine the check touched — fired after the
  depletion loop via `LowStockAlertsService`, fire-and-forget so alerting never slows or
  blocks the stock write (`:436-442`).
- The `pos_unresolved_lines` queue surfaced for mapping — an unmapped wine is queued, never
  dropped.
- Ingestion stats by source over a 30-day window (`GET /pos-hub/status/:restaurantId`).

## 6. Insights the owner sees (the payoff)
- Depletion/pour velocity per SKU; wine-by-the-glass yield vs theoretical pour.
- Stock variance: POS-driven depletion reconciled against receiving (S02) — "you sold 14
  glasses of the Chablis; the bottle math says 12 — where did two go?"
- Live stock levels that actually track sales, not just receiving.

**Satisfiability — higher here, on purpose.** The 25.1%-of-573 ceiling
([[analytics-bi-charter]]) is the *without-POS* floor. This scenario **is** the POS feed,
so it unlocks the depletion/variance/velocity classes that sit above that floor — but only
for **mapped** lines. Unmapped wine and all food feed nothing until mapped (§3d), so the
realized insight coverage is gated on mapping completeness, not promised outright.

## 7. Decisions
Human: map unresolved lines, approve catalog-match proposals, adjust pars. The system
**proposes only** (ask→propose→confirm→execute): auto-maps a catalog item only at ≥0.9
confidence *and* unambiguous, queues everything else, and **never overwrites an existing
mapping silently** (`catalog-matcher` contract, `pos-hub.controller.ts:139`). Par-level
changes after repeated depletion patterns are proposed, never auto-applied.

## 8. Failure modes
- **Unmapped wine accumulates invisibly** in `pos_unresolved_lines` — real depletion goes
  unrecorded until someone reviews the queue (silent, compounding).
- **Food never depletes** by design — correct, but reads as a gap to an owner expecting
  plate-level stock movement; needs recipe-level BOM to ever close (out of scope today).
- **A failed stock RPC is logged `warn`, not surfaced** to the owner (`:415-418`) — the
  ledger silently misses that line.
- **Open check never closes** → never depletes; the sale is analytics-only forever.
- **Secret unset/rotated** → every webhook rejected (fail-closed, correct) but presents as
  a total silent outage — see S09.

## 9. Simulation & deploy gate

> **EXECUTES AS A CHECK since 2026-09-02 (ADR 0093)** — `scripts/simulate scenario … --apply`
> posts a seeded day through the signed `generic_webhook` path and
> `GET /simpos/:id/scenarios/runs/:runId/verify` compares it: `stock.bottle_transactions`,
> `stock.pours`, `stock.projection` (projection = lots) and `consumption.mirror` are the
> "correct ledger delta"; `stock.dedupe` + `webhook.duplicate` are "a replay is a no-op".
> The first live verdict is pending the migrations reaching production on merge — the gate
> now *runs*; it has not yet *passed* on the record.
**SimPOS is the harness for exactly this** (`apps/api-gateway/src/simpos/` — non-production
only since PR #32). A SimPOS check-close signs the canonical payload with a real HMAC and
POSTs `generic_webhook` into the hub (`simpos.service.ts:485-509`), so the golden path runs
without a real POS. **Gate (simulation before live, locked 2026-08-24):** pos-bridge
ingestion or stock-effect changes ship only when a SimPOS close produces the correct ledger
delta **and** a replay of the same `external_check_id` is a no-op (idempotency proven).

## 10. Tier cut (OD-48 locked — Core/Plus/Pro; prices open, OD-23)

**Premise:** this scenario *is* the POS feed — it only exists once S14 connects one. The marks
below name what is needed **beyond** that connection.

- **Core (operate):** per-line stock decrement on check close, idempotency-keyed so replays are
  safe; live stock levels that track sales rather than only receiving; the real-time low-stock
  **edge alert** for every wine the check touched; the `pos_unresolved_lines` queue surfaced so
  an unmapped wine is queued, never dropped. Wired end to end today (`pos-hub.service.ts`).
- **Plus (understand):** depletion / pour-velocity scorecards per SKU, wine-by-the-glass yield
  vs theoretical pour, and 30-day ingestion stats by source. **Partial by construction:** only
  lines carrying an `inventory_id` deplete — today that is wine. **Food is persisted verbatim
  to `pos_checks.items` but has no inventory row and never decrements stock** (B36/A11), and
  unmapped wine sits in `pos_unresolved_lines`. Realized coverage is gated on mapping
  completeness, not promised outright.
- **Pro (optimize):** stock-variance intelligence — POS depletion reconciled against S02
  receiving ("you sold 14 glasses of the Chablis; the bottle math says 12 — where did two
  go?"); par-level proposals from observed depletion patterns; the cross-entity S02 ↔ S04
  reconciliation. Real **for wine**. Plate-level variance — the thing an owner assumes "Pro
  inventory intelligence" means — is 🚧 **signal not built**: it needs recipe-level BOM, which
  does not exist. Do not let a Pro page imply food depletion.

## 11. Evolution feedback
The `pos_unresolved_lines` rate tells us where mapping coverage is thin; which items owners
map first tells us catalogue priorities; how often owners override a proposed mapping tunes
the catalog-matcher thresholds. Every silent RPC warning that a review later catches is a
signal to promote that failure into an owner-visible output.

**Flex points:** sale unit (glass vs bottle) per SKU · provider (any of 27, or the
universal `generic_webhook`/`csv_import` bridge) · push (webhook) vs pull (nightly CSV) ·
whether food ever gains recipe-level depletion (future BOM).
