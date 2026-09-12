---
type: software
slug: recommendations
name: Recommendations
division: intelligence-analytics
status: partial
tier: plus
routes: ["/recommendations", "/recommendations/catalog"]
pages: [recommendations, recommendations-catalog]
api_modules: [analytics, one-tap-actions, ux-optimizer]
agents: []
owner_unit: insight-narrative-generation
updated: 2026-09-01
links: ["[[recommendations]]", "[[recommendations-catalog]]", "[[reports-analytics]]", "[[insight-narrative-generation-charter]]", "[[SOFTWARE-MAP]]"]
---

# Recommendations

## §0 What it is

The screen that turns a number into something to do. Each card names one thing it
noticed, one concrete action, and why the action follows — no chat, no invented advice;
every card traces back to a rule and a figure from your own data. You act on it, dismiss
it with a reason, snooze it, mark it done, pin it, or hand it to someone on your team. A
second screen is the catalogue behind all of it: the whole space of findings the system
could ever produce, and which of them your data can currently support.

## §1 Features today

- Read one card per rule that fired: the observed number, the action, and why
- Act, dismiss with a reason, snooze, mark done, or pin a card
- Assign a card to a team member
- Run bulk actions over several cards; drive the whole page from the keyboard
- Switch tabs: active / history / dismissed / snoozed / done
- Set how often you want a digest
- Browse the full finding space as a dimension × measure × comparator grid
- Open one cell for its description, requirements and an example
- See readiness — what is computable now versus blocked on missing data for *your*
  restaurant, with a coverage meter
- Search, filter by category, share a `?type=` deep link, export the catalogue as JSON/CSV
- Reach the page at all — *partial* (no sidebar entry; command palette or the catalogue only)

## §2 Screens

- [[recommendations]] — the acting surface; route `/recommendations` at
  `apps/web/src/App.tsx:291`, **not** behind `PageGate`.
  `apps/web/src/pages/Recommendations.tsx` (1,099 lines), self-contained.
- [[recommendations-catalog]] — the capability map; route `/recommendations/catalog` at
  `App.tsx:292`. `apps/web/src/pages/InsightCatalog.tsx` (545 lines).

Neither is in the sidebar. Entries are the command palette
(`components/command/commands.ts:84,105`) and the back-link between the two pages. A
primary actionable surface with no navigation presence, and no ADR either way.

## §3 Backend

**`apps/api-gateway/src/analytics/`** — shared with [[reports-analytics]]; this software
uses **9 of its 40 endpoints**, all behind class-level `JwtAuthGuard`
(`analytics.controller.ts:46`).

| Endpoint | Controller | Used by |
|---|---|---|
| `GET /analytics/recommendations/:rid` | `analytics.controller.ts:682` | `Recommendations.tsx:195` |
| `POST /analytics/recommendations/:rid/action` | `:708` | `:262` |
| `POST /analytics/recommendations/:rid/bulk-action` | `:762` | `:401` |
| `GET /analytics/recommendations/:rid/actions` | `:811` | disposition merge |
| `GET /analytics/recommendations/:rid/history` | `:833` | `:217` |
| `GET /analytics/recommendations/:rid/digest` | `:848` | `:251` |
| `PUT /analytics/recommendations/:rid/digest` | `:856` | `:382` |
| `GET /analytics/insight-catalog` | `:214` | — |
| `GET /analytics/insight-catalog/types` | `:224` | `InsightCatalog.tsx:104` |

Behind them: `recommendations.service.ts` (417 lines) — a deterministic rule engine whose
own docblock states the contract, *"No LLM — every recommendation is auditable back to a
rule + a number"* (`:36-44`) — merged with `recommendation-actions.service.ts` (308
lines) for manager disposition, and `insights/insight-catalog.ts` for the candidate space.

**`one-tap-actions` and `ux-optimizer` are declared, not called.**

- `apps/api-gateway/src/one-tap-actions/` — `@Controller("one-tap-actions")` at
  `one-tap-actions.controller.ts:65`, 8 endpoints, guarded. Its only web callers are on
  [[dashboard-home]] and [[notifications]] via `OneTapActionCenter.tsx`. **Neither
  recommendations page references it** — grep for `one-tap` / `oneTap` in
  `Recommendations.tsx` and `InsightCatalog.tsx` returns no hits. It is the confirm
  primitive this software's "act" verb should share and does not.
- `apps/api-gateway/src/ux-optimizer/` — `@Controller("ux")` at
  `ux-optimizer.controller.ts:56`, 8 endpoints. **Dark by construction**:
  `UX_OPTIMIZER_ENABLED` defaults to `"false"` (`ux-optimizer.service.ts:78`) and the
  client half is gated on `VITE_UX_OPTIMIZER === "true"` (`lib/uxSignals.ts:15`). Neither
  recommendations page carries a `data-ux-key`, so nothing is emitted from here even with
  the flag on.

## §4 Automation

`none` acting on this software's behalf — no agent exists for it, and none should
(`services/agent-orchestrator/agents/` has no recommendations agent; the frontmatter's
`agents: []` is accurate).

Its inputs are refreshed by someone else's sweep:
`analytics/insights/insight-scheduler.service.ts:42` runs `@Cron(EVERY_HOUR)` across 10
categories, so the rule engine reads a feed that stays warm. The digest preference this
page sets (`PUT …/digest`) has no scheduled sender of its own — the cadence is stored,
and what consumes it is the scheduler above, not a digest job.

## §5 Data

From `recommendation-actions.service.ts`: `recommendation_actions` (`:81`),
`recommendation_digest_prefs` (`:243`). From `recommendations.service.ts`:
`recommendation_impressions` (`:411`). Everything else it renders is computed, not
stored — the cards themselves are derived per request from the analytics feed and the
insight catalogue, which is why there is no `recommendations` table.

