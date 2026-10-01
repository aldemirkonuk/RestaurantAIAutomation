## An access-register read error let `users.role` decide a person's role at a house — CLOSED on `fix/role-read-error-means-no-role` — 2026-10-01

Filed and closed on `fix/role-read-error-means-no-role` ([ADR 0248](../decisions/0248-an-access-register-that-cannot-be-read-gives-no-role.md)). Line numbers are at `origin/main` 2019ae7f6 unless marked "this branch".

**What it was.**
- `lookupRestaurantRole` (`apps/api-gateway/src/organizations/organizations.service.ts:35-64`) read `users.role` whenever no access role came back, including when the access read ERRORED. It set `readError` and still returned that role.
- `resolveRestaurantRole` (strict: false) dropped the error and returned the role.
- `registerAccount` writes `users.role = 'owner'` (`auth/auth.service.ts:1557-1566`), and `acceptHeldMembership` later sets only `users.restaurant_id` (`:3152-3157`). So, at the helper, an account made by `registerAccount` that later joined a house as staff through `acceptHeldMembership` read as that house's owner when the helper's access read errored, and passed `assertCanManageRestaurant`.
- The order seal (`assertApprovalAllowed`, `procurement/procurement.service.ts:4455`) read the role the same way. With the lookup fixed alone, an access-read error would have parked a threshold-tripping order as APPROVAL_NEEDED and filed an `order_approval_refused` row saying the person holds no role.

**How far it reached.** Over HTTP, `AuthService.validateJwtPayload` (`auth/auth.service.ts:1426-1493`) reads the token's house's access row before any helper runs. It answers 503 when that read errors and 401 when there is no active row. So the helper's path was reached:
- in the narrow window where that read succeeded and the helper's own read errored;
- on `GET`/`PATCH /organizations/locations/:id`, whose house the JWT step does not check;
- from the recurring-orders cron (`procurement/recurring-orders.service.ts:888`), which has no JWT step.

The earlier premises put to the founder overstated this. The decisions stand as defence in depth for those paths. ADR 0248, "Reachability end to end".

**The rulings**, 2026-10-01:
- *"Next PR: error means no role (Recommended)"*.
- *"Strict for the order seal (Recommended)"*.

**How it is closed.**
- An access read that errors now returns no role with `readError` set, and the `users` row is not read (this branch, `organizations.service.ts:80-85`).
- The seal reads the role through `OrganizationsService.readRestaurantRole` and answers 500 before it parks or files anything (this branch, `procurement.service.ts:4458-4480`).
- Five callers degrade during such an error instead of refusing. ADR 0248 lists them by `file:line`, and none of them grants anything.

**Pinned by:**
- `apps/api-gateway/src/organizations/role-read-error-means-no-role.spec.ts`.
- `apps/api-gateway/src/procurement/order-approval-gate.spec.ts`, describe "approveOrder — a role that cannot be read".
- The claim `claims.d/fix-role-read-error-means-no-role.jsonl:1`.

## An inactive access row sent the role lookup to `users.role` — ~~OPEN~~ CLOSED on `fix/role-read-error-means-no-role` — 2026-10-01

Filed by `fix/role-read-error-means-no-role` (ADR 0248, "What stays open" (a)), and closed on the same branch by the founder's answer *"Close both in #561"*. The option read: *"Fall back to users.role only when no access row exists at all, and honour the validity window. This widens #561 and changes more callers."*

**What it was.** `lookupRestaurantRole` read only rows with `is_active = true` (`organizations.service.ts:45`). So, at the helper, a person whose row here was inactive was read at `users.role` when `users.restaurant_id` named the house. An active row with an empty role went the same way (`:48-49`).

**Reach over HTTP.**
- On a token-house route the JWT step answers 401 for an inactive row first, so the inactive case reached the helper only on `/organizations/locations/:id` and from the cron.
- The JWT step passes an active row with an empty role, so that case was reachable.

**How it is closed.**
- The lookup reads the person's one row here whatever its `is_active`; `(user_id, restaurant_id)` is UNIQUE.
- A row that exists decides alone (this branch, `organizations.service.ts:92-98`). Only a read that found no row falls back to `users.role`.

**Who could be refused by it.** This was measured by reading code; ADR 0248 has the list.
- No gateway code deactivates an existing row. One SQL function can: `seed_sim_restaurant(jsonb)` upserts `is_active` from its payload (`20260805000000_baseline_from_production.sql:1489-1500`). Only `service_role` may run it, and its one caller, `scripts/synth/seed.py`, passes `is_active: True` for the sim house (`:371-378`).
- `joinViaInvite`'s held row (`auth.service.ts:2903`) affects only an existing account already known at that house by its `users` row alone. That account gets the house back when it accepts the hold.
- Production, read-only, 2026-09-18, held one such member, and migration `20260918153000` gives them an active row. It has not been re-measured since.

