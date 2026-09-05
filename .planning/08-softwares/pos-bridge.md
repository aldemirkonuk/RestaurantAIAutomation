---
type: software
slug: pos-bridge
name: POS Bridge
division: pos
status: backend-only
tier: internal
routes: []
pages: []
api_modules: [pos-hub, toast]
agents: [pos_integration_agent]
owner_unit: pos-bridge
updated: 2026-09-01
links: ["[[simpos]]", "[[pos-bridge-charter]]", "[[POS-BRIDGE-AUDIT]]", "[[SOFTWARE-MAP]]"]
---

# POS Bridge

## §0 What it is

The part of Mudavym that plugs into the till a restaurant already uses. When a check is
closed on their point-of-sale, this is what hears about it, works out which bottle was
poured, and takes it off the stock count — so nobody has to type a sale into us twice.
It is the reason the pitch is *"we become the bridge, not another POS"*: whatever system
the kitchen already chose stays, and becomes an input.

## §1 Features today

**No page note rolls up into §1 here** — this software has no screen (§2), so the list
below is read off the controller and the audit rather than from a `06-pages` §1a.

- Say which POS providers exist and where each sits on the status ladder
- Report ingestion status per source over a 30-day window
- Accept a signed webhook from any provider and normalize it to one `CanonicalCheck`
- Upsert canonical checks idempotently on `(restaurant_id, source, external_check_id)`
- Deplete stock from a closed check — bottle movements and glass pours
- Queue a line that resolved to nothing into a human review list
- Batch-import historical checks
- Map a POS item to a catalogue item, and review the mapping
- Propose catalogue matches automatically, then approve or reject each one
- Set the sale unit on a mapping — *broken*: all 92 production mappings have
  `sale_unit = null` (`POS-BRIDGE-AUDIT.md:172,347`), so **every glass pour depletes a
  bottle**. The write path exists; nothing has written it
- Ingest Toast specifically — *broken as a bridge*: it writes stock and `events` directly
  and never produces a canonical check (§7)

## §2 Screens

`backend-only — no user surface.` Nothing in `apps/web` routes here. Its consumers are:

- **[[simpos]]** — the simulator closes a check and POSTs a signed webhook straight into
  this module (`simpos.service.ts:490-527`). Today it is the *only* live producer.
- **Analytics** — `pos_checks` is the substrate 386 of 573 insight types read
  (`POS-BRIDGE-AUDIT.md:535`). Empty bridge, dark analytics.
- **Inventory** — depletion runs through `apply_stock_movement` / `record_glass_pour`
  from inside the ingest path, so a closed check moves real stock.
- **[[receiving]]-side review queues** — unresolved lines and match proposals surface as
  human-approval work, not as a POS screen.

The two `simpos-*` page notes belong to [[simpos]], not to this software.

## §3 Backend

Two gateway modules, and the seam between them is the whole story.

**`apps/api-gateway/src/pos-hub/`** — 13 endpoints, `@Controller("pos-hub")` at
`pos-hub.controller.ts:47`. This is the canonical path.

| Endpoint | Controller |
|---|---|
| `GET /pos-hub/providers` | `pos-hub.controller.ts:55` |
| `GET /pos-hub/status/:restaurantId` | `:65` |
| `POST /pos-hub/webhook/:provider/:restaurantId` | `:73` — `@Public()`, HMAC-authenticated |
| `POST /pos-hub/import/:restaurantId` | `:117` |
| `GET`/`POST /pos-hub/mappings/:restaurantId` | `:137`, `:143` |
| `GET /pos-hub/mappings/:restaurantId/sale-unit-review` | `:174` |
| `POST /pos-hub/mappings/:restaurantId/sale-unit` | `:198`, `:221` |
| `POST /pos-hub/catalog-match/:restaurantId` | `:247` |
| `GET …/proposals`, `POST …/approve`, `POST …/reject` | `:271`, `:282`, `:303` |

**`apps/api-gateway/src/toast/`** — 10 endpoints, `@Controller("toast")` at
`toast.controller.ts:64`: `POST webhook` `:81`, `GET webhook/metrics` `:154`,
`GET menus` `:167`, `POST cache/refresh` `:191`, `GET menus/:menuId` `:206`,
`POST orders` `:225`, `GET orders/:orderId` `:250`, `GET sales` `:271`,
`GET statistics` `:314`, `GET health` `:331`.

