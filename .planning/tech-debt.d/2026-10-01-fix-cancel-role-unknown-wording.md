## The sentences for a role that is not known implied it would become known, and the cancel control said to reload — ~~OPEN~~ CLOSED on `fix/cancel-role-unknown-wording` — 2026-10-01

Filed and closed on `fix/cancel-role-unknown-wording`. A search of `v3.0-TECH-DEBT.md` and `tech-debt.d/` at 1c1a676f8 for `SealedRejectDie`, `REJECT_ROLE_UNKNOWN` and `activeRole` found no earlier entry for it.

**What it was.** At 1c1a676f8, `REJECT_ROLE_UNKNOWN` (`apps/web/src/components/orders/SealedRejectDie.tsx:83-86`) said the person's role "has not been read yet" and "If this does not clear in a moment, reload". Its docblock (`:78-82`) and rule 4 of the file header (`:41-45`) named two `null` states, still loading and a failed read, and not a read that finds no role. The goals desk (`apps/web/src/pages/reports/next/useGoalsDesk.ts:141`) and the export shelf (`apps/web/src/pages/reports/next/useReportExports.ts:122`) said the role "is not known yet", and that the desk was read-only, or exports were not offered, "until it is".

All three show when `useAuth().activeRole` is null. `AuthContext` (`apps/web/src/contexts/AuthContext.tsx:556-585` at 1c1a676f8) sets it from `GET /auth/me/role` when the user or the active house changes. It is null in more than one state, including before the first read returns, after a failed read, and when the read finds no role. That route reads only the `user_restaurant_access` row with `is_active = true` (`auth.service.ts` `getUserRoleAtRestaurant`, `:2690-2702`). The cancel gate, `assertCanManageRestaurant` (`organizations.service.ts:297-303` → `:219-231` → `:254-261`), reads through `lookupRestaurantRole` (`:35-65`), which falls back to the legacy `users` row when the access read fails or finds no role. So a member with no such access row was told to reload, and a reload repeats the same read. That includes a legacy-only manager whom the gateway's role check admits.

**How it is closed.** The three sentences now say the role is not confirmed here and name who to ask. None says the state will clear.
- `REJECT_ROLE_UNKNOWN`: "Your role at this restaurant is not confirmed here, so cancelling this order is not available. Ask a manager or an owner."
- The goals desk: "Your role at this restaurant is not confirmed here, so the desk is read-only. Ask a manager or an owner to set or change a goal."
- The export shelf: "Your role at this restaurant is not confirmed here, so exports are not offered. Ask a manager or an owner to write one up."
- `REJECT_NEEDS_A_MANAGER`, shown when `activeRole` is `staff`, now says "this page has you as staff at this restaurant" in place of "your role here is not one of those", because `activeRole` keeps its old value until a new read returns, including the previous house's role after a house switch.
- `SealedRejectDie`'s header and docblocks list the null states, introduced with "including".

No control is offered to a different set of `activeRole` values than before. The wording follows the same fix in `RecurrenceSheet` on the open PR #558. Pinned by three `[REVERT-FAILS]` tests (`SealedRejectDie.test.tsx`, `useGoalsDesk.test.tsx`, `ExportsShelf.test.tsx`), each red against the sources at 1c1a676f8, and by the claim `claims.d/fix-cancel-role-unknown-wording.jsonl:1`.

## The browser's role and the gateway's role check read different rows — OPEN — 2026-10-01

Filed by `fix/cancel-role-unknown-wording`, which changes only the words shown for a null `activeRole`.

**What.** At 1c1a676f8:
- `activeRole` comes from the `is_active = true` access row only (`getUserRoleAtRestaurant`, `auth.service.ts:2690-2702`). The cancel gate's role check falls back to the legacy `users` row (`lookupRestaurantRole`, `organizations.service.ts:35-65`). A member whom that check admits through the legacy row has a null `activeRole`, so `SealedRejectDie` withholds a cancel the gateway would allow. The goals desk and the export shelf read the same `activeRole`; their routes' role checks were not traced for this entry.
- `AuthContext` does not reset `activeRole` when `activeRestaurantId` changes (`AuthContext.tsx:556-585`; the switch at `:608-650` sets the house and the user, not the role). Until the new read returns, the page holds the previous house's role, so `SealedRejectDie` can offer a cancel the gateway then refuses with 403, or withhold one it would allow.

**Not decided here.** Whether `/auth/me/role` should read the role the way the gateway does, and whether a house switch should clear `activeRole` before the new read, are open. The open PR #561 changes `lookupRestaurantRole`; its description says a read that finds no access row still falls back to `users.role`.
