## The sentences for a role that is not known implied it would become known, and the cancel control said to reload — ~~OPEN~~ CLOSED on `fix/cancel-role-unknown-wording` — 2026-10-01

Filed and closed on `fix/cancel-role-unknown-wording`. A search of `v3.0-TECH-DEBT.md` and `tech-debt.d/` at 1c1a676f8 for `SealedRejectDie`, `REJECT_ROLE_UNKNOWN` and `activeRole` found no earlier entry for it.

**What it was.** At 1c1a676f8, `REJECT_ROLE_UNKNOWN` (`apps/web/src/components/orders/SealedRejectDie.tsx:83-86`) said the person's role "has not been read yet" and "If this does not clear in a moment, reload". Its docblock (`:78-82`) and rule 4 of the file header (`:41-45`) named two `null` states, still loading and a failed read, and not a read that finds no role. The goals desk (`apps/web/src/pages/reports/next/useGoalsDesk.ts:141`) and the export shelf (`apps/web/src/pages/reports/next/useReportExports.ts:122`) said the role "is not known yet", and that the desk was read-only, or exports were not offered, "until it is".

All three show when `useAuth().activeRole` is null. `AuthContext` (`apps/web/src/contexts/AuthContext.tsx:556-585` at 1c1a676f8) sets it from `GET /auth/me/role`, for the house the session's token names, when the user or the active house changes. It is null in more than one state, including before the first read returns, after a failed read, and when the read finds no role. That route reads only the `user_restaurant_access` row with `is_active = true` (`auth.service.ts` `getUserRoleAtRestaurant`, `:2690-2702`).

**Which no-role states are reachable.** A token naming a house where the person holds no active access row is refused before `/auth/me/role` answers (`validateJwtPayload`, `auth.service.ts:1426-1493`: 401 `HOUSE_ACCESS_ENDED` at `:1481-1487`; a failed read of that row is a 503 at `:1471-1479`). So a read that finds no role includes:
- an active row whose `role` is NULL. The column is nullable (`20260805000000_baseline_from_production.sql:5814`), and `user_restaurant_access_role_known` is `CHECK (role IN ('owner', 'manager', 'staff'))` (`20260902200000_team_access_role_is_a_known_role.sql:62-63`), which NULL passes;
- a failure of the route's own read of that row, after the session check read it. `getUserRoleAtRestaurant` does not look at the read's error and answers no role (`:2701`).

A member with a NULL role was told to reload, and a reload repeats the same read. The cancel gate, `assertCanManageRestaurant` (`organizations.service.ts:297-303` → `:219-231` → `:254-261`), reads through `lookupRestaurantRole` (`:35-65`), which reads the legacy `users` row when the access read gives no role. So a member with a NULL role, whose `users` row names this house with the role manager or owner, passes the cancel gate's role check while the control said to reload.

**How it is closed.** The three sentences now say the role is not confirmed here and name who to ask. None says the state will clear.
- `REJECT_ROLE_UNKNOWN`: "Your role at this restaurant is not confirmed here, so cancelling this order is not available. Ask a manager or an owner."
- The goals desk: "Your role at this restaurant is not confirmed here, so the desk is read-only. Ask a manager or an owner to set or change a goal."
- The export shelf: "Your role at this restaurant is not confirmed here, so exports are not offered. Ask a manager or an owner to write one up."
- `REJECT_NEEDS_A_MANAGER`, shown when `activeRole` is `staff`, now says "this page has you as staff at this restaurant" in place of "your role here is not one of those", because `activeRole` keeps its old value until a new read returns, including the previous house's role after a house switch.
- `SealedRejectDie`'s header and docblocks list the null states, introduced with "including", and the header names the two reachable "no role" states above.
- ADR 0125's Q1 paragraph, which quotes the removed sentence, carries a dated bracketed correction.

No control is offered to a different set of `activeRole` values than before. The wording follows the same fix in `RecurrenceSheet` on the open PR #558. Pinned by three `[REVERT-FAILS]` tests (`SealedRejectDie.test.tsx`, `useGoalsDesk.test.tsx`, `ExportsShelf.test.tsx`), each red against the sources at 1c1a676f8, and by the claim `claims.d/fix-cancel-role-unknown-wording.jsonl:1`.

## The browser's role and the gateway's role checks read different things — OPEN — 2026-10-01

Filed by `fix/cancel-role-unknown-wording`, which changes only the words shown for a null `activeRole`.

