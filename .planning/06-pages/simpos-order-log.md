---
type: page
route: /simpos/:restaurantId/orders
slug: simpos-order-log
component: apps/web/src/pages/simpos/SimposOrderLogPage.tsx
audience: dev
tier: public
archetype: dev # proposed 2026-08-26 (OD-79)
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[simpos-terminal]]", "[[logs]]"]
---

# /simpos/:restaurantId/orders

## Surface — buttons → where they go

- **Back to terminal** → [[simpos-terminal]] `/simpos/:restaurantId`

## 1. Purpose
Full-page debug log over SimPOS's *own* checks — explicitly distinct from the WineOps `/logs` correlated timeline (`SimposOrderLogPage.tsx:1-4`). Per closed check: line items with void/comp status, loss total, and crucially the **webhook delivery status + error** (`:100-118`) — the page you look at to see whether a closed check actually reached PosHub.

## 1a. Features *(dev fixture companion)*
- Per closed check: line items with void/comp status and loss total
- Webhook delivery status + error per check — did the closed check actually reach PosHub?

## 2. Entry
"Check logs in full page" button on the terminal header (`SimposTerminalPage.tsx:202-208`); otherwise cold URL ([PAGE_MAP](../foundation/PAGE_MAP.md) entry-points list). `ProtectedRoute`, chrome-free (`App.tsx:222-229`) — and **only reachable under `vite dev`**; a production build redirects to `/` (`App.tsx:226`, see §8).

