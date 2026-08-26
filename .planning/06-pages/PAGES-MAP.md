---
type: moc
title: Pages Map
updated: 2026-08-25
---

# Pages Map — the ecosystem layer

> **46 pages documented** against [[PAGE-CONTRACT]] (was 50; `/wine-agent`,
> `/wineagent`, `/inventory-legacy` and `/calendar-classic` retired 2026-08-26,
> ADR 0019 §B). Generated summary — regenerate by hand-count or script; Dataview
> query below is live.
>
> The four deleted dossiers are superseded by **[[RETIRED]]** — what came down, what
> replaced it, what was ported, and why the two real pages redirect rather than 404.

**Surface graph (2026-08-25, ADR 0018):** every note now opens with a `## Surface`
section — the page's buttons, one line each, wikilinked to where they go. **115
distinct page→page edges** across the notes; the Obsidian graph over this folder is
the interconnection map the founder asked for. 13 pages have no outbound page
navigation (see findings feed below) — the two retired placeholders came off that
list without being wired.

**Instrumented pages: 0 full · 2 partial · 46 none.**
The founder's tracking mandate lands here: page telemetry rides the NF spine (`subject_type: operator`, ADR 0008), and today it is dark — `uxSignals` ships gated off with zero page importers, and 11 `data-ux-key` markers wait for a reporter.

**User-visible WineOps strings across pages: ~71** (shared chrome counted once) — the per-page slice of the rebrand surface, execution held pending brand direction.

| Route | Doc | Audience | Tier | Signals | Rebrand |
|---|---|---|---|---|---|
| `/admin/health` | [[admin-health]] | dev | core | none | 0 |
| `/admin` | [[admin]] | owner | core | none | 0 |
| `/authorize/:integrationId` | [[authorize-integration]] | owner | core | none | 3 |
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
| `/studio/invite/:token` | [[studio-invite-redeem]] | dev | core | none | 1 |
| `/studio/queue` | [[studio-queue]] | dev | core | none | 1 |
| `/studio` | [[studio]] | dev | core | none | 1 |
| `/team` | [[team]] | staff | core | none | 0 |
| `/vendor-prices` | [[vendor-prices]] | owner | plus | none | 0 |
| `/v/:slug` | [[vendor-public-page]] | public | public | none | 0 |
| `/verify-email` | [[verify-email]] | public | public | none | 3 |
| `/wines` | [[wines]] | owner | core | none | 0 |

**Retired 2026-08-26 (ADR 0019 §B):** `/wine-agent` and `/wineagent` — one inline
`PlaceholderPage` under two spellings, zero buttons, zero endpoints. Their notes
are deleted rather than archived: the pages had no behaviour to preserve a record
of. The sidebar "Wine Agent" item is gone; the Wine Agent FAB, Help card and Learn
panel already opened [[sommelier]] and are unchanged.

## Surface findings feed — raw material for the P2.3 proposal

> Written by the Surface pass (2026-08-25, three agents, every bullet traced to
> source). The P2.3 proposal compiles these with the endpoint gaps and
> `v3.0-TECH-DEBT.md` carry-overs into the founder-approval doc. Until then this
> feed is the record; nothing here is fixed yet. Compiled into the approval doc:
> [0019-p2-build-scope](../decisions/0019-p2-build-scope.md).

**Live defects — buttons navigating to routes that do not exist:** ✅ **all fixed
2026-08-25 (P2.4, [#67](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/67))**

1. ~~Inventory Command "View ledger" → `/documents?ledger=…`~~ → now
   `/documents-reports`. The `ledger` param is **dropped, not faked**: that page
   is keyed by report, not by inventory item. Per-item ledger data does exist
   (`inventory-ledger.controller.ts:210`) with **no UI rendering it** — a real
   product gap, filed rather than invented.
2. ~~One-Tap gmail actions → `/emails`~~ → now `/communications`. No thread id
   exists on those actions to preselect with.
3. ~~Notification action-URL picker offered `/documents`~~ (same dead route, so
   every notification built with it dead-ended) → `/documents-reports`.
4. ~~`/wines` reorder used `window.location.href`~~ → SPA navigation. This one
   was **breaking the feature**: `pendingReorder` is deliberately excluded from
   persistence, so the reload always rehydrated it as null.
5. Still open: `DocumentsPage.tsx:368` copy-link builds `?doc=<id>` that the
   page never reads — a shared link silently loses its target.

**Dead-end pages (no outbound page navigation):** the two pure placeholders
(`/wine-agent`, `/wineagent`) are **retired**; the remaining 11 are modal/API-only
surfaces — [[admin]], [[admin-health]], [[calendar]],
[[dev-sandbox]], [[documents-reports]], [[logs]],
[[receipts]], [[sommelier]], [[team]], [[vendor-prices]], [[vendor-public-page]].
(`/inventory-legacy` was on this list; **retired 2026-08-26** once its two parity
blockers were ported onto [[inventory]] — ADR 0019 §B-parity. `/calendar-classic`
likewise: **retired 2026-08-26** once its one blocker — reminders that actually
fire — was ported onto [[calendar]]. Both old paths now **redirect** to their
replacements rather than falling to the `*` catch-all; full parity tables and the
redirect reasoning in [[RETIRED]].)
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