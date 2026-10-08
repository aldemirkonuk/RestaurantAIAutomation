TITLE: fix(providers): refuse staff the vendor intelligence GET /promotions already refuses them

> **Coordinator's note, 2026-10-08T00:53Z (verify round).** New head `2124874da` (`2124874daa235d364ef6059e28ab7a2f91fc149c`): `e23d650ea` answers the verifier's two shoulds and three nits, then a clean `git merge --no-edit origin/main` at `62f8967b4`. 13 files against `origin/main`.
> - **Should 1, the outreach/onboard fork.** The body said outreach and onboard "serve a staff job" while the web change took away staff's only way to reach them (the Actions menu, `ProviderIntelligencePanel.tsx:35-44, 60-90` at `4c9452361`). Resolved by the decided rule, as the coordinator's reading under the founder's 2026-10-07T20:04:10Z delegation: **no locked rule puts those two routes behind a role.** ADR 0124:365 (origin/main) draws the gate "by what the route exposes", and they return `{success, message}` only (`provider-intelligence.controller.ts:396`, `:428`). ADR 0175 decisions 9-10 (`0175-one-tap-from-the-notification-is-staged.md:63-64`) gate four named vendor-send routes, and outreach is not one of them. ADR 0207:298 covers sentiment only. `git grep -n -i outreach origin/main -- .planning/decisions/` finds no ADR naming either route (the one provider hit, ADR 0147:52, is house scope). A gate must not narrow a feature no rule closed, so **staff's route is restored**: `ProviderIntelligencePanel` takes `learned` (default true; false mounts the header and Actions menu, no tab strip, no tab read), and `TwinSheet.tsx` mounts it for every role with `learned={readsTwin}`, keeping the heading for owners and managers. "Staff job" is dropped below.
> - **Should 2, tech-debt `:3` over-claim.** "The legacy vendor sheet panel made those calls for every role" is narrowed in place, with a dated bracket, to what it called: the twin (`:id/knowledge`, contradictions, verify), `:id/promotions` (mounted with `mode="provider"` only, `ProviderPromotionsPanel.tsx:37-58`) and the conversation memory, its search and the sessions.
> - **Nits.** The no-caller list is seven routes, not four (below). The controller cite is bracket-corrected. The base line is bracket-corrected. `ProvidersController`'s own `:id/intelligence` reads (`providers.controller.ts:739-806`, still `JwtAuthGuard` only) are named under "Not covered".
> - **Evidence at `2124874da`.** Gateway jest `src/providers src/auth/guards src/promotions`: 27 suites, 590 passed. Web vitest `src/components/providers src/pages/providers`: 15 files, 173 passed (+1 file, +2 tests: the new `ProviderIntelligencePanel.test.tsx`, and the staff case in `ProvidersNext.test.tsx` now also asserts the actions-only panel). tsc: gateway `tsconfig.json` and `tsconfig.spec.json` 2 errors each, web 1, all `@simplewebauthn`. `scripts/check_decision_claims.sh`: 944 checked, 944 holding. `lanecheck.sh wt-fix-promogate`: every check rc 0, files=13. `route-access.expected.json` still 217 rows after the merge. Mutations, each restored from a `cp -p` snapshot and confirmed with `cmp`: tab strip ungated (panel test 1 failed), `learned={true}` passed (ProvidersNext 1 failed), the panel unmounted for staff (1 failed); the amended CLAIMS row `PROMOGATE-TWIN-PANEL-OWNER-OR-MANAGER` killed 5 of 5 (`learned={true}`, tabs ungated, `readsMail` widened, heading ungated, `learned` defaulting false), comment-only control green.
> - **Still not done.** No browser or preview check of the sheet; web eslint cannot start (`eslint-plugin-jsx-a11y` missing). Not pushed, not audited.


**Branch:** `fix/promotions-gate-every-route`.
- Base: `origin/main` `a323cc80b`, which is still the tip of main at this writing. Head: `4c9452361`. 3 commits, 11 files against main. [Stale 2026-10-08: base `62f8967b4` (merged), head `2124874da`, 4 commits plus the merge, 13 files.]
- `git merge-tree` with `origin/main` is clean.
- Local only: not pushed, not audited.

## What was wrong for a real house

