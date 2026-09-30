## `PATCH /menus/items/:id` and `POST /menus/items` write into any house's menu — no tenant check — OPEN — 2026-09-22

Found by `price-judge.md:119-124` (`.planning/07-reference/research/2026-09-21/`) for the PATCH
route; confirmed by the PR #443 audit and re-read here on `origin/main` `f80754129`. The gateway's
database client uses the service-role key (`apps/api-gateway/src/database/database.service.ts:13-22`),
so row-level security does not stand in for a missing check.

- `PATCH /menus/items/:id` takes only `:id` (`apps/api-gateway/src/menus/menus.controller.ts:54-64`).
  `reviewMenuItem` loads and updates `menu_items` by id alone (`menus.service.ts:182-186,204-211`),
  and for the `name` field it also renames the linked `restaurant_inventory` row by id alone
  (`:218-222`). A signed-in caller from another house who knows a menu-item id can change its price
  or any reviewed field.
- `POST /menus/items` has the same shape: `addMenuItem` loads the menu by `dto.menuId` alone
  (`menus.service.ts:115-119`) and adds the wine to that menu's house.
- Neither is caught by the tenant check `JwtAuthGuard` runs: it compares only a `restaurantId` /
  `restaurant_id` named in the path, query or body, and returns early when none is named
  (`apps/api-gateway/src/common/tenant/assert-tenant-match.ts:64-76`).

**Fix in flight:** branch `fix/menu-item-house-scope` (unpushed when this row was filed) takes the
caller's house from the token on both routes. Close this row when it merges, with a CLAIMS row that
proves both routes filter by the caller's house.

## Two wage leaks in `/team`: `wage_visible` is defeated, and any wage can be set unaudited — OPEN — 2026-09-22

Found by `labor-judge.md:171-185` (`.planning/07-reference/research/2026-09-21/`); every citation
below re-read on `origin/main` `f80754129`.

**Leak 1.** `wage_visible` only nulls `hourly_wage` in `listMembers`
(`apps/api-gateway/src/team/team.service.ts:156,211`). `getWeek`
(`apps/api-gateway/src/team/schedule.service.ts:90-133`, manager-gated at `:96`) returns every
shift's raw `labor_cost` regardless of the switch, and `labor_cost ÷ (end − start)` recovers the wage
exactly. The switch reads no role (`team.service.ts:156`), so turning it off hides wages from the
owner too.

**Leak 2.** `updateMember` is manager-gated (`team.service.ts:403`) and writes `hourly_wage`
(`team.service.ts:417`) with no audit row and no history — a manager can set any member's wage,
including their own, unrecorded.

**Fix in flight:** PR #440 (branch `fix/team-pay-defects`, ADR 0215) makes money owner-only, retires
`wage_visible` and records every wage change; open, not merged. Close this row when it merges.

## `approve-draft`, `manual-reply` and `confirm-deal` let any house member send vendor mail, and record no one — OPEN — 2026-09-22

Found by `seal-judge.md:22-27` (`.planning/07-reference/research/2026-09-21/`, measured on lane E's
branch at `8d409bd79`); re-read here on `origin/main` `f80754129`. The judge names `manual-reply`
and `confirm-deal` only, because lane E already gates `approve-draft`; on main `approve-draft` has
the same gap. On main all three handlers pass the token's house to the service but never the
caller: `approveDraft(restaurantId, orderId, dto)`
(`apps/api-gateway/src/procurement/procurement.controller.ts:564-580`,
`procurement.service.ts:5754-5758`), `manualReply(restaurantId, orderId, content, ccEmails)`
(`procurement.controller.ts:633-653`, `procurement.service.ts:6549-6554`) and
`confirmDeal(restaurantId, orderId, opts)` (`procurement.controller.ts:743-761`,
`procurement.service.ts:6915-6923`). With no user id there is no owner, manager or grantee check,
which ADR 0175 decision 10 requires for every vendor send, and nothing records who sent.
`confirmDeal` emails the vendor unless `sendConfirmation` is false (`procurement.service.ts:7122`),
at the price and quantity in the request body.

Already tracked, not repeated here: that these sends are unsealed (CLAIMS
`ADR-0175-VENDOR-SENDS-ARE-SEALED`; ADR 0175's live-defect table). That row checks only the seal
header, so it could resolve while the role check and the actor are still missing; this row covers
those two.

**Fix in flight:** PR #436 (branch `feat/finish-action-integrity`, head `288b2897c`) passes the
caller and the seal to all three routes (`procurement.controller.ts:623-636,848-858,1015-1025` at
that head) and moves that CLAIMS row to resolved. The seal-judge's "three unsealed paths" were
measured before those commits, and they are a different three: `manual-reply`, `confirm-deal` and
the house letter composer (`POST /communications/letters`). The composer records its writer and is
not one of the four routes decision 10 names on main, so it is not filed here. Close this row when
#436 merges, with the spec that proves a staff member is refused.
