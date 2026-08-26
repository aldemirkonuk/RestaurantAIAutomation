---
type: page
route: /simpos/:restaurantId
slug: simpos-terminal
component: apps/web/src/pages/simpos/SimposTerminalPage.tsx
audience: dev
tier: public
signals_today: none
rebrand_strings: 3
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[simpos-order-log]]", "[[logs]]", "[[dashboard]]"]
---

# /simpos/:restaurantId

## Surface — buttons → where they go

- **Check logs in full page** → [[simpos-order-log]] `/simpos/:restaurantId/orders`
- **Exit to WineOps** (footer) → [[dashboard]] `/`
- **Close check** → API `POST /simpos/:restaurantId/check/:checkId/close` (server fires the HMAC webhook into PosHub)
- **Void / comp a line** → API `PATCH /simpos/:restaurantId/lines/:lineId`
- **Edit POS** (catalog editor) → API `POST /simpos/:restaurantId/catalog`

## 1. Purpose
Chrome-free fake POS terminal (decisions C26–C30, `SimposTerminalPage.tsx:1-11`): open check + loss tracker, wine→vintage→size menu, void/comp lines, Edit POS catalog editor ("drift generator"), disabled Tables 1–20 (C29), and a Receipts/Invoices tab over the fake restaurant's `procurement_documents`. Closing a check makes the *server* HMAC-sign a webhook into PosHub, which depletes real stock — the only channel into WineOps (C25, `services/api/simpos.ts:2-5`). Footer says what it is: "Synthetic test fixture — not a WineOps feature" (`:335`).

## 2. Entry
**No inbound in-app link** ([PAGE_MAP](../foundation/PAGE_MAP.md) entry-points list; also listed among untraced route components). Cold URL only, and **only under `vite dev`** — a production build redirects to `/` (`App.tsx:218`, see §8). Requires login: wrapped in `ProtectedRoute` (`App.tsx:214-221`) but outside `DashboardLayout` to preserve the terminal illusion.

## 3. Files
- Route binding: `apps/web/src/App.tsx:214-221` (lazy, `App.tsx:80`)
- `apps/web/src/pages/simpos/SimposTerminalPage.tsx` (618 lines)
- API modules: `services/api/simpos.ts`, `services/api/documents.ts`
- Server counterpart: `apps/api-gateway/src/simpos/` (see §8 for its production fate)

