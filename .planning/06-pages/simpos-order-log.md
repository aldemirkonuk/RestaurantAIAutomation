---
type: page
route: /simpos/:restaurantId/orders
slug: simpos-order-log
component: apps/web/src/pages/simpos/SimposOrderLogPage.tsx
audience: dev
tier: public
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[simpos-terminal]]", "[[logs]]"]
---

# /simpos/:restaurantId/orders

## Surface — buttons → where they go

- **Back to terminal** → [[simpos-terminal]] `/simpos/:restaurantId`

## 1. Purpose
Full-page debug log over SimPOS's *own* checks — explicitly distinct from the WineOps `/logs` correlated timeline (`SimposOrderLogPage.tsx:1-4`). Per closed check: line items with void/comp status, loss total, and crucially the **webhook delivery status + error** (`:100-118`) — the page you look at to see whether a closed check actually reached PosHub.

## 2. Entry
"Check logs in full page" button on the terminal header (`SimposTerminalPage.tsx:202-208`); otherwise cold URL ([PAGE_MAP](../foundation/PAGE_MAP.md) entry-points list). `ProtectedRoute`, chrome-free (`App.tsx:222-229`).

## 3. Files
- Route binding: `apps/web/src/App.tsx:222-229` (lazy, `App.tsx:81`)
- `apps/web/src/pages/simpos/SimposOrderLogPage.tsx` (128 lines)
- API module: `services/api/simpos.ts:94-97`

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| GET | `/simpos/:restaurantId/orders` | `SimposOrderLogPage.tsx:21` → `simpos.ts:95` | ENDPOINTS.md:549 (⚠️ unguarded row — resolved by prod removal, PR #32) |

## 5. Signals
**none.**

## 6. Tier cut
Not a product page; debug companion to S04/S09 test runs (see [[simpos-terminal]] §6).

## 7. Rebrand surface
**0** user-visible strings — the WineOps mentions at `SimposOrderLogPage.tsx:3` are comments.

## 8. State & config — production behavior
Same server-side gate as the terminal: `SimposModule` exists only when `NODE_ENV !== "production"` (main `apps/api-gateway/src/app.module.ts:84-87`, PR #32). In production the single query 404s, retries once (`App.tsx:127`), never throws (`App.tsx:128`), and the page **renders the empty state "No checks yet — close an order from the terminal"** (`SimposOrderLogPage.tsx:47-50`) — `query.isError` is never branched, so an absent backend is indistinguishable from a fresh fixture. No 404 page, no error, no hang.

## 9. Gaps
- Same silent-emptiness mismatch as the terminal (§8): the page should say "dev-only" rather than impersonating an empty log.
- No pagination and no filter; fine for a fixture, worth noting if the page ever grows real use.
