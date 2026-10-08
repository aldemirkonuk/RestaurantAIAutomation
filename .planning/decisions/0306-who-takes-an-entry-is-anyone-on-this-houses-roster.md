# 0306 — Who takes an entry is anyone on this house's roster, whatever their status

- **Status:** Locked by the coordinator, decided under the founder's 2026-10-07T20:04:10Z delegation, quoted verbatim below. This is not the founder's pick. He can overrule any part of it.
- **Date:** 2026-10-08
- **Decider:** the coordinator, under the delegation below. Built by lane houseswitch on `fix/a-house-switch-clears-the-last-house` (PR #654).
- **Keywords:** who takes this, assign, assignee, assignedTo, assigned_to, assignedName, assertAssigneeOnRoster, loadTeam, WhoTakesThisPopover, team_members.status, active, trial, inactive, roster, OPS-03, status-blind
- **Links:** [[0191-the-recommendations-catalogue-is-actionable-not-a-read-only-leaf]] (assignment is a note, not an act); [[0215-money-on-team-is-the-owners-and-hours-are-worked-hours]] (item 19, "Only removal counts"); [[0218-an-alert-finds-its-area-first-a-lead-acts-on-cards-only-and-away-is-dates]] (round 4 answer 3; not the source of this rule); `.planning/06-pages/recommendations.md` (F4); PR #654 and its `claims.d/fix-a-house-switch-clears-the-last-house.jsonl` row `TD-2026-10-07-ASSIGNEE-ON-THIS-HOUSES-ROSTER`; the ADR 0090 audit report `p4-scratch/sim-run/fixes/audits/654-505a03400/report.md` and the scenario walk `p4-scratch/sim-run/pages/SCENARIO-WALK-2026-10-07.md` row OPS-03 (both outside the repo)

## Context

Cites are at `origin/main` `62f8967b4` unless marked.

On `/recommendations`, "who takes this" writes `assignedTo`, a `team_members.id`. On main the gateway writes it as sent (`apps/api-gateway/src/analytics/recommendation-actions.service.ts:494-500`), so an id from another house or any string lands on the entry. The scenario walk filed this as OPS-03. PR #654 closes it by reading the path house's roster before the write.

As built at `505a03400`, PR #654 also refused any roster row whose status was not `active` (`recommendation-actions.service.ts:473` at that head), and the page dropped those rows (`useRecommendationsNextData.ts:820` at that head). The ADR 0090 audit at `505a03400` BLOCKed for two reasons. Dropping `trial` rows was not recorded as a decision. A CLAIMS row also cited ADR 0218 round 4 answer 3 as the basis, but that answer rules only on who a crew message to everyone reaches (`0218-an-alert-finds-its-area-first-a-lead-acts-on-cards-only-and-away-is-dates.md:558-562`). The words "an active member" came from the scenario walk's suggested fix, not from the founder.

### The delegation (verbatim)

The founder, 2026-10-07T20:04:10Z: *"Do not ask me questions, I allow and approve for you to decide on your own. If its a decision question then research deep, find answers. While you can change decisions, you cannot change any feature we decided unless it breaks everything then only you can, but before that you should research."*

### What is already decided

- **F4, the founder, 2026-09-06:** the docket keeps assignment, *"and the roster it reads is the team's"* (`.planning/06-pages/recommendations.md:821`). The roster's four states stay four (`:52-54`). A read that failed must not be shown as an empty roster, because that sends someone to `/team` to add a teammate they already have.
- **ADR 0215 item 19:** *"Only removal counts"*: "Leaves the roster" means the row is removed, never a status change (`0215-money-on-team-is-the-owners-and-hours-are-worked-hours.md:451-456`). A person marked inactive "is still on the roster" (`:380`).
- **ADR 0191:** pins, ratings and assignments "are notes, not acts" (`0191-the-recommendations-catalogue-is-actionable-not-a-read-only-leaf.md:484-488`). The popover says assigning "sends nothing and commits nothing" (`apps/web/src/pages/recommendations/next/WhoTakesThisPopover.tsx:132`).

### What the code does today

- **The team's roster is every row.** `listMembers` selects `*` with no status filter (`apps/api-gateway/src/team/team.service.ts:529-533`). `/team` lists every row and tags the non-active ones (`apps/web/src/pages/team/next/RosterSheet.tsx:447`). Main's `loadTeam` offered every row (`useRecommendationsNextData.ts:761-774`).
- **Every other named roster pick at the gateway ignores status.**
  - `assertMemberInRestaurant` (`team.service.ts:455-467`).
  - `rosterRow` (`apps/api-gateway/src/areas/house-areas.service.ts:774-786`, used at `:373` and `:460`), including area membership with lead.
  - A crew message to named people (`apps/api-gateway/src/team/team.controller.ts:534`).
  - The one status gate is the crew message to everyone (`team.controller.ts:535`), and that is the audience ADR 0218 r4a3 rules on.
- **The status column.** `team_members.status` is `text NOT NULL DEFAULT 'active'` with no CHECK (`supabase/migrations/20260805000000_baseline_from_production.sql:5642`). The DTO admits exactly `active`, `inactive` and `trial` (`apps/api-gateway/src/team/dto/team.dto.ts:48`) under a whitelisting ValidationPipe (`apps/api-gateway/src/main.ts:54-55`). The service's own writes set `active` or `trial` (`team.service.ts:894`, `:995`, `:1040`) or the DTO's value (`:1054`). Invite placeholders are written `active` (`apps/api-gateway/src/auth/auth.service.ts:2455`, `:2466`, `:2535`). The original schema comment reads `active | inactive | trial` (`supabase/migrations_archive/20260716010000_team_ops.sql:34`).
- **Who reads `assigned_to`.** Only `recommendation-actions.service.ts` (`:347`, `:1101-1102`, `:1218-1221`, `:1740`) and the merge in `recommendations.service.ts:851`. The note gate keys ownership on `assigned_by`, not on `assigned_to`.

## Options considered

1. **Any row of this house's roster, status not read (chosen).** The gateway refuses an id that is not a uuid or not a row of the path house's roster, and the page offers every row. Status-blind, like every other named pick. Cost: an inactive person can be picked, and the popover does not say they are inactive (Consequences).
2. **Active only (as built at `505a03400`). Rejected.** It narrows F4's "the roster it reads is the team's" by status, against ADR 0215 item 19, and nothing breaks without it. Its only cited basis, ADR 0218 r4a3, rules on a broadcast audience. The same ADR's named audience ignores status (`team.controller.ts:534`). A house whose rows were all `trial` or `inactive` would also read "The roster is empty. Add a teammate on /team first." (`WhoTakesThisPopover.tsx:57`), which is the false sentence F4's four states forbid. It also lets a staff member, who cannot read the roster (`team.service.ts:519-523`), learn a colleague's status from a 200 or a 400.
3. **`{active, trial}`, refuse `inactive`. Rejected.** This was the research pass's first pick, and its own adversarial refute did not survive. An inactive person is still on the roster by ruling (ADR 0215 item 19), so refusing them narrows a decided feature. The assignment grants nothing that a refusal would protect.
4. **A three-value allow-list `{active, trial, inactive}` that refuses any other string. Rejected.** For every value the code can write today it equals option 1. It differs only for a legacy string (production was not read) or a status added later. In both cases it would hide a person `/team` lists and could print the false "roster is empty" line. It would also be a third copy of the status vocabulary, after the DTO and `/team`, that can drift. Failing closed pays where opening carries risk. Here opening risks nothing, because assignment grants nothing.
5. **The page offers active rows only, and the gateway accepts any row. Rejected.** The page would offer fewer people than `/team` lists and than the gateway accepts, which narrows F4 on the page alone. It keeps the page and the gateway disagreeing, the class of defect the audit's planner raised as risk 4.
6. **Do nothing (main). Rejected.** An id from another house, or any string, would still be written as the assignee (OPS-03).

## Decision

**An assignee id must be a row of the path house's roster (`team_members`, same `restaurant_id`). The row's status is not read, and the page offers every row the roster read returns.**

What carried it:
- The rule matches the decided feature. F4 says the roster is the team's, ADR 0215 item 19 says only removal takes a person off it, and every other gateway pick of a named roster person reads it the same way.
- It refuses everything OPS-03 named: another house's id, an id on no roster, and a string that is not an id.
- It makes no claim beyond what an assignment does. An assignment sends nothing, grants nothing, and is a note.

This replaces PR #654's appeal to ADR 0218 round 4 answer 3, which stays a ruling about the crew message to everyone and nothing more.

**As built on PR #654 at `c18c94a5f`:**
- `assertAssigneeOnRoster` selects only `id`, filters by the path house and the id, and refuses a missing row (`recommendation-actions.service.ts:449-476` at that head).
- The refusal reads *"That person is not on this house's team, so the entry was not assigned to them."* (`:454`).
- A roster read that fails refuses the write.
- `loadTeam` has no status filter (`useRecommendationsNextData.ts:817` at that head).

## Consequences

- **Easier:**
  - The page and the gateway accept the same people, so the page cannot offer someone the gateway refuses.
  - There is one status vocabulary fewer to keep in step.
- **Residuals, the same under every option above, disclosed and not closed:**
  - **A name alone is not checked.** The roster read runs only when `assignedTo` is set (`recommendation-actions.service.ts:489` at `c18c94a5f`). A body with only `assignedName`, or with `assignedTo: null` and an `assignedName`, writes that name (`:553`), and the page draws the name as the assignee (`apps/web/src/pages/recommendations/next/Entry.tsx:793`, `:1407`). So any name can still appear as "assigned to". This must not be used to justify a status gate.
  - **The popover shows no status.** An inactive person looks the same as an active one in `WhoTakesThisPopover.tsx`. `RosterSheet.tsx:447` already tags non-active rows. A display tag, not a refusal, is owed. It was left out of #654 for the 15-file cap.
  - **An assignment outlives a later change.** `assigned_to` has no foreign key (`baseline_from_production.sql:4925`) and nothing sweeps it, so an assignment stays after the person turns inactive or is removed.
  - **Invite placeholders are assignable.** They are `active` roster rows (`auth.service.ts:2448-2467`). Revoking an invite deletes the `organization_invites` row (`apps/api-gateway/src/restaurants/members.service.ts:667`), and nothing I read removes its `team_members` placeholder. `team_members.invite_id` has no foreign key in the baseline (`:5631`). This is roster hygiene for `/team`, not an assignment rule.
  - **Staff cannot read the roster.** `listMembers` is manager-gated (`team.service.ts:519-523`), so a staff member's popover says the roster could not be read. The gateway still accepts a roster id that the staff member sends when the note gate lets the write through.
  - **Production was not read.** `team_members.status` values in production were not measured. "Only `active`, `trial` and `inactive` exist" rests on the code's writers, not on a query.
- **Revisit when:**
  - A status gains a meaning that should stop someone taking work. The signal is a status added to the DTO, or a CHECK added to the column.
  - Or an assignment starts to send or grant something, such as a notice to the assignee. Either one makes the status worth reading, and the refusal belongs to that change.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-08 | the coordinator, research workflow (finders, decide, adversarial refute of `{active, trial}`, adversarial pass on status-blind) | Created; status-blind survived its adversarial pass |
| 2026-10-07 | ADR 0090 audit of PR #654 at `505a03400` (`p4-scratch/sim-run/fixes/audits/654-505a03400/report.md`, outside the repo) | BLOCK that called for this record |
