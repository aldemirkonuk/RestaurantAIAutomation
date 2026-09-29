# 0238 — Zone setup is for owners, managers and the people they assign

- **Status:** Locked (the rule: founder, 2026-09-29). The mechanism below is the build's reading of it; the part the answer does not settle is OD-200.
- **Date:** 2026-09-29
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** storage locations, zones, cellar floor, zone setup, permission, capability, assign, staff, manager, owner, user_restaurant_access, zone_setup_access
- **Links:** [[0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person]] (house scope of the same routes, PR #516), [[0215-money-on-team-is-the-owners-and-hours-are-worked-hours]] (the per-membership switch this copies), [[0218-an-alert-finds-its-area-first-a-lead-acts-on-cards-only-and-away-is-dates]] (lead marks, rejected below), [[0175-one-tap-from-the-notification-is-staged]] D10 (`authority_grants`, rejected below), [[0162-managers-grant-manager-or-staff-on-both-doors]], OD-200, `v3.0-TECH-DEBT.md` "Storage locations took a location id from another house on trust"

## Context

PR #516 (`fix/storage-locations-house-scope`) found that every storage-locations route, and the cellar floor's `PUT /cellar/:rid/zones/:zoneId`, admit any member of the house, staff included, and filed "who may edit zones" as a founder fork in its defect-register entry (`.planning/tech-debt.d/2026-09-29-fix-storage-locations-house-scope.md`). The founder was asked, 2026-09-29: *"who may create, rename, resize or delete a zone, and who may place wines in zones? Today every house member can do all of it"*. His answer, verbatim:

> "managers/owners+ the people they assign"

Two things had to be settled before building: whether the house already has a per-person grant this should reuse, and what the answer covers.

**The existing per-person mechanisms, measured on `origin/fix/storage-locations-house-scope` @ `2a79581d7`.** A grep of `apps/api-gateway` for capabilities, permissions, grants, delegate, assign, `RolesGuard`, `@Roles` finds no general capability register. It finds three single-purpose per-person marks:

1. `authority_grants` (`supabase/migrations/20261116100000_an_owner_names_who_may_send.sql`, ADR 0175 D10) — the vendor-send register. Its `scope` CHECK admits only `'vendor_send'` (`authority_grants_scope_known`), `authority_grant_issue` (`20261116100600_…`) re-checks that the actor is an **owner**, every act is sealed, and a grant stops when its owner stops being one (`authority_grants_on_access_change`). Those are the founder's 2026-09-21 rules for sending money: *"only an owner issues"*. `scripts/check_grant_writes_are_ledgered.py` guards its writes.
2. `house_area_members.is_lead` (ADR 0218) — a lead mark an owner or manager sets. The founder bounded it, 2026-09-21: *"Yes, cards only"*; `areas/area-routing.ts` `mayActForEveryone` says it "grants NO pay and NO roster access".
3. `user_restaurant_access.team_pay_access` (`20261201110220_an_owner_may_let_a_manager_see_and_set_pay.sql`, ADR 0215) — one boolean on the membership row, written only by an owner through the gateway, audited as `team_pay_access_changed` by `team/access-audit.ts` `recordAccessChange`, the person told, shown on the roster sheet.

## Options considered

1. **Add a `zones` scope to `authority_grants`.** Appeals: it is literally a per-person grant with a scope column, and the task said to reuse one if it exists. Costs: the founder's rules on that table say an owner alone issues; his answer here says managers assign too. Reusing it means either refusing managers (contradicting the answer) or rewriting `authority_grant_issue`, the latch triggers and the "voucher is an owner" gate per scope, on a security ledger with its own guard, for a right that moves no money and needs no seal. `VendorSendAuthorityService` filters on `scope = 'vendor_send'` today, but every future reader of the register would have to remember to. Rejected.
2. **Make the zone right a lead-mark privilege.** Appeals: owners and managers already set lead marks. Costs: a lead is per area (bar, kitchen, floor…), not per house, and the founder bounded the mark to *"cards only"*. Rejected.
3. **A new `member_capabilities` table.** Appeals: general. Costs: a second register with nothing else in it, a new RLS/lock-down surface, and a design for a vocabulary nobody has asked for. Rejected as not the smallest honest thing.
4. **A boolean on the membership row, as `team_pay_access` is (chosen).** `user_restaurant_access.zone_setup_access BOOLEAN NOT NULL DEFAULT false`. It goes when the membership goes, cannot outlive the house, and no client can write it (the table's RLS has SELECT policies only; the migration fails if anon/authenticated ever hold a write grant). Same audit function, same notice, same kind of roster control. The one difference from the pay switch is the one the answer makes: an owner **or a manager** writes it, and it is held by **staff**.
5. *Doing nothing* leaves every member able to create, rename, resize and delete zones, which the answer rules out.

## Decision

Zone setup writes need an owner's or manager's role in the house, or that person's assignment; everyone else gets 403 with nothing written. Built as:

- **Setup, gated** (`storage-locations.controller.ts`, via `assertMaySetUpZones` in `storage-locations.service.ts`): `POST /storage-locations/:rid` (create); `PATCH /storage-locations/:rid/:locationId` when the body carries any field but `current_count` (rename, resize, re-parent, colour, notes, temperature, humidity, type, description — `isZoneSetupEdit`); `DELETE /storage-locations/:rid/:locationId`; and on the cellar floor, `PUT /cellar/:rid/zones/:zoneId` **when it renames** (`ZonesService.confirm`).
- **Who passes:** the caller's role here read strictly by `readRestaurantRole` (a role that cannot be read is a 500, never a pass). `owner` or `manager` passes. `staff` passes only when their active membership row carries `zone_setup_access = true`; an unreadable switch is a 500. Any other role value is refused.
- **The grant:** `PUT /storage-locations/:rid/setup-access/:userId { allowed }`. The actor must be an owner or manager of the same house (403 otherwise, including a manager of another house); the person must hold an active membership here (404 otherwise — another house's person answers like a missing one, ADR 0147); only a staff member is assigned (400 for an owner or manager, who set up zones by role); withdrawing works whatever the person's role now, so a grant left from before a promotion can be cleared. The write is a compare-and-set on the before-state (409 if it moved). Every change is a `zone_setup_access_changed` row in `system_audit_log` through `recordAccessChange`, and the person is told; a save that moves nothing records nothing.
- **What the web reads:** `GET /storage-locations/:rid/setup-access` → `{ mine: { allowed, via: "house_role" | "assigned" | null }, assigned }`, where `assigned` (user ids) is given to owners and managers only. The trail row is read back on `/settings-audit` and withheld from staff (`STAFF_WITHHELD_ACTIONS`), matching the endpoint.
- **Not gated, as today:** placing a wine (`POST …/mappings`), removing one (`DELETE …/mappings/:wineId`), counting (`PATCH …` with `current_count` alone, and the per-wine `quantity`), and confirming a detected zone name without changing it. The answer does not separate these from setup; they stay open to every member and the question is **OD-200**. Nothing here decides it.

Why a column and not the grants register: the answer's shape (managers assign, staff hold, no money, no seal) is the pay switch's shape, not the vendor-send register's, and bending the register would have rewritten founder-set rules to fit a right they were never written for.

## Consequences

- Every staff member loses zone setup on deploy until an owner or manager assigns them — that is the answer, not a side effect. Owners and managers are unchanged.
- The web does not yet hide or disable the setup controls or show the switch on the roster sheet: that is the stacked web PR (see the PR body), so until it merges a staff member who tries an edit sees the gateway's 403 sentence. The server refusal is the gate; the page is a courtesy.
- A staff member assigned, promoted to manager, then demoted back to staff finds the assignment again (the column is untouched by a role change, as `team_pay_access` is). Clearing it on a role change needs `MembersService` and is not built.
- Revisit when a second per-person right appears: two booleans on the membership row is the point at which a capabilities register (option 3) starts paying for itself.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-29 | founder | Answered: "managers/owners+ the people they assign" |
| 2026-09-29 | — | Created with the gateway half (`feat/zone-edit-permission`, stacked on PR #516); placing/counting filed as OD-200 |
