# 0162 — Managers grant manager or staff, on both doors

- **Status:** Locked 2026-09-18. The founder chose this in chat from the options below, in his words: *"Managers grant manager or staff"*. Re-confirmed the same day after the question was found to carry a wrong premise, with an owner rule added (see the dated addendum). Four forks that addendum left open were answered the same day (second addendum). **[Sixth round, 2026-09-18: the ADR 0090 merge audit of `dcf91322` blocked on two consequences of answer A. Both are built here, as answer A requires (third addendum).]**
- **Date:** 2026-09-18
- **Decider:** Aldemir (founder)
- **Keywords:** roles, invite, invitation, add member, remove member, role ceiling, manager, owner, staff, owners manage owners, last owner, co-owner, role change scope, setup-era member, users-row fallback, generateInvite, addMember, removeMember, updateMemberRole, grantRefusal, role-grant, migration 20260918153000, RolesGuard, JwtStrategy, validateJwtPayload, house-role, roleInHouse, leaveRestaurant, deleteMember, per-house role
- **Links:** [[0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person]] (the invite fault is its addendum's second finding), [[0088-a-team-change-is-recorded-and-a-wage-is-not-invented]] (the `user_restaurant_access.role` CHECK, and `assertAccess` no longer trusting `users.role`), `v3.0-TECH-DEBT.md` 44.1h–44.1q, PR #392 (where the fault was found), PR #393 (this build), `supabase/migrations/20260918153000_a_setup_era_manager_holds_their_house_by_a_row.sql` (answer B)

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

1. **Managers grant staff only, on both doors.** Least privilege, and it was what the
   direct door already did. Cost: a manager who runs a floor cannot
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

- **`generateInvite`** reads the inviter's role exactly as
  `MembersService.assertMembership` reads it (`members.service.ts:26-52`). An active
  `user_restaurant_access` row in that house decides, and its role is the answer; a
  NULL role grants nothing. With no row, a `users` row whose `restaurant_id` names the
  house is read at `users.role || "staff"`; any other `users` row grants nothing. One
  named difference: a failed read of either answers 503 here, where
  `assertMembership` discards the error and reads it as "no row".
- **`addMember`** reads the role through `assertMembership` itself.

The `users`-row read stays on both doors because a legitimate member depends on it.
Production, read-only, 2026-09-18: 8 users carry `users.restaurant_id`, and 1 of them
has no active access row for that house. That user is a manager created 2026-05-09.
The house their `users.restaurant_id` names (YAREN) was created the same day. They
hold 0 access rows for YAREN, active or inactive, and active manager rows at ALDEMIR
and YARDOM, created 2026-08-05. They are a setup-era member of YAREN, not someone who
left it. Removal deletes access rows rather than deactivating them, and
`system_audit_log` is empty in production, so "never had a row" rests on absence. Even
so, `assertMembership` admits them to YAREN, and dropping the read from this door alone
would have locked them out of inviting there. The stale chain the read also admits
(removed from A, promoted in B, `users.restaurant_id` still A) is filed OPEN as
44.1i. 0 production instances were measured. **[Updated 2026-09-18, PR #393's fourth
round: migration `20260918153000` writes that member's YAREN access row (answer B,
second addendum). Once it is applied in production, the `users`-row read can retire in
a follow-up, on this door, the three helpers and the two target reads listed under
answer B; it must not retire before.]**

