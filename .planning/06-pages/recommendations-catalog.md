---
type: page
route: /recommendations/catalog
slug: recommendations-catalog
component: apps/web/src/pages/InsightCatalog.tsx
audience: owner
tier: plus
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: broken
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[recommendations]]", "[[settings]]"]
---

# /recommendations/catalog — Insight Catalog

## Surface — buttons → where they go

- **← Recommendations** → [[recommendations]] `/recommendations`
- **Open Settings** (blocked-type explainer) → [[settings]] `/settings`
- **Export** → (in-page download via ExportMenu)
- **Copy link** (per type) → clipboard deep link

## 1. Purpose

"'Browse all 375 insight types' explorer" (`InsightCatalog.tsx:1-2`): full-screen
dimension × measure × comparator grid with per-cell detail (description,
requirements, example), readiness/blocked states with what's-missing, fuzzy search,
category filter, coverage meter, `?type=` deep links, and JSON/CSV export (UX paths
NEW-707…NEW-727, header comment :4-11).

## 1a. Features
- Browse the full insight-type space as a dimension × measure × comparator grid
- Per-cell detail: description, requirements, example
- Readiness/blocked states showing what's missing for *this* restaurant
- Fuzzy search, category filter, coverage meter
- Shareable `?type=` deep links; JSON/CSV export
- 🚧 Headline says "375 types" while the enumerated space is 573 (§9 — OD-33)

## 2. Entry

- From `/recommendations` (`Recommendations.tsx:560`;
  [PAGE_MAP](../foundation/PAGE_MAP.md):88).
- Command palette ×2 (`components/command/commands.ts:84,105`).
- Contextual-insight "browse" links on Orders/Inventory
  (`components/insights/ContextualInsights.tsx:244`) and Reports' seating panel
  (`components/reports/organisms/SeatingDensityPanel.tsx:571,604`).
- Self-produced share links `…?type=<key>` (`InsightCatalog.tsx:187`).

## 3. Files

- Route binding: `apps/web/src/App.tsx:263` (lazy import :86).
- `apps/web/src/pages/InsightCatalog.tsx` (544 lines) — self-contained
  (Header, Breadcrumbs, ExportMenu are the only shared renders, :26-31).

## 4. Endpoints