Owned outright: `recommendation_actions`, `recommendation_digest_prefs`,
`recommendation_impressions`.

## §6 Owner

[[insight-narrative-generation-charter]] — team `insight-narrative-generation`,
department `analytics-bi`, division Intelligence
(`01-org/intelligence/analytics-bi/teams/insight-narrative-generation/`).

The cleanest ownership match in this cluster. The charter's boundary list names both
services by path and line count — *"`recommendations.service.ts` (417 lines) — **8
deterministic rules** and the served list"* and *"`recommendation-actions.service.ts` (308
lines) — act / dismiss / snooze / done / pin / assign / feedback"* (`:36-40`). Both counts
match this tree exactly.

Its mandate is this software stated as a question — *"is it worth saying?"* (`:17`) —
and it owns *"everything between a correct number and a manager doing something
differently … and the recommendation-action loop that measures whether any of it was
worth reading"* (`:19-22`). It also owns **the empty state**, and the `insufficient_data`
posture: *"At 11 restaurants the honest verdict on nearly every change is 'we cannot
tell.' A system that says so is more valuable than one that guesses"* (`:26-28`).

Not its: whether the arithmetic is right ([[analytics-engine-charter]]), whether a number
matches its published definition ([[metric-contract-truth-assurance-charter]]), or how
the card looks ([[design-charter]] / [[client-surfaces-charter]]).

## §7 Maturity & seams

**partial** — and both page notes' verdicts need correcting.

[[recommendations]] §10 and [[recommendations-catalog]] §10 both read **`broken`**, on one
finding each: every request was a raw `fetch` with no `Authorization` header against a
controller that has required a bearer token since 2026-08-24 (#31), so *"the page cannot
load a single card"* and the catalogue rendered "Couldn't load the catalog." The reasoning
was correct and thorough — header-only JWT strategy (`auth/strategies/jwt.strategy.ts:11`),
no cookie extractor, dev bypass unreachable without an `X-Dev-Bypass` header.

**Both were fixed in commit `58113e26` — the same commit that wrote the dossiers.** The
verdicts describe the pre-fix tree and were never revised (`git log` on both page notes
shows only frontmatter and index edits since). Verified against this working tree:

| Was | Now |
|---|---|
| Six raw `fetch` calls, no bearer token | `Recommendations.tsx:53` imports `apiClient`; all six call sites migrated (`:195,217,251,262,382,401`). The interceptor stamps `Authorization: Bearer` and `X-Restaurant-Id` (`services/api/client.ts:58-73`) |
| One raw `fetch`, no bearer token; failure swallowed by `.catch(() => {})` | `InsightCatalog.tsx:33` imports `apiClient`; the request is at `:103-104` and the failure branch is now real — `.catch((e) => setError(getErrorMessage(e)))` (`:116`) |

So the software loads and acts. What remains:

1. **The "act" verb does not use the confirm primitive.** `POST …/recommendations/:rid/action`
   records a disposition in `recommendation_actions`; it does not create a
   `one_tap_actions` row, so acting on a card is recorded as *a manager's disposition*,
   not as *an executed action with `executed_by` / `executed_at`*. The gate that
   [[action-safety-the-human-gate-charter]] owns runs on [[dashboard-home]]'s cards and
   not on these. Two act-loops, one product.
2. **Unreachable by navigation.** No sidebar entry (§2). A page that requires the command
   palette to find is, for most users, a page that does not exist. Undecided rather than
   accidental — no ADR records it either way.
3. **A stale headline number, still user-visible.** The catalogue page itself is honest —
   it renders `{catalog.total}` from the server's live `INSIGHT_CANDIDATES.length`
   (`InsightCatalog.tsx:265,278`; server `insights/insight-generator.service.ts:60` →
   `insight-catalog.ts:547`) with a coverage meter splitting computable-now from
   blocked-on-data. The hardcoded **375** survives in two command-palette entries the user
   reads before ever opening the page (`components/command/commands.ts:84,105`), against
   an enumerated space of 573. That is OD-33's discrepancy, still shipping.
4. **Two declared modules with no caller.** §3's `one-tap-actions` and `ux-optimizer` are
   in this software's taxonomy and in none of its code paths. `ux-optimizer` is
   deliberately dark and human-gated (memory `recommendations-actions-ux-optimizer`); it
   is listed because the self-learning UX loop is designed to close here, not because it
   does today.
5. **Coverage, not code, is the ceiling.** The rule engine is complete and auditable; what
   it can say is bounded by what data exists. `analytics.satisfiable_candidate_share` was
   38/573 on consumption-only data (`analytics-engine-charter.md`, measured 2026-08-24).

## §8 Where it's going

- ADR 0049 §3a puts pages `recommendations(-catalog)` under **Intelligence/Analytics**,
  phase **E2** — the 573/375/~19 reconciliation, the feedback loop, and the Ask AI merge
  (`.planning/04-specs/ECOSYSTEM-PLAN.md:58`). Two of the three E2 items are §7 items 3
  and 4.
- `one-tap-actions` and `ux-optimizer` sit in the **Restaurant** and **Platform/Admin**
  divisions respectively (`ECOSYSTEM-PLAN.md:54,59`), so unifying the act-loop is a
  cross-division change, not a local one.
- The sidebar question is a founder call and belongs in `OPEN-DECISIONS.md`; it is not
  there.
- Memory `recommendations-actions-ux-optimizer` carries what shipped in P0 (UX paths
  NEW-284–308, 434, 303) and the UX-optimizer foundation's human-gated constraint.