`GET /promotions` serves a house's vendor offers to owners and managers only. A staff account gets 403 (`promotions.controller.ts:63-64` at main, ADR 0124:357-362: what a vendor quoted this house is its negotiating position).

`ProviderIntelligenceController` (`apps/api-gateway/src/providers/provider-intelligence.controller.ts:71-73` [corrected 2026-10-08: those are head lines; at main the class decorator is `:53-54`]) carried `@UseGuards(JwtAuthGuard)` and nothing more. Its reads were scoped to the caller's house (ADR 0147) but not to a role. So in any house, a staff member's token could read:
- **The same `provider_promotions` rows**, through `GET /providers/promotions/active`, `/expiring`, `/compare`, `/savings` and `GET /providers/:id/promotions`.
- **The Digital Twin.** `provider_knowledge` holds `pricing/price_point`, `financial` and `relationship/leverage_signal` rows. The agent writes them as free-form JSON (`services/agent-orchestrator/agents/provider_conversation_agent.py:1573-1700`).
- **The vendor's sentiment trend.** ADR 0207:298, round 3: "owners and managers only, staff never see it".
- **The cross-vendor comparison and the leverage signals.**
- **The AI's conversation memory and negotiation sessions** with each vendor.

Staff did not need to know the routes. The vendor sheet's "What the platform has learned" panel called the twin, promotions and conversation reads for every role.

The money-policy refuter found this on 2026-10-07 (`refute:money.missed_surfaces`, M1 item 2). The rule is already decided: F7 of ADR 0253 r11 ("promotions and the quote book: by role") on PR #566 at `de4e8cade`, which is unmerged, and on main ADR 0124:357-362 and ADR 0207:298. It was already named as open at `.planning/tech-debt.d/2026-09-28-fix-websocket-role-gate.md:41`.

## What changed

**Gateway (`provider-intelligence.controller.ts`).** Fifteen of the controller's seventeen handlers now carry the `GET /promotions` gate on the method: `@UseGuards(RolesGuard)` + `@Roles("owner", "manager")`.
- It is the same guard and decorator `promotions.controller.ts:66-67` uses (`:63-64` at main), with ADR 0164's exact match (an `admin` token is refused, as on `/promotions`).
- The class keeps `JwtAuthGuard` alone, so the two open handlers inherit no role gate.
- The guard refuses before the handler runs. The service, and the house check `assertProviderInHouse`, are never called for a refused caller.
- **A staff caller gets 403 with the house's usual sentence**, `{"message":"Forbidden resource","error":"Forbidden","statusCode":403}`. The spec compares the bytes with what `GET /promotions` answers the same staff caller in the same app.

| Route | Before | After |
|---|---|---|
| `GET /providers/:id/knowledge` | any member of the house | owner, manager |
| `GET /providers/:id/knowledge/contradictions` | any member | owner, manager |
| `PUT /providers/:id/knowledge/:knowledgeId/verify` | any member | owner, manager |
| `GET /providers/:id/promotions` | any member | owner, manager |
| `GET /providers/promotions/active` | any member | owner, manager |
| `GET /providers/promotions/expiring` | any member | owner, manager |
| `GET /providers/promotions/compare` | any member | owner, manager |
| `GET /providers/promotions/savings` | any member | owner, manager |
| `GET /providers/:id/conversation-memory` | any member | owner, manager |
| `POST /providers/:id/conversation-memory/search` | any member | owner, manager |
| `GET /providers/:id/sessions` | any member | owner, manager |
| `GET /providers/:id/sessions/:sessionId/summary` | any member | owner, manager |
| `GET /providers/:id/sentiment` | any member | owner, manager |
| `GET /providers/intelligence/compare` | any member | owner, manager |
| `GET /providers/intelligence/leverage` | any member | owner, manager |
| `POST /providers/:id/outreach` | any member | **unchanged: any member** |
| `POST /providers/:id/onboard` | any member | **unchanged: any member** |

**Left open, and why.** Outreach and onboard start a conversation with a vendor [corrected 2026-10-08: "serve a staff job" removed, it was never checked]. They return `{success, message}` and no figure, and no locked rule gates them by role (ADR 0124:365 draws the gate by what a route exposes). Who may start one is a send-authority question, and ADR 0175 D9/D10 answer it: a grant is a row, not a token role. A role gate here would be the wrong rule. The branch does not answer whether a staff member *without* a grant may start one (see "Not covered").

