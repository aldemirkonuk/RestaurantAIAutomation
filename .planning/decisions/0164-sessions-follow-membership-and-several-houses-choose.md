# 0164 — Sessions follow membership, and a person with several houses chooses one

- **Status:** Locked 2026-09-18/19 for the four answers below, and **locked 2026-09-19** for the five build parameters under "Forks carried" (F1–F5: where the device keeps its memory, the seven-day window, the one-house-left case, the chooser's drawing, and the organisation role a house grant writes) — all founder answers, quoted verbatim (`founder-sketch-decisions-106-115.md`, "Sessions (ADR 0164) answers 2026-09-19"). F1, F2, F3 and F5 confirm the defaults already built to the research's recommendation; F4 (sketch 118 = Direction B, the endpaper) is a new answer, not yet wired into `/choose-house` — see "Forks carried" below for the citation and the named follow-up.
- **Date:** 2026-09-18
- **Decider:** Aldemir (founder)
- **Keywords:** session, membership only, sign-in, house choice, chooser, choose-house, last used house, return window, refresh, HOUSE_ACCESS_ENDED, HOUSE_REQUIRED, AllowsNoHouse, switchRestaurant, organisation fallback, RolesGuard, owner-or-manager, keep managers in, createLocation, organisation owner, organization_members, users.role, users.restaurant_id, 44.1r, 44.1s, 44.1t, 44.1u, 44.1o
- **Links:** [[0162-managers-grant-manager-or-staff-on-both-doors]] (fourth addendum: where answers 1 and 2 were first recorded), claim `ADR-0019` in `CLAIMS.jsonl` (exactly one `@AllowsTenantChange` route; unchanged), `v3.0-TECH-DEBT.md` 44.1i, 44.1j, 44.1o, 44.1q–44.1u, PR #393 (merged `cb756083e`) and its merge audit's seven carried notes, sketch 118 (`wt-finish/.planning/sketches/118-login-flyleaf/`, uncommitted there; built as Direction B on `feat/login-flyleaf-endpaper`, commit `8bfa353a4`, merged `main` as PR #397 / `1fba79f57` 2026-09-19), ADR 0143:36 and ADR 0149 row 35 (`:117`, F4's citation), CLAIMS row `ADR-0164-ORG-OWNERS-ACTIVE-HOUSE` (OD-131(a))

**Index row:** not added to `decisions/README.md` here. That file is gate-owned.

**Number:** 0164, from `python3 scripts/check_adr_numbers_unique.py` ("Next free number, swept across 891 refs: 0164"), run 2026-09-18 in `wt-sessions`. That guard sees refs only, not peers' uncommitted worktrees.

## Context

PR #393 made `req.user.role` the role in the token's house and made leaving clear `users.restaurant_id`. Its merge audit carried four holes forward (v3.0-TECH-DEBT 44.1r–44.1t, plus note 2's `createLocation` authority), all older than or beside its diff:

- **Sessions outlived membership (44.1r).** `refreshAccessToken` re-minted `payload.restaurantId ?? users.restaurant_id` with no membership check (`auth.service.ts:399` on `cb756083e`), `JwtStrategy.validate` admitted a token whose house gave no role, and `switchRestaurant`'s organisation fallback (`:474-513`) opened any house of the person's organisation with no row there. Production, read-only 2026-09-19: 7 such person-house pairs, all 3 simulation accounts, 0 real people; by an edge-log fingerprint unique to that fallback it served 2 sessions, both the Sim Bistro owner, on 2026-09-03.
- **"Owner only" admitted managers (44.1s).** `RolesGuard` let `owner`, `manager` and `admin` through any route naming owner or manager (`roles.guard.ts:29-38`), so ten `@Roles("owner")` routes admitted managers.
- **A session with no house carried the account-wide role (44.1t).** `JwtStrategy` gave a token with no house `users.role` and the `users` row's house (`jwt.strategy.ts:30-31`, `:62-64`).
- **Any organisation member could open a location and own it** (audit note 2; filed here as 44.1u). `createLocation` checked only that an `organization_members` row existed (`organizations.service.ts:575-578`).

And the web had no house step at all: after a fresh sign-in it showed `branches[0]` of an unordered organisation listing while the token named `users.restaurant_id`, and a failed switch relabelled the page anyway, "proceeding with X-Restaurant-Id header only", a header the gateway reads nowhere (`AuthContext.tsx:377-385`, `:510-521`).

Production, re-measured read-only for this record (Supabase MCP, SELECT only, 2026-09-18): 8 accounts; active memberships 0 → 0 people, 1 → 4, 2 or more → 4; 0 `users` rows naming a house without an active row there; no `admin` role in `users`, `user_restaurant_access` or `organization_members`; 5 organisation-owner rows (`organization_members.role = 'owner'`) against 4 `organizations.owner_id`; every organisation row's role equals its holder's `users.role`; latest migration `20260918153000`.

## Options considered

The exact option text shown in each `AskUserQuestion` prompt is not in this worktree's records. What follows is what each answer chose between, reconstructed from ADR 0162's fourth addendum, the code map and the research note, and marked as such.

1. **Sessions (44.1r).** (a) *Membership only*: an active access row is the only thing that opens a house. (b) Keep organisation membership as a way in: the fallback stays, any house of the organisation opens. (c) Do nothing: a removed person keeps their session until the refresh token lapses (7 days). **Chosen: (a), "Membership only"** (the offered recommendation, per ADR 0162's fourth addendum). (b) was rejected because it is the switcher's and the fallback's current behaviour, and it is what let the Sim Bistro owner into a memberless house. (c) costs up to seven days of access after removal.
2. **"Owner only" (44.1s).** (a) *Keep managers in*: today's access stays and the ten routes say owner-or-manager. (b) Make them owner-only: managers lose scrapes, sweeps and the price-index reopen seal. **Chosen: (a), "Keep managers in"**, so the code says what it does and no one loses access.
3. **Sign-in with several houses (44.1t and the house step).** The founder's own words: *"think bigger picture, if they own couple houses what we do, in sign-in? we let them choose which"* and *"be SOTA, after quite some time let them choose which restaurant to go"*. Alternatives at stake (research §2): always reopen the last house (Linear, Xero), always ask (Shopify, Auth0), or reset `users.role` on leave (the fourth addendum's first remedy for 44.1t). **Chosen:** 0 memberships, no house and no role; 1, that house; 2 or more, the person chooses, except that someone returning within a recent window goes straight to the house they used last, and after "quite some time" they choose again. `users.role` stops mattering for anyone with a house. The reset remedy was not needed: a session in no house now carries no role.
4. **Opening a location.** (a) *Organisation owners only*, and they become its owner. (b) Any organisation member (today). (c) Any owner or manager of a house in the organisation. **Chosen: (a), "Organisation owners only".**

## Decision

**A session is in a house only while the person holds an active membership row there, it carries the role that row gives and no other, and a person with several houses picks theirs at sign-in unless this device used one of them within seven days.** Built in `fix/sessions-follow-membership` on `cb756083e`:

- **Every mint is membership-checked in one place.** `generateTokens` now takes the house explicitly and names it only where an active `user_restaurant_access` row exists; the role claim is that row's role, otherwise null (`auth.service.ts`, `generateTokens`). Sign-in (password, Google, Microsoft, dev bypass), refresh, switch, register, join and verify-email all go through it.
- **The next request is refused.** `validateJwtPayload` answers 401 `{ code: "HOUSE_ACCESS_ENDED", restaurantId }` for a token naming a house with no active row; a failed read stays 503. The `users`-row fallback in `roleInHouse` is retired (the seventh site of 44.1i; its precondition held).
- **Refresh signs the person out of that house, not out of Mudavym.** It returns a pair naming no house and `houseAccessEnded: { restaurantId }`; it never moves them to another house, even with one left. A bad refresh token is still 401; a failed read is now 503, not a sign-out.
- **The organisation fallback opens nothing.** `switchRestaurant` mints only through `generateTokens`; a non-member gets 403 `NOT_A_MEMBER`.
- **A session in no house has no house and no role, and reaches almost nothing (R4).** `JwtStrategy` no longer substitutes `users.restaurant_id` or `users.role`. `JwtAuthGuard` refuses 403 `HOUSE_REQUIRED` on every route not marked `@AllowsNoHouse()`: 13 `AuthController` routes (me, houses, switch, logout, invite accept, own account, verify) and `GET /organizations/branches`, pinned in `no-house-session.spec.ts`. `assertTenantMatch` lets a tenantless session name a house in the BODY of the one `@AllowsTenantChange` route, so choosing works; path and query stay refused.
- **The sign-in rule (R1).** `house-choice.ts`: `signInHouse(memberships, hint, now)`; `HOUSE_RETURN_WINDOW_MS` = 7 days, its own constant. Sign-in bodies may carry `lastHouses: [{ userId, houseId, usedAt }]`; the server reads only the authenticated person's newest entry and checks it against memberships. When a choice is needed the response carries `chooseHouse: { houses: [{ id, name, city }] }` and a pair naming no house; the client chooses through `POST /auth/switch-restaurant`. `GET /auth/houses` lists the person's memberships for the chooser.
- **`/auth/me` reports the session's house and the role there**, null for both in no house, so the web's and the phone's ~15 readers of `user.role` read the house role without changing.
- **The switcher lists memberships only** (`getBranchesForUser`), not every house of the organisation.
- **`RolesGuard` is exact** and the ten `@Roles("owner")` routes say `@Roles("owner", "manager")`. `admin` is no longer widened to (no one holds it). `route-access.spec.ts` compares every guarded route's admitted roles, measured through the real guard and metadata, with the table measured on `cb756083e`, less `admin`, plus the one new route. The web's `ProtectedRoute` mirror is exact too; its three owner pages say `['owner', 'manager']`.
- **Organisation owners only.** `createLocation` reads `organization_members` (error → 503) and refuses 403 `NOT_ORGANISATION_OWNER` unless the caller's row in the target organisation says `owner`; with a group named, the group's organisation is the target and must be owned. The creator still becomes the house's owner.
- **The web** stores sessions through one helper (`lib/houseMemory.ts`) that keeps `activeRestaurantId` equal to the TOKEN's house, remembers the house per person on the device, sends the hints at sign-in, and on `houseAccessEnded` forgets that house, notes it and opens `/choose-house`, the new chooser ("Which house today?", "Signed in as …", one row per house, this device's last first and marked "Last opened here", search above 8, "Not you? Sign out", and "Your access to {house} has ended." when that is why they are there). A refused switch returns false and relabels nothing. `ProtectedRoute` sends a session in no house to the chooser; the chooser sends someone with no houses to `/no-access`. Accepting an invitation now switches into the house joined.
- **The phone** handles it minimally rather than the API defaulting for it (the research's R1: the server decides, both clients behave the same). `signIn` sends the phone's memory from SecureStore; a session in no house goes from the Today tab to a new `choose-house` screen; `houseAccessEnded` on refresh forgets the house and re-reads `/auth/me`. A phone build older than this one still signs a two-house person in, lands them in no house, and shows `/no-access` until updated; no house is opened wrongly by it.

## Forks carried (built to the research's recommendation; the founder's call — answered 2026-09-19)

- **F1 · Where "last used" lives: per device (built) or per account.** Per device fits hardware that belongs to one house and avoids Xero's documented failure (a customer "on another clients business dashboard" for a split second); per account follows a person from phone to PC. The question for him: *"If you opened Moda on your phone this morning, should the Kadıköy office PC open Moda?"* Switching to per account needs a column and a write at sign-in. **Locked 2026-09-19** — the founder (`AskUserQuestion`, `founder-sketch-decisions-106-115.md`): **"Per device (Recommended)."** The built default stands; nothing to change.
- **F2 · How long "quite some time" is: 7 days (built), 14 or 1.** Seven matches a restaurant's week and the 7-day refresh lifetime, so a session that lapsed from disuse always chooses. One constant changes it. **Locked 2026-09-19** — the founder (`AskUserQuestion`): **"7 days (Recommended)."** The built constant stands.
- **F3 · Access removed with one house left: the chooser (built) or move them automatically.** Built as the research recommends: a silent move mid-service would put the next order into a house they did not pick. **Locked 2026-09-19** — the founder (`AskUserQuestion`): **"Show the chooser (Recommended)."** The built behaviour stands.
- **F4 · The chooser's drawing.** Sketch 118 draws no chooser frame and has no winning direction. The page reuses the sign-in page's shell and its public-door switch (`usePublicDesign`), so it wears whatever the sign-in page wears; a drawn frame is owed. **Locked 2026-09-19** — the founder: sketch 118 = **Direction B, the endpaper**. Commit `8bfa353a4` on `feat/login-flyleaf-endpaper` ("feat(auth): /login and /register open on the endpaper — sketch 118 Direction B") brackets **ADR 0143:36** and **ADR 0149 row 35** (`:117`) with "2026-09-19: sketch 118 = B, the endpaper (the founder's answer, over the README's recommended A)"; merged to `main` as PR #397 (`1fba79f57`, 2026-09-19 14:32Z). `/choose-house` should mount inside `EndpaperShell` going forward, the same way it already carries the `usePublicDesign` switch. **Not built here** — `EndpaperShell` lives on `feat/login-flyleaf-endpaper`, not this branch. **Follow-up, named and deferred:** `EndpaperShell` is on `origin/main` (it merged there in PR #397, above) but not on this branch's own base — `git merge-base fix/sessions-follow-membership origin/main` is `cb756083e`, the commit this branch was cut from, and `origin/main` is 10 commits ahead of it (measured 2026-09-21, re-measure rather than trust this number). This is not "once that branch lands" — it already landed — it is "once this branch is rebased onto `origin/main`." Once rebased, `ChooseHouse.tsx` should wrap its form as `usePublicDesign() ? <EndpaperShell> : <AuthShell><AuthCard>`, matching that commit's own description; this lane cannot build it today without a component that does not exist on its own base.
- **F5 · The organisation role a house grant writes.** Once "Organisation owners only" made `organization_members.role` decide, the three grant doors that upserted it with the HOUSE role (invite accept, join, `addMember`; 44.1o) would both strip an organisation owner who accepted a staff invite and crown anyone invited as a house owner. Built: a grant never changes an existing organisation row (insert only), and a new row is never `owner` (a house owner or manager becomes an organisation `manager`, staff stays `staff`). No production row changes by it (every organisation role equals its holder's `users.role`, 5 owners are the 4 founders and the simulation owner). **Locked 2026-09-19** — the founder (`AskUserQuestion`): **"Never via a house (Recommended)."** This closes the question the original text left open (whether a person invited as the owner of one house should be able to open new houses in its organisation): no — a house grant never makes anyone an organisation owner. The built default already matches.

## Consequences

- A removed person is out of that house on their next request (at most one request later, not up to seven days), and no route answers a session in a house it has no row in.
- Four accounts see the chooser when their device has not used one of their houses within a week; four go straight in.
- Three organisation members who are not organisation owners lose `POST /organizations/locations`: the YAREN manager, the Sim Bistro manager and the Sim Bistro staff account. Every location in production was opened by its organisation's owner. Three houses sit in organisations with no owner row at all (the memberless legacy organisations); nobody can open a location in those.
- A 503 from refresh now keeps the session on both web clients instead of signing the person out.
- Deploy order matters for one window: the web (Vercel) and the gateway (Railway) ship separately, and a web bundle older than this change, against the new gateway, lets a person with several houses sign in to a session in no house and then shows them a page whose every request answers 403 `HOUSE_REQUIRED`, until they reload onto the new bundle. Existing sessions are unaffected (every production token names a house the person is a member of).
- Seen, not only tested: the chooser was rendered in the browser pane against a throwaway mock of the four routes it calls, at 800px and 375px on the charcoal ground (redirect from a protected page, the ended-house sentence, the last-opened row, one tap into the house and the device memory updated). The paper ground was not captured.
- Harder: any new route a session in no house must reach needs `@AllowsNoHouse()` and an edit to `no-house-session.spec.ts`; any new route in a `@Roles` controller needs a row in `route-access.expected.json`.
- Not done here, stated: the refresh token still survives logout for seven days (code map finding 3); the dead `register` call in `AuthContext` still posts to the 410 route; `getUserOrgIdsWithFallback`'s `'member'` repair still violates the CHECK and fails silently (dormant: every user has an organisation row); `createChain`/`renameChain`/`deleteChain` still admit any organisation member (measured, not fixed — "Open items for the founder (b)" below, OD-131); the Settings "Add a location" button is not hidden from non-owners (they now get a 403 whose message the dialog prints, per `locationDialogFailures.test.tsx`; not checked in a browser). The Python services decode tokens themselves and were not checked for a null `restaurantId`.
- Revisit when: `fix/sessions-follow-membership` is rebased onto `origin/main` — `EndpaperShell` already merged there via PR #397, this branch's base (`cb756083e`) simply predates it — and `ChooseHouse.tsx` needs its `EndpaperShell` wrapper (F4's named follow-up above); a person with more than 8 houses appears (search is built, untested on real data); a second client starts minting sessions outside `generateTokens`.

## 2026-09-19 round — what closed

Hardening work on the four ANSWERS this file already had recorded as locked
(verbatim, in the Review trail) — not on the five forks under "Forks
carried," which this round left exactly as it found them (they are answered
and locked in a later round; see the Review trail's round-4 row and "Forks
carried" above).

**Closed, each with a test shown failing before the fix and passing after:**

1. **HIGH — websocket rooms did not check membership.**
   `handleSubscribeRestaurant` refused a mismatched `restaurantId` but not a
   *missing* one (`if (metadata.restaurantId && …)` skips the check entirely
   when the token names no house), and `handleConnection` never checked the
   token's claimed house against a live row at all. Fixed:
   `WebsocketGateway.isActiveMember` checks at connect (a failed read refuses
   the house, never admits it, and never drops the personal `user:{id}`
   room); the subscribe guard now refuses whenever `!metadata.restaurantId`;
   a new `evictFromHouse(userId, restaurantId)` takes a person's sockets out
   of a room the moment their membership ends, wired into all three removal
   paths (`MembersService.removeMember`, `TeamService.deleteMember`,
   `AuthService.leaveRestaurant`, via `@Optional() @Inject(forwardRef(...))`
   — `WebsocketModule` added to `AuthModule`/`RestaurantsModule`/`TeamModule`
   imports, also `forwardRef`); the web's `subscriptionsRef` (`lib/websocket.tsx`)
   is cleared outright on every transition away from the active house, not
   trimmed one id at a time. `websocket.gateway.spec.ts` (new, 5 cases);
   `check_gateway_boots.sh` passes, confirming the DI graph actually resolves
   (jest builds its own narrow test module and cannot see this).
2. **MEDIUM — three independent refresh implementations, one of them missing
   HOUSE_ACCESS_ENDED and the 503 fix entirely.** `authStore.ts`'s `loadUser`
   had its own inline refresh, and treated ANY non-401 error from `/auth/me`
   (a 503, a dropped connection) as a sign-out — the exact failure
   `AuthContext.tsx`'s own `/auth/me` load had already been fixed for. This
   record's own Consequences line above claiming the 503 fix landed "on both
   web clients" was true of one. New `lib/sessionRefresh.ts` is now the one
   `doRefresh`, genuinely single-flight (the old `refreshPromise` dedup only
   ever covered the axios interceptor's own repeat callers, not a concurrent
   refresh from `authStore`); `AuthContext.tsx`'s interceptor, its
   `refreshTokenFn`, and `authStore.ts`'s `loadUser` all call it now. Callers
   tell a genuine sign-out apart from a kept session (houseAccessEnded, or a
   503) by checking whether `doRefresh` actually removed the stored refresh
   token, rather than re-deriving the HTTP status logic themselves.
   `sessionRefresh.test.ts` (new) + `authStore.test.ts` (new, 6 cases) +
   `AuthContext.houses.test.tsx` (existing, kept green — one fixture updated
   for item 8 below).
3. Folded into (2) above — same fix, same evidence.
4. **NOT DONE.** The scenario harness's `--apply` gap
   (`scripts/simulate/cli.py:452-465`, `scenario_apply.py:112-131`) was not
   touched this round — ran out of round for it. Still open.
5. **LOW — an invite outlived its issuer's standing.** `acceptInviteAsExistingUser`
   never re-checked the issuer after minting; a removed or demoted issuer's
   invite still granted exactly what it said. New `cancel-house-invites.ts`
   (`cancelPendingInvitesFrom`) expires (not a new column — the existing
   `expires_at`) an issuer's pending invites for a house the moment their own
   membership there ends, called from all three removal paths above.
   `acceptInviteAsExistingUser` also re-reads the issuer's CURRENT active
   membership and re-runs `grantRefusal` against the invite's role at
   acceptance, as a backstop for demotion (not a removal) and any race.
   `invite-issuer-must-still-stand.spec.ts` (new, 9 cases). Fixing this
   surfaced a real regression: `org-role-not-overwritten.spec.ts`'s two
   invite fixtures had no `invited_by` (never mattered before this check
   existed) — corrected to name a real issuer with standing, not worked
   around.
6. **LOW — the phone's device memory went stale between sign-ins.** Neither
   `hydrate()` nor `refreshAccessToken()` in `apps/mobile/src/state/session.ts`
   touched the remembered house's `usedAt`, only `signIn`/`adoptTokens` did.
   Both now call `rememberSessionHouse`. **Not covered by an automated
   test** — `apps/mobile`'s jest config deliberately excludes modules with
   native imports (`expo-secure-store`, `expo-constants`, `react-native`),
   by its own header comment, and `session.ts` touches all three; building
   that mocking harness was judged disproportionate to a LOW item within
   this round. Verified by reading and by `tsc --noEmit` (clean for
   `session.ts` itself — the mobile typecheck run surfaced ~498 PRE-EXISTING
   errors, all in `__tests__` files missing jest type globals, none in any
   file this round touched; a real but unrelated gap, stated here rather
   than either silently ignored or wrongly pinned on this work).
7. **LOW — coverage: two mutants now killed, static and live.**
   `create-location-owners-only.spec.ts` seeded `organization_members` with
   only the caller's own rows in every existing case, so a mutant dropping
   `.eq("user_id", userId)` from `createLocation`'s owner read changed
   nothing observable (V7); `sessions-follow-membership.spec.ts`'s `world()`
   fixture only ever seeds `is_active: true`, so the same was true of
   `memberHouses`' and `generateTokens`' own `is_active` filters (V1). Three
   new cases seed a foreign owner row / an inactive row directly and were
   run against each mutant by hand — red with the filter removed, green
   restored, and each is the *only* case that moves. New CLAIMS row
   `ADR-0164-ORG-OWNERS-USER-FILTER` pins V7 statically (added rather than
   risking the existing giant `ADR-0164-ORG-OWNERS-OPEN-LOCATIONS` regex);
   V1 has jest coverage only, no new static claim (time).
8. **Privacy — every remembered account rode along in each sign-in.**
   `lastHouseHints()` sent this device's WHOLE memory (every person who had
   ever signed in on it, up to 20) with every login/OAuth call, because the
   device did not know which one was signing in until the server answered.
   New email→userId index in `houseMemory.ts` (`indexEmail`,
   `lastHouseHintFor`), keyed by a non-cryptographic hash of the normalised
   email (never the address itself) — populated from the token's OWN
   `email` claim inside `storeSession`, so no call site needed to start
   threading plaintext emails through refresh/switch. `login` uses the typed
   email directly; `loginWithGoogle`/`loginWithMicrosoft` decode the OAuth
   provider's own ID token. `lastHouseHints()` removed outright (the leak
   itself, not left dead). `houseMemory.test.ts` extended, `lastHouseHints`
   references replaced. **This edit regressed an existing, resolved CLAIMS
   row** (`ADR-0164-SIGN-IN-HOUSE-RULE`, which pinned the literal string
   `lastHouses: lastHouseHints(),` ×3) — caught by running
   `check_decision_claims.sh`, not by inspection. Fixed by updating that
   row's check and prose to the new call shape, not by reverting the privacy
   fix to keep old text green; `check_decision_claims.sh` now reports
   364/364 holding, including the new row from item 7.
