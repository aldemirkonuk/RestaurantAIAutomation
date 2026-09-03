---
type: software
slug: simpos
name: SimPOS
division: pos
status: partial
tier: internal
routes: ["/simpos/:restaurantId", "/simpos/:restaurantId/orders", "/simpos/:restaurantId/scenarios"]
pages: [simpos-terminal, simpos-order-log, simpos-scenarios]
api_modules: [simpos]
agents: []
owner_unit: pos-bridge
updated: 2026-09-02
links: ["[[simpos-terminal]]", "[[simpos-order-log]]", "[[simpos-scenarios]]", "[[0093-a-scenario-is-replayed-and-verified-against-its-own-expectation]]", "[[pos-bridge]]", "[[pos-bridge-charter]]", "[[SOFTWARE-MAP]]"]
---

# SimPOS

## §0 What it is

A fake till we run ourselves, so the rest of Mudavym can be developed and tested against a
restaurant that does not exist. You open a check, add a glass of wine, void a line, close
the check — and everything downstream reacts as if a real venue had just sold a bottle.
It is deliberately *not* a product: the moment a real venue is offered it as their
point-of-sale, the bridge thesis is dead.

## §1 Features today

- See tables 1–20 laid out (rendered disabled, decision C29)
- Open a check with a running loss tracker
- Add a line through a wine → vintage → size menu
- Void or comp a line
- Edit the POS catalogue in place — the deliberate drift generator
- Read receipts and invoices over the fixture's documents
- Close a check — the server then HMAC-signs a webhook that depletes **real** stock
- Per closed check, see line items, void/comp status and the loss total
- See whether the webhook actually reached [[pos-bridge]]: delivery status, timestamp,
  error — the only place in the whole product where webhook delivery is observable
- **Replay a whole restaurant day and verify it (ADR 0093, 2026-09-02).** `scripts/simulate scenario`
  generates a day inside the venue's own operating hours — the opening minute, two tables two
  minutes apart, a full service, a wine sold through to par, an unmapped button, a void, a
  duplicate webhook, a dropped webhook, an after-hours order, or a seeded `random` mix — posts it
  through the same signed webhook path, and persists its expectation (`sim_scenario_runs`)
- See the verdict on [[simpos-scenarios]]: twenty checks across `pos_checks`, lots, the consumption
  mirror, the unresolved queue, the inbox, the email outcome, insights and analytics — each
  pass / fail / **unverifiable**, an empty expectation never a pass
- Fire the low-stock sweep and the insight generator now, from the page, instead of waiting for the cron
- Seed the catalogue on mount — *dark*: it swallows its own failure
  (`.catch(() => undefined)`, `SimposTerminalPage.tsx:59-62`), so "Catalog empty" means
  both "never seeded" and "seed rejected"

## §2 Screens

- [[simpos-terminal]] (`/simpos/:restaurantId`) — the till itself. Chrome-free on purpose
  (decision C26): sidebar and agent FAB would break the terminal illusion.
- [[simpos-order-log]] (`/simpos/:restaurantId/orders`) — the check log, and the webhook
  delivery view. 128 lines, one query, one link back.

- [[simpos-scenarios]] (`/simpos/:restaurantId/scenarios`) — the verdict screen for a replayed
  day (ADR 0093): runs, stories, the twenty-check table, three levers. 611 lines.

All three are declared at `apps/web/src/App.tsx:238-268`, outside `DashboardLayout`.

**On tier — the page notes say `public`; the runtime does not.** Both routes are wrapped in
`<ProtectedRoute>` (`App.tsx:241,249`) and the controller carries a class-level
`@UseGuards(JwtAuthGuard)` (`simpos.controller.ts:52-55`). `tier: internal` here is the
honest read: this is a development fixture, and the page notes' own §6 says so —
*"Not a product page — the test driver behind S04 … S09 … and S14"*
(`simpos-terminal.md:64`).