**The seam:** `toast/` is a *parallel* ingestion path, not a normalizer feeding `pos-hub`.
A `toastAdapter` for the canonical route exists, is unit-tested, and **is called by
nothing** (`POS-BRIDGE-AUDIT.md:417-418`). Four normalizers live in
`pos-adapters.ts:204-210`; canonical shape in `pos-types.ts`; registry in
`pos-provider.registry.ts` (Toast marked `status: "partial"` at `:58`).

## §4 Automation

**None on the live path.** No `@Cron` in either module; every ingest is webhook-driven.

`services/agent-orchestrator/agents/pos_integration_agent.py` (996 lines) is registered
(`core/orchestrator.py:179`, `core/agent_registry.py:93`, tier `CORE`) and reachable at
`POST /api/v1/pos/webhook/{provider}` (`api/pos_routes.py:35`, dispatching at `:110`). It
is nonetheless **dormant**, and ADR 0049 §3a names it so
(`.planning/04-specs/ECOSYSTEM-PLAN.md:57`: *"the dormant …pos_integration_agent.py"*).
Verified two ways:

1. **No product caller.** Grepping `/api/v1/pos/webhook` across `apps/` returns nothing.
   The only callers are `scripts/simulate/bridge.py:47`, the e2e harness
   (`tests/e2e/wave_d_toast_pipeline.py`), and `scripts/ngrok_live_test.py`.
2. **It could not work if called.** It writes `pos_webhook_logs`
   (`pos_integration_agent.py:951`) — a table with **no `CREATE TABLE` anywhere in
   `supabase/migrations/`**. That path fails on every webhook
   (`POS-BRIDGE-AUDIT.md:414-416`).

Its bus subscriptions are `pos.sync.manual` and `pos.test`
(`pos_integration_agent.py:139-141`) — neither is published by anything.

**The live path is the NestJS module, not the Python agent.** This is the two-runtime
split ECOSYSTEM-PLAN §4.2 names as a cross-cutting fault.

## §5 Data

Verified from `.from("…")` in the two modules' services.