9. **Records — partial.** This entry, and the stale `admin` note at
   `vendor-intel/identity.service.ts:1283-1288` (RolesGuard no longer admits
   `admin` at all since this ADR; fixed). **Not done:** the Sim Meyhouse
   `aaecdb17` production consequence was not re-queried this round (no
   Supabase MCP call was made); the seven users-row-fallback sites were not
   inventoried against `44.1i`'s current wording; 44.1i's "six" was not
   re-measured. State them as open rather than guess.
10. **Two questions for the founder, left open — see "Open items" below.**

## 2026-09-19, round 2 — an adversarial pass on round 1's own diff, three new findings

An independent verifier reconfirmed round 1's work live (461 total gateway
tests before this round's own additions, `check_gateway_boots.sh`,
`tsc --noEmit` clean, the P1–P8 probe re-run) rather than trusting its
report copied forward, then a dedicated adversarial pass looked for what
round 1's own diff had not covered. Two real findings closed with tests
shown failing before and passing after; one narrow, self-limited gap named
and deliberately left, per the same no-shortcuts rule that governs this
whole record.

1. **HIGH — `joinViaInvite` (Path A, `POST /auth/join`, `@Public()`) never
   got item 5's fix.** `acceptInviteAsExistingUser` (item 5, round 1) re-checks
   an invite's issuer at acceptance; its sibling door — the ONE an invite is
   accepted through when the joiner has no account and no session yet —
   still selected `id, organization_id, restaurant_id, role` (no
   `invited_by`) and minted `user_restaurant_access` from the invite's
   stored role alone. An issuer demoted or removed after minting still
   granted exactly what the invite said, through this route, for up to its
   7-day expiry — demotion is the worse case: `MembersService.updateMemberRole`
   never calls `cancelPendingInvitesFrom`, so the invite never even expires
   early, and the hole is reproducible for the invite's entire remaining
   life, no race required. Fixed the same way as item 5: select `invited_by`
   too, re-read the issuer's current active role in the invite's house, and
   refuse (`BadRequestException`, invite left consumed — not restored, same
   as `acceptInviteAsExistingUser`, so retrying meets the same refusal
   again) via `grantRefusal(roleInHouse(issuerAccess), invite.role,
   "invite")`, before either the new-account or existing-account branch
   runs, so a refusal creates no orphan account either.
   `invite-issuer-must-still-stand.spec.ts`'s new `joinViaInvite (Path A)`
   block (4 cases): the 3 refusal/503 cases fail against the code as this
   round found it and pass after; the legitimate-grant case passes either
   way. Fixing this surfaced a real regression in a file neither round had
   read yet: `join-via-invite.spec.ts` (the 2026-08-26 account-takeover
   fix's own tests) used a `chain()` stub that replays one canned answer for
   every query against a table, so its `user_restaurant_access` mock could
   not tell "does the issuer still stand" apart from "is the joiner already
   a member" once both questions were asked of the same table in the same
   call — all 3 of its cases started failing (wrong exception type, or the
   invite reads no code and no date columns at all) the moment this fix
   landed. Migrated to the real, filter-applying `makeStubDb`/
   `asDatabaseService` (the same helper `invite-issuer-must-still-stand.spec.ts`
   already used) with a standing issuer seeded by default and the invite
   given real `code`/`expires_at`/`used_at` columns; all 3 cases re-verified
   to pass against BOTH the pre-fix and post-fix service code, confirming
   the account-takeover protection itself is untouched — only the fixture
   was stale, same shape as item 5's `org-role-not-overwritten.spec.ts`
   repair in round 1, not a workaround of either check.
2. **MEDIUM — `AuthContext.tsx`'s OWN mount-time `loadUser` was the fourth
   caller item 2/3 (round 1) did not find.** Round 1 consolidated three
   refresh implementations behind one `doRefresh` and said so in this
   record's Consequences line ("both web clients"), but `AuthContext.tsx`'s
   `useEffect` `loadUser` — separate from the axios interceptor and
   `refreshTokenFn` above it in the same file, though it shares the same
   `api` instance and so runs AFTER the interceptor has already awaited
   `doRefresh()` for the same 401 — still deleted BOTH tokens on any 401
   from `GET /auth/me`, unconditionally. `doRefresh` removes the stored
   refresh token only on a genuine sign-out; a `houseAccessEnded` refresh
   stores a fresh no-house pair and sends the person to the chooser, and a
   503 or dropped connection while refreshing leaves the original pair
   untouched — both keep a session `loadUser`'s catch then destroyed anyway,
   on the ordinary path of reloading a page, not only the tab-stayed-open
   case round 1's own UI sweep tested. Fixed by checking
   `localStorage.getItem("refreshToken")` before clearing anything — NOT by
   calling `doRefresh()` again, which would double-fire the refresh network
   call every other caller's single-flight dedup exists to prevent, since
   the interceptor on this exact `api` instance has already made and
   settled that call by the time this catch runs (confirmed by reading both
   call sites; `authStore.ts`'s sibling `loadUser`, by contrast, correctly
   calls `doRefresh()` itself because its OWN bare axios instance has no
   interceptor to have done so already). `AuthContext.houses.test.tsx`'s new
   "loadUser on mount" block: the kept-session case fails against the
   pre-fix unconditional removal and passes after; a genuine-sign-out
   control case passes unchanged either way, proving the fix does not
   loosen the real sign-out path.
3. **LOW/INFO — websocket connect-time membership check vs. a concurrent
   eviction: named, not fixed.** `evictFromHouse` (item 1, round 1) only
   sweeps `this.clients` — sockets already registered. A socket whose
   `handleConnection` is still awaiting `isActiveMember`'s DB round trip when
   an eviction fires for the same user+house is not in that map yet, so it
   is skipped, and if its own already-in-flight read still resolves
   "active" it gets seated in the room anyway (reproduced against a gated
   stub). Left open rather than patched under time pressure, because both
   candidate fixes have their own real cost and neither got the adversarial
   pass the rest of this record's closed items did: a re-check immediately
   before `client.join` shrinks the window but doubles the DB reads every
   websocket connection pays for a narrow edge case; an in-memory
   "last evicted at" map closes it more precisely but is unbounded state in
   a long-running process and needs its own pruning rule. Narrow blast
   radius in the meantime: it is a self-race, needing the VICTIM's own
   reconnect in flight at the instant their OWN removal's write commits —
   not something a third party can aim at anyone — and ordinary
   read-committed ordering (a connect starting after the removal commits)
   is unaffected. Revisit with the same rigour as item 1 rather than as a
   round-2 addendum.
4. **INFO, pre-existing, out of this round's diff, not a regression.** The
   websocket gateway's non-production auth fallback
   (`extractAuthContext`, unconditional on `NODE_ENV !== "production"`) lets
   an unauthenticated socket claim any `userId`; unrelated to items 1–3
   above and not reachable in production as deployed
   (`apps/api-gateway/Dockerfile` hardcodes `NODE_ENV=production`). Flagged
   for completeness only.

**Also re-verified live rather than copied forward:** `check_adr_numbers_unique.py`
now sweeps 916 refs (was 891 at this ADR's creation) and still answers
**0169** next-free, not 0164 — the renumbering risk item 9 (round 1) flagged
is current, not stale. `check_decision_claims.sh`: 366/366 holding (two new
rows this round, `ADR-0164-JOIN-VIA-INVITE-ISSUER-STANDING` and
`ADR-0164-AUTHCONTEXT-LOADUSER-KEEPS-REFRESH`, each pinning its fix's shape
statically — the first also pins that a refusal does not restore the
invite, guarding against reintroducing exactly the restore-on-refusal bug
this round's own first draft had and its own tests caught). `check_citation_pairing.py`
(178/119), `check_no_conflict_markers.py` (5384+1449 files),
`check_migration_versions_unique.py`, `check_gateway_boots.sh` all still
PASS. Gateway `tsc --noEmit` (both configs — the spec config surfaced one
new-this-round error, an unguarded possibly-undefined `find()` result in
the new `joinViaInvite` spec, fixed with a non-null assertion after
`toBeDefined()`) and web `tsc --noEmit`: clean.
Full gateway sweep (`auth`, `websocket`, `team`, `restaurants`,
`organizations`): 40 suites, 460/460 (was 456/456 after round 1; +4 for the
new `joinViaInvite` block, `join-via-invite.spec.ts`'s repair nets zero
since it neither adds nor removes cases). Full web sweep (`contexts`,
`stores`, `lib`): 30 suites, 353/353. Not re-run this round, unchanged from
round 1's own stated gaps: the Sim Meyhouse production re-query, the
seven-fallback-site inventory, 44.1i's "six", the mobile automated test gap
for item 6, mutation testing beyond items 1/2's new claims.

## 2026-09-19, round 3 — an independent verifier and attacker re-ran round 2's work live

The verifier reconfirmed round 2's two closed items and all of round 1's
still-standing checks by reading the code directly and re-running the guard
scripts and full suites (not copied forward); the attacker re-ran the P1–P8
probes against current code (all still refused as round 2 left them, plus
two newly-covered variants of P8) and looked specifically at what round 2's
own diff had not touched. Two real, narrow findings closed with tests shown
failing before and passing after; one coverage gap (a CLAIMS row, not code)
closed the same way; one documentation precision correction; the register
filed (above). No HIGH or MEDIUM finding was left open this round.

1. **MEDIUM (P9) — `deleteAccount` was the fourth removal path, and the only
   one never wired to eviction or invite cancellation.** `leaveRestaurant`,
   `MembersService.removeMember` and `TeamService.deleteMember` each call
   both `websocketGateway.evictFromHouse` and `cancelPendingInvitesFrom`
   after their access-row delete succeeds; `deleteAccount` — which can end
   membership in SEVERAL houses at once — called neither, for any of them.
   Reproduced: a socket already subscribed to a house's room before its own
   owner called `deleteAccount` stayed subscribed, and any invite that
   account had issued for a house kept granting exactly what it said until
   it lapsed on its own. Narrow blast radius (only the deleted account's own
   already-open socket, bounded by that socket's access token's remaining
   life; production re-queried by the attacker this round, Supabase MCP,
   SELECT only: 0 currently-pending invites from a non-member issuer, so
   nothing is live-exploitable today), but real and reproducible. Fixed by
   reading every active `user_restaurant_access.restaurant_id` for the
   account BEFORE the access rows are deleted, then — once the `users`-row
   delete has succeeded — calling `evictFromHouse` and
   `cancelPendingInvitesFrom` once per house, mirroring the other three
   paths exactly. `delete-account-evicts-houses.spec.ts` (new, 4 cases): the
   single-house and multi-house eviction/cancellation cases fail against the
   pre-fix code (0 calls where 1 or 2 were expected) and pass after; the
   no-active-house and sole-owner-guard control cases are unaffected either
   way. New CLAIMS row `ADR-0164-DELETE-ACCOUNT-EVICTS-HOUSES`, mutation-tested
   (the select-before-delete step removed → red; restored → green).
2. **LOW (coverage gap, not a code defect) — item 1's HIGH websocket fix had
   jest coverage but no CLAIMS row.** Every other closed item in this ADR has
   a static, mutation-tested CLAIMS row; `websocket.gateway.ts`'s membership
   check (item 1, round 1) did not, so a future edit that quietly reintroduced
   the `if (metadata.restaurantId && …)` gap or dropped the connect-time
   `isActiveMember` check would pass `websocket.gateway.spec.ts` only if that
   suite were remembered to be run, and would not fail CI on its own. Closed
   with a new row, `ADR-0164-WEBSOCKET-MEMBERSHIP-CHECK`, pinning
   `isActiveMember`, `handleConnection`'s ordering, the `handleSubscribeRestaurant`
   refusal, `evictFromHouse`'s `socketsLeave` call, and the three modules'
   `forwardRef(() => WebsocketModule)` wiring. Mutation-tested: reintroducing
   the original `if (metadata.restaurantId && …)` bug makes the check fail;
   restoring the fix makes it pass again.
3. **LOW/INFO (parity) — the phone's device memory never got the privacy fix
   the web received in round 1 (item 8).** `apps/web/src/lib/houseMemory.ts`
   sends only the ONE hint matching the email being submitted, via an
   email→userId index populated at sign-in; `apps/mobile/src/auth/houseChoice.ts`'s
   `hints()` still returned every person the phone remembered (up to 20),
   sent on every mobile sign-in, on a shared device — the server discards it
   (it is never authority), but the same class of over-sharing item 8 closed
   on the other platform. Mirrored the web's fix exactly: `houseChoice.ts`
   gains an `EmailIndex` (same FNV-1a fingerprint, its own copy, own
   storage), `indexEmail` and `hintFor` as pure functions (this file stays
   side-effect-free by its own header comment; `state/session.ts` does the
   actual `SecureStore` reads/writes, adding `readEmailIndex`/`writeEmailIndex`
   alongside the existing memory pair); `signIn` now sends `hint ? [hint] : []`
   instead of `hints(await readMemory())`; `rememberSessionHouse` indexes the
   email alongside the house on every path that calls it (sign-in, token
   adoption, app-open). `hints()` removed outright, same as the web's
   `lastHouseHints()` in item 8 — the leak itself, not left dead. This
   regressed the existing `ADR-0164-SIGN-IN-HOUSE-RULE` CLAIMS row, which
   pinned the literal `lastHouses: hints(await readMemory()),` in
   `session.ts` — caught by re-running `check_decision_claims.sh`, fixed by
   updating that row's check to the new literal (`lastHouses: hint ? [hint]
   : [],` plus the `hintFor(mem, index, email)` call) and its prose, the same
   shape as item 8's own web-side regression repair. **Not run live:**
   `apps/mobile/src/auth/__tests__/houseChoice.test.ts` was extended with 5
   new cases for `hintFor`/`indexEmail`/`parseEmailIndex` (mirroring
   `houseMemory.test.ts`'s existing web cases) and hand-traced against the
   implementation, but this worktree's `apps/mobile/node_modules` — a
   symlink to the main checkout's copy, shared by every worktree — has no
   `jest` binary and no `@types/jest` materialized at all, despite both being
   declared in `apps/mobile/package.json`; `npx jest` answers `command not
   found`. This is a DIFFERENT, more basic gap than item 6's "native imports
   excluded from jest config" — jest itself cannot run for this package from
   any worktree sharing this install, and fixing it means running an install
   inside the main checkout, which this lane's HARD RULES forbid. Verified
   instead by `tsc --noEmit` (see below) and by reading: both new production
   files are clean, and every new test assertion was traced by hand against
   `houseChoice.ts`'s actual logic.
4. **Documentation precision, not a defect — item 6's "none in any file this
   round touched" was true in spirit and imprecise in fact.** Mobile
   `tsc --noEmit` was re-run this round: **498** pre-existing errors
   (unchanged count, confirming the gap is stable, not growing on its own),
   all `describe`/`it`/`expect` "cannot find name" (`TS2582`/`TS2304`) from
   the same missing-jest-types gap, and `apps/mobile/tsconfig.json` is
   byte-for-byte unchanged from this branch's base commit (`cb756083e`),
   confirming the gap is repo-wide and pre-existing, not introduced by this
   branch. But **16 of those 498** land inside
   `apps/mobile/src/auth/__tests__/houseChoice.test.ts` — the new file round
   1 itself added — not zero, because any new jest test file in this package
   inherits the same pre-existing config gap. Stated precisely rather than
   left as round 1 phrased it. After this round's own additions to that same
   file, the count is 517 (498 + 19, all the same two error codes, none a
   new category) — proportional to the added test code, not a new defect.
5. **Register, closed this round.** `OPEN-DECISIONS.md` had no entry for
   F1–F5, F4, or the two "Open items for the founder" below, despite two
   prior rounds leaving them open — flagged by round 3's own attacker pass as
   a repeat of round 1's MEDIUM #4. Filed as OD-129 (F1/F2/F3/F5), OD-130
   (F4, carrying the ADR 0143/0149 citation above), and OD-131 (open items a
   and b) [2026-09-19: first drafted under three provisional numbers, 124–126, already allocated to other lanes; renumbered to OD-129/130/131 before commit] — every citation below
   and in `OPEN-DECISIONS.md` uses the current numbers. Adding rows shifted every paired `(OD-id at OPEN-DECISIONS.md:line)`
   citation below the insertion point — [[register-row-shifts-citations]] —
   so `check_citation_pairing.py --fix` was run and repointed 47 citations
   across 33 files (listed in this round's diff); re-ran the check clean
   afterward (178 citations / 122 rows, PASS) rather than leaving a rewrite
   this size unverified.

**Also re-verified live, this round:** gateway `tsc --noEmit` both configs
clean; full gateway sweep (`auth`, `websocket`, `team`, `restaurants`,
`organizations`): 41 suites, **464/464** (was 460/460 after round 2; +4 for
the new `delete-account-evicts-houses.spec.ts`). Web `tsc --noEmit` clean;
full web sweep (`contexts`, `stores`, `lib`): 30 suites, **353/353**
(unchanged — no web files touched this round). `check_gateway_boots.sh`
PASS. `check_decision_claims.sh`: **368/368** holding (369 total lines, one
`_comment`-only row; three CLAIMS changes this round — two new rows
(`ADR-0164-DELETE-ACCOUNT-EVICTS-HOUSES`, `ADR-0164-WEBSOCKET-MEMBERSHIP-CHECK`)
and one repaired row (`ADR-0164-SIGN-IN-HOUSE-RULE`'s mobile pin) — each
independently confirmed via `bash -c` exactly as the guard itself invokes
`verify`, and each mutation-tested by editing the guarded line out and back).
`check_citation_pairing.py` PASS after `--fix` (178/122, see item 5).
`check_no_conflict_markers.py`, `check_migration_versions_unique.py` (no new
migrations this branch), `check_od_ids_exist.py` and `_od_collisions.py`
(both clean after the three new OD rows) all PASS. `check_adr_numbers_unique.py`:
next-free still **0169**, swept across **916** refs — unchanged from round 2,
since no new ADR was created this round.

**Not done this round, same as rounds 1 and 2 (not among the findings this
round was asked to close):** the Sim Meyhouse production re-query, the
seven-fallback-site inventory, 44.1i's "six" re-measurement, mutation
testing of round 1's original 8 fixes, Playwright screenshot verification,
item 3's websocket connect-time race (still disclosed and deliberately not
fixed — re-read, not re-reproduced, and the "narrow, self-race-only"
characterization still holds architecturally), item 4's scenario-harness gap,
and a full sentence-by-sentence audit of this ADR's body beyond the F1–F5
and round-3 sections. The P1–P8 probe re-run this round was performed by the
adversarial pass that produced this round's task brief, not repeated a
fourth time by this session; the full jest sweep above exercises the same
fixed code paths.

## Open items for the founder (not decided here)

**(a) Should an organisation owner removed from every house of their
organisation keep organisation ownership** — and so the power to open new
locations under decision 4, "Organisation owners only" above — with no house
left to exercise it in?

**Answered 2026-09-19** — the founder (batch-4 answers,
`founder-sketch-decisions-106-115.md`): **keep the organisation role**
(a house-level removal still never touches `organization_members`), but
**opening a location now also requires an active `user_restaurant_access`
row in a house of that same organisation.** This is a third option neither
bullet below considered: the organisation role is untouched, but the
privilege the ADR actually cared about (opening a location) now depends on
more than that role alone. Built this round in `createLocation`
(`organizations.service.ts`): after the existing owner check and the
target-organisation resolution, a failed-read-safe (503) check refuses 403
`NO_ACTIVE_HOUSE_IN_ORGANISATION` when the caller owns the organisation but
holds no active house in it. `create-location-owners-only.spec.ts` (new
`OD-131(a)` describe block, 5 cases: 3 refusal cases, 1 positive case, 1 503
case — corrected round 5, 2026-09-21; earlier rounds miscounted this as "4
refusal cases"): the 3 refusal cases plus the 503 case fail against the
pre-fix code (the create succeeds, or the read error goes unchecked, when
either should be refused) and pass after; the positive case passes both
before and after, since an organisation owner who already holds an active
house in that organisation was never refused. CLAIMS row
`ADR-0164-ORG-OWNERS-ACTIVE-HOUSE`, mutation-tested (the `if
(!hasHouseInOrg)` check alone removed → exactly the 3 refusal cases go red,
the positive case and the 503 case stay green because neither depends on
that line; restored → green). See `OPEN-DECISIONS.md`
OD-131.

The two options originally weighed, kept for the record:
- *Keep it (today's behaviour, by omission).* Nothing changes
  `organization_members` when a house removal empties an organisation
  owner's last house — but an owner of nothing could still open a location
  and immediately own it.
- *Strip it when their last house goes.* Closes that gap, but turns a house
  removal into an organisation-level demotion no removal path reasons about,
  and needs a rule for what happens if they are later re-added to a house.

**(b) Should organisation-group operations (create/rename/delete a chain)
require a house membership in that organisation plus an organisation role,
instead of any organisation member?** `createChain`/`renameChain`/`deleteChain`
still admit any `organization_members` row, unchanged by this ADR (flagged,
not fixed, in the Consequences section above).

**Answered 2026-09-19** — the founder (batch-4 answers,
`founder-sketch-decisions-106-115.md`): **no change now.** Measure the three
routes and who uses them; decide in a dedicated ADR of its own later.
Measured this round:
- All three routes (`POST /organizations/chains`, `PATCH
  /organizations/chains/:id`, `DELETE /organizations/chains/:id`,
  `organizations.controller.ts:64-94`) call the SAME
  `getUserOrgIdsWithFallback(userId)` and only check `orgIds.length > 0` —
  ANY `organization_members` row, any role (`owner`, `manager`, `staff`,
  `member`), passes; there is no role check at all, unlike `createLocation`'s
  "Organisation owners only" gate. The fallback can even self-repair a
  `'member'` row from `users.restaurant_id` when no membership row exists
  (`organizations.service.ts:74-107`) — the same "member repair" this ADR's
  Consequences section already flags as silently violating a CHECK.
- Exactly 3 web call sites, all reachable only through the Settings page's
  "Locations & Chains" section: `CreateChainDialog.tsx:81` (create),
  `Settings.tsx:661` (rename), `Settings.tsx:678` (delete). That whole
  section is gated client-side to `user?.role === 'owner'` — the person's
  HOUSE role in their CURRENT session, not an organisation role — a
  different and weaker gate than the server holds for `createLocation`.
  Zero call sites in `apps/mobile`.
- Zero dedicated authorization test coverage: the only spec touching
  `renameChain` (`last-changed-dates-reach-the-client.spec.ts`) tests its
  `updated_at` stamping, not who may call it.
- No code changed for (b) this round — recorded as an open item with this
  measurement, per OD-131 (`OPEN-DECISIONS.md`).

The two options originally weighed, kept for the record:
- *Any organisation member (today).* Unchanged surface, but this is the
  exact shape "Organisation owners only" was written to close for
  `createLocation` — a members-table row with no house tie deciding a
  house-adjacent action.
- *Owner (or owner/manager) of a house in the organisation, plus the
  organisation row.* Consistent with the spirit of F5's now-answered "never
  via a house" rule, but organisation groups were never in this ADR's own
  scope (Options considered above is about locations, not chains) and may
  have a reason of their own for being wider.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-18 | Aldemir (AskUserQuestion) | "Membership only" (44.1r), "Keep managers in" (44.1s); first recorded in ADR 0162's fourth addendum |
| 2026-09-18/19 | Aldemir (AskUserQuestion) | Sign-in: "think bigger picture, if they own couple houses what we do, in sign-in? we let them choose which"; "be SOTA, after quite some time let them choose which restaurant to go". Opening a location: "Organisation owners only" |
| 2026-09-18 | Research workflow (SOTA sign-in note, code map) | Proposed R1–R7, measured production read-only, listed forks F1–F4 and the code-map forks |
| 2026-09-18 | Build session, `fix/sessions-follow-membership` | Created; built the four answers and R1–R7; F1–F5 built to recommendation and carried |
| 2026-09-19 | Build session (workflow subagent), same branch | Hardening round: items 1, 2/3, 5, 6, 7 (partial), 8 closed with before/after tests; item 4 and most of 9 not done. F1–F5 were left open this round, pending the founder. |
| 2026-09-19 | Build session (workflow subagent), round 2, same branch | Adversarial pass on round 1's diff: closed 1 HIGH (`joinViaInvite` issuer standing) and 1 MEDIUM (`AuthContext.tsx` mount-time `loadUser`) with before/after tests; named and deliberately left 1 LOW/INFO (websocket connect-time race) with the cost of each candidate fix stated; repaired a pre-existing spec (`join-via-invite.spec.ts`) the HIGH fix broke, verified as a stale fixture, not a workaround. |
| 2026-09-19 | Build session (workflow subagent), round 3, same branch | Independent verifier + attacker pass on round 2's diff: closed 1 MEDIUM (`deleteAccount` the fourth un-wired removal path, P9) and 1 coverage gap (a missing CLAIMS row for item 1's websocket fix) with before/after tests and mutation-tested static claims; closed 1 LOW/INFO parity gap (mobile device memory sent every remembered account, not just the signing-in one — mirrored the web's item 8 fix), verified by reading and `tsc` rather than a live jest run (mobile's shared `node_modules` has no `jest` binary materialized, a repo-wide gap this lane's HARD RULES forbid fixing from here); corrected round 1's "none in any file this round touched" to the precise 16-of-498 count; filed F1–F5, F4 and the two open governance questions to `OPEN-DECISIONS.md` as OD-129/130/131 [2026-09-19: first drafted under three provisional numbers, 124–126, already allocated to other lanes; renumbered to OD-129/130/131 before commit] (not done in rounds 1–2), running `check_citation_pairing.py --fix` to repoint the 47 citations the new rows shifted. |
| 2026-09-19 | Build session (workflow subagent), round 4, same branch | Records round, closing a reviewer's `must_fix` list. Deleted the three-round "a note on provenance" below (rounds 1–3 wrongly held F1–F5/F4 open against a computed brief three times running; the founder's answers were real all along, recorded in `founder-sketch-decisions-106-115.md`, and sketch 118 = Direction B had already landed on `main` as PR #397, `1fba79f57`, before this round). Locked F1–F5 in the Status line and "Forks carried," dated and quoted verbatim; named F4's `EndpaperShell` wrapper for `ChooseHouse.tsx` as a deferred follow-up (still not built — `EndpaperShell` is not on this branch). Closed "Open items for the founder (a)" with the founder's batch-4 answer (an organisation owner keeps the organisation role but now also needs an active house in that organisation to open a location): built in `createLocation`, before/after tests in `create-location-owners-only.spec.ts` (new `OD-131(a)` block, 5 cases; adjusted 2 pre-existing cases whose fixtures had no seeded house), a mutation-tested CLAIMS row (`ADR-0164-ORG-OWNERS-ACTIVE-HOUSE`), and a fixture update to `create-location-grants-access.spec.ts` for the new read it now needs to satisfy. Measured "Open items (b)" (the three chain routes, their authorization, and their 3 web call sites) per the founder's "no change now" answer; no code changed for (b). Fixed two doc comments that undercounted the removal paths at three instead of four (`cancel-house-invites.ts`, `websocket.gateway.ts`'s `evictFromHouse`) and two mislabels in "Open items" that said "F4" where "decision 4" or "F5" was meant. [2026-09-19: first drafted under three provisional numbers, 124–126, already allocated to other lanes; renumbered to OD-129/130/131 before commit] Moved OD-129/130 to `OPEN-DECISIONS.md`'s Resolved table; re-ran `check_citation_pairing.py --fix`, `check_od_ids_exist.py`, `_od_collisions.py` and `check_decision_claims.sh` afterward (all PASS; claims 369/369, one new row). Full gateway `organizations` suite re-run: 6 suites, 37/37 (was 32/32). |
| 2026-09-21 | Build session (workflow subagent), round 5, same branch | Closed round 4's last-call NOT-READY list, six items. (1) `deleteAccount`'s pre-delete `user_restaurant_access` read now binds `error` and refuses (503, logged) before any of the three deletes runs — `ci.yml:527`'s `check_read_errors_not_swallowed.py` was failing the build on this exact site; new case in `delete-account-evicts-houses.spec.ts` shown red against the pre-fix code and green after; guard now PASSES at 173 sites / 173 baselined / 0 new (no baseline row added); gateway `auth/websocket/team/restaurants/organizations` sweep 41 suites, 470/470 (was 469); `ADR-0164-DELETE-ACCOUNT-EVICTS-HOUSES` extended to pin the error binding and mutation-tested (two mutants — the read reverted outright, and bound but never checked — both red; restored green). (2)/(3) The Resolved-table rows for this ADR's own F1–F5, F4 and "Open items" forks (renumbered 129/130/131, first drafted under three provisional numbers this cycle's other lanes had already taken) and this file no longer carry the three "**Absorbs \<number\> (merged 2026-09-19)**" declarations naming those provisional numbers, or their now-false "before it was ever taken by anyone else" / "this closes the sibling entry" sentences — those three numbers were never committed under their own rows, so the first was free for `origin/feat/finish-public-doors` to file its own, unrelated privacy-notice fork under it 2026-09-18, and the absorbs declarations made `check_od_ids_exist.py` read that real row as resolving two ways. The three provisional-number tokens still in this file (:420-422, the round-3 and round-4 rows above) are replaced with a dated bracket naming them as provisional numbers renumbered before commit — spelled without their letter prefix throughout this row and those edits, deliberately, so this sentence does not itself relapse into the defect it describes (`check_od_ids_exist.py`'s id-reference regex has no way to tell a citation from a plain mention). Proved with the exact scratch-copy simulation the reviewer used to find this: the other lane's row for the first provisional number, read from `origin/feat/finish-public-doors`, inserted into a temporary copy of `OPEN-DECISIONS.md` — `check_od_ids_exist.py` now PASSES (previously exited 1, "RESOLVES TWO WAYS"); the temporary copy was then discarded, never committed. (4) The F4 bullet and "Revisit when" line no longer say "once that branch lands" / "`feat/login-flyleaf-endpaper` lands" — that branch's `EndpaperShell` merged to `main` in PR #397 two days before round 4 wrote those words. Reworded to what is actually still true: `git merge-base fix/sessions-follow-membership origin/main` is `cb756083e`, this branch's own base, and `origin/main` is 10 commits ahead of it (measured today, not round 4's now-stale "4" — numbers get re-measured, never copied forward); the wrapper waits on a rebase, not on a merge that already happened. (5) The OD-131(a) block in `create-location-owners-only.spec.ts` is 3 refusal cases, 1 positive case and 1 503 case, not "4 refusal cases" / "red on all four" as the OPEN-DECISIONS.md row, this file's "Open items (a)", and (found while fixing those two) the `ADR-0164-ORG-OWNERS-ACTIVE-HOUSE` CLAIMS row all three said. Live-checked by reverting `if (!hasHouseInOrg)` to `if (false)`: exactly the 3 refusal cases go red, the positive and 503 cases stay green (11 passed / 14 total in the file); all three passages corrected to match. (6) 21 `CLAIMS.jsonl` rows this lane does not own had their em-dashes and section-signs re-encoded from literal UTF-8 to `\uXXXX` escapes (`json.loads` identical either way, confirmed row-by-row against `cb756083e`) — restored byte-for-byte from that base commit; the diff against `cb756083e` now carries only the 11 added `ADR-0164-*` rows and the 2 `ADR-0162-*` rows this lane actually changed. Re-ran after every item: `check_decision_claims.sh` 369/369, `check_citation_pairing.py --fix` (0 rewritten), `check_od_ids_exist.py` PASS, `_od_collisions.py` clean, `check_adr_numbers_unique.py` and `check_no_conflict_markers.py` PASS, both gateway `tsc --noEmit` configs clean. |
