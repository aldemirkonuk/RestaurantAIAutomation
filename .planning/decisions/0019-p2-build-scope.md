# 0019 — P2 build scope (the founder-approval list)

- **Status:** Locked (build authorized 2026-08-25) — **with two carve-outs, see Decision**
- **Date:** 2026-08-25
- **Decider:** Aldemir (founder) — this document exists to be edited and locked by you
- **Keywords:** P2.3, build scope, page graph, dead ends, live defects, endpoint gaps, web deploy
- **Links:** [[0018-p2-plan-of-record]], `.planning/06-pages/PAGES-MAP.md` (findings feed), `.planning/v3.0-TECH-DEBT.md`, `.planning/UX_PATHS_CATALOG.md`

## Context

ADR 0018 stage P2.3: the docs are grounded, so the build scope becomes a
decision instead of a drift. Sources, all verified 2026-08-25: the Surface
graph (50 notes, 115 page→page edges), the endpoint atlas verification, the
tech-debt register, and the decision register. Approve by striking or keeping
lines; anything kept becomes P2.4's burn-down list, in this order.

## A. Live defects — proposed first, they are broken today

| # | Defect | Proposed fix |
|---|---|---|
| A1 | Inventory Command "View ledger" → `/documents` — **route does not exist** (`RowExpansion.tsx:329`) | Point at `/documents-reports?ledger=…` and honor the param there |
| A2 | One-Tap gmail actions → `/emails` — **route does not exist** (`OneTapActionCenter.tsx:131`) | Point at `/communications` with the thread preselected |
| A3 | Wines reorder confirm does a full page reload via `window.location.href` (`WineLibrary.tsx:372`) | SPA `navigate("/orders")`, state preserved |
| A4 | `v3.0-TECH-DEBT.md` 44.1b — wine-library duplicate-add mutates an in-memory store and fires a success event for a write the DB never received | **Verify against the register first** (half-closed entries are the norm); if open, persist through the API |

## B. Dead-end pages — wire, bless, or retire (one verdict each)

15 pages have no outbound page navigation. A dead end is either a deliberate
leaf or a missing connection; proposed verdicts:

| Page | Proposed verdict |
|---|---|
| [[wine-agent]], [[wineagent-alias]] | **Retire** — pure placeholders, zero buttons; the alias doubles the surface for nothing |
| [[admin]], [[admin-health]], [[dev-sandbox]], [[logs]] | **Bless as leaves** — dev/ops surfaces, no product flow should depend on them |
| [[calendar-classic]], [[inventory-legacy]] | **Retire after parity check** — superseded by [[calendar]] and [[inventory]]; keeping two calendars and two inventories doubles every future change |
| [[calendar]] | **Wire** — today's dates should link to [[orders]] / [[promotions]] they reference |
| [[documents-reports]], [[receipts]] | **Wire** — each document row should link to its [[orders]] order and vendor page; receipts ↔ credits transition exists as API only |
| [[sommelier]], [[team]], [[vendor-prices]], [[vendor-public-page]] | **Bless as leaves** — self-contained tools; revisit if usage says otherwise |

## C. Cold-entry pages — auth + empty-state audit

22 routes are reachable only by URL/redirect (`foundation/PAGE_MAP.md:104`).
Most are sidebar-reachable in practice (the census counts body links only);
the genuinely cold ones — `/v/:slug`, `/authorize/:integrationId`,
`/simpos/*`, `/invite/:code` — each need a verified auth + empty-state pass
before deploy. Proposed as one P2.4 line item, not four.

## D. Endpoint gaps