**pos-hub writes/reads:** `pos_catalog_match_proposals`, `pos_item_mappings`, `pos_checks`,
`pos_unresolved_lines`, plus `restaurant_inventory`, `wine_consumption_log`,
`restaurant_tables`, `simpos_catalog` (the last is a reach across into [[simpos]]'s tables).

**toast reads/writes:** `events`, `pos_unresolved_lines`, `pos_item_mappings`,
`restaurant_inventory`, `restaurants`.

Owned outright: the four `pos_*` tables. `pos_checks`, `pos_item_mappings` and
`restaurant_tables` are in `supabase/migrations/20260805000000_baseline_from_production.sql`;
`pos_unresolved_lines` and `pos_catalog_match_proposals` in
`…20260805133000_pos_unresolved_lines_and_review_queues.sql`.

**Referential integrity was added late and for cause.** `pos_item_mappings` had *no foreign
keys at all*, which is how 92 rows came to point at a `restaurant_id` in no `restaurants`
row and at 92 `inventory_id`s resolving to nothing — a synth teardown deleted the tenant
and the database could not object. Those lines landed in **neither stock nor
`pos_unresolved_lines`** — "a black hole, not a shortfall". Closed by OD-71 in
`supabase/migrations/20260825140000_pos_referential_integrity.sql:1-15`, with delete
behaviour derived from a census of the 224 existing public FKs rather than chosen
(`:19-25`); `inventory_id` had already been closed by ADR 0012 and
`candidate_inventory_id` by [ADR 0014](../decisions/0014-proposal-candidate-set-null.md).

`pos_webhook_logs` is **omitted deliberately**: the Python agent writes it and it does not
exist.

## §6 Owner

[[pos-bridge-charter]] — team `pos-bridge`, department `partnerships-integrations`,
division Product (`01-org/product/partnerships-integrations/teams/pos-bridge/`).

The charter claims this module by name and in full: *"`apps/api-gateway/src/pos-hub/` — the
whole module: `pos-adapters.ts`, `pos-hub.service.ts`, `catalog-matcher.service.ts`,
`pos-types.ts`, `pos-provider.registry.ts`, plus specs"* (`pos-bridge-charter.md:43-44`),
along with the canonical shape, the provider registry, per-provider normalizers, and the
human approval gate over match proposals (`:45-49`). It is the team whose deliverable is
*"code that runs in production against someone else's data model"* (`:33-34`).

**Contested at the edges, and worth naming rather than smoothing over:**

- `apps/api-gateway/src/toast/` is claimed by [[integration-engineering-charter]] —
  *"Every code path that speaks someone else's protocol: Toast, SimPOS, POS Hub…"*
  (`integration-engineering-charter.md:19`), listing `toast/` at 10 routes (`:29`).
- [[connector-platform-trust-charter]] audits the same webhook doors (`:136`).
- [[pos-operational-telemetry-ingest-charter]] draws the crispest line in the org:
  Integration Engineering owns *"the webhook verified, returned 200, and nothing was
  dropped"*; that team owns *"the check lines resolved to real catalogue items and velocity
  is computable"* — **"Delivery vs. fitness. A payload can be perfectly delivered and
  useless"** (`pos-operational-telemetry-ingest-charter.md:36-39`).

`pos-bridge` is the primary owner because the charter names the module outright; the other
three are real co-tenants on `toast/`, not a resolution failure.

## §7 Maturity & seams

**backend-only, and split down the middle: the canonical path is built and proven; the one
provider anybody actually configured does not use it.**

**Proven.** Driving 66 canonical checks through the live webhook moved satisfiable insight
types from **8 (1.4%) to 386 (67.4%)** of 573 (`POS-BRIDGE-AUDIT.md:535`); generated
insights 0 → 11, table-performance from `dataStatus: "awaiting POS check feed"` to `live`
with 32 geometry correlations (ridge R² = 0.93), basket 0 → 51 transactions
(`:542-546`). Idempotency held under replay (`:558-560`). The bridge works when fed.

**The webhook-secret verdict — the hole is closed, and one rung of the ladder is still
open by design.** The flagged defect was real: one process-wide key covered all providers
and every restaurant while the route read `restaurantId` straight out of the path and bound
it to nothing, *"so a signature valid for restaurant A was valid for restaurant B's URL,
and holding the secret meant stock writes for any tenant"*
(`pos-hub.service.ts:352-357`, citing `POS-BRIDGE-AUDIT.md §2.4`, OD-B). On origin/main
it is fixed: `resolveWebhookSecret` (`:304-341`) tries
`POS_WEBHOOK_SECRET_<PROVIDER>__<RESTAURANT_ID>`, then `POS_WEBHOOK_SECRET_<PROVIDER>`,
then the legacy global; a scoped key signs `"<provider>:<restaurantId>." + rawBody`
(`:413-416`), so a signature minted for one tenant cannot authenticate another's. It fails
closed on unknown provider, blank context, missing signature, and missing secret
(`:370-410`), and compares with `timingSafeEqual` (`:424`). Setting a scoped rung disables
the global one for that provider — *"a fallback that runs after a scoped signature fails is
not a fallback, it is the hole still being open"* (`:298-300`).

**But:** the legacy `POS_HUB_WEBHOOK_SECRET` rung survives, still signs the raw body alone
with no tenant binding, and **is the rung the only live signer uses** — SimPOS signs with
exactly that variable (`simpos.service.ts:490-501`). So the cross-tenant-forgeable door is
shut *for any connection given a scoped secret* and open for every connection not yet
given one. Each acceptance on that rung logs a warning naming it (`:325-330`). The
remaining work is configuration, not code.

Seams:

1. **Three Toast paths, none producing a canonical check** (`POS-BRIDGE-AUDIT.md:410-422`).
   All 10 production restaurants say `pos_system = 'toast'`. `ToastService.processWebhook`
   writes `events`, `pos_unresolved_lines` and stock RPCs directly, bypassing the canonical
   contract, so analytics over `pos_checks` sees nothing from it; the Python agent writes a
   table that does not exist; the tested `toastAdapter` is called by nothing. **The one
   provider that is production-configured is the one whose live path does not feed the
   bridge.**
2. **`sale_unit` is never written.** All 92 production mappings are null (`:172,347`), so a
   glass pour depletes a bottle. Ranked #1 in the audit's own list (`:472`) — *"the only
   item here that is already wrong rather than not yet built."*
3. **Toast's own signature gate is now conditional, not absent.** The earlier
   fail-open call site is closed: `toast.service.ts:207-235` rejects unsigned requests
   whenever `enforceSignature()` holds. That predicate is
   `!mockMode || NODE_ENV === "production"` (`:121-123`) — so in mock mode outside
   production an unsigned Toast webhook is still accepted, against the same Supabase
   instance production uses. [[connector-platform-trust-charter]]:136 records the older,
   harsher reading; this is the corrected one.
4. **No `pos_connections` table** (`POS-BRIDGE-AUDIT.md:475`) — blocks two POS at one venue,
   meaningful connection health, pull cursors, and per-connection secrets as data rather
   than env vars.
5. **Zero real merchant traffic.** Everything above is proven on a 47-row simulator window
   plus 66 fixtures (`ECOSYSTEM-PLAN.md` §4.4).

> **Lens run 2026-09-03 (`v3.0-TECH-DEBT.md`, POS lens):** the bridge's own doors work — 44 checks in, 34 depletions, a replayed close refused — but **no screen connects POS buttons to stock** (`apps/web/src/services/api/posHub.ts:59,66` are the SPA's only two pos-hub calls), an approved catalog match carries no sale unit and still cannot deplete (`catalog-matcher.service.ts:420-427`), 0 of 135 real button names cleared the 0.9 auto-match threshold (`line-matcher.ts:64`), and every SimPOS line arrives as wine (`simpos.service.ts:411-414`), so the unresolved queue is mostly mezes. The mapping-review screen still promises a "bottle" default that ADR 0011 removed (`pos-mapping-review.service.ts:16-17,219,250-251`).
>
> **Closed 2026-09-05 (#307):** the bridge has a front door. `GET /pos-hub/unresolved/:rid` is
> the first reader `pos_unresolved_lines` has ever had; `PosMappingPanel` on `/inventory` works
> the queue, the catalog-match proposals and the sale-unit answers together, and an approval now
> writes `sale_unit`/`sale_volume_ml` (batch route for the whole queue in one request — the 107
> sequential approvals lost 7 to the 100-per-60s limit). `unit_if_unanswered: "bottle"` became
> `effect_if_unanswered: "depletes_nothing"`.
>
> **The threshold claim above is withdrawn.** "0 of 135 cleared the 0.9 threshold" is true but
> misattributed: measured over those same 135 buttons, the matcher's maximum emittable confidence
> is **0.8800 for every input**, because `catalog-matcher.service.ts:332` is
> `Math.min(0.88, textScore)` — a deliberate cap with a test asserting it, so the trigram tier can
> never auto-map at any threshold above 0.88. 53 of the 135 score a raw 1.000 and 0 are ambiguous.
> The threshold is not the constraint and was left at 0.9.

## §8 Where it's going

> **Decided 2026-09-03:** a POS connection is a row in `pos_connections (restaurant_id, provider_key)` — secret, `signature_scheme`, `notification_url`, OAuth tokens, cursor, status — after the measured Square day (genuine signature 401 × 243; our header 201 × 243 with zero rows and zero log lines; the same day 42/42 through the canonical envelope): [ADR 0105](../decisions/0105-a-pos-connection-is-a-row-not-an-env-var.md). Build gated; four defects it found are in `v3.0-TECH-DEBT.md` (2026-09-03).

- ADR 0049 §3a puts this in the **POS** division at spine hop 1, phases **E0** (webhook
  secrets), **E1** (pipeline unification), **E4** (real-venue onboarding)
  (`.planning/04-specs/ECOSYSTEM-PLAN.md:57`).
- E1's real content is seam 1: make Toast go through `toastAdapter` so one canonical
  contract has one implementation per provider.
- E0 is now finishing configuration, not writing code — set a scoped secret per connection
  and the legacy rung stops mattering.
- `sale_unit` is one field in `upsertItemMapping` (`pos-hub.service.ts:514-527`) and is the
  cheapest correctness win in the division.