**Web (`apps/web/src/pages/providers/next/TwinSheet.tsx`).** The "What the platform has learned" section mounts for owners and managers only. [Corrected 2026-10-08: the heading and the panel's tabs are owner/manager; the panel itself mounts for every role with `learned={readsTwin}`, so staff keep the Actions menu (outreach, onboarding) and get no tab and no tab read. `ProviderIntelligencePanel.tsx` gains the `learned` prop.]
- `readsTwin` is defined as `readsMail`, the sheet's existing owner/manager check for "How their mail reads" (ADR 0207 round 3), so the two cannot drift.
- The panel swallows errors. Mounted for staff, its tabs would print "nothing learned" over three 403s, which is false.
- The vendor's record, terms, contacts, branches and ledger card still render for every role.

**Census.**
- `route-access.expected.json` gains the controller's 17 rows: 15 `["owner","manager"]` and 2 `"open"`. It goes from 200 to 217 rows, with 0 removed and 0 changed against `a323cc80b`.
- `route-access.spec.ts` lists the controller among those that carry `@Roles(`.
- CLAIMS row `ADR-0164-ROLES-EXACT-MANAGERS-KEPT` pins `len(fx)==200`. It is amended in place to 217 with a dated bracket, which is a pure addition.
- `promotions.controller.ts`'s comment naming this side door as open gets a dated closing bracket. No code changes there.

**Coordinator's calls under the founder's 2026-10-07T20:04:10Z delegation.** Each applies a rule already decided and changes no decided feature. They are recorded with their reasoning in `.planning/tech-debt.d/2026-10-07-fix-promotions-gate-every-route.md`:
1. **The twin is gated, though M1 did not name it.** Its price points and leverage rows are free-form JSON, so no field list strips them reliably. Gating only `intelligence/leverage` would have left `?category=relationship` open on the knowledge route. Verifying a price fact is a money write.
2. **Conversation memory, search, sessions and summaries are gated.** They carry the AI's extracted entities (including price changes) and the negotiation intents. F13 ("mail kept, AI summaries neutral") governs the house's mail surfaces, which this branch does not touch.
3. **Outreach and onboard stay open** (ADR 0175, as above).
4. **The web panel mounts for owner/manager only.** As a result, staff also lose the panel's Actions menu (outreach, onboarding) in the UI, though those routes still answer them. [Superseded 2026-10-08: the tabs mount for owner/manager only and the Actions menu for every role; see the coordinator's note at the top.]

## Evidence