**[Corrected 2026-09-18, PR #393's third round.** The second round's text here said
`generateInvite` read the access row only, with no `users` fallback, because no member
relied on the fallback and its only effect was the stale chain. Both halves were false
(above). The fallback is restored, capped by the same rule.**]**

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
- A manager can no longer remove an owner through `MembersService.removeMember`
  (the dated addendum below). **[Sixth round: nor through `TeamService.deleteMember`,
  the Team page's remove (third addendum).]**
- Still open, filed rather than fixed here (`v3.0-TECH-DEBT.md`):
  - 44.1i. Every check that reads the `users` row would admit a stale one as well as
    the legacy one. That covers `assertMembership`, `resolveRestaurantRole` with
    `assertCanManageRestaurant`, `assertAccess` (as staff) and now `generateInvite`,
    and two reads of a target's membership, in `updateMemberRole` and `removeMember`.
    It is theoretical: 0 instances were measured. **[Updated 2026-09-18, fourth round:
    the legacy member gets an access row (answer B). The fallback can retire in a
    follow-up once that row exists in production, and must not before. Fifth round:
    the open claim `ADR-0162-USERS-ROW-FALLBACK-RETIRED` trips when any of three
    admissions changes, and resolved claims pin the other three sites (answer B).]**
  - 44.1j. `leaveRestaurant` and `TeamService.deleteMember` leave
    `users.restaurant_id` set. **[Closed 2026-09-18, sixth round (third addendum).]**
  - 44.1k. The role columns' constraints are uneven.
  - 44.1l. `generateInvite` still swallows two reads.
  - 44.1m. `registerRestaurant` ignores the errors of the founding owner's
    organisation and access-row writes.
  - 44.1n. The owner rule has gaps on other doors, and 4 houses have no owner.
    **[Updated 2026-09-18, fourth round: the co-owner fork is answered (C) and the 4
    houses are left untouched (D); the other gaps stay open.]** **[Sixth round: the
    Team page's remove and its count are closed (third addendum). Still open: the
    hand-over race, and a `users`-row owner demoting the only access-row owner.]**
  - 44.1o. `addMember` overwrites the person's organisation role.
  - 44.1p. `updateMemberRole` never checks that the target belongs to the house, so
    an owner of any house can rewrite anyone's global `users.role`. **[Closed
    2026-09-18, fourth round (answer A).]**
  - 44.1q. `RolesGuard` gates on the global `users.role`, so a role changed in a house
    other than the one the person's `users` row names does not reach `@Roles` routes
    (filed in the fifth round; answer A below). **[Closed 2026-09-18, sixth round:
    `req.user.role` is now the role in the house the token names (third addendum).]**
- Revisit if: a house asks for owner-approved managers; or a fourth role appears.
  A new role needs a rank in `role-grant.ts`, and until it has one it grants nothing.
