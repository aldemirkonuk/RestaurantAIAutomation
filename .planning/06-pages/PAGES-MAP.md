---
type: moc
title: Pages Map
updated: 2026-08-25
---

# Pages Map — the ecosystem layer

> **50 pages documented** against [[PAGE-CONTRACT]]. Generated summary — regenerate by hand-count or script; Dataview query below is live.

**Surface graph (2026-08-25, ADR 0018):** every note now opens with a `## Surface`
section — the page's buttons, one line each, wikilinked to where they go. **115
distinct page→page edges** across 50 notes; the Obsidian graph over this folder is
the interconnection map the founder asked for. 15 pages have no outbound page
navigation (see findings feed below).

**Instrumented pages: 0 full · 2 partial · 48 none.**
The founder's tracking mandate lands here: page telemetry rides the NF spine (`subject_type: operator`, ADR 0008), and today it is dark — `uxSignals` ships gated off with zero page importers, and 11 `data-ux-key` markers wait for a reporter.

**User-visible WineOps strings across pages: ~71** (shared chrome counted once) — the per-page slice of the rebrand surface, execution held pending brand direction.

| Route | Doc | Audience | Tier | Signals | Rebrand |
|---|---|---|---|---|---|
| `/admin/health` | [[admin-health]] | dev | core | none | 0 |
| `/admin` | [[admin]] | owner | core | none | 0 |
| `/authorize/:integrationId` | [[authorize-integration]] | owner | core | none | 3 |
| `/calendar-classic` | [[calendar-classic]] | owner | core | none | 0 |
| `/calendar` | [[calendar]] | owner | core | none | 0 |
| `/communications` | [[communications]] | owner | core | none | 3 |
| `/credits` | [[credits]] | owner | core | none | 0 |
| `/` | [[dashboard]] | owner | core | none | 0 |
| `/dev-sandbox` | [[dev-sandbox]] | dev | core | none | 5 |
| `/distributors` | [[distributors]] | owner | core | none | 0 |
| `/documents-reports` | [[documents-reports]] | owner | core | none | 0 |
| `/forgot-password` | [[forgot-password]] | public | public | none | 4 |
| `/get-started` | [[get-started]] | owner | core | partial | 5 |
| `/help` | [[help]] | owner | core | partial | 4 |
| `/inventory-legacy` | [[inventory-legacy]] | staff | core | none | 0 |
| `/inventory` | [[inventory]] | staff | core | none | 0 |
| `/invite/:code` | [[invite-landing]] | public | public | none | 3 |
| `/login` | [[login]] | public | public | none | 3 |
| `/logs` | [[logs]] | owner | core | none | 0 |
| `/no-access` | [[no-access]] | public | public | none | 2 |
| `/notifications` | [[notifications]] | owner | core | none | 0 |
| `/onboarding` | [[onboarding]] | owner | core | none | 2 |
| `/orders` | [[orders]] | owner | core | none | 4 |
| `/privacy` | [[privacy]] | public | public | none | 4 |
| `/profile` | [[profile]] | owner | core | none | 2 |
| `/promotions` | [[promotions]] | owner | core | none | 0 |
| `/providers` | [[providers]] | owner | core | none | 0 |
| `/receipts` | [[receipts]] | owner | core | none | 0 |
| `/receiving/:orderId/door` | [[receiving-door]] | staff | core | none | 0 |
| `/receiving` | [[receiving]] | staff | core | none | 0 |
| `/recommendations/catalog` | [[recommendations-catalog]] | owner | plus | none | 0 |
| `/recommendations` | [[recommendations]] | owner | plus | none | 0 |
| `/register` | [[register]] | public | public | none | 3 |
| `/reports` | [[reports]] | owner | plus | none | 2 |
| `/reset-password` | [[reset-password]] | public | public | none | 5 |
| `/services` | [[services]] | owner | core | none | 0 |
| `/settings` | [[settings]] | owner | core | none | 8 |
| `/simpos/:restaurantId/orders` | [[simpos-order-log]] | dev | public | none | 0 |
| `/simpos/:restaurantId` | [[simpos-terminal]] | dev | public | none | 3 |
| `/sommelier` | [[sommelier]] | owner | core | none | 0 |
| `/studio/certify` | [[studio-certify]] | dev | core | none | 1 |
| `/studio/queue` | [[studio-queue]] | dev | core | none | 1 |
| `/studio` | [[studio]] | dev | core | none | 1 |
| `/team` | [[team]] | staff | core | none | 0 |
| `/vendor-prices` | [[vendor-prices]] | owner | plus | none | 0 |
| `/v/:slug` | [[vendor-public-page]] | public | public | none | 0 |
| `/verify-email` | [[verify-email]] | public | public | none | 3 |
| `/wine-agent` | [[wine-agent]] | owner | core | none | 0 |
| `/wineagent` | [[wineagent-alias]] | owner | core | none | 0 |
| `/wines` | [[wines]] | owner | core | none | 0 |

## Surface findings feed — raw material for the P2.3 proposal

> Written by the Surface pass (2026-08-25, three agents, every bullet traced to
> source). The P2.3 proposal compiles these with the endpoint gaps and
> `v3.0-TECH-DEBT.md` carry-overs into the founder-approval doc. Until then this
> feed is the record; nothing here is fixed yet.

**Live defects — buttons navigating to routes that do not exist:**

1. Inventory Command "View ledger" → `/documents?ledger=…` — no `/documents`
   route exists (the page is `/documents-reports`). `apps/web/src/pages/inventory/command/RowExpansion.tsx:329`.
2. One-Tap Action Center routes `gmail_send`/`gmail_contextual` actions →
   `/emails` — no such route (comms live at `/communications`). `apps/web/src/components/notifications/OneTapActionCenter.tsx:131`.

**Dead-end pages (no outbound page navigation):** pure placeholders —
[[wine-agent]], [[wineagent-alias]]; modal/API-only surfaces — [[admin]],
[[admin-health]], [[calendar]], [[calendar-classic]], [[dev-sandbox]],
[[documents-reports]], [[inventory-legacy]], [[logs]], [[receipts]],
[[sommelier]], [[team]], [[vendor-prices]], [[vendor-public-page]].
A dead end is not automatically wrong — but each is either a deliberate leaf or
a missing connection, and the proposal decides which.

**Notable behaviors captured:**

- Wines reorder confirm ("Contact Provider") does a hard
  `window.location.href = '/orders'` full reload instead of SPA navigation
  (`WineLibrary.tsx:372`).
- SimPOS terminal exits to `/` via "Exit to WineOps" (`SimposTerminalPage.tsx:337`)
  — also a rebrand string.
- Notification `actionUrl` destinations are server-supplied and dynamic — the
  graph cannot capture them statically.

## Live query

```dataview
TABLE route, audience, tier, signals_today, rebrand_strings
FROM "06-pages"
WHERE type = "page"
SORT route ASC
```