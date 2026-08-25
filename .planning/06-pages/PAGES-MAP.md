---
type: moc
title: Pages Map
updated: 2026-08-24
---

# Pages Map — the ecosystem layer

> **50 pages documented** against [[PAGE-CONTRACT]]. Generated summary — regenerate by hand-count or script; Dataview query below is live.

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

## Live query

```dataview
TABLE route, audience, tier, signals_today, rebrand_strings
FROM "06-pages"
WHERE type = "page"
SORT route ASC
```