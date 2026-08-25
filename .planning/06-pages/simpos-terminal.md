---
type: page
route: /simpos/:restaurantId
slug: simpos-terminal
component: apps/web/src/pages/simpos/SimposTerminalPage.tsx
audience: dev
tier: public
signals_today: none
rebrand_strings: 3
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]", "[[simpos-order-log]]", "[[logs]]"]
---

# /simpos/:restaurantId

## 1. Purpose
Chrome-free fake POS terminal (decisions C26–C30, `SimposTerminalPage.tsx:1-11`): open check + loss tracker, wine→vintage→size menu, void/comp lines, Edit POS catalog editor ("drift generator"), disabled Tables 1–20 (C29), and a Receipts/Invoices tab over the fake restaurant's `procurement_documents`. Closing a check makes the *server* HMAC-sign a webhook into PosHub, which depletes real stock — the only channel into WineOps (C25, `services/api/simpos.ts:2-5`). Footer says what it is: "Synthetic test fixture — not a WineOps feature" (`:335`).

## 2. Entry
**No inbound in-app link** ([PAGE_MAP](../foundation/PAGE_MAP.md) entry-points list; also listed among untraced route components). Cold URL, or the Vercel subdomain rewrite mapped in production (`App.tsx:208-213` comment). Requires login: wrapped in `ProtectedRoute` (`App.tsx:214-221`) but outside `DashboardLayout` to preserve the terminal illusion.

## 3. Files
- Route binding: `apps/web/src/App.tsx:214-221` (lazy, `App.tsx:80`)
- `apps/web/src/pages/simpos/SimposTerminalPage.tsx` (618 lines)
- API modules: `services/api/simpos.ts`, `services/api/documents.ts`
- Server counterpart: `apps/api-gateway/src/simpos/` (see §8 for its production fate)

## 4. Endpoints
All under `/simpos/:restaurantId` (atlas: ENDPOINTS.md:536-550, flagged "11 unguarded" — resolved by PR #32 removing the module in production rather than guarding routes):
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

## 8. State & config — what actually happens in production
`SimposModule` is registered only when `NODE_ENV !== "production"` (PR #32; main `apps/api-gateway/src/app.module.ts:84-87` — note this docs branch still carries the pre-PR unconditional registration at its own `app.module.ts:84`). The frontend route ships everywhere. So in production:

- **The page neither 404s, errors, nor hangs — it renders a permanently empty terminal.** Every `/simpos/*` call returns 404; the mount-time seed is explicitly swallowed (`.catch(() => undefined)`, `:59-62`); the three queries fail after one retry (`App.tsx:127 retry: 1`) with `throwOnError: false` (`App.tsx:128`), and **no query error is ever rendered** — the `error` banner (`:212-218`) is set only by mutation handlers. Concretely: check id shows "…" (`:253`), Loss $0.00, "No items — pick from the menu below" (`:267-270`), menu shows "Catalog empty — seed from inventory or use Edit POS" (`:368-371`), tables fall back to 20 hard-coded disabled placeholders (`:225-231`), Order stays disabled (`:303`).
- **It silently polls the dead endpoint every 5 seconds forever** (`refetchInterval: 5_000`, `:74`).
- The Receipts tab still *works* — `/procurement/documents` is a live production module — so one tab shows real data while the other is a void, which reads as "empty restaurant", not "feature removed".
- Interactions that do go through a mutation (Edit POS save, add line if a check somehow existed) would surface a 404 message in the banner.

## 9. Gaps
- The production behavior above is honest-by-accident: nothing tells the user the module is dev-only. A `NODE_ENV`/flag-gated route (as `SimposModule` now is server-side) or an explicit "not available in production" state would make the two match.
- Fixture-fidelity gaps tracked at `v3.0-TECH-DEBT.md:380-384` (44.13): only invoices render among modelled document types; 35% wine-detection gap until `pos_item_mappings` is seeded.