- Claims: `ADR-0147-INVITE-ROLE-CEILING` covers the invitation door,
  `ADR-0162-ONE-GRANT-RULE-BOTH-DOORS` covers the shared rule and the direct door, and
  `ADR-0162-OWNERS-REMOVE-OWNERS` covers removal. All three verifies are static. They
  pin `grantRefusal`'s body and each door's gate text exactly, with comments stripped.
  They were mutation-tested against their own removal: 26 mutants and the three earlier cuts, all killed.
  **[Updated 2026-09-18, fourth round:** three more rows.
  `ADR-0162-ROLE-CHANGE-THIS-HOUSE-ONLY` covers answer A,
  `ADR-0162-SETUP-ERA-MANAGER-ROW` pins the migration of answer B, and
  `ADR-0162-USERS-ROW-FALLBACK-RETIRED` is an open tripwire on the fallback's removal.
  The first two claims above now also pin the tests that catch a dropped filter. All
  six verifies were re-run against 52 one-change mutants and the four earlier cuts;
  every mutant was caught. Fifth round: the round-4 verifier found two mutants those
  six let through, a CTE backfill and an admission deleted while a dead `users` read
  stayed. Both rows were rewritten, and the six were re-run against 72 mutants (the
  52, the verifier's six and 14 more) and the four cuts: every mutant was caught,
  and 3 controls that must not trip them did not.**]**

## Addendum 2026-09-18: the question's premise, the re-confirmation, and the owner rule

**[Added 2026-09-18, PR #393's third round.]**

*The premise was wrong.* The question that put options 1–3 to the founder said the
Team page lets a manager add only staff, and this record first wrote option 1 as
*"offered as the rule that matched the Team page"* (PR #393 at `3416205`). That was
not true:

- The Team page's add posts to `/restaurants/:id/team/members`
  (`apps/web/src/services/api/team.ts:10,132`). That route is `TeamService.createMember`
  (`apps/api-gateway/src/team/team.controller.ts:78-84`, `team.service.ts:366-395`),
  which writes a `team_members` roster row and grants no role.
- The staff-only rule lived in `MembersService.addMember`
  (`members.service.ts:345-346` at `d9fd8f1c`: *"Managers can only add staff
  members"*), and no web or mobile client calls it.

So option 1 did not match anything a manager could do on the Team page.

*The founder re-confirmed*, told of the wrong premise, in his words:

> "stands: manager or staff. But an owner can degrade or give its status to someonelse, so owner can make either a coowner or make himself manager while making other manager owner(min:1,owner)"

The decision above stands. His second sentence is an owner rule: owners manage
owners, an owner may make a co-owner or hand over and step down, and a house keeps at
least one owner.

*What the code does with the owner rule*, `apps/api-gateway/src/restaurants/members.service.ts`
on this branch at round 3 **[line numbers as of round 3; re-measured in the fourth
round: the owner check is `:176`, `updateMemberRole` is `:170-282`, the only-owner
guard `:220-233`, the removal guard `:341-345`, the last-owner guards `:348-360` and
`:370-383`]**:

- **Role changes are owner-only.** `updateMemberRole` calls
  `assertMembership(..., "owner")` (`:170`). A manager cannot promote or demote
  anyone.
- **An owner can make a co-owner.** Any member can be set to `owner`, with no further
  check (`:164-244`).
- **An owner can hand over.** They promote someone to owner, then set their own role
  to manager. The only-owner guard (`:172-185`) counts active owner access rows and
  refuses only when 1 or fewer remain. It runs only when the actor changes their own
  role. The order matters: stepping down first is refused. `members.service.spec.ts`
  pins the hand-over and the refusal. Those tests were green before this round and are
  kept so the rule cannot drift unseen.
- **Removal: a manager may not remove an owner.** Added in this round
  (`removeMember`, `:286-290`), on both the access-row and `users`-row paths, before
  any write. Before this, any owner-or-manager could remove an owner while another
  owner remained. The last-owner guards are unchanged (`:293-305`, `:315-328`). An
  owner leaving is still allowed while another owner remains.

*What is missing, filed OPEN, not built here* (`v3.0-TECH-DEBT.md` 44.1n):

- `TeamService.deleteMember`, the Team page's remove, is manager-gated, so a manager can
  still remove an owner there. Its last-owner count also ignores `is_active` and skips
  the guard on a failed read.
- The hand-over is two calls with no lock. Two owners stepping down at once can both
  pass the count.
- An owner known only by their `users` row can demote the only access-row owner.
- 4 of 14 houses in production have no active owner access row, and no user reaches
  them as owner through the `users` row either. The rule's "min:1, owner" does not
  hold there today, and without a database write nobody can become their owner.
  Which owner each house should have is the founder's call. **[Answered 2026-09-18: D
  below.]**
- `addMember`'s `organization_members` upsert overwrites an existing organisation role
  (44.1o).
- An owner can demote another owner without that owner's say. The count guard runs
  only when the actor changes their own role (`:172`). His words cover an owner
  degrading or handing over their own status, not demoting a co-owner, so that is
  undecided and his call. **[Answered 2026-09-18: C below.]**
- `updateMemberRole` does not check that the target belongs to this house. Its
  `users` write (`:226-229`) then changes a non-member's global `users.role` (44.1p).
  **[Closed 2026-09-18: A below.]**

## Addendum 2026-09-18 (second): four forks answered

**[Added 2026-09-18, PR #393's fourth round.]** The third round left four forks open
(the addendum above, 44.1i, 44.1n, 44.1p). A, B and C went to the founder on
2026-09-18 (AskUserQuestion), and he chose the offered recommendation each time. D was
recorded with them.

**A. A role change reaches that house only.** His answer: *"Only that house"*.
`MembersService.updateMemberRole` (`PATCH /restaurants/:id/members/:memberId`) now
requires the target to be a member of that house, read the way `assertMembership`
reads one: an active access row there or, with none, a `users` row naming it
(`members.service.ts:189-218`). Anyone else gets 404, before any write. The role
changes in that house, and the global `users.role` is written only when the person's
`users` row names that same house: the write is filtered on it (`:255-259`). Before,
only the actor was checked, and the `users` write was scoped to the person alone, so
any owner of any house could rewrite anyone's global `users.role` (44.1p, now closed).
Two details follow from reading the membership first. The audit row's before-state is
that read, so a legacy member's change records the role they had rather than `null`.
And a failed `users` write refuses the change for a member known only by that row
(where it is their role), but for a member with an access row it is logged, since that
change has happened and is recorded (`:260-268`). Whether a change should write
`users.role` at all stays open; `RolesGuard` still gates on it. Claim
`ADR-0162-ROLE-CHANGE-THIS-HOUSE-ONLY`.

**[Added 2026-09-18, fifth round, found by the round-4 verifier.]** A has a
consequence. `RolesGuard` (`auth/guards/roles.guard.ts`) reads `req.user.role`, and
`jwt.strategy.ts:59` fills it from the global `users.role`. A change in a house other
than the one the person's `users` row names writes only the access row there, so it
never reaches `@Roles` routes. Someone who is staff in their `users`-row house and is
made manager in house B is still turned away in B by `@Roles("owner", "manager")`,
for example on `POST /auth/invite` (`auth.controller.ts:437-439`). The reverse also
holds: demoted in B, they keep `users.role` and pass `RolesGuard` there, and only the
route's own check in that house refuses them, where it has one (`generateInvite`
and `assertMembership` do). Which `@Roles` routes lack such a check was not swept.
Production, read-only, 2026-09-18: 7 of the 14 active access rows (held by 4 of the
8 people with one) are in a house other than the one the person's `users` row names.
None of those 7 differs in role from `users.role`, so nobody is affected today. Filed
OPEN as 44.1q, with the question above. **[Closed 2026-09-18, sixth round (third addendum): the
merge audit swept the routes (38 `@Roles` decorators in 9 controllers (a 39th match, `identity-curation.controller.ts:29`, sits inside a JSDoc comment); 36 of them in 7
controllers that call no membership check of their own), and `req.user.role` is now the role in the house the token
names.]** [Corrected 2026-09-18, ADR 0164, by a comment-stripped count on `cb756083e`: 37 decorators in 9 controllers, price-index 8, not 9. A second match, `price-index.controller.ts:238`, is also a JSDoc line, and it was counted as a decorator.]

**B. The YAREN manager gets a manager row.** His answer: *"Give them a manager row"*.
Migration `20260918153000_a_setup_era_manager_holds_their_house_by_a_row.sql` writes
one `user_restaurant_access` row (manager, active) for the setup-era member of YAREN
described in the Decision above. It matches the whole measured tuple, not a bare id:
both ids, `users.role = 'manager'`, the `users` row and the house both created
2026-05-09 (UTC), the house not soft-deleted, and no access row for the pair, active or
inactive. It raises on more than one match or more than one row written, reports the
count by NOTICE, and writes nothing on a fresh database or a second run. Its version
sorts after the latest on `origin/main`, on `origin/train/finish-2` and in production
(each `20260917020000` on 2026-09-18). On PGlite, over the three tables as the baseline
declares them with production's constraints, it wrote 1 row on the seeded tuple, 0 on
a second run, 0 on each of 6 tuples with one part changed and on an empty database,
and raised on two matches; each of 11 mutants to the file was caught by that probe.

It is deliberately not a generic backfill. `leaveRestaurant` and
`TeamService.deleteMember` delete the access row and leave `users.restaurant_id`
naming the house (44.1j), so a backfill of every `users` row with no access row would
re-admit everyone they removed. **Once this row exists in production, the `users`-row
fallback can retire in a follow-up (44.1i), at all six sites that read it. Four admit
the caller: `assertMembership`, `resolveRestaurantRole`, `assertAccess` and
`generateInvite`. Two read a target: `updateMemberRole` (`members.service.ts:204-218`)
and `removeMember` (`:323-335`). It must not retire before: without the row, that
manager loses YAREN.**

Claim `ADR-0162-SETUP-ERA-MANAGER-ROW` pins the file. It also fails if any other
migration has a statement that both writes access rows and reads `users`, whether a
plain, CTE, JOIN or MERGE backfill. `ADR-0162-USERS-ROW-FALLBACK-RETIRED` is open,
and it fails the build as soon as the fallback changes. It pins three admissions
exactly: `assertMembership`'s, `resolveRestaurantRole`'s and `assertAccess`'s.
Deleting one trips it, and so does removing an admission while its `users` read
stays. Resolved claims pin the other three sites and fail when those change:
`generateInvite` by `ADR-0147-INVITE-ROLE-CEILING` and
`ADR-0162-ONE-GRANT-RULE-BOTH-DOORS`, and the two target reads by
`ADR-0162-ROLE-CHANGE-THIS-HOUSE-ONLY` and `ADR-0162-OWNERS-REMOVE-OWNERS`. So none of
the six can retire by editing those pinned spans without someone reading this. The pins
are textual: a guard added outside a pinned span retires a fallback without tripping
them, and only the jest specs catch that (round-5 verifier, 2026-09-18).

**C. Owners are equals.** His answer: *"Yes, any owner"*. Any owner may demote or
remove another owner of the same house, as long as one owner remains. That is what the
code already did: `updateMemberRole` is owner-only and the demoting owner stays an
owner, and `removeMember`'s last-owner guards hold. Nothing is built.
`members.service.spec.ts` pins the demotion (*"lets an owner demote a co-owner, since
the demoting owner remains"*). The 44.1n fork is closed; the rest of 44.1n stays open.

**D. The 4 houses with no owner are left untouched.** Re-measured read-only on
2026-09-18: 4 of 14 houses have no active owner access row, and between them they hold
0 access rows (active or not), 0 `users` rows naming them and 0 inventory rows. They
are empty shells: Gullit's Tavern, Yaren's Fine Dine, a Meyhouse Palo Alto duplicate
and a Sim Meyhouse duplicate. Nothing is written.

Also in the fourth round, not a fork: `invite-role-ceiling.spec.ts` moved onto the
filter-honouring stub, and `removeMember` gained two target-read tests, because a
mutant dropping `.eq("restaurant_id", …)` or `.eq("is_active", true)` from either read
passed every test (the round-3 verifier). The membership sweep in 44.1g gained
`ProspectsService.accessibleRestaurantIds`, which adds the token's house without
re-checking it.

## Addendum 2026-09-18 (third): the merge audit's BLOCK, and answer A carried through

**[Added 2026-09-18, PR #393's sixth round.]** The ADR 0090 merge audit of `dcf91322`
blocked the PR. Its correctness reviewer approved with notes; its adversarial reviewer
blocked on two findings, both consequences of answer A (*"Only that house"*) that the
fifth round had filed rather than built:

1. **`@Roles` still answered with the global role.** `RolesGuard` reads
   `req.user.role`, and `JwtStrategy.validate` filled it from `users.role`. Since answer
   A stopped a role change from writing `users.role` for a house the `users` row does
   not name, a person demoted in house B kept manager on B's `@Roles` routes. There are
   38 decorators in 9 controllers (a 39th match sits inside a JSDoc comment) [Corrected 2026-09-18, ADR 0164, by a comment-stripped count on `cb756083e`: 37 decorators in 9 controllers, price-index 8, not 9. A second match, `price-index.controller.ts:238`, is also a JSDoc line, and it was counted as a decorator.]. 36 of them sit in 7 controllers (vendor-intel,
   price-index, commodity, house-mail-archive, ask-ai, distributor-feed, sender-trust)
   that call no membership check of their own, per the audit's grep (44.1q).
2. **Leavers stayed members.** `leaveRestaurant` and `TeamService.deleteMember` deleted
   the access row and left `users.restaurant_id` naming the house, so the `users`-row
   fallback that answer B keeps for the YAREN manager also admitted anyone who had left
   (44.1j). `updateMemberRole` would reach them, and they could invite at `users.role`.

*Why this is answer A, not a new fork.* The founder's rule, as the orchestrating
session restated it on 2026-09-18: a role in one house must never change what a
person may do in another. Both findings break it. The first lets house A's role act in
house B. The second lets a house the person left keep treating them as a member.
`RolesGuard` reading the role in the house the request names was already the first
option 44.1q named. It is built here once, where every consumer reads, and not by
retiring 39 decorators. [Corrected 2026-09-18, ADR 0164: 37 decorators; two of the 39 matches are JSDoc lines.]

*What changed* (details, line numbers and tests in `v3.0-TECH-DEBT.md` 44.1j, 44.1n
and 44.1q):

- **The role on every request is the role in the token's house.**
  `AuthService.validateJwtPayload` reads it alongside the `users` read, exactly as
  `assertMembership` reads a member (`auth/house-role.ts`, `roleInHouse`).
  `JwtStrategy.validate` puts it on `req.user.role` and never falls back to `users.role`
  or the token's claim. No membership means no role, and `@Roles` refuses it. A failed
  read is a 503, because a 403 would state something about the person that nothing
  measured, and setting no role would close only `RolesGuard` while `IdentityService`
  also reads the role. A token that names no house keeps the old behaviour, which is
  stated and tested. This is the seventh site that reads the `users`-row fallback
  (44.1i), and it retires with the other six.
- **Leaving or being removed clears `users.restaurant_id`, for that house only.**
  `leaveRestaurant` and `TeamService.deleteMember` now clear it only when it names the
  house being left, read the write's error, and clear before deleting the access row.
  `removeMember` used to clear it whatever house it named; it now filters the same way
  (`clearUsersRowHouse`).
- **The Team page's remove follows the owner rule.** `TeamService.deleteMember` now
  refuses a manager who removes an owner (44.1n's Team-page bullet), counts active
  owners only, and refuses when the count cannot be read.
- **Failed reads stop the removal.** Both removals now refuse on a read that failed.
  Before, a failed read of the target's access row in `removeMember` fell through to the
  `users` row, so a manager could remove an owner whose `users.role` said otherwise.
- **A role change rewrites only the active row.** `updateMemberRole`'s access-row
  UPDATE now filters `is_active`, so a member admitted by their `users` row does not have
  an inactive row rewritten.

*Measured before deploying, read-only (Supabase MCP, SELECT only, 2026-09-18).* 14
active access rows, and 0 of them differ from the holder's `users.role`, so no member's
role changes. The one `users` row naming a house with no row behind it is the YAREN
manager, who stays manager there. There are 0 stale leavers to repair.
`switchRestaurant`'s organisation fallback can open a session for 7 (person, house)
pairs with no membership. All 7 belong to 3 simulation accounts (Sim Bistro's owner,
manager and staff), and those sessions lose the `@Roles` passage their Sim Bistro role
gave them. That is answer A's outcome, and `assertMembership` already refused them
there.

*Still open.* Whether a role change should write `users.role` at all; it now matters
only for a token that names no house. Also open: the rest of 44.1n (the hand-over
race, and a `users`-row owner demoting the only access-row owner), 44.1i (the fallback
retires once migration `20260918153000` is applied in production), and 44.1k–44.1m and
44.1o.

Claims: `ADR-0162-ROLE-IN-TOKEN-HOUSE`, `ADR-0162-LEAVING-ENDS-MEMBERSHIP` and
`ADR-0162-TEAM-REMOVE-OWNERS` are new. `ADR-0162-OWNERS-REMOVE-OWNERS` and
`ADR-0162-ROLE-CHANGE-THIS-HOUSE-ONLY` were extended, and the open tripwire's text
now names the seventh site. All five verifies are static and were run against 49
mutants and 3 controls: every mutant turned the expected claim red and no control
tripped. 41 of those mutants are runtime changes; 40 fail at least one jest test. The
one survivor (the owner count's test reverted to `count && count <= 1`) is equivalent
once the count's error is read, and only its claim catches it.

## Addendum 2026-09-18 (fourth): three holes found beside this PR, and two answers

The round-6 verifier found three holes that existed before PR #393 and sit outside
its diff (v3.0-TECH-DEBT 44.1r-44.1t). Two were put to the founder the same night
(`AskUserQuestion`, 2026-09-18): **[Corrected 2026-09-18, PR #393's merge audit note 1
and ADR 0164: two of the three existed before PR #393. 44.1t came from #393's own fix.
Clearing `users.restaurant_id` on leave is what made a leaver's next sign-in name no
house and carry `users.role`. Before #393 that sign-in named the house they had left,
and the `users`-row fallback still admitted them there at `users.role`, so the hole
#393 left is narrower than the one it closed, but it is #393's. Built in ADR 0164.]**

- **Sessions (44.1r).** Leaving or being removed does not end the session in that
  house: `refreshAccessToken` re-mints a token naming the house with no membership
  check, and every route not limited by `@Roles` still answers. Separately,
  `switchRestaurant`'s organisation fallback opens a session in any house of the
  organisation without a membership row (measured: 7 pairs, all three simulation
  accounts). His answer, the offered recommendation: **"Membership only"** - a
  session in a house needs a membership row there; a removed person is signed out
  of that house on their next request; organisation membership alone opens no
  house. Built in a follow-up PR right after this one.
- **"Owner only" (44.1s).** `RolesGuard` (`roles.guard.ts:30-37`) lets a manager
  through wherever a route requires `owner`; 11 non-spec `@Roles('owner')`
  decorators exist (vendor-intel scrape and sweeps, price-index reopen, and
  others) **[Corrected 2026-09-18, ADR 0164: 10. The 11th grep match is a JSDoc line,
  `price-index.controller.ts:238`]**. His answer: **"Keep managers in"** - today's behaviour stays, and those
  routes are relabelled owner-or-manager so the code says what it does (follow-up
  PR). This does not touch the grant rule above: who may GRANT owner is unchanged.
- **A leaver's next login (44.1t).** After leaving their home house, a person's
  fresh login names no house and carries `users.role` (column default `manager`),
  which nothing resets. Not put to the founder: it follows from answer A and 44.1r,
  and the follow-up PR resets the role with the house. **[Corrected 2026-09-18, ADR
  0164: not built that way. Resetting `users.role` would have been a remedy the
  founder had not seen. His sign-in answer settled it instead: `users.role` stops
  mattering for anyone with a house, and a session in no house carries no role at
  all, so the column is never read for a session and nothing needs resetting.]**

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-18 | PR #393 audit (planner R4, security reviewer) | Found the two doors disagreeing with no record deciding which was right |
| 2026-09-18 | Aldemir (chat) | Chose option 3 over (1) staff only and (2) the doors kept different |
| 2026-09-18 | Orchestrating session | Created; built on `fix/invite-role-ceiling` |
| 2026-09-18 | PR #393 round-2 planner (R1–R7) and the orchestrating session's production read | Found the `users`-fallback removal rested on a false reading (a legacy member, not a leaver), the question's premise wrong, the claims blind to three one-line mutants, and the membership sweep short by four sites |
| 2026-09-18 | Aldemir (chat) | Re-confirmed "manager or staff" and added the owner rule (addendum) |
| 2026-09-18 | PR #393 round-3 build (resumed after a restart) | Restored the `users`-row read capped by the rule, added the removal guard, re-measured production (counts only), mutation-tested the three claims (26 mutants, all killed), and filed 44.1m–44.1p, 44.1p being a role change that reaches non-members |
| 2026-09-18 | PR #393 round-3 verifier | Found both invite-read filters and removal's `is_active` filter unguarded by any test (a stub that ignored filters), the four forks unrecorded, and `accessibleRestaurantIds` missing from the records' sweep (the round-3 build had listed it only in its evidence) |
| 2026-09-18 | Aldemir (AskUserQuestion) | Answered A "Only that house", B "Give them a manager row", C "Yes, any owner" |
| 2026-09-18 | PR #393 round-4 build | Built A and B, recorded A–D, moved the invite spec onto the filter-honouring stub, closed 44.1p, and mutation-tested the six claims (52 mutants), the specs (16 jest mutants) and the migration (11 PGlite mutants), all caught |
| 2026-09-18 | PR #393 round-4 verifier | Found V1 (the role change's `users` write with `.eq("user_id", …)` dropped) passing every test, the tripwire blind to an admission removed while a dead read stayed (C5) and to `resolveRestaurantRole` and `assertAccess`, the migration row blind to a CTE backfill (C3b), two target reads missing from the fallbacks to retire, and answer A's `RolesGuard` consequence unrecorded |
| 2026-09-18 | PR #393 round-5 build | Asserted the owner's and a legacy member's `users.role` unchanged (V1 now fails a test), pinned three admissions exactly in the tripwire, made the backfill check read each statement in any order, listed six fallback sites, filed 44.1q from a production re-read, and re-ran the claims table (72 mutants, 3 controls held) and the jest table (30 mutants), all caught |
| 2026-09-18 | PR #393 merge audit of `dcf91322` (ADR 0090: planner, correctness reviewer, adversarial reviewer) | Correctness: approve with notes. Adversarial: BLOCK on `@Roles` still gated by the global `users.role` (39 decorators in 10 controllers, swept) and on leavers kept as members by the `users`-row fallback |
| 2026-09-18 | PR #393 round-6 build | Made `req.user.role` the role in the token's house, cleared `users.restaurant_id` for the house left on all three exits, put the owner rule on the Team page's remove, stopped both removals on a failed read, filtered the role change's UPDATE to the active row; re-measured production read-only; 49 claim mutants and 3 controls, 41 jest mutants (1 equivalent survivor) |
| 2026-09-18 | Aldemir (AskUserQuestion) | On the round-6 verifier's findings: "Membership only" for sessions (44.1r), "Keep managers in" for owner-only routes (44.1s); fourth addendum |
| 2026-09-18 | ADR 0164 build (`fix/sessions-follow-membership`) | Bracket-corrected the fourth addendum (44.1t came from #393's own fix; its remedy is ADR 0164's, not a reset) and the decorator counts (10 owner-only, 37 in all); built 44.1r, 44.1s and 44.1t in ADR 0164 |