## 3. Files
- Route binding: `apps/web/src/App.tsx:222-229` (lazy, `App.tsx:81`)
- `apps/web/src/pages/simpos/SimposOrderLogPage.tsx` (128 lines)
- API module: `services/api/simpos.ts:94-97`

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| GET | `/simpos/:restaurantId/orders` | `SimposOrderLogPage.tsx:21` → `simpos.ts:95` | ENDPOINTS.md:549 (⚠️ unguarded row is stale — prod removal, PR #32, *and* a class-level `JwtAuthGuard` since 2026-08-25 (#55, OD-35), `apps/api-gateway/src/simpos/simpos.controller.ts:53-56`) |

## 5. Signals
**none.**

## 6. Tier cut
Not a product page; debug companion to S04/S09 test runs (see [[simpos-terminal]] §6).

## 7. Rebrand surface
**0** user-visible strings — the WineOps mentions at `SimposOrderLogPage.tsx:3` are comments.

## 8. State & config — **the page does not exist in production**

Both gates, same as [[simpos-terminal]] §8:

- **Server:** `SimposModule` registered only when `NODE_ENV !== "production"`
  (`apps/api-gateway/src/app.module.ts:89`), verified against production at
  `apps/api-gateway/src/simpos/simpos.controller.ts:41-45`.
- **Client:** the route renders `<Navigate to="/" replace />` under `import.meta.env.PROD`
  (`App.tsx:222-229`, specifically `:226`) — landed 2026-08-24 (`fc340b7d`). Every Vite
  production build, previews included, redirects to the dashboard.
- **Guard:** class-level `JwtAuthGuard` (`simpos.controller.ts:53-56`, OD-35).
- The previously documented "renders the empty state in production" behaviour is
  **superseded**; it now describes only a `vite dev` frontend pointed at a
  `NODE_ENV=production` gateway. In that split the description still holds exactly: the
  single query 404s, retries once (`App.tsx:127`), never throws (`App.tsx:128`), and the
  page renders *"No checks yet — close an order from the terminal"*
  (`SimposOrderLogPage.tsx:47-50`).

## 9. Gaps
- ~~The page should say "dev-only" rather than impersonating an empty log~~ — **closed by
  removal**: it no longer renders in production (`App.tsx:226`).
- `query.isError` is still never branched (`:19-25,43-51`), so in the dev-frontend /
  prod-gateway split an absent backend remains indistinguishable from a fresh fixture.
- No pagination and no filter; fine for a fixture, worth noting if the page ever grows
  real use.

---

## 10. Maturity — **partial**, and *absent in production*

**Say this first: this page does not exist in production** (`App.tsx:226`,
`app.module.ts:89`). The verdict below is about `vite dev`.

There, it does its job and does it well — this is **the only place in the product where
webhook delivery is observable**:

- Per closed check: line items with void/comp status, the Loss total, and the webhook
  status plus error (`SimposOrderLogPage.tsx:100-118`), read straight off the columns
  `closeCheck` persists (`simpos.service.ts:422-424`). When a webhook fails, this page is
  where you find out.
- It is deliberately scoped away from the product's own timeline: *"full-page debugging
  view over SimPOS's own data only (distinct from the WineOps /logs correlated timeline)"*
  (`:1-4`).
- 128 lines, one query, one link back. Nothing decorative.

What holds it back:

- **No error state.** `useQuery` is destructured for `data` and `isLoading` only
  (`:19-25`); a failed fetch renders *"No checks yet — close an order from the terminal"*
  (`:47-50`) — an instruction to do the thing you may have already done.
- **No refetch.** Unlike the terminal's 5-second poll (`SimposTerminalPage.tsx:74`), this
  page fetches once (`:19-23`) — so you close a check on the terminal, come here, and see
  stale data until a manual reload. For the page whose purpose is watching webhook
  delivery land, that is the wrong default.
- No filter for failed deliveries, which is the only reason to open it under load.

## 11. Data flow

**Calls out**

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/api/v1/simpos/:restaurantId/orders` | Bearer via the shared API client; server-side `JwtAuthGuard` (`simpos.controller.ts:53-56`) + `assertSimRestaurant` (`simpos.service.ts:46-58`) | `simpos.controller.ts` → `simpos.service.ts:447` (`listOrders`) | Closed checks with lines, timestamps, per-check Loss, and `webhook_status` / `webhook_sent_at` / `webhook_error` (`service:443-447`) |

Called at `SimposOrderLogPage.tsx:21` → `services/api/simpos.ts:94-97`.
**Absent in production** (`app.module.ts:89`).

**Fed by — the synthetic engine, one hop removed**

- Rows exist only because [[simpos-terminal]] closed a check: `closeCheck`
  (`simpos.service.ts:356`) writes the check, HMAC-signs the payload (`:490-501`), POSTs it
  to `/pos-hub/webhook/generic_webhook/:restaurantId` (`:525-527`) and **stamps the
  delivery outcome back onto the row** (`:422-424`). That stamp is this page's entire
  reason to exist.
- The sim tenants themselves come from `scripts/synth/` via
  `POST /api/v1/admin/synth/generate` (`services/agent-orchestrator/api/synth_routes.py:48`,
  `X-Admin-Key` gated at `:22`); SimPOS refuses non-`sim-*` slugs
  (`simpos.service.ts:46-58`).
- No cron, no external producer, no agent writes here.

**Writes**

- **Nothing.** One GET; the page is strictly read-only, correctly so for a debug view.
- Downstream: nothing reacts to this page. What it *observes* — the webhook — is what
  drives PosHub → `pos_checks` → inventory depletion → notifications → [[logs]].

## 12. Design intent

**Should be:** the verification half of the SimPOS loop. The terminal asserts "I closed a
check"; this page is where you confirm the assertion reached PosHub, and see the exact
error when it did not.

| State | Implemented? | Evidence |
|---|---|---|
| Empty | **yes** — "No checks yet — close an order from the terminal" (`:47-50`)… and it doubles as the error state |
| Loading | **yes** — centred spinner (`:43-46`) |
| Error | **no** — `query.isError` is never read (`:19-25`) |
| Permission-denied | **partial** — `ProtectedRoute` (`App.tsx:224`) covers logged-out; a non-`sim-*` tenant's refusal (`simpos.service.ts:55-58`) surfaces as the same empty state |

**Where the UI misleads**

1. **"No checks yet — close an order from the terminal"** for a 404, a 401, or a rejected
   tenant (`:47-50`). One string, four meanings, one of them an instruction the user
   cannot act on.
2. **Stale by default** — no `refetchInterval`, no invalidation link from the terminal's
   close mutation (`SimposTerminalPage.tsx:141`), so the page you open *to check delivery*
   may not contain the check you just closed.

## 13. Roadmap

1. **Branch on `query.isError`** (`:19-25`) — one line, and it is the page's only
   dishonest state.
2. **Refetch, or invalidate `['simpos-orders']` from the terminal's close mutation**
   (`SimposTerminalPage.tsx:141`), so the log reflects the check you just closed.
3. **Filter to failed deliveries** — `webhook_status !== 'sent'` is the query anyone
   opening this page under load actually wants.
4. Pagination once volume warrants; `listOrders` (`simpos.service.ts:447`) currently
   returns unbounded.
5. Inherits [[simpos-terminal]] §13.4 — whether SimPOS should exist in a controlled
   production-like environment at all. *Blocked: founder decision / ADR.*