**They do not exist in production.** Each route renders `<Navigate to="/" replace />` when
`import.meta.env.PROD` (`App.tsx:242,250`), and `SimposModule` is conditionally excluded
from the gateway: `...(process.env.NODE_ENV !== "production" ? [SimposModule] : [])`
(`app.module.ts:89`). Verified live rather than assumed: `GET /api/v1/simpos/<uuid>/catalog`
returns **404** in production while `/api/v1/pos-hub/providers` returns **401**, so the app
is routing and this module simply is not loaded (`simpos.controller.ts:39-44`).

## §3 Backend

`apps/api-gateway/src/simpos/` — 16 endpoints (11 terminal + 5 scenario, ADR 0093), `@Controller("simpos/:restaurantId")` at
`simpos.controller.ts:55`. The `:restaurantId` is on the controller prefix, so every route
is tenant-parameterized.

| Endpoint | Controller |
|---|---|
| `POST catalog/seed` · `GET catalog` · `POST catalog` · `DELETE catalog/:catalogId` | `:59`, `:69`, `:75`, `:95` |
| `GET tables` · `GET check` · `GET orders` · `GET check/:checkId` | `:104`, `:112`, `:120`, `:131` |
| `POST check/:checkId/lines` · `PATCH lines/:lineId` · `POST check/:checkId/close` | `:142`, `:161`, `:183` |
| `GET scenarios/runs` · `GET scenarios/runs/:runId` · `GET scenarios/runs/:runId/verify` · `POST scenarios/runs/:runId/sweep` · `POST scenarios/runs/:runId/insights` (ADR 0093) | `:209`, `:219`, `:230`, `:243`, `:256` |

**The guard exists for a specific reason, and the reasoning is worth keeping.** This
controller originally had neither a guard nor `@Public()`, and `POST check/:id/close` makes
*our own server* HMAC-sign a webhook into `/pos-hub/webhook/generic_webhook/:restaurantId`,
which the perimeter then trusts because the signature is genuinely valid — *"That is a
confused deputy, and the deputy depletes stock"* (`simpos.controller.ts:30-37`, OD-35,
added 2026-08-25). It was never remotely exploitable in production because the module is
not loaded there. It still needed the guard for a reason the register did not name:
**dev and staging point at the same Supabase instance as production**, so an
unauthenticated endpoint in a preview environment writes real rows (`:47-51`). The
sim-tenant check (`slug LIKE 'sim-%'`) bounds the blast radius; it does not authenticate
the surface.

`closeCheck` signs with `crypto.createHmac("sha256", …)` over `POS_HUB_WEBHOOK_SECRET` and
POSTs over real HTTP rather than calling in-process — *"no shared service import: this is a
real HTTP round trip so the verification path stays exercised"* (`simpos.service.ts:485-501`,
decision C28).

## §4 Automation

`none (every action is human-initiated)` — no `@Cron`, no agent. The terminal polls its own
reads every 5 seconds (`SimposTerminalPage.tsx:74`), which is a refresh, not automation.

## §5 Data

Owns four tables outright, all created in
`supabase/migrations/20260805134000_simpos_schema.sql`: `simpos_checks`, `simpos_catalog`,
`simpos_check_lines`, `simpos_tables` — with real FKs between them
(`:65-66,95-98`). Reads `restaurants` for the sim-tenant check.

**One table leaks.** `simpos_catalog` is also read from `pos-hub`
(`apps/api-gateway/src/pos-hub/`, one `.from("simpos_catalog")`) — a production module
reaching into the simulator's storage. That is the shape of a fixture that grew a
dependency.

## §6 Owner

[[pos-bridge-charter]] — team `pos-bridge`, department `partnerships-integrations`,
division Product.

Named explicitly and twice: *"The **SimPOS simulator** (`apps/api-gateway/src/simpos/`) as a
development target"* under boundaries owned outright (`pos-bridge-charter.md:50`), and in
the evidence section as *"A simulator to develop against: `apps/api-gateway/src/simpos/`,
11 routes … surfaced at `/simpos/:restaurantId` and `/simpos/:restaurantId/orders`"*
(`:99-101`).

The same charter's first explicit non-goal is this software's guardrail: *"**We do not build
a POS.** SimPOS is a simulator for developing against, not a product. The moment it is
offered to a venue as their point-of-sale, the bridge thesis is dead"* (`:54-55`).