Each line names the command and its result at head `4c9452361`. [Re-measured at `2124874da` in the coordinator's note at the top.]
- **Gateway jest:** `cd apps/api-gateway && env LC_ALL=C npx jest src/providers src/auth/guards src/promotions` gives **27 suites, 590 tests passed**. The baseline before the change was 26 suites, 509 tests.
  - The new `provider-intelligence-roles.http.spec.ts` has 81 tests. It runs a real Nest app with the real controller, the real `RolesGuard`, the real `@Roles` metadata and one fixture house. Only `JwtAuthGuard` is stubbed, and it sets `req.user.role` from a header.
  - For each of the 15 routes: staff, a role-less session and `admin` get 403, and neither the service nor the house check is called. Owner and manager get 200 (201 for POST), and the service is called once with this house.
  - Staff get the same 403 body from `/providers/promotions/active` as from `/promotions`.
  - Outreach and onboard still answer staff with 201, reaching the house check and the insert.
  - Metadata: the class is `JwtAuthGuard` alone, the 15 have `RolesGuard` and `["owner","manager"]`, and the 2 open handlers have neither.
- **Web vitest:** `cd apps/web && npx vitest run src/pages/providers` gives **14 files, 171 tests passed**. [At `2124874da`, with `src/components/providers` added: 15 files, 173 passed.]
  - The new test in `ProvidersNext.test.tsx` checks owner and manager see the twin panel.
  - For staff and a null role, it waits for the ledger card, then checks that neither the panel nor its heading is in the document. [2026-10-08: and that the actions-only panel is.]
- **Mutations.** Each was reverted, run red, then restored byte-identical from a `cp -p` snapshot and confirmed with `cmp`.
  - All 15 gates removed: 49 failed.
  - Only `promotions/active` ungated: 6 failed.
  - Outreach gated: 3 failed.
  - Web `readsTwin` forced true: 1 failed.
- **CLAIMS (`.planning/decisions/claims.d/fix-promotions-gate-every-route.jsonl`).** Two rows, both `resolved`, both static python/grep checks.
  - `PROMOGATE-PROVIDER-INTEL-OWNER-OR-MANAGER` killed 6 of 6 mutations: one route ungated, `@Roles` dropped alone, outreach gated, a class-level `RolesGuard`, the gate commented out, and one fixture row reopened. Its comment-only control stayed green.
  - `PROMOGATE-TWIN-PANEL-OWNER-OR-MANAGER` killed 3 of 3: `readsTwin` true, the wrapper removed, `readsMail` widened. Its control stayed green. [Amended 2026-10-08 to the `learned` shape: 5 of 5, control green.]
  - The amended row 582 holds, and it fails (rc 1) with one providers row dropped from the fixture.
  - The other claim rows that read these files still hold: 387, 388, 400, 447, 549, 562, 567, 654-657, 669, 711 and `feat-tables:5`. Row 620, which is `open`, still does not hold.
  - `scripts/check_decision_claims.sh` was not run, by instruction; the coordinator runs it. [Run 2026-10-08 at `2124874da`: 944 checked, 944 holding.]
- **tsc.**
  - Gateway `tsconfig.json` and `tsconfig.spec.json`: only the known `@simplewebauthn/server` errors.
  - Web: only the known `@simplewebauthn/browser` error.
- **eslint.** The gateway's four touched files are clean (`--quiet`, rc 0).

## Overlaps with open PRs

- **#564** edits other rows of `route-access.expected.json`: the analytics goal routes move from `"open"` to owner/manager. It adds no keys, so the 217 count holds after both land. `git merge-tree` resolves the hunks separately.
- **#626, #614, #569 and #561** touch `.planning/decisions/CLAIMS.jsonl`. None touches row `ADR-0164-ROLES-EXACT-MANAGERS-KEPT`. Any later PR that adds or removes a `route-access.expected.json` key must move that row's `len(fx)` again.
- **#579** (paused, local only) keeps `dashboard.service.ts`'s same query at `:319`. This branch does not touch that file.

## Not covered

- **Web eslint was not run.** It cannot start in this repo: `eslint-plugin-jsx-a11y` is missing, a known repo-wide gap. The two web files are checked by vitest and tsc only. [Four web files at `2124874da`, same checks.]
- **No live browser or preview check** of the vendor sheet. The mount rule is proven by the vitest test, not by a screenshot. [Still true at `2124874da`, including the actions-only panel for staff.]
- **Outreach and onboarding check no grant and no role.** Whether a staff member without a live grant may start a vendor conversation is ADR 0175's question, and this branch leaves it open.
- **`GET /providers/promotions/savings` still reads columns that exist in no migration** (OD-158). This branch gates the route; it does not fix it.
- **Staff no longer see the twin's non-money categories** (`company`, `people`, `logistics`, `compliance`). Serving those back needs the M2 money helper with allowlist DTOs, which does not exist yet.
- **ADR 0253 is unmerged** (PR #566). This branch cites its F7 as the rule's latest statement. The gate stands on ADR 0124:357-362 and ADR 0207:298, which are on main.
- **No caller is mounted** for sentiment, `promotions/compare`, `intelligence/compare` or `intelligence/leverage` (`ProviderComparisonView.tsx` and `useActivePromotions` are mounted nowhere). Those four routes are closed at the gateway only. [Corrected 2026-10-08: seven, not four. `promotions/active`, `/expiring` and `/savings` have no mounted caller either; they run only in `ProviderPromotionsPanel`'s `mode="dashboard"` (`ProviderPromotionsPanel.tsx:43-58`), which nothing mounts.]
- **`ProvidersController`'s own intelligence door is not covered.** `GET /providers/:id/intelligence`, `GET /providers/:id/intelligence/summary` and `PATCH /providers/:id/intelligence` (`providers.controller.ts:739-806`) are still `JwtAuthGuard` only and return `profile_dynamic` (negotiation style, relationship tier; `providers.service.ts:1010-1042`, `:1079-1095`). M1 does not name them; "provider intelligence reads are owner or manager" covers `provider-intelligence.controller.ts` only. [Added 2026-10-08.]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
