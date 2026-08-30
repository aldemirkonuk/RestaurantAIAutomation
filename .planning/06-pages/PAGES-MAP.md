---
type: moc
title: Pages Map
updated: 2026-08-26
---

# Pages Map — the ecosystem layer

> **50 pages documented** against [[PAGE-CONTRACT]]. Generated summary — regenerate by hand-count or script; Dataview query below is live.
>
> **2026-08-26:** every page doc now carries a **§1a Features** list — what the page
> presents to the user, in plain product language (founder mandate; improve as pages
> evolve). The shared-design question these lists exposed lives in
> [[DESIGN-FOUNDATION]] (plan only, fork registered as OD-79).
>
> **Archetype column (proposed 2026-08-26, founder to adjust):** the founder chose
> "archetype map of all 50" as OD-79's first co-design step — documentation only,
> design work deferred. Seven product archetypes — `command` (dense operational
> workspace) · `list+detail` (browse + inspect) · `canvas` (block-composed overview)
> · `form` (sectioned config/wizard) · `calendar` · `chat` · `document` (editorial
> reading) — plus three structural buckets: `focused` (chrome-free task/auth flow),
> `redirect`, `placeholder`, `dev` (fixtures). Tally: list+detail 16 · focused 9 ·
> command 5 · form 5 · redirect 3 · dev 3 · canvas 2 · calendar 2 · document 2 ·
> placeholder 2 · chat 1. Each page's `archetype:` frontmatter is the source of
> truth; this table is the view.

> **2026-08-29 — founder review captured.** All 46 routes were screenshotted live and
> redrawn on the makeover canvas; the founder's page-by-page verdicts (KEEP / MERGE /
> REWORK / REJECT / HOLD) are in [[MAKEOVER-VERDICTS]]. Two outright rejections
> (`/wines`, `/login`+`/register`), one HOLD (`/sommelier`), and the palette re-skin to
> İznik + Warm Charcoal in [[0042-iznik-seal-and-warm-charcoal]].

**Instrumented pages: 0 full · 2 partial · 48 none.**
The founder's tracking mandate lands here: page telemetry rides the NF spine (`subject_type: operator`, ADR 0008), and today it is dark — `uxSignals` ships gated off with zero page importers, and 11 `data-ux-key` markers wait for a reporter.

**User-visible WineOps strings across pages: ~71** (shared chrome counted once) — the per-page slice of the rebrand surface, execution held pending brand direction.

| Route | Doc | Archetype | Audience | Tier | Signals | Rebrand |
|---|---|---|---|---|---|---|
| `/admin/health` | [[admin-health]] | `list+detail` | dev | core | none | 0 |
| `/admin` | [[admin]] | `form` | owner | core | none | 0 |
| `/authorize/:integrationId` | [[authorize-integration]] | `focused` | owner | core | none | 3 |
| `/calendar-classic` | [[calendar-classic]] | `calendar` | owner | core | none | 0 |
| `/calendar` | [[calendar]] | `calendar` | owner | core | none | 0 |
| `/communications` | [[communications]] | `list+detail` | owner | core | none | 3 |
| `/credits` | [[credits]] | `redirect` | owner | core | none | 0 |
| `/` | [[dashboard]] | `canvas` | owner | core | none | 0 |
| `/dev-sandbox` | [[dev-sandbox]] | `dev` | dev | core | none | 5 |
| `/distributors` | [[distributors]] | `redirect` | owner | core | none | 0 |
| `/documents-reports` | [[documents-reports]] | `list+detail` | owner | core | none | 0 |
| `/forgot-password` | [[forgot-password]] | `focused` | public | public | none | 4 |
| `/get-started` | [[get-started]] | `form` | owner | core | partial | 5 |
| `/help` | [[help]] | `document` | owner | core | partial | 4 |
| `/inventory-legacy` | [[inventory-legacy]] | `command` | staff | core | none | 0 |
| `/inventory` | [[inventory]] | `command` | staff | core | none | 0 |
| `/invite/:code` | [[invite-landing]] | `focused` | public | public | none | 3 |
| `/login` | [[login]] | `focused` | public | public | none | 3 |
| `/logs` | [[logs]] | `list+detail` | owner | core | none | 0 |
| `/no-access` | [[no-access]] | `focused` | public | public | none | 2 |
| `/notifications` | [[notifications]] | `list+detail` | owner | core | none | 0 |
| `/onboarding` | [[onboarding]] | `focused` | owner | core | none | 2 |
| `/orders` | [[orders]] | `command` | owner | core | none | 4 |
| `/privacy` | [[privacy]] | `document` | public | public | none | 4 |
| `/profile` | [[profile]] | `form` | owner | core | none | 2 |
| `/promotions` | [[promotions]] | `list+detail` | owner | core | none | 0 |
| `/providers` | [[providers]] | `list+detail` | owner | core | none | 0 |
| `/receipts` | [[receipts]] | `list+detail` | owner | core | none | 0 |
| `/receiving/:orderId/door` | [[receiving-door]] | `focused` | staff | core | none | 0 |
| `/receiving` | [[receiving]] | `list+detail` | staff | core | none | 0 |
| `/recommendations/catalog` | [[recommendations-catalog]] | `list+detail` | owner | plus | none | 0 |
| `/recommendations` | [[recommendations]] | `list+detail` | owner | plus | none | 0 |
| `/register` | [[register]] | `form` | public | public | none | 3 |
| `/reports` | [[reports]] | `canvas` | owner | plus | none | 2 |
| `/reset-password` | [[reset-password]] | `focused` | public | public | none | 5 |
| `/services` | [[services]] | `redirect` | owner | core | none | 0 |
| `/settings` | [[settings]] | `form` | owner | core | none | 8 |
| `/simpos/:restaurantId/orders` | [[simpos-order-log]] | `dev` | dev | public | none | 0 |
| `/simpos/:restaurantId` | [[simpos-terminal]] | `dev` | dev | public | none | 3 |
| `/sommelier` | [[sommelier]] | `chat` | owner | core | none | 0 |
| `/studio/certify` | [[studio-certify]] | `list+detail` | dev | core | none | 1 |
| `/studio/queue` | [[studio-queue]] | `list+detail` | dev | core | none | 1 |
| `/studio` | [[studio]] | `command` | dev | core | none | 1 |
| `/team` | [[team]] | `command` | staff | core | none | 0 |
| `/vendor-prices` | [[vendor-prices]] | `list+detail` | owner | plus | none | 0 |
| `/v/:slug` | [[vendor-public-page]] | `list+detail` | public | public | none | 0 |
| `/verify-email` | [[verify-email]] | `focused` | public | public | none | 3 |
| `/wine-agent` | [[wine-agent]] | `placeholder` | owner | core | none | 0 |
| `/wineagent` | [[wineagent-alias]] | `placeholder` | owner | core | none | 0 |
| `/wines` | [[wines]] | `list+detail` | owner | core | none | 0 |

## Live query

```dataview
TABLE route, archetype, audience, tier, signals_today, rebrand_strings
FROM "06-pages"
WHERE type = "page"
SORT route ASC
```