Co-claimed by [[integration-engineering-charter]], which lists `apps/api-gateway/src/simpos/`
at 11 routes (`:30`, `:89`) under *"every code path that speaks someone else's protocol"*.
[[connector-platform-trust-charter]] examined it and released it: *"Not a webhook receiver
at all — catalog/check/table CRUD for the local simulator. The label prescribes a control it
has no use for"* (`:137`). `pos-bridge` wins on the explicit naming.

## §7 Maturity & seams

**partial, and absent in production** — the verdict both page notes lead with, and it rolls
straight up. A dev-only surface cannot be "complete" in the product sense however well it
works, so what follows is about the environment it does ship to.

In `vite dev` the terminal is **feature-complete and genuinely end-to-end** — the only page
in this cluster whose primary write reaches real downstream state
(`simpos-terminal.md:114-137`). Close fires a real signed webhook that PosHub verifies and
trusts, delivery status is persisted back onto the check (`simpos.service.ts:422-424`) and
surfaced in [[simpos-order-log]]. The pages label themselves honestly: *"Synthetic test
fixture — not a WineOps feature"* and *"Changes here diverge from WineOps inventory. The
drift agent finds them."*

Seams:

1. **Reads fail silently on both pages.** The terminal's three read queries
   (`SimposTerminalPage.tsx:64,70,77`) have no error branch — the banner is only ever set
   by mutation handlers — so a dead gateway looks like an empty restaurant. The order log
   destructures only `{ data, isLoading }` (`SimposOrderLogPage.tsx:19-25`) and renders
   *"No checks yet — close an order from the terminal"* on a failed fetch: an instruction
   to do the thing you may have already done.
2. **The order log never refetches** (`:19-23`). For the page whose entire purpose is
   watching webhook delivery land, fetch-once is the wrong default; it also has no filter
   for failed deliveries, which is the only reason to open it under load.
3. **It signs on the legacy rung.** `POS_HUB_WEBHOOK_SECRET` is the process-wide,
   un-scoped key — the one [[pos-bridge]] §7 keeps alive *because* SimPOS uses it
   (`pos-hub.service.ts:359-363`). Moving SimPOS to a scoped secret is what lets the
   legacy rung be removed.
4. **Mixed-environment bleed.** The Receipts tab reads `/procurement/documents`, a
   production module, so in the dev-frontend/prod-gateway case one tab shows real data
   beside a void (`simpos-terminal.md:145-147`).
5. **CodeQL flags `sendSignedWebhook` as request-forgery**, and the mitigation is action at
   a distance: `assertSimRestaurant` lives in another method, CodeQL cannot see it, and a
   future caller reaching the private method directly inherits no protection
   (`simpos.service.ts:506-511`).

> **Lens run 2026-09-03 (`v3.0-TECH-DEBT.md`, POS lens):** as a stand-in for a real POS, SimPOS under-reports on three axes measured against 44 closed checks — every seeded button is a hard-coded $45 (`simpos.service.ts:91-96`), the webhook carries no money, table, server or covers (`:401-415`; NULL on 44 of 44 `pos_checks`), and it never reads the venue's operating hours (`restaurants.operating_hours`, ADR 0093) — all 44 checks rang after the published close without a warning.

## §8 Where it's going

- ADR 0049 §3a places it in the **POS** division alongside [[pos-bridge]]
  (`.planning/04-specs/ECOSYSTEM-PLAN.md:57`), phases **E0/E1/E4**.
- Its own charter caps its ambition: it is a development target, and growing it toward a
  product is the failure mode, not the roadmap.
- The two cheap fixes are error branches on the four read queries and a refetch on the
  order log — both are honesty defects, which is exactly what a test fixture cannot afford.
- **The scenario harness (ADR 0093) is now the thing that makes this fixture prove anything.** Next: run
  the first live day after the two migrations reach production on merge; record the verdict table in
  the ADR's review trail; then a missed-webhook detector so `webhook.dropped` can become a real check
  (S09), and a CI job that runs a seeded day against a throwaway database.
- Retiring it is downstream of `pi.merchant_backed_providers` going 0 → 1: until a real
  venue is connected, this is the only producer the bridge has.
