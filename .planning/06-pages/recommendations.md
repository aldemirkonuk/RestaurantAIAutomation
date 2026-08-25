---
type: page
route: /recommendations
slug: recommendations
component: apps/web/src/pages/Recommendations.tsx
audience: owner
tier: plus
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[orders]]", "[[promotions]]", "[[reports]]", "[[providers]]", "[[inventory]]", "[[team]]", "[[recommendations-catalog]]"]
---

# /recommendations — Recommendations

## Surface — buttons → where they go

- **Act** (per card; label varies — "Draft PO", "Create promo", …) → [[orders]], [[promotions]], [[reports]], [[providers]], [[inventory]] or [[team]] by rule/category
- **Browse every insight type** → [[recommendations-catalog]] `/recommendations/catalog`
- **Enable more insight types** / **Open Reports** (empty state) → [[reports]] `/reports`
- **Dismiss / Snooze / Assign / Pin** → API `POST /api/v1/analytics/recommendations/:restaurantId/action`
- **Copy link** → clipboard deep link

## 1. Purpose

"The translation layer page, now actionable. Each card = one deterministic rule
that fired: the observed number, the concrete action, and why the action follows …
(no LLM — auditable rules)" (`Recommendations.tsx:1-7`). Cards support act / dismiss
with reason / snooze / done / pin, bulk actions, keyboard flows, digest settings,
history, and assignment to team members (UX paths NEW-284…NEW-308, header comment
:8-14).

## 2. Entry

**Not in the sidebar.** Entries are:

- Command palette "Recommendations" / "View recommendations"
  (`components/command/commands.ts:77,100`).
- Back-link from `/recommendations/catalog` ([PAGE_MAP](../foundation/PAGE_MAP.md):90).
- Outbound edges to `/recommendations/catalog` and `/reports` (PAGE_MAP:88-89).

## 3. Files

- Route binding: `apps/web/src/App.tsx:262` (lazy import :85).
- `apps/web/src/pages/Recommendations.tsx` (1,103 lines) — self-contained; only
  shared imports are Header, toasts, and the team API (:49-52).

## 4. Endpoints

Raw `fetch` against `${VITE_API_GATEWAY_URL}/api/v1/analytics/recommendations`
(`Recommendations.tsx:54,155`). Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):10
(`analytics` — **⚠ unguarded**), :565 (`team`).

| Method | Path | Call site |
|---|---|---|
| GET | `/analytics/recommendations/:rid` | `Recommendations.tsx:196` |
| GET | `…/:rid/history`, `…/:rid/actions?status=` | `Recommendations.tsx:219` |
| GET/PUT | `…/:rid/digest` | `Recommendations.tsx:252,383` |
| POST | `…/:rid/action` | `Recommendations.tsx:263` |
| POST | `…/:rid/bulk-action` | `Recommendations.tsx:404` |
| GET | `/restaurants/:rid/team/members` | assignment picker, `Recommendations.tsx:346` → `services/api/team.ts:124` |

## 5. Signals

**None.** Dispositions (act/dismiss/snooze) are *server writes to the
`recommendation_actions` store* — operational state, not telemetry. No `uxSignals`,
no `data-ux-key` (reporter dark, `lib/uxSignals.ts:15`).

## 6. Tier cut

**Plus** — this is where "understand" becomes a to-do list; drafted-action rows in
S10/S02 Plus land here ([TIER-MAP](../03-scenarios/TIER-MAP.md):38,46). Rule-based
"optimize" proposals stop short of Pro's forecast-backed versions (TIER-MAP:84-90).

## 7. Rebrand surface

**0 user-visible strings** (no `wineops` hits in the file). Layout chrome per
dashboard.md §7.

## 8. State & config

- Tabs (active/history/dismissed/snoozed/done) fetch on demand (:219); digest
  frequency is a server-side setting via GET/PUT digest (:252,383).
- No client flags or env gates beyond `VITE_API_GATEWAY_URL`.

## 9. Gaps

- `v3.0-TECH-DEBT.md:493` — the UX-catalog line "Recommendations entirely read-only"
  is **stale**; actions shipped (`recommendation-actions.service.ts`, migration
  `20260720120000`). Do not rebuild from the catalog.
- The page is reachable only through the command palette or the catalog (§2) — a
  primary actionable surface with no sidebar presence; undecided, not accidental as
  far as any record shows (no ADR either way).
