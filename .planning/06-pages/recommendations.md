---
type: page
route: /recommendations
slug: recommendations
softwares: [recommendations]
component: apps/web/src/pages/Recommendations.tsx
audience: owner
tier: plus
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: broken
status: documented
updated: 2026-09-03
links: ["[[PAGE-CONTRACT]]", "[[orders]]", "[[promotions]]", "[[reports]]", "[[providers]]", "[[inventory]]", "[[team]]", "[[recommendations-catalog]]"]
---

# /recommendations — Recommendations

> **Part of** [[08-softwares/recommendations|Recommendations]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

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

## 1a. Features
- Recommendation cards, one per fired deterministic rule: the observed number, the concrete action, and why (no LLM — auditable)
- Per-card: act / dismiss with reason / snooze / done / pin; bulk actions; keyboard flows
- Assign a recommendation to a team member
- Tabs: active / history / dismissed / snoozed / done
- Digest frequency settings
- 🚧 Not in the sidebar — reachable only via command palette or the catalog (§9)

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
(`analytics` — atlas's **⚠ unguarded** is stale; guarded at class level since
2026-08-24 (#31), `apps/api-gateway/src/analytics/analytics.controller.ts:51`),
:565 (`team`).

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

- **Intelligence lens 2026-09-03 (`v3.0-TECH-DEBT.md`, customer + intelligence lens):** none found — "12 rules evaluated · 1 active" matched `GET /analytics/recommendations/:id` exactly; the 11 rules that produced nothing rendered nothing.

## 10. Maturity

**broken.** Every request this page makes is unauthenticated against a controller that
has required a bearer token since 2026-08-24. The page cannot load a single card.

| Evidence | `path:line` |
|---|---|
| **Six raw `fetch` calls, zero `Authorization` headers.** The only header set anywhere in the file is `content-type: application/json` on the three POST/PUT bodies. | `Recommendations.tsx:196,219,252,263-265,383-385,404-406`; grep for `Authorization` in the file → **no hits** |
| **The target controller is class-guarded.** `AnalyticsController` gained `@UseGuards(JwtAuthGuard)` at class level on 2026-08-24 (#31) — the comment explains it was unauthenticated by omission and `POST /consult/:id` spends money. | `analytics.controller.ts:44-51` |
| **The guard accepts a bearer header only** — `ExtractJwt.fromAuthHeaderAsBearerToken()`, no cookie extractor. A `fetch` without the header cannot authenticate, and cross-origin cookies would not be sent anyway (no `credentials: 'include'`). | `auth/strategies/jwt.strategy.ts:11`; guard `auth/guards/jwt-auth.guard.ts:31-45` |
| **The dev bypass does not rescue it** either: it requires non-production, `DEV_AUTH_BYPASS=true`, localhost, *and* an `X-Dev-Bypass` secret header these fetches never send. So the page is broken in every environment. | `auth/dev-bypass.util.ts:16-45` |
| **Result:** `loadActive` throws `Request failed (401)` and the page renders its error state. Every action (act / dismiss / snooze / done / pin / assign / bulk / digest) 401s identically. | `Recommendations.tsx:193-199` (`if (!res.ok) throw new Error(\`Request failed (${res.status})\`)`) |
| **The backend it cannot reach is complete.** `RecommendationsService` is a deterministic, auditable rule engine (no LLM) merged with the `recommendation_actions` disposition store; the hourly `insight-scheduler` sweep keeps its inputs fresh. None of that is the defect. | `analytics/recommendations.service.ts:35-56`; `analytics/recommendation-actions.service.ts`; `analytics/insights/insight-scheduler.service.ts:42` |
| The fix is one import away — sibling pages use `apiClient`, whose request interceptor stamps `Authorization: Bearer` and `X-Restaurant-Id` synchronously. | `services/api/client.ts:58-73` |

- **Intelligence lens 2026-09-03 (`v3.0-TECH-DEBT.md`, customer + intelligence lens):** the active recommendation (Acılı Muhammara + Köpoğlu, lift 2.24) is grounded in real `wine_consumption_log` co-occurrence from the night's 44 checks — a genuinely healthy surface.

## 11. Data flow

### Calls out

| Method · Path | Auth **sent** | Auth **required** | Gateway controller | Returns |
|---|---|---|---|---|
| GET `/analytics/recommendations/:rid` | ❌ none | JWT (class) | `analytics.controller.ts:628` → `recommendations.service.ts:58` | ranked rule hits with observation / action / rationale, merged with dispositions — **401 today** |
| GET `…/:rid/history`, `…/:rid/actions?status=` | ❌ | JWT | `:779`, `:757` | tab contents — **401** |
| GET/PUT `…/:rid/digest` | ❌ | JWT | `:794`, `:802` | digest frequency — **401** |
| POST `…/:rid/action` | ❌ | JWT | `:654` | act/dismiss/snooze/done/pin write — **401** |
| POST `…/:rid/bulk-action` | ❌ | JWT | `:708` | bulk write — **401** |
| GET `/restaurants/:rid/team/members` | ✅ via `apiClient` | JWT | `team` module (`services/api/team.ts:124`) | assignment picker — **this one works**, which is why the assign menu populates on a page where nothing else does |

### Fed by

| Producer | Mechanism | `path:line` |
|---|---|---|
| Rule inputs | hourly `@Cron(EVERY_HOUR)` insight sweep across all restaurants and 11 categories, honouring `analytics_insight_prefs` | `analytics/insights/insight-scheduler.service.ts:42-70` |
| Metrics behind the rules | `AnalyticsService` / `AdvancedAnalyticsService` over `pos_checks`, `wine_consumption_log`, `restaurant_inventory`, `procurement_orders` | `analytics/analytics.service.ts:18,133-138`; `advanced-analytics.service.ts:86` |
| Goal-pace rules | `GoalsService` | `analytics/goals.service.ts:312` |
| Dispositions | this page's own writes (currently 401) plus `ContextualInsights` on [[orders]]/[[inventory]] (also 401 — same defect) | `analytics/recommendation-actions.service.ts` |

The producers are healthy and running. **The transport is the defect** — this page is
starved by its own client code, not by missing data. Note the second-order effect: many
rules need `pos_checks`, so even once auth is fixed, a restaurant without a POS sees a
much shorter list than the catalogue implies (see [[recommendations-catalog]] §10).

### Writes

| Write | Lands in | Downstream reacts |
|---|---|---|
| Act / dismiss / snooze / done / pin | `recommendation_actions` (migration `20260720120000`) | the card's disposition on this page **and** the hidden/pinned set that `ContextualInsights` applies on [[orders]] and [[inventory]] (`ContextualInsights.tsx:125-138`) |
| Assign to a teammate | `recommendation_actions.assigned_to` | assignee's view |
| Digest frequency | server-side digest setting | scheduled digest mail |

**All of these are 401 today**, so the disposition store receives nothing from this page.

## 12. Design intent

**Should be:** the to-do list a manager works down before service — each row a
deterministic rule that fired, with the number, the action, and why the action follows.
Auditable, never an LLM.

| State | Handled? | Evidence |
|---|---|---|
| loading | ✅ | `setLoading(true)` in `loadActive` (`:192`) |
| empty | ✅ | dedicated empty state routing to [[reports]] (§0) |
| error | ✅ **and it is the state users actually see** — `setError` is populated and rendered | `:168,193-199` |
| permission-denied | ❌ | 401 renders as a generic "Request failed (401)", not as "sign in again" |

**Where the UI misleads:** it does not, much — it fails loudly, which is the one thing in
its favour. The misleading part is upstream of the user: a page that *reports* as
shipped, that has an ADR-worthy action model behind it, and that has been non-functional
since the guard landed two days after the actions shipped.

## 13. Roadmap

1. **Replace all six raw `fetch` calls with `apiClient`.** This alone restores the entire
   page. Highest-value single change across all twelve of these dossiers relative to
   effort. *Blocker: none.*
2. **Add a regression test that a page's analytics call carries a bearer token** — this
   defect was introduced by a *correct* security fix in a different file, and nothing
   caught it. Same class of failure will recur on the next guard added.
3. Distinguish 401 from other errors in the UI ("your session expired" vs "request
   failed").
4. **Decide whether this page belongs in the sidebar** (§9). It is a primary actionable
   surface reachable only via the command palette. *Blocker: founder decision — no ADR
   exists either way; add to `OPEN-DECISIONS.md`.*
5. Correct the stale `v3.0-TECH-DEBT.md:493` line ("Recommendations entirely read-only")
   — actions shipped; the page's real problem is auth, not read-only-ness.
6. Once loading works, emit signals — dispositions are operational state, but *which
   rules get dismissed* is the highest-value UX signal in the product and nothing
   records it (§5).