One call. Atlas row: [ENDPOINTS](../foundation/ENDPOINTS.md):10 (`analytics` — atlas's
**⚠ unguarded** is stale; guarded at class level since 2026-08-24 (#31),
`apps/api-gateway/src/analytics/analytics.controller.ts:51`).

| Method | Path | Call site |
|---|---|---|
| GET | `/analytics/insight-catalog/types` | raw fetch, `InsightCatalog.tsx:102` (`API_URL` const :34) |

## 5. Signals

**None.** No tracking, no `data-ux-key`; reporter dark (`lib/uxSignals.ts:15`).

## 6. Tier cut

**Plus** — a browsing surface over the insight space; readiness display is the
per-restaurant reachability discipline OD-33 demands. Scenario: S15's denominator
problem lives here ([TIER-MAP](../03-scenarios/TIER-MAP.md):51,108-111).

## 7. Rebrand surface

**0 user-visible strings** (no `wineops` hits). Layout chrome per dashboard.md §7.

## 8. State & config

- `?type=` and `?dim=` URL params drive selection (deep links produced at :187 and
  by ContextualInsights/SeatingDensityPanel).
- No flags or env gates beyond `VITE_API_GATEWAY_URL`.

## 9. Gaps

- **The headline number is the wrong one.** The page brands itself "375 insight
  types" while the enumerated space is **573** and only ~144 are satisfiable without
  POS — the exact labelling failure [TIER-MAP](../03-scenarios/TIER-MAP.md):108-111
  forbids: "Never headline a catalogue total … show the
  reachable-for-this-restaurant count (OD-33)". The palette entries repeat the 375
  (`components/command/commands.ts:84,105`).
- Endpoint guarded since 2026-08-24 (#31)
  (`apps/api-gateway/src/analytics/analytics.controller.ts:51`); the atlas row
  ([ENDPOINTS](../foundation/ENDPOINTS.md):10) still reads "unguarded" and is stale.

## 10. Maturity

**broken.** Its single request is unauthenticated against a now-guarded controller, so
the page renders "Couldn't load the catalog." and nothing else.

| Evidence | `path:line` |
|---|---|
| **One raw `fetch`, no `Authorization` header.** Grep for `Authorization`, `token` or `headers` in the file returns **no hits**. | `InsightCatalog.tsx:102`; `API_URL` const `:34` |
| The controller has required a bearer token since 2026-08-24 (#31), and the JWT strategy is header-only — no cookie extractor, and the fetch sets no `credentials`. | `analytics.controller.ts:44-51`; `auth/strategies/jwt.strategy.ts:11` |
| **Failure path:** `.then(r => (r.ok ? r.json() : null))` → `null` → `if (!body) return` → `catalog` stays `null` → the page renders its "Couldn't load the catalog" branch. The `.catch(() => {})` swallows anything else. | `InsightCatalog.tsx:103-118`; error branch `:322` |
| The dev bypass cannot help — it needs an `X-Dev-Bypass` secret header this fetch never sends. Broken in every environment. | `auth/dev-bypass.util.ts:33-45` |
| **§9's headline-number finding needs correcting.** The *page* is honest: it renders `{catalog.total} types` from the API's live `INSIGHT_CANDIDATES.length`, and a coverage meter splitting that into "computable now" vs "blocked on missing data" — exactly the OD-33 discipline TIER-MAP:108-111 demands. The hardcoded **375** survives only in a source comment (`:2`) and, **user-visibly, in two command-palette entries**. | honest render `InsightCatalog.tsx:265,278`; server total `insights/insight-generator.service.ts:58-60` → `insight-catalog.ts:547`; stale literal `components/command/commands.ts:84,105` ("Browse all 375 insight types") |
| The catalogue itself is generated, not hand-listed — dimension × measure × comparator with pruning — so any hardcoded total is wrong by construction. | `insight-catalog.ts:503-540` |

## 11. Data flow

### Calls out

| Method · Path | Auth **sent** | Auth **required** | Gateway controller | Returns |
|---|---|---|---|---|
| GET `/analytics/insight-catalog/types[?restaurantId]` | ❌ none | JWT (class) | `analytics.controller.ts:224` → `insight-generator.service.ts:58` | `{ total, byCategory, dimensions, measures, comparators, candidates, available }` — `available` is the per-restaurant satisfied `DataRequirement` set (`insight-generator.service.ts:74-77`). **401 today.** |

That is the page's entire network surface. There is no second call to fall back on, which
is why the failure is total rather than partial.

### Fed by

| Producer | Mechanism | `path:line` |
|---|---|---|
| The catalogue | **pure computation, no data source** — `buildCandidates()` enumerates `DIMENSIONS × DIMENSION_MEASURES × DIMENSION_COMPARATORS` with three pruning rules, at module load | `insight-catalog.ts:503-547` |
| `available` (the readiness half) | `loadBundle(restaurantId)` — the same bundle the insight engine loads, over `pos_checks`, `wine_consumption_log`, `restaurant_inventory`, `procurement_orders` | `insight-generator.service.ts:74-77`; `analytics.service.ts:18` |
| Those tables | POS webhook (`pos-hub.service.ts:321,752`), receiving, manual entry | see [[inventory]] §11 |

**Finding:** the catalogue half needs no producer at all — it is deterministic code, which
is why this page could work offline if it could authenticate. The *readiness* half is
POS-shaped: without a connected POS a large share of candidates report blocked, which is
the honest answer and the whole point of the coverage meter.

### Writes

**None.** The page is read-only; Export and Copy-link are client-side
(`InsightCatalog.tsx:187,205-215`).

## 12. Design intent

**Should be:** the honest map of what this product can tell you — every insight type, and
for *your* restaurant which are computable and which are blocked on data you have not
connected yet.

| State | Handled? | Evidence |
|---|---|---|
| loading | ✅ | `setLoading` in the `finally` (`:115`) |
| empty | ✅ | "No types match those filters for this dimension." (`:368`) |
| error | ✅ | "Couldn't load the catalog." (`:322`) — and it is the only state anyone currently sees |
| permission-denied | ⚠️ degraded-by-design when signed out: "sign in to see what's computable with your data" (`:268`) — good copy, but it never fires because the whole fetch 401s first |

**Where the UI misleads**

1. **The command palette, not the page.** "Browse all 375 insight types"
   (`commands.ts:99`) is user-visible text asserting a number the server computes and may
   not equal. TIER-MAP:108-111 forbids headlining a catalogue total precisely here.
2. Everything else on this page is a model of the opposite habit — a live total, a split
   between computable and blocked, and per-cell "what's missing". Preserve that when
   fixing the fetch.

## 13. Roadmap

1. **Move the fetch to `apiClient`** (`services/api/client.ts:62` stamps the bearer
   token). Single change; restores the page completely. Do it in the same commit as
   [[recommendations]] §13.1 and the `ContextualInsights` fix — one defect, three pages.
   *Blocker: none.*
2. **Fix the two command-palette labels** — drop the number, or fetch it. `commands.ts:99`
   is the user-visible one; `:78` is a keyword. *Blocker: none.*
3. Update the source comment at `InsightCatalog.tsx:2` so the next reader does not
   re-introduce the literal.
4. Correct the stale ENDPOINTS atlas row (`ENDPOINTS.md:10`, still "⚠ unguarded") — it is
   the record that made this page's auth defect easy to miss.
5. Add the regression test proposed in [[recommendations]] §13.2 — an assertion that every
   analytics call from the web app carries an `Authorization` header would have caught
   both pages.
6. Emit signals: which blocked types users open is a direct signal about which
   integration to build next, and the page currently records nothing (§5).
