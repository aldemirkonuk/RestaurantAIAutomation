# 0162 — Managers grant manager or staff, on both doors

- **Status:** Locked 2026-09-18. The founder chose this in chat from the options below, in his words: *"Managers grant manager or staff"*.
- **Date:** 2026-09-18
- **Decider:** Aldemir (founder)
- **Keywords:** roles, invite, invitation, add member, role ceiling, manager, owner, staff, generateInvite, addMember, grantRefusal, role-grant
- **Links:** [[0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person]] (the invite fault is its addendum's second finding), [[0088-a-team-change-is-recorded-and-a-wage-is-not-invented]] (the `user_restaurant_access.role` CHECK, and `assertAccess` no longer trusting `users.role`), `v3.0-TECH-DEBT.md` 44.1h–44.1l, PR #392 (where the fault was found), PR #393 (this build)

**Index row:** not added to `decisions/README.md` here. That file is gate-owned, and its row for this record goes in a separate PR.

**Number:** 0162, not 0161. `check_adr_numbers_unique.py` swept the refs and called 0161 free, but a peer worktree holds an uncommitted 0161 the ref sweep cannot see.

## Context

A person joins a house through one of two doors, and each door decided on its own
who may grant which role:

- **An invitation.** `POST /auth/invite` → `AuthService.generateInvite`. It is
  `@Roles("owner","manager")`, and `RolesGuard` gates on `users.role`, one value per
  person for every house they belong to (`JwtStrategy.validate`,
  `auth/strategies/jwt.strategy.ts:59`: `role: user.role ?? payload.role`). Until
  2026-09-18 the method checked only that the caller had some active access row in the
  house the body named, then wrote `dto.role` unchanged. So a manager could mint an
  owner's invite (`v3.0-TECH-DEBT.md` 44.1h).
- **Adding a member directly.** `POST /restaurants/:id/members` →
  `MembersService.addMember`. It refused any manager who added anything but staff:
  *"Managers can only add staff members"* (`members.service.ts:345` at `d9fd8f1c`).

PR #393's first cut capped the invitation at the inviter's own rank, which let a
manager invite a manager. `addMember` still refused the same grant, so the two doors
disagreed, and no record said which rule was right. That fork was the founder's to
settle (CLAUDE.md §0.1).

## Options considered

1. **Managers grant staff only, on both doors.** Least privilege, and it was offered
   as the rule that matched the Team page. Cost: a manager who runs a floor cannot
   bring in a second manager without an owner. The invitation door would also refuse
   something the web's invite dialog already offers: it lists manager and staff
   (`apps/web/src/components/team/InviteTeamDialog.tsx:112-113`).
2. **Keep the two doors different.** Invitations capped at the inviter's rank;
   direct adds staff-only for managers. Cost: two rules for one question. The
   disagreement is how the fault was found. It leaves a manager able to do by
   invitation what they cannot do directly, and whichever door is stricter protects
   nothing.
3. **Managers grant manager or staff, never owner, on both doors.** Owners grant
   any role, and staff grant nothing. One rule, one implementation. Cost: a manager
   can create another manager without an owner's say.
4. *(Doing nothing.)* A manager could still mint an owner's invite, and whoever
   redeemed it would become an owner.

## Decision

**Option 3.** An owner grants owner, manager or staff. A manager grants manager or
staff, never owner. Staff grant nothing. A missing role, or any value that is not one
of those three, grants nothing and cannot be granted. This holds on both doors.

One implementation serves both doors: `grantRefusal` in
`apps/api-gateway/src/auth/role-grant.ts`, called by `generateInvite` and by
`addMember`. The rule lives in one place because two copies of it are how the doors
came to disagree. The rank table is a `Map`. An object literal would answer
`"constructor"` with a function, which would get past a `??` default.

The granter's role is read in the house being granted into, and each door reads it
differently:

- **`generateInvite`** reads only the inviter's active `user_restaurant_access` row
  in that house. It has no fallback to the `users` row. A read error answers 503.
  Production, read-only counts on 2026-09-18: 8 users carry `users.restaurant_id`.
  1 of them has no active access row for that house, is an active member of another
  house, and holds owner or manager in `users.role`. 0 users have no active access
  row anywhere. So no member relied on the fallback, and its only effect was the
  stale chain: a person removed from house A who is a member of B could still mint
  invites into A.
- **`addMember`** still reads the role through `MembersService.assertMembership`,
  which falls back to the `users` row. This record leaves that alone. Removing it
  touches the logs, members and operating-hours endpoints, and it is filed as
  44.1i.

## Consequences

- A manager can now add a manager directly. Before, the direct door refused it and
  the invitation door allowed it. No web or mobile client calls the direct door today.
  A grep on 2026-09-18 found no POST to `/restaurants/:id/members` in `apps/web/src`
  or `apps/mobile/src`. The Team page posts to `/restaurants/:id/team/members`, which
  writes a roster row and grants no role.
- A manager can no longer mint an owner's invite, and a role the rule does not know
  (`"admin"`, `"constructor"`) grants nothing on either door. `users.role` has no
  CHECK constraint (44.1k). Before this record, `addMember` let either role add an
  owner. The first cut of the invitation fix refused `"admin"` but let
  `"constructor"` through, because it compared as NaN.
- Given up: an owner's say over each new manager. If a house needs that, this
  record is what gets superseded.
- Still open, filed rather than fixed here (`v3.0-TECH-DEBT.md`):
  - 44.1i. `assertMembership`, `resolveRestaurantRole` and
    `assertCanManageRestaurant` still honour the `users`-row fallback.
  - 44.1j. `leaveRestaurant` and `TeamService.deleteMember` leave
    `users.restaurant_id` set.
  - 44.1k. The role columns' constraints are uneven.
  - 44.1l. `generateInvite` still swallows two reads.
- Revisit if: a house asks for owner-approved managers; or a fourth role appears.
  A new role needs a rank in `role-grant.ts`, and until it has one it grants nothing.
- Claims: `ADR-0147-INVITE-ROLE-CEILING` covers the invitation door, and
  `ADR-0162-ONE-GRANT-RULE-BOTH-DOORS` covers the shared rule and the direct door.
  Both verifies are static and were mutation-tested against their own removal.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-18 | PR #393 audit (planner R4, security reviewer) | Found the two doors disagreeing with no record deciding which was right |
| 2026-09-18 | Aldemir (chat) | Chose option 3 over (1) staff only and (2) the doors kept different |
| 2026-09-18 | Orchestrating session | Created; built on `fix/invite-role-ceiling` |