## The role lookup ignored `valid_from` and `valid_until` — ~~OPEN~~ CLOSED on `fix/role-read-error-means-no-role` — 2026-10-01

Filed by `fix/role-read-error-means-no-role` (ADR 0248, "What stays open" (b)), and closed on the same branch by the same answer, *"Close both in #561"*.

**How it is closed.**
- `lookupRestaurantRole` and `MembersService.assertMembership` give a row's role only while `isLiveMembership` holds (`common/tenant/live-membership.ts:39-55`, imported, not copied).
- `TeamService.assertAccess` still reads `is_active` alone. Its entry at `tech-debt.d/2026-09-29-docs-merge-queue-followups-2026-09-29.md:89-94` stays OPEN for it and for the last-owner counts.

**The clock.** `isLiveMembership` compares `valid_from` with the gateway's clock, while every access-row insert takes `valid_from` from the database's `now()`.
- On the founder's answer *"Small tolerance on valid_from (Recommended)"*, it now treats a `valid_from` up to two minutes ahead as started (`VALID_FROM_CLOCK_TOLERANCE_MS = 120_000`, this branch, `common/tenant/live-membership.ts:41`). The option read: *"The shared check treats a valid_from up to 2 minutes in the future as already started. Since only the database's now() ever writes it, this cannot let anyone in early in practice. The predicate is also used by the recipient resolver, which gets the same tolerance. That is one line plus a spec in #561."*
- Rejected: *"Record it as open"* and *"Ignore valid_from, check only valid_until"*.
- **A corrected premise.** The question and the picked option said only the database's `now()` writes `valid_from`. `acceptHeldMembership` also writes it, from the gateway's clock (`auth/auth.service.ts:3133`). The answer stands: that value is compared against a gateway clock, so it reads as ahead only when two clocks differ, the case the tolerance covers. ADR 0248, "Corrected premises", has the detail.
- **What is left:** a gateway clock more than two minutes behind the database's. The skew was not measured.

## `MembersService.assertMembership` read `users.role` when its access read errored — ~~OPEN~~ CLOSED on `fix/role-read-error-means-no-role` — 2026-10-01

Filed by `fix/role-read-error-means-no-role` (ADR 0248, "What stays open" (d)), and closed on the same branch by the founder's answer *"Fold into #561 (Recommended)"*. The option read: *"Apply the same rule to this copy: an access-read error means no role, so the caller gets a 403. That is about 2 more files and a spec, making 9 files. One review covers both copies of the rule."*

**What it was.** `assertMembership` discarded the access read's error (`restaurants/members.service.ts:56`; `v3.0-TECH-DEBT.md:288-289` notes the discard). On no data it returned `users.role || "staff"` when `users.restaurant_id` named the house (`:74`).
- Its route callers take the house from a tenant-compared `:restaurantId`, and the leave route from a tenant-compared `body.restaurantId`. So over HTTP the JWT step reads that house's row first, and the error path showed at the helper only when that read succeeded and this one errored.
- `DELETE` of the account calls it for each house with an active row, including houses the JWT step did not check.

**How it is closed** (this branch, `members.service.ts:63-110`).
- An access read that errors is logged and answers 403, and the `users` row is not read.
- A row that exists gives its role only while `isLiveMembership` holds.
- Only no row at all reads `users.role || "staff"`, unchanged.
- `scripts/read_error_baseline.json` drops `members.service.ts::user_restaurant_access::access`, so the baseline goes from 151 to 150.
- Pinned by `apps/api-gateway/src/restaurants/members.service.spec.ts`, describe "MembersService.assertMembership — the access row decides, and an unreadable one is no role".

## The no-row fallback still contradicts `team.service.ts` — OPEN — 2026-10-01

Filed by `fix/role-read-error-means-no-role` (ADR 0248, "What stays open" (c)). This adds to 44.1i (`v3.0-TECH-DEBT.md:364`), which stays OPEN.

- `team/team.service.ts:173` says the legacy `users` row "proves MEMBERSHIP ONLY, never privilege".
- When a person has no access row at all at a house, `lookupRestaurantRole` and `MembersService.assertMembership` still return `users.role` (or `staff`) as their role there.
- `registerAccount`'s `users.role = 'owner'` is still written, and `acceptHeldMembership` still does not change it. Since a row that exists now decides alone, that value is read only for a person with no row at the house.