## 4. Endpoints
All under `/simpos/:restaurantId` (atlas: ENDPOINTS.md:536-550, flagged "11 unguarded" — that flag is stale twice over: PR #32 removed the module in production, and the routes *are* now guarded too, class-level `JwtAuthGuard` since 2026-08-25 (#55, OD-35), `apps/api-gateway/src/simpos/simpos.controller.ts:53-56`):
| Method | Path | Where called |
|---|---|---|
| POST | `…/catalog/seed` | `SimposTerminalPage.tsx:59` (on mount, errors swallowed) |
| GET | `…/catalog` · `…/check` (5s poll) · `…/tables` | `:66,72-74,79` |
| POST | `…/check/:checkId/lines` | `:111` |
| PATCH | `…/lines/:lineId` | `:124` (void/comp) |
| POST | `…/check/:checkId/close` | `:141` (triggers the signed webhook) |
| GET | `/procurement/documents` | Receipts tab, `:85` → `documents.ts:83` (ENDPOINTS.md — procurement module, **not** simpos) |

## 5. Signals
**none.** (Its whole output is the webhook the *server* emits on close.)

## 6. Tier cut
Not a product page — the test driver behind S04 (POS→inventory), S09 (webhook drop/desync), and S14 (connecting a POS). v3.0 task 44.7 calls it critical path for the eval program (`v3.0-TECH-DEBT.md:309,464`).

## 7. Rebrand surface
- `SimposTerminalPage.tsx:335` — "Synthetic test fixture — not a WineOps feature"
- `SimposTerminalPage.tsx:340` — footer button "Exit to WineOps"
- `SimposTerminalPage.tsx:518` — Edit POS caption "Changes here diverge from WineOps inventory. The drift agent finds them."

## 8. State & config — **the page does not exist in production**

Both halves are now gated, and the gates agree:

- **Server:** `SimposModule` is registered only when `NODE_ENV !== "production"` —
  `...(process.env.NODE_ENV !== "production" ? [SimposModule] : [])`
  (`apps/api-gateway/src/app.module.ts:89`, with the reasoning at `:86-88`: close() makes
  our own server HMAC-sign a webhook into PosHub, so an unguarded simpos route is a
  confused deputy over real inventory). Verified in production by the OD-35 note at
  `apps/api-gateway/src/simpos/simpos.controller.ts:41-45`: `GET /api/v1/simpos/<uuid>/catalog`
  returns **404** in production while `/api/v1/pos-hub/providers` returns 401 — the app is
  routing, the module simply is not loaded.
- **Client:** the route now renders `<Navigate to="/" replace />` under
  `import.meta.env.PROD` (`App.tsx:214-221`, specifically `:218`) — landed 2026-08-24
  (`fc340b7d`). Any Vite production build, **including Vercel preview deployments**,
  redirects to the dashboard. The terminal renders only under `vite dev`.
- **Routes are also authenticated now**: class-level `@UseGuards(JwtAuthGuard)`
  (`simpos.controller.ts:53-56`, OD-35, 2026-08-25) — because dev and staging point at the
  same Supabase instance as production, so an unauthenticated endpoint in a local
  environment writes real rows. Blast radius is bounded to `sim-*` tenants by
  `assertSimRestaurant` (`simpos.service.ts:46-58`).
- Consequence for this note: the previously documented "renders a permanently empty
  terminal in production" behaviour is **superseded** — that analysis now describes only a
  `NODE_ENV=production` **gateway** paired with a **development** frontend build, e.g. a
  local `vite dev` pointed at the Railway gateway. In that configuration the description
  still holds exactly: mount-time seed swallowed (`:59-62`), three queries failing after
  one retry (`App.tsx:127-128`) with no query-error branch, check id "…" (`:253`),
  "No items — pick from the menu below" (`:269`), "Catalog empty — seed from inventory or
  use Edit POS" (`:370`), 20 hard-coded disabled table placeholders (`:224-231`), Order
  disabled (`:302-303`), and a 5-second poll against a dead endpoint (`:74`).

## 9. Gaps
- ~~Nothing tells the user the module is dev-only~~ — **closed by removal**: the route no
  longer renders in production at all (`App.tsx:218`), which is the cleaner resolution
  than an explanatory empty state. See §10 for what this costs.
- The **dev-frontend / prod-gateway** combination above is still silently empty, and it is
  the configuration a developer is most likely to hit.
- Fixture-fidelity gaps tracked at `v3.0-TECH-DEBT.md:380-384` (44.13): only invoices
  render among modelled document types; 35 % wine-detection gap until `pos_item_mappings`
  is seeded.

---

## 10. Maturity — **partial**, and *absent in production*

**Say this first: this page does not exist in production.** The route redirects
(`App.tsx:218`) and the backend module is not registered (`app.module.ts:89`). A dev-only
page cannot be "complete" in the product sense no matter how well it works, so the verdict
below is about the dev environment it does ship to.

In `vite dev` against a non-production gateway, the terminal is **feature-complete and
genuinely end-to-end** — the only page in this cluster whose primary write reaches real
downstream state:

- Open check, wine→vintage→size menu, add line (`:111`), void/comp (`:124`), close
  (`:141`), Edit POS catalogue editor, disabled Tables 1–20 (C29), Receipts/Invoices tab.
- **Close fires a real signed webhook.** `closeCheck` (`simpos.service.ts:356`) HMAC-SHA256
  signs the canonical payload with `POS_HUB_WEBHOOK_SECRET` (`:490-501`) and POSTs it to
  `/pos-hub/webhook/generic_webhook/:restaurantId` (`:525-527`), which PosHub verifies and
  trusts — depleting real stock. Delivery status, timestamp and error are persisted back
  onto the check (`:422-424`) and surfaced in [[simpos-order-log]].
- Errors from mutations are shown in a dismissible banner (`:212-218`, set at
  `:114,130,143,147`), including webhook-delivery failure specifically (`:143`).
- The page labels itself honestly: *"Synthetic test fixture — not a WineOps feature"*
  (`:335`) and *"Changes here diverge from WineOps inventory. The drift agent finds them."*
  (`:518`).

What holds it back from complete, within dev:

- **No query-error state.** The three read queries (`:64,70,77`) fail silently — the error
  banner is only ever set by mutation handlers. A dead or mis-configured gateway looks like
  an empty restaurant.
- **The mount-time seed swallows its own failure** (`.catch(() => undefined)`, `:59-62`),
  so "Catalog empty" (`:370`) is the same for "never seeded" and "seed rejected".
- **It polls a possibly-dead endpoint every 5 seconds indefinitely** (`:74`).
- The Receipts tab reads `/procurement/documents` — a **production** module — so in the
  dev-frontend/prod-gateway case one tab shows real data beside a void.

## 11. Data flow

**Calls out** — all under `/simpos/:restaurantId`, all `JwtAuthGuard`
(`simpos.controller.ts:53-56`), all **absent in production** (`app.module.ts:89`)

| Method | Path | Called at | Gateway controller → service | Returns / effect |
|---|---|---|---|---|
| POST | `…/catalog/seed` | `:59` (on mount, errors swallowed) | `simpos.controller.ts:60-67` → `simpos.service.ts:72` | Seeds `simpos_catalog` once from the sim restaurant's live inventory |
| GET | `…/catalog` | `:66` | `simpos.controller.ts:69-72` → `service:117` | Menu pane data |
| GET | `…/check` | `:72-74`, **5 s poll** | → `service:224` (`getOrCreateOpenCheck`) | The open check + its lines + computed Loss (`service:269`) |
| GET | `…/tables` | `:79` | → `service:187` | Falls back to 20 hard-coded placeholders when empty (`:224-231`) |
| POST | `…/catalog` | Edit POS save | → `service:130` (`upsertCatalogItem`) | The "drift generator" — diverges SimPOS prices from inventory on purpose |
| POST | `…/check/:checkId/lines` | `:111` | → `service:281` | |
| PATCH | `…/lines/:lineId` | `:124` | → `service:327` (`setLineStatus`) | void / comp |
| POST | `…/check/:checkId/close` | `:141` | → `service:356` | **Closes the check and fires the signed webhook** |
| GET | `/api/v1/procurement/documents` | `:85` → `services/api/documents.ts:83` | ProcurementModule — a **production** module, not simpos | Receipts/Invoices tab |

**Fed by — the synthetic engine**

- **Sim tenants** come from the synth factory: `scripts/synth/` (`seed.py`, `recipes.py`,
  `oracle.py`, `auth_personas.py`, `snapshots.py`), driven either by its CLI
  (`scripts/synth/cli.py`) or by the orchestrator's admin routes —
  `POST /api/v1/admin/synth/generate` · `/teardown` · `/refresh`
  (`services/agent-orchestrator/api/synth_routes.py:48,83,93`), gated by `X-Admin-Key`
  (`:22`) and dry-run by default.
- **SimPOS refuses to target anything else**: `assertSimRestaurant` requires
  `restaurants.slug LIKE 'sim-%'` (`simpos.service.ts:46-58`), the same predicate
  `scripts/synth/teardown` uses — so the generator and the terminal agree on what is
  disposable.
- **The catalogue is fed from the sim restaurant's own inventory** on first seed
  (`service:72`), then deliberately allowed to drift via Edit POS — which is the *point*:
  the drift agent's job is to find the divergence.
- Nothing else feeds this page. No POS vendor, no cron, no external webhook inbound.

**Writes**

- SimPOS's own tables only — `simpos_catalog`, checks, lines, tables. The service takes
  this seriously: *"No shared service imports, no direct reads of WineOps stocks, and the
  webhook is the only channel that can ever reconcile them"* (`simpos.service.ts:17-21`).
- **Downstream, on close:** signed webhook → PosHub → canonical `pos_checks` → inventory
  depletion → low-stock notifications → recommendations → [[logs]]' correlated timeline.
  This is the single deepest write-path of any page in this batch.
- Webhook outcome (`webhook_status` / `webhook_sent_at` / `webhook_error`,
  `service:422-424`) → read by [[simpos-order-log]].
- If `POS_HUB_WEBHOOK_SECRET` is unset the service refuses to send rather than sending
  unsigned (`service:494-496`), and refuses non-UUID restaurant ids (`:521-525`).

## 12. Design intent

**Should be:** a POS that behaves badly on demand — the test driver that produces real,
signed, adversarial traffic (voids, comps, price drift, dropped webhooks) so the ingestion
side can be proven against something other than a happy-path fixture. v3.0 task 44.7 calls
it critical path for the eval program (`v3.0-TECH-DEBT.md:309,464`).

| State | Implemented? | Evidence |
|---|---|---|
| Empty | **yes** — "No items — pick from the menu below" (`:269`), "Catalog empty — seed from inventory or use Edit POS" (`:370`), 20 disabled table placeholders (`:224-231`) |
| Loading | **partial** — mutations show a spinner via `busy` (`:302-306`); the Receipts tab passes `isLoading` (`:329`); the three main queries have no loading treatment, so the terminal renders fully-formed-but-empty on first paint |
| Error | **partial** — mutation errors get a dismissible banner (`:212-218`), webhook failure named explicitly (`:143`); **query errors are never rendered** |
| Permission-denied | **partial** — `ProtectedRoute` (`App.tsx:216`) covers logged-out; a logged-in user hitting a non-`sim-*` tenant gets the service's refusal (`simpos.service.ts:55-58`) surfaced only if it arrives via a mutation |

**Where the UI misleads**

1. **A silently empty terminal** whenever the backend is unreachable (§10) — the single
   failure mode, and it is the one a misconfigured dev environment produces.
2. **The Receipts tab works while the rest is dead** in a dev-frontend/prod-gateway split,
   which reads as "quiet restaurant" rather than "module not loaded".
3. **Tables 1–20 are decoration** (`:224-231`) — real when the endpoint answers,
   hard-coded placeholders when it does not, visually identical either way (both are
   `opacity-50 pointer-events-none` by design, C29).
4. ENDPOINTS.md:536-550's "11 unguarded" flag is **stale twice over** — production removal
   (PR #32) and the class-level guard (`simpos.controller.ts:53-56`, OD-35).

## 13. Roadmap

1. **Branch on query error.** One `isError` check across `:64,70,77` feeding the existing
   banner (`:212-218`) removes the page's only real dishonesty. Cheapest item here.
2. **Surface the swallowed seed failure** (`:59-62`) rather than letting it read as an
   empty catalogue.
3. **Stop the 5-second poll after N consecutive failures** (`:74`).
4. **Decide whether SimPOS should be reachable in a controlled production-like
   environment** — a staging tenant with the module enabled would let the eval program
   (`v3.0-TECH-DEBT.md:309,464`) run against production-shaped infrastructure instead of a
   laptop. *Blocked: founder decision; it reopens exactly the confused-deputy risk
   `app.module.ts:86-88` was written to close, so it needs an ADR, not a config change.*
5. **Close the fixture-fidelity gaps** (`v3.0-TECH-DEBT.md:380-384`): document types beyond
   invoices; seed `pos_item_mappings` to close the 35 % wine-detection gap.
6. Add adversarial generators the eval program needs and the terminal cannot yet produce —
   deliberately dropped webhooks, duplicate check ids, out-of-order closes. Today the only
   failure it can inject is price drift.
