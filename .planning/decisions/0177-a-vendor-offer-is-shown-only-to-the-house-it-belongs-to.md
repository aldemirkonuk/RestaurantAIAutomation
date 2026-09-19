# 0177 — A vendor offer is shown only to the house it belongs to

- **Status:** Proposed. **Locked in part.** The scope (the promotion reads under `/providers` answer only for the caller's house) was directed in the 2026-09-19 fix brief. **Not yet decided, and marked as assumptions below:** that a session naming no house is a 403, that a foreign provider id on `GET :id/promotions` answers an empty list, that no role is required for these reads, and that `intelligence/compare` is in scope.
- **Date:** 2026-09-19
- **Decider:** Aldemir (founder) for the scope; the assumptions await him.
- **Keywords:** provider_promotions, vendor offers, providers/promotions/active, tenant scope, cross-tenant, service-role, RLS, restaurant_id, houseOf, intelligence/compare
- **Links:** [[0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person]] (the rule), [[0171-a-conversation-id-opens-only-for-the-house-that-owns-it]] (the same fault and the same fix shape, `houseOf`), `v3.0-TECH-DEBT.md` 44.1w, claim `ADR-0177-PROMOTION-READS-HOUSE-SCOPED`

**Number:** 0177. The guard (`check_adr_numbers_unique.py`, 939 refs) offered 0173, but peer worktrees hold uncommitted 0172 (`agent-ab9a6212194829427`) and 0173-0176 (`comms-lane-adrs`), so this takes the first number past everything seen anywhere.
**Index row:** not added to `decisions/README.md`; that file is gate-owned (the ADR 0162 and 0171 precedent).

## Context

Verified 2026-09-19 on `origin/main` at `e066712bc`. `ProviderIntelligenceController` (`provider-intelligence.controller.ts`, class guard `JwtAuthGuard` only) served six routes that read `provider_promotions` with no `restaurant_id` clause, through `ProviderIntelligenceService`:

| Route | Service method | Shape |
|---|---|---|
| `GET /providers/promotions/active` | `getAllActivePromotions` | `.eq("is_active", true)` only, plus `providers(id, name)` embed |
| `GET /providers/promotions/expiring` | `getExpiringPromotions` | same, plus an `end_date` cutoff |
| `GET /providers/promotions/compare` | `comparePromotions` | same, grouped by `promo_type` |
| `GET /providers/promotions/savings` | `getPromoSavings` | every row with `savings_realized > 0`, plus vendor name |
| `GET /providers/:id/promotions` | `getPromotions` | filtered by the URL's provider id alone |
| `GET /providers/intelligence/compare` | `compareProviders` | every house's `providers` rows (name, reliability, tier, minimum order), each with a count of that vendor's active promotions |

`provider_promotions.restaurant_id` is `NOT NULL` (`supabase/migrations/20260805000000_baseline_from_production.sql:4808`, index `idx_pp_restaurant` at `:10305`). The gateway reads with the service-role client, which bypasses RLS, so the house had to be filtered in the query and was not. Any signed-in account of any house received every house's vendor offers and vendor names. Web callers on main: `apps/web/src/hooks/queries/usePromotionsQueries.ts:22` (legacy `Promotions.tsx`) and `apps/web/src/services/api/provider-intelligence.ts:137-158` (the providers intelligence panel). Both send the session token and neither passes a house, so the response shapes are unchanged by the fix.

The only prior mention of the fault was a code comment in the unmerged promotions lane (`wt-pg-promos`, `promotions.service.ts:25-32`). Nothing in `v3.0-TECH-DEBT.md` or `OPEN-DECISIONS.md` recorded it.

## Options considered

1. **A check in the controller only** (compare each row's house after the query). Leaves the service callable unscoped by the next caller, and filters after the rows are already read.
2. **The house as a required first argument on every service method, applied in the query** *(chosen)*. Forgetting the house is a compile error, and a missing value throws before any query is built. It is the shape ADR 0171 gave the conversations service.
3. **Row-level security.** The gateway's service-role key bypasses it, so it protects nothing here.
4. **A 404 for a foreign provider id on `GET :id/promotions`.** ADR 0147 answers a foreign row that is looked up by id with the same 404 as a missing one. This route is a list under a parent, and a house-filtered list under a foreign parent is indistinguishable from a vendor with no offers, which already leaks nothing. Rejected as extra machinery for no gain.

## Decision

1. **The token names the house, and every promotion read takes it as a required first argument.** `getPromotions`, `getAllActivePromotions`, `getExpiringPromotions`, `getPromoSavings`, `comparePromotions` and `compareProviders` call `requireHouse(restaurantId)` (throws before a query is built) and put `.eq("restaurant_id", restaurantId)` directly after `.select(...)` on every `provider_promotions` read. `compareProviders` does the same on its `providers` read, so a `providerIds` list naming another house's vendor returns nothing for it.
2. **The controller resolves the house with `houseOf(user)`**, the helper `ConversationsController` already uses (same message, same 403), before the `try` so the 403 is not rewritten into a 500.
3. **A session that names no house is a 403**, not an unfiltered query and not an empty list. A member removed from a house has `users.restaurant_id` cleared, so their next login names none.
4. **No role is required.** Reads answer for any member of the house, which is what they answered for before.

**Assumptions I made and the founder has not decided:**

- 403 for a no-house session (copied from ADR 0171).
- An empty list for a foreign provider id on `GET :id/promotions` (Option 4 above).
- `intelligence/compare` is in scope: it reads `provider_promotions` for its count and `providers` for the list, and it leaks the same vendor names.

## Named and not decided

- **The rest of this controller is unscoped in the same way, and one route is a write.** Read on `origin/main`, none of these takes a house: `GET :id/knowledge`, `GET :id/knowledge/contradictions`, `PUT :id/knowledge/:knowledgeId/verify` (an **update** by `knowledgeId` alone), `GET :id/conversation-memory`, `POST :id/conversation-memory/search` (returns vendor message text), `GET :id/sessions`, `GET :id/sessions/:sessionId/summary`, `GET :id/sentiment`, and `GET intelligence/leverage` (vendor names). `POST :id/outreach` and `POST :id/onboard` insert a session with the caller's house but never check the provider id belongs to it. These are the same class, more sensitive than the offers, and are **not fixed here** (one operation per branch). They need their own ADR and an OD allocation from the orchestrator, which this session did not take.
- **`GET promotions/savings` and `GET :id/promotions?status=` select or filter columns that the baseline does not define.** `savings_realized`, `times_used` and `status` are absent from `provider_promotions` in the baseline and in every migration after it. Not confirmed against the live database. If production matches the migrations, `/promotions/savings` already answers a 500 and the fix scopes a query that fails. The fixture in the spec carries the columns, so the spec proves the filter, not that the route works. A separate hollow-feature fault, not touched.
- **`houseOf` is now copied in two controllers.** A shared helper is the obvious follow-up; it is left out so this change does not touch the conversations controller (another lane).

## Consequences

- A house sees only its own vendor offers on all six routes. The web callers keep working unchanged for any session that names a house; one that names none now gets a 403 where it used to get everyone's offers.
- The six service methods have new signatures (`restaurantId` first). Their only callers are this controller's handlers; grepped repo-wide.
- Revisit if the founder answers the assumptions differently, or when the rest of the controller is scoped and `houseOf` is worth extracting.

## Review trail

| Date | Who | What |
|---|---|---|
| 2026-09-19 | Aldemir (founder) | Directed the scope in the fix brief |
| 2026-09-19 | Claude | Built it. Spec `promotions-reads-belong-to-the-callers-house.spec.ts`: 23 of 26 tests fail against the `origin/main` controller and service and all 26 pass after (three that pass before are the own-provider `GET :id/promotions` cases and the in-house status filter, which the provider id already isolated). Jest mutation on the real files killed 21 of 21 (one survivor, the promo count in `compareProviders`, was killed by an added test); the claim's static check, mutated on a scratch copy, killed 29 of 29. Details in `v3.0-TECH-DEBT.md` 44.1w. |
