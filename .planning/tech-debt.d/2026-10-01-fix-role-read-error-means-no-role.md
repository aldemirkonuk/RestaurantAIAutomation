## An access-register read error let `users.role` decide a person's role at a house — CLOSED on `fix/role-read-error-means-no-role` — 2026-10-01

Filed and closed on `fix/role-read-error-means-no-role` ([ADR 0248](../decisions/0248-an-access-register-that-cannot-be-read-gives-no-role.md)). Line numbers are at `origin/main` 2019ae7f6 unless marked "this branch".

**What it was.**
- `lookupRestaurantRole` (`apps/api-gateway/src/organizations/organizations.service.ts:35-64`) read `users.role` whenever no access role came back, including when the access read ERRORED. It set `readError` and still returned that role.
- `resolveRestaurantRole` (strict: false) dropped the error and returned the role.
- `registerAccount` writes `users.role = 'owner'` (`auth/auth.service.ts:1557-1566`), and `acceptHeldMembership` later sets only `users.restaurant_id` (`:3152-3157`). So an account made by `registerAccount` that later joined a house as staff through `acceptHeldMembership` read as that house's owner during an access-read error, and passed `assertCanManageRestaurant`.
- The order seal (`assertApprovalAllowed`, `procurement/procurement.service.ts:4455`) read the role the same way. With the lookup fixed alone, an access-read error would have parked a threshold-tripping order as APPROVAL_NEEDED and filed an `order_approval_refused` row saying the person holds no role.

**The rulings**, 2026-10-01:
- *"Next PR: error means no role (Recommended)"*.
- *"Strict for the order seal (Recommended)"*.

**How it is closed.**
- An access read that errors now returns no role with `readError` set, and the `users` row is not read (this branch, `organizations.service.ts:59-64`). The no-row fallback is unchanged.
- The seal reads the role through `OrganizationsService.readRestaurantRole` and answers 500 before it parks or files anything (this branch, `procurement.service.ts:4458-4480`).
- Five callers degrade during such an error instead of refusing. ADR 0248 lists them by `file:line`, and none of them grants anything.

**Pinned by:**
- `apps/api-gateway/src/organizations/role-read-error-means-no-role.spec.ts` (8 `[REVERT-FAILS]` cases).
- `apps/api-gateway/src/procurement/order-approval-gate.spec.ts`, describe "approveOrder — a role that cannot be read" (4 `[REVERT-FAILS]` cases).
- The claim `claims.d/fix-role-read-error-means-no-role.jsonl:1`.

## The role lookup's no-row fallback still reads `users.role`, including behind an inactive access row — OPEN — 2026-10-01

Filed by `fix/role-read-error-means-no-role` (ADR 0248, "What stays open" (a) and (c)). This adds to 44.1i (`v3.0-TECH-DEBT.md:364`), which stays OPEN.

- `lookupRestaurantRole` filters `is_active = true` (`organizations.service.ts:45`). With no active row, it returns `users.role` when `users.restaurant_id` is this house.
- `team/team.service.ts:173` says that row "proves MEMBERSHIP ONLY, never privilege". This lookup contradicts it.
- `registerAccount`'s `users.role = 'owner'` is still written, and `acceptHeldMembership` still does not change it.

**Is an inactive row plus a matching `users` row reachable?** Measured by reading code; no production query was run.
- Every gateway removal clears `users.restaurant_id` for that house before deleting the access row: `restaurants/members.service.ts:462`, `:478-483`, and `team/team.service.ts:1274-1294`.
- No code path sets `is_active = false` on an existing access row.
- `joinViaInvite`'s held row is written inactive (`auth/auth.service.ts:2903`). It reaches this case only for an existing account whose `users.restaurant_id` already named that house, and that account read `users.role` before the row existed.
- So the case is reachable through a hand-run SQL deactivation, that held-row case, or rows older than the clear-first order (44.1j).

## The role lookup ignores `valid_from` and `valid_until` — OPEN — 2026-10-01

Filed by `fix/role-read-error-means-no-role` (ADR 0248, "What stays open" (b)).

- `lookupRestaurantRole` filters on `is_active` alone (`organizations.service.ts:40-46`). `isLiveMembership` also checks `valid_from` and `valid_until` (`common/tenant/live-membership.ts:39-55`).
- No access-row insert in the gateway sets either column, and nothing in the gateway or `supabase/migrations` writes `valid_until` on an access row. So this is reachable only through a hand-written value.
- The same gap in `TeamService.assertAccess` and `MembersService.assertMembership` is already filed at `tech-debt.d/2026-09-29-docs-merge-queue-followups-2026-09-29.md:89-94`. Move them together.

## `MembersService.assertMembership` reads `users.role` when its access read errors — OPEN — 2026-10-01

Filed by `fix/role-read-error-means-no-role` (ADR 0248, "What stays open" (d)). This is the hole ADR 0248 closed in `lookupRestaurantRole`, in a second helper.

- `assertMembership` discards the access read's error (`restaurants/members.service.ts:56`). `v3.0-TECH-DEBT.md:288-289` notes the discard, and `scripts/read_error_baseline.json` lists it as `members.service.ts::user_restaurant_access::access`.
- On no data, it returns `users.role || "staff"` when `users.restaurant_id` is this house (`:74`).
- It gates owner or manager acts at `members.service.ts:153, 199, 339, 586, 672` and `restaurants/operating-hours.service.ts:101-105`.
- Not changed on this branch: the founder's answer covered `lookupRestaurantRole`.
