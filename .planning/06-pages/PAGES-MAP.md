---
type: moc
title: Pages Map
updated: 2026-08-26
---

# Pages Map — the ecosystem layer

> **47 pages documented** against [[PAGE-CONTRACT]] (was 50; `/wine-agent`,
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

**Software layer (2026-09-01, [ADR 0052](../decisions/0052-software-catalog-layer.md)):**
every route note now carries a `softwares:` frontmatter list and a `> **Part of** …` line
under its H1, naming the small software the screen belongs to. Pages are *screens*;
[[SOFTWARE-MAP]] is the *product* layer above them, and it in turn nests under the eight
divisions of [ECOSYSTEM-PLAN §3a](../04-specs/ECOSYSTEM-PLAN.md) ([ADR 0049](../decisions/0049-ecosystem-division-layer.md)).
The mapping is N:M — `providers` hosts two softwares behind its `?tab=` — and all 47 notes
are assigned, none left unowned. This is the [[PAGE-CONTRACT]] half of PV-12.

**§1a Features (2026-08-26, founder mandate):** every page note now carries a
`## 1a. Features` list — what the page presents to the user, in plain product
language, one bullet per capability. Broken or dark features are marked, never
omitted. This is the founder-readable layer over the `path:line` evidence in
§3–§9; keep it current in the same session that changes what a page does
([[PAGE-CONTRACT]] §1a).

**Archetype column (proposed 2026-08-26, founder to adjust — OD-106):** the first
co-design step of the design foundation is a shared vocabulary for what *kind* of
page each route is. Seven product archetypes — `command` (dense operational
workspace) · `list+detail` (browse + inspect) · `canvas` (block-composed overview)
· `form` (sectioned config/wizard) · `calendar` · `chat` · `document` (editorial
reading) — plus structural buckets `focused` (chrome-free task/auth flow),
`redirect`, and `dev` (fixtures). Tally: list+detail 16 · focused 10 · form 5 · command 4 · redirect 3 · dev 3 · canvas 2 · document 2 · calendar 1 · chat 1. Each note's `archetype:`
frontmatter is the source of truth; this table is the view. **Documentation only** —
[[DESIGN-FOUNDATION]] holds the plan and no design work starts until the founder
reopens OD-106.

**Instrumented pages: 0 full · 2 partial · 45 none.**
The founder's tracking mandate lands here: page telemetry rides the NF spine (`subject_type: operator`, ADR 0008), and today it is dark — `uxSignals` ships gated off with zero page importers, and 11 `data-ux-key` markers wait for a reporter.

**User-visible WineOps strings across pages: ~71** (shared chrome counted once) — the per-page slice of the rebrand surface, execution held pending brand direction.

| Route | Doc | Audience | Tier | Archetype | Signals | Rebrand |
|---|---|---|---|---|---|---|
| `/` | [[dashboard]] | owner | core | canvas | none | 0 |
| `/admin` | [[admin]] | owner | core | form | none | 0 |
| `/admin/health` | [[admin-health]] | dev | core | list+detail | none | 0 |
| `/authorize/:integrationId` | [[authorize-integration]] | owner | core | focused | none | 3 |
| `/calendar` | [[calendar]] | owner | core | calendar | none | 0 |
| `/communications` | [[communications]] | owner | core | list+detail | none | 3 |
| `/connections` | [[connections]] | owner | core | list+detail | none | 1 |
| `/credits` | [[credits]] | owner | core | redirect | none | 0 |
| `/dev-sandbox` | [[dev-sandbox]] | dev | core | dev | none | 5 |
| `/distributors` | [[distributors]] | owner | core | redirect | none | 0 |
| `/documents-reports` | [[documents-reports]] | owner | core | list+detail | none | 0 |
| `/forgot-password` | [[forgot-password]] | public | public | focused | none | 4 |
| `/get-started` | [[get-started]] | owner | core | form | partial | 5 |
| `/help` | [[help]] | owner | core | document | partial | 4 |
| `/inventory` | [[inventory]] | staff | core | command | none | 0 |
| `/invite/:code` | [[invite-landing]] | public | public | focused | none | 3 |
| `/login` | [[login]] | public | public | focused | none | 3 |
| `/logs` | [[logs]] | owner | core | list+detail | none | 0 |
| `/no-access` | [[no-access]] | public | public | focused | none | 2 |
| `/notifications` | [[notifications]] | owner | core | list+detail | none | 0 |
| `/onboarding` | [[onboarding]] | owner | core | focused | none | 2 |
| `/orders` | [[orders]] | owner | core | command | none | 4 |
| `/privacy` | [[privacy]] | public | public | document | none | 4 |
| `/profile` | [[profile]] | owner | core | form | none | 2 |
| `/promotions` | [[promotions]] | owner | core | list+detail | none | 0 |
| `/providers` | [[providers]] | owner | core | list+detail | none | 0 |
| `/receipts` | [[receipts]] | owner | core | list+detail | none | 0 |
| `/receiving` | [[receiving]] | staff | core | list+detail | none | 0 |
| `/receiving/:orderId/door` | [[receiving-door]] | staff | core | focused | none | 0 |
| `/recommendations` | [[recommendations]] | owner | plus | list+detail | none | 0 |
| `/recommendations/catalog` | [[recommendations-catalog]] | owner | plus | list+detail | none | 0 |
| `/register` | [[register]] | public | public | form | none | 3 |
| `/reports` | [[reports]] | owner | plus | canvas | none | 2 |
| `/reset-password` | [[reset-password]] | public | public | focused | none | 5 |
| `/services` | [[services]] | owner | core | redirect | none | 0 |
| `/settings` | [[settings]] | owner | core | form | none | 8 |
| `/simpos/:restaurantId` | [[simpos-terminal]] | dev | public | dev | none | 3 |
| `/simpos/:restaurantId/orders` | [[simpos-order-log]] | dev | public | dev | none | 0 |
| `/simpos/:restaurantId/scenarios` | [[simpos-scenarios]] | dev | public | dev | none | 0 |
| `/sommelier` | [[sommelier]] | owner | core | chat | none | 0 |
| `/studio` | [[studio]] | dev | core | command | none | 1 |
| `/studio/certify` | [[studio-certify]] | dev | core | list+detail | none | 1 |
| `/studio/invite/:token` | [[studio-invite-redeem]] | dev | core | focused | none | 1 |
| `/studio/queue` | [[studio-queue]] | dev | core | list+detail | none | 1 |
| `/team` | [[team]] | staff | core | command | none | 0 |
| `/v/:slug` | [[vendor-public-page]] | public | public | list+detail | none | 0 |
| `/vendor-prices` | [[vendor-prices]] | owner | plus | list+detail | none | 0 |
| `/verify-email` | [[verify-email]] | public | public | focused | none | 3 |
| `/wines` | [[wines]] | owner | core | list+detail | none | 0 |

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
TABLE route, audience, tier, archetype, signals_today, rebrand_strings
FROM "06-pages"
WHERE type = "page"
SORT route ASC
```