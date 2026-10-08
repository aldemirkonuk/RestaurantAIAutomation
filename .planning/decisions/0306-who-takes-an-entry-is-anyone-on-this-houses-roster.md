# 0306 — Who takes an entry is anyone on this house's roster, whatever their status

- **Status:** Proposed. Decided by the coordinator under the founder's 2026-10-07T20:04:10Z delegation, quoted verbatim below. This is the coordinator's call, not the founder's pick. The founder can overrule any part of it. A lock is his.
- **Date:** 2026-10-08
- **Decider:** the coordinator, under the delegation below. Built by lane houseswitch on `fix/a-house-switch-clears-the-last-house` (PR #654).
- **Keywords:** who takes this, assign, assignee, assignedTo, assigned_to, assignedName, assertAssigneeOnRoster, loadTeam, WhoTakesThisPopover, team_members.status, active, trial, inactive, roster, OPS-03, status-blind
- **Links:** [[0191-the-recommendations-catalogue-is-actionable-not-a-read-only-leaf]] (assignment is a note, not an act); [[0215-money-on-team-is-the-owners-and-hours-are-worked-hours]] (item 19, "Only removal counts"; item 27, the handover pick); [[0218-an-alert-finds-its-area-first-a-lead-acts-on-cards-only-and-away-is-dates]] (round 4 answer 3; not the source of this rule); `.planning/06-pages/recommendations.md` (F4); PR #654 and its `claims.d/fix-a-house-switch-clears-the-last-house.jsonl` row `TD-2026-10-07-ASSIGNEE-ON-THIS-HOUSES-ROSTER`; the ADR 0090 audit report `p4-scratch/sim-run/fixes/audits/654-505a03400/report.md` and the scenario walk `p4-scratch/sim-run/pages/SCENARIO-WALK-2026-10-07.md` row OPS-03 (both outside the repo)

## Context

Cites are at `origin/main` `c4005eb09` unless marked. PR #654's cites are at its head `8e663b43f`.

On `/recommendations`, "who takes this" writes `assignedTo`, a `team_members.id`. On main the gateway writes it as sent (`apps/api-gateway/src/analytics/recommendation-actions.service.ts:494-500`). So an id from another house, or a uuid on no roster, lands on the entry. A value that is not a uuid fails at the column, which is a `uuid` (`supabase/migrations/20260805000000_baseline_from_production.sql:4925`), as a database error rather than a refusal in words. The scenario walk filed this as OPS-03. PR #654 closes it by reading the path house's roster before the write.

As built at `505a03400`, PR #654 also refused any roster row whose status was not `active` (`recommendation-actions.service.ts:473` at that head), and the page dropped those rows (`useRecommendationsNextData.ts:820` at that head). The ADR 0090 audit at `505a03400` BLOCKed for two reasons. Dropping `trial` rows was not recorded as a decision. A CLAIMS row also cited ADR 0218 round 4 answer 3 as the basis, but that answer rules only on who a crew message to everyone reaches (`0218-an-alert-finds-its-area-first-a-lead-acts-on-cards-only-and-away-is-dates.md:558-562`). The words "an active member" came from the scenario walk's suggested fix, not from the founder.

### The delegation (verbatim)

The founder, 2026-10-07T20:04:10Z: *"Do not ask me questions, I allow and approve for you to decide on your own. If its a decision question then research deep, find answers. While you can change decisions, you cannot change any feature we decided unless it breaks everything then only you can, but before that you should research."*

### What is already decided

- **F4, the founder, 2026-09-06:** the docket keeps assignment, *"and the roster it reads is the team's"* (`.planning/06-pages/recommendations.md:821`). F4 names which roster the page reads. It says nothing about statuses. The roster's four states stay four (`:52-54`): a read that failed must not be shown as an empty roster, because that sends someone to `/team` to add a teammate they already have.
- **ADR 0215 item 19:** *"Only removal counts"*. The item rules on when a departure is recorded: on removal of the row, never on a status change (`0215-money-on-team-is-the-owners-and-hours-are-worked-hours.md:451-456`). This ADR cites it only for the narrower point that a person marked inactive "is still on the roster" (`:380`). It does not rule on who may be assigned.
- **ADR 0191:** pins, ratings and assignments "are notes, not acts" (`0191-the-recommendations-catalogue-is-actionable-not-a-read-only-leaf.md:484-488`). The popover says assigning "sends nothing and commits nothing" (`apps/web/src/pages/recommendations/next/WhoTakesThisPopover.tsx:132`).

### What the code does today

- **The team's roster is every row.** `listMembers` selects `*` with no status filter (`apps/api-gateway/src/team/team.service.ts:529-533`). `/team`'s roster sheet lists every row and tags the non-active ones (`apps/web/src/pages/team/next/RosterSheet.tsx:447`). Main's `loadTeam` offered every row (`useRecommendationsNextData.ts:761-774`).
- **Every other gateway refusal of a named roster pick that was read for this ADR ignores status.**
  - `assertMemberInRestaurant` (`team.service.ts:455-467`).
  - `rosterRow` (`apps/api-gateway/src/areas/house-areas.service.ts:774-786`, used at `:373` and `:460`), including area membership with lead.
  - A crew message to named people (`apps/api-gateway/src/team/team.controller.ts:534`).
  - The handover target when someone is removed (ADR 0215 item 27; `team.service.ts:1661-1671`).
  - The one status gate on a roster row at the gateway that was found is the crew message to everyone (`team.controller.ts:535`), and that is the audience ADR 0218 r4a3 rules on.
- **The web's suggestion lists on `/team` do filter by status.** Cover candidates (`apps/web/src/pages/team/next/WeekGrid.tsx:259`, `useTeamNextData.ts:515`) and the sales sheet (`SalesSheet.tsx:60`) offer `active` rows only. The crew-message count and audience (`TeamOverlays.tsx:290`, `:523`) take `active`, account-linked rows. The area picker leaves out `inactive` rows (`AreasSheet.tsx:87`). These lists choose someone to work a shift or cover, to count as sales, to receive a message or to join an area. They are page suggestions, not gateway refusals, and none of them is an ADR ruling. They do not bind this rule: an assignment is a note that sends nothing and grants nothing (ADR 0191), and they are the strongest rival precedent for filtering a page picker, which is why they are named here.
- **The status column.** `team_members.status` is `text NOT NULL DEFAULT 'active'` with no CHECK (`baseline_from_production.sql:5642`). The DTO admits exactly `active`, `inactive` and `trial` (`apps/api-gateway/src/team/dto/team.dto.ts:48`) under a whitelisting ValidationPipe (`apps/api-gateway/src/main.ts:54-55`). The service's own writes set `active` or `trial` (`team.service.ts:894`, `:995`, `:1040`) or the DTO's value (`:1054`). Invite placeholders are written `active` (`apps/api-gateway/src/auth/auth.service.ts:2455`, `:2466`), and so is the row written for a signed-in member who accepts an invite (`:2535`). The original schema comment reads `active | inactive | trial` (`supabase/migrations_archive/20260716010000_team_ops.sql:34`).
- **Who reads `assigned_to`.** A git grep of non-test code under `apps/`, `services/`, `packages/`, `scripts/`, `backend/` and `supabase/` finds it read at the gateway only in `recommendation-actions.service.ts` (`:347`, `:1101-1102`, `:1218-1221`, `:1740`) and in the merge in `recommendations.service.ts:878`. The web uses the value only in the popover, to mark who has the entry (`WhoTakesThisPopover.tsx:93`) and to show the "Nobody" choice (`:116`). The note gate keys ownership on `assigned_by`, not on `assigned_to` (`recommendation-actions.service.ts:1111-1116`).

## Options considered

1. **Any row of this house's roster, status not read (chosen).** The gateway refuses an id that is not a uuid or not a row of the path house's roster, and the page offers every row. This matches every gateway refusal of a named roster pick listed above. It does not match the `/team` suggestion lists, which are not refusals (Context). Cost: an inactive person can be picked, and the popover does not say they are inactive (Consequences).
2. **Active only (as built at `505a03400`). Rejected.** On the coordinator's reading of F4, the roster the page reads is the team's, and `/team` lists every row. Main's `loadTeam` offered every row too. Active-only would narrow that by status, and nothing breaks without it. ADR 0215 item 19 keeps an inactive person on the roster. Its only cited basis, ADR 0218 r4a3, rules on a broadcast audience. The same ADR's named audience ignores status (`team.controller.ts:534`). A house whose rows were all `trial` or `inactive` would also read "The roster is empty. Add a teammate on /team first." (`WhoTakesThisPopover.tsx:57`), the false sentence F4's four states forbid. It also lets a staff member, who cannot read the roster (`team.service.ts:519-523`), learn a colleague's status from a 200 or a 400.
3. **`{active, trial}`, refuse `inactive`. Rejected.** This was the research pass's first pick, and its own adversarial refute did not survive. An inactive person is still on the roster (ADR 0215 item 19, `:380`), so on the coordinator's reading of F4 refusing them narrows what the page reads. The assignment grants nothing that a refusal would protect.
4. **A three-value allow-list `{active, trial, inactive}` that refuses any other string. Rejected.** For every value the code's writers listed above can set, it equals option 1. It differs only for a legacy string (production was not read) or a status added later. In both cases it would hide a person `/team` lists and could print the false "roster is empty" line. It would also be a third copy of the status vocabulary, after the DTO and `/team`, that can drift. Failing closed pays where opening carries risk. Here the coordinator found no risk in opening, because an assignment grants nothing.
5. **The page offers active rows only, and the gateway accepts any row. Rejected.** The page would offer fewer people than `/team`'s roster sheet lists and than the gateway accepts. It keeps the page and the gateway disagreeing, the class of defect the audit's planner raised as risk 4. The `/team` suggestion lists that do filter (Context) choose people to work or receive something, which an assignment does not.
6. **Do nothing (main). Rejected.** An id from another house, or a uuid on no roster, would still be written as the assignee, and a value that is not a uuid would still fail as a database error (OPS-03).

## Decision

**An assignee id must be a row of the path house's roster (`team_members`, same `restaurant_id`). The row's status is not read, and the page offers every row the roster read returns.**

What carried it:
- The coordinator reads F4's *"the roster it reads is the team's"* as every row of that roster, which is what main's page offered and what `/team`'s roster sheet lists. ADR 0215 item 19 keeps an inactive person on the roster. Every gateway refusal of a named roster pick listed in Context reads the roster the same way.
- It refuses everything OPS-03 named, in words: another house's id, an id on no roster, and a value that is not a uuid.
- It makes no claim beyond what an assignment does. An assignment is a note, and the coordinator found nothing that it sends or grants.

This replaces PR #654's appeal to ADR 0218 round 4 answer 3, which stays a ruling about the crew message to everyone and nothing more.

**As built on PR #654 at `8e663b43f`:**
- `assertAssigneeOnRoster` selects only `id`, filters by the path house and the id, and refuses a missing row (`recommendation-actions.service.ts:450-477`).
- The refusal reads *"That person is not on this house's team, so the entry was not assigned to them."* (`:455`).
- A roster read that fails refuses the write.
- `loadTeam` has no status filter (`useRecommendationsNextData.ts:803`, rows mapped at `:817`).

## Consequences

- **Easier:**
  - The page and the gateway accept the same people, so the page cannot offer someone the gateway refuses.
  - There is one status vocabulary fewer to keep in step.
- **Residuals, the same under every option above, disclosed and not closed:**
  - **A name alone is not checked.** The roster read runs only when `assignedTo` is set (`recommendation-actions.service.ts:490` at `8e663b43f`). A body with only `assignedName`, or with `assignedTo: null` and an `assignedName`, writes that name (`:554`), and the page draws the name as the assignee (`apps/web/src/pages/recommendations/next/Entry.tsx:793`, `:1407`). So any name can still appear as "assigned to". This must not be used to justify a status gate.
  - **The popover shows no status.** An inactive person looks the same as an active one in `WhoTakesThisPopover.tsx`. `RosterSheet.tsx:447` already tags non-active rows. A display tag, not a refusal, is owed. It was left out of #654 for the 15-file cap.
  - **An assignment outlives a later change.** `assigned_to` has no foreign key (`baseline_from_production.sql:4925`) and nothing found sweeps it, so an assignment stays after the person turns inactive or is removed.
  - **Invite placeholders are assignable.** They are `active` roster rows (`auth.service.ts:2448-2467`). Revoking an invite deletes the `organization_invites` row (`apps/api-gateway/src/restaurants/members.service.ts:674-679`, in `revokeInvite` at `:667`), and nothing read for this ADR removes its `team_members` placeholder. `team_members.invite_id` has no foreign key in the baseline (`:5631`). This is roster hygiene for `/team`, not an assignment rule.
  - **Staff cannot read the roster.** `listMembers` is manager-gated (`team.service.ts:519-523`), so a staff member's popover says the roster could not be read. The gateway still accepts a roster id that the staff member sends when the note gate lets the write through.
  - **Production was not read.** `team_members.status` values in production were not measured. "Only `active`, `trial` and `inactive` are written" rests on the code's writers listed in Context, not on a query.
- **Revisit when:**
  - A status gains a meaning that should stop someone taking work. The signal is a status added to the DTO, or a CHECK added to the column.
  - Or an assignment starts to send or grant something, such as a notice to the assignee. Either one makes the status worth reading, and the refusal belongs to that change.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-07 | ADR 0090 audit of PR #654 at `505a03400` (`p4-scratch/sim-run/fixes/audits/654-505a03400/report.md`, outside the repo) | BLOCK that called for this record |
| 2026-10-08 | The coordinator, research workflow (finders, decide, adversarial refute of `{active, trial}`, adversarial pass on status-blind) | Created as Proposed; status-blind survived its adversarial pass |
| 2026-10-08 | Independent verify of this record at `606004296` and #654 at `c18c94a5f` | One MUST: option 1's "status-blind, like every other named pick" was broader than the code, since `/team`'s web suggestion lists filter by status. Shoulds: F4 and ADR 0215 item 19 were read further than they say, two cites were loose, the review trail was out of order, and the "only write of `assigned_to`" sentence was pinned in one file |
| 2026-10-08 | The coordinator, under the delegation | Scoped option 1 to gateway refusals and named the `/team` suggestion lists; worded F4 as the coordinator's reading; cited ADR 0215 item 19 only for an inactive person staying on the roster; fixed the `:2535` and `revokeInvite` cites; said that main refused a non-uuid at the column, not in words; restated cites at `c4005eb09` and #654's cites at `8e663b43f`; changed the status from Locked to Proposed, matching ADR 0309 |