**What.** At 1c1a676f8:
- `activeRole` comes from the `is_active = true` access row only (`getUserRoleAtRestaurant`, `auth.service.ts:2690-2702`). The cancel gate's role check reads the legacy `users` row when the access read gives no role (`lookupRestaurantRole`, `organizations.service.ts:35-65`). A member with an active access row whose `role` is NULL, and whose `users` row names this house with the role manager or owner, passes that check while `activeRole` is null, so `SealedRejectDie` withholds a cancel the gateway's role check would allow.
- The export routes are gated owner or manager (`report-exports.controller.ts:55-56`, `RolesGuard`). That guard reads the role on the token's house access row, with no `users.role` fallback (`jwt.strategy.ts:68`), so a NULL role is refused there too.
- The goal write routes carry no role gate: create (`analytics.controller.ts:782`), update (`:827`), cutting spec (`:848`) and status (`:896`). The class has only `JwtAuthGuard` (`:113`), and `goals.service.ts` reads no role. So no role is checked on a goal write through those routes. The goals desk's read-only state for staff and for a null role is the page's choice only, and its staff sentence "Goals are set by owners and managers." describes the page, not the gateway. This is open and not fixed here; the lane `fix/goal-writes-need-a-manager` is measuring it.
- `AuthContext` does not reset `activeRole` when `activeRestaurantId` changes (`AuthContext.tsx:556-585`; the switch at `:608-650` sets the house and the user, not the role). Until the new read returns, the page holds the previous house's role, so `SealedRejectDie` can offer a cancel the gateway then refuses with 403, or withhold one it would allow.

**Not decided here.** Whether `/auth/me/role` should read the role the way the gateway does, and whether a house switch should clear `activeRole` before the new read, are open. The open PR #561 changes `lookupRestaurantRole`; its description says a read that finds no access row still falls back to `users.role`.

## Other role sentences say the role was not read, or name the wrong source, when it is null — OPEN — 2026-10-01

Filed by `fix/cancel-role-unknown-wording`, and not fixed there.

**What.** At 1c1a676f8:
- `apps/web/src/components/mudavym/HouseUserMenu.tsx:54`, when `activeRole` and `user.role` are both empty: "Your role was not read. Nothing here is a claim about what you may do." Both are empty in cases including an active access row whose `role` is NULL, which both reads did read. Pinned by `HouseHeader.test.tsx:341`.
- `HouseUserMenu.tsx:53`, when `activeRole` is empty and `user.role` is set: "… on the account. The role at this house was not read, so this is the account’s own record." `user.role` comes from `GET /auth/me`, which reports the role from the access row in the session's house and never the account-wide `users.role` (`auth.controller.ts:269-275`). Pinned by `HouseHeader.test.tsx:332`.
- `apps/web/src/pages/settings/next/TeamSection.tsx:56`, when its `role` is null: "the gateway has not said which, so nothing is claimed about what you may change." That `role` is `activeRole ?? user?.role ?? null` (`useSettingsNextData.ts:587`), and it is null in cases including a NULL role, about which the gateway did answer.
- 17 lines in 14 files under `apps/web/src` compute `activeRole ?? user?.role ?? null` (`git grep -nE "activeRole \?\? user(\?)?\.role" -- apps/web/src apps/mobile/src`): `pages/IdentityDecisionLog.tsx:138`; `pages/inventory/command/InventoryCommandPage.tsx:197,198`; `pages/menu/next/MenuNext.tsx:261`; `pages/profile/next/useProfileNextData.ts:393`; `pages/providers/next/TwinSheet.tsx:94`; `pages/providers/next/UsualCurrencySection.tsx:74`; `pages/receipts/next/ReceiptsCredits.tsx:847`; `pages/receipts/next/ReceiptsNext.tsx:175`; `pages/recommendations/next/CatalogView.tsx:122`; `pages/recommendations/next/useRecommendationsNextData.ts:474,475,476`; `pages/settings/next/CellarSection.tsx:85`; `pages/settings/next/SettingsNext.tsx:185`; `pages/settings/next/useSettingsNextData.ts:587`; `pages/team/next/TeamNext.tsx:267`. For them a null `activeRole` falls back to `/auth/me`'s role in the session's house, read at a different moment. Their sentences for a null role were not checked for this entry.

**Fix.** Say what each state is, as `REJECT_ROLE_UNKNOWN` now does, with no claim that a read did not happen, and describe `user.role` as the session's role in its house, from `/auth/me`.