A first draft of this section proposed four gaps; **verification killed
three** — ux-optimizer and simpos both carry class-level `JwtAuthGuard`
(`ux-optimizer.controller.ts:55`, `simpos.controller.ts:54`), and the POS
webhook **fails closed** when `POS_HUB_WEBHOOK_SECRET` is unset
(`pos-hub.service.ts:206-214`, spec'd at `pos-hub.service.spec.ts:255`). The
draft rows are recorded here as a caution, not repeated. What survives:

The atlas re-verification landed (this PR): **450 endpoints — 411 guarded, 30
public by design, 9 unguarded**. The atlas's previous exposure claim (137
unguarded) was overstated by 128 rows of rot. The 9 real ones were all on one
controller and are **already fixed in [#66](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/66)**
(Toast: anonymous reads of any restaurant's menus/sales verified 200 in
production, plus a mock-mode escape that accepted unsigned stock-mutating
webhooks). What remains proposed:

| # | Gap (verified) | Proposed fix |
|---|---|---|
| D1 | ✅ **FIXED 2026-08-25 — and this row's original claim was wrong.** It said any authenticated user could read another restaurant's data. Not so: `TenantGuard` compares the JWT's `restaurantId` against param/query/body and throws `ForbiddenException` (`tenant.guard.ts:62`), so a user *with* a tenant was always caught. The real hole was narrower and worse-shaped: a user with **no** `restaurantId` on their session skipped the comparison entirely (`if (!user?.restaurantId) return true`), so a tenantless account could name any restaurant and be let through. Now denied whenever the request names a tenant, while tenantless routes (onboarding, profile, settings) keep working. 6 tests, 2 proven to fail against the old code | Done |
| D2 | **~9 `@Public()` `test/*` routes on `communications.controller.ts` (lines 305–991) mutate real data in production** — `test/e2e/step2-approve-reorder` approves a real order, `step3-send-vendor-email` sends a real email, no env gate | Gate behind `NODE_ENV !== "production"` like SimPOS, or delete; founder picks |
| D3 | **`POST /communications/webhooks/gmail` + `/gmail/force-fetch` are `@Public()` with no Pub/Sub OIDC verification** — anyone can trigger a fetch/publish cycle | Verify the Google-signed OIDC token on push requests |
| D4 | **AdminPanel's orchestrator health call is both mis-pathed and unauthenticated** (`AdminPanel.tsx:215` calls `/health/agents` bare; the real route is `/api/v1/health/agents` and wants `X-Admin-Key`) — it can only ever hit the graceful-error branch, so the admin page has silently never shown live agent health | Fix path + auth together when the admin page is touched in P2.4 |

## E. Deliberately NOT in P2

- **Rebrand sweep** (~71 user-visible WineOps strings) — held until brand
  direction exists (standing decision, Vision §13/§14.5).
- **Testing campaign** (44.8–44.12 breadth passes) — after the approved
  feature set ships, not interleaved; P2.4 items carry their own tests.
- **UX_PATHS_CATALOG full burn-down** (~660 unshipped paths) — P2 ships the
  approved list above; the catalog remains the backlog, reconciled per 44.15.
- **Mobile, NF-B guests, Ask AI, beverage expansion** — P3 candidates
  (ROADMAP).

## Decision

**Authorized by the founder 2026-08-25**: *"complete P2 from start to end,
deploy full process"*. That instruction locks the build scope; it does not
license everything in the tables, and two carve-outs are held back
deliberately rather than assumed:

**HELD — page retirements (section B).** Deleting `/calendar-classic`,
`/inventory-legacy`, `/wine-agent` and `/wineagent-alias` removes surfaces a
user may be relying on, and this ADR itself makes each conditional on a parity
check. Retirement is irreversible in a way the rest of this list is not, so it
waits for an explicit yes. Everything else in B is additive wiring and is not
blocked by this.

**HELD — anything requiring a secret the browser must not hold (D4).** If the
admin health panel needs a server-side proxy, that is a new endpoint and an ops
change, not a build item.

**BUILT under this authorization:** A1–A4 (live defects), D1–D3 (tenant
isolation, public test routes, Gmail push verification), and the additive
wiring in B. Delivered in `feat/p2-4-burndown`.

## Consequences

Approving fixes P2.4's scope; anything struck stays in the backlog docs it
came from. The two-calendar / two-inventory retirements (B) are the largest
risk items — each needs a parity check before deletion, and the check is part
of the line item.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-25 | — | Drafted from the Surface findings feed + register; awaiting founder lock |
| 2026-08-25 | Aldemir | Build authorized ("complete P2 start to end, deploy"); retirements and secret-bearing work held back explicitly |
| 2026-08-25 | Verification | D1's stated premise was FALSE — TenantGuard already blocked cross-tenant reads; the real hole was the tenantless-session bypass, now closed. Row corrected in place |
