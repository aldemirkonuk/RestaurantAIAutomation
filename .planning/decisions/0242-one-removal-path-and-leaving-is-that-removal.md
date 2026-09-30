# 0242 — One removal path, and leaving on your own is that same removal

- **Status:** Locked 2026-09-29. The founder delegated OD-204 (verbatim below), and this ADR records the choice made under that delegation.
- **Date:** 2026-09-29
- **Decider:** Aldemir (founder), by delegation. His answer, verbatim, given in chat on 2026-09-29: *"Open Decision, I leave that to you, do the best approach"*.
- **Keywords:** removal, remove member, leave house, self-leave, delete account, open pool, shifts, roster, team_members, removeFromHouse, deleteMember, removeMember, leaveRestaurant, notify managers
- **Links:** OD-204 (`OPEN-DECISIONS.md:99`); defect entry `tech-debt.d/2026-09-29-docs-merge-queue-followups-2026-09-29.md:15`; [[0215-money-on-team-is-the-owners-and-hours-are-worked-hours]] (item 26: shifts go back to the open pool; item 27: "Replace with"); [[0162-managers-grant-manager-or-staff-on-both-doors]] (owners manage owners); [[0164-sessions-follow-membership-and-several-houses-choose]] (a leave is stamped `left`); [[0088-a-team-change-is-recorded-and-a-wage-is-not-invented]] (a removal is recorded).

## Context

On `origin/main` 71ae5449b, four pieces of code took a person out of a house, and only one of them dealt with the person's shifts:

| Door | Code | Shifts | Roster row | Audit row |
|---|---|---|---|---|
| Team page "Remove" | `TeamService.deleteMember` (`team.service.ts:1095`) | to the open pool, one in progress cut, optional hand-over (#502) | deleted | yes |
| Settings "Remove", and removing yourself there | `MembersService.removeMember` (`members.service.ts:323`) | **kept, on someone who can no longer sign in** | **kept** | no |
| Profile "Leave this house" | `AuthService.leaveRestaurant` (`auth.service.ts:4414`) | **kept** | **kept** | no |
| Delete account | `AuthService.deleteAccount` | **kept** | kept, its `user_id` gone with the account | no |

The founder's item 93 (2026-09-28) for the Team page was *"back to the open pool absolutely"*. The other three doors never did that.

## Research

- **Slack.** An admin deactivating someone and a person deactivating themselves end in the same state. The Primary Owner must transfer ownership first. (slack.com/help/articles/204475027, /203953146)
- **Google Workspace.** Only an admin can remove a user. Deleting a user offers an optional transfer of their data, and anything not transferred is lost. (knowledge.workspace.google.com … delete-or-remove-a-user)
- **Toast / Sling.** Toast has a single archive or terminate path, and its Toast docs do not say what happens to shifts. Sling asks the admin whether to delete the person's future shifts or leave them unassigned. (support.toasttab.com; support.getsling.com 1078515)
- **7shifts.** Admins deactivate; an employee cannot leave on their own and must ask a manager. Future shifts stay assigned to the inactive person until someone deletes them. (kb.7shifts.com 27587775303315, 29652928424083)
- **Deputy.** Admins archive, and archiving is **blocked** until every future shift is deleted or reassigned. Employees cannot leave on their own. (help.deputy.com 4764904256143, 4621554999823)
- **Homebase.** Terminating someone takes them off the schedule, with a reason recorded (support.joinhomebase.com 360012344352). Only a snippet was read.

Four of these sources returned 403 or 401 to the research agent (7shifts' deactivation page, both Deputy pages, Homebase), so what they say rests on search snippets. Nothing was found for When I Work. Across the rest, where two paths exist they reach the same end state. No product silently releases shifts into an open pool, and the scheduling tools mostly have no self-leave at all.

## Options considered

1. **(a) `removeMember` calls the Team removal.** Shifts go to the open pool with no hand-over picker on that path. **Taken, extended to every door.**
2. **(b) Retire the members route and send every removal through Team.** Rejected: the route is live in Settings (`useSettingsNextData.ts:838`; the legacy `Settings.tsx` that also called it was deleted by #494) and takes a user id, while Team takes a roster id. It is also the only way to remove someone who has access but no roster row. Retiring it moves a problem rather than closing one.
3. **(c) Keep both, and have `removeMember` refuse while the person holds future shifts.** Rejected: it keeps two code paths that will drift again (they already had: no audit row on this door). It also blocks self-leave on the Settings door.
4. **(d) `removeMember` refuses every removal and points to Team.** Rejected for the same reason as (b), and it removes self-leave from Settings.
5. **Self-leave refused while the person holds upcoming shifts** (Deputy's rule, and the adversarial pass's strongest alternative). Rejected for now. A person cannot always reach a manager, and a house that will not let someone leave keeps their access to its data against their will. The notice below is what answers the "nobody sees the hole" risk. This option stays the revisit trigger (§Consequences).
6. **Do nothing.** A removed or departed person keeps future shifts they will never work, and the roster lists someone who cannot sign in.

## Decision

**`TeamService.removeFromHouse` is the one removal of a rostered person. Every door ends there. Leaving on your own, from Settings, the profile or by deleting your account, is that same removal. The house's owners and managers are told, in their inbox and by push, what the leave opened.**

- `deleteMember` is now the manager gate plus `removeFromHouse`, the old body, unchanged in order. That order is: refusals, then shift release, then the calendar stop, the `users` row, the access row, the `left` stamp for oneself, eviction, invite cancel, the roster row, and the audit row.
- `MembersService.removeMember` keeps its own gate (owner or manager, or oneself), owners-manage-owners and the last-owner guard, all before any write. It then hands a target who has a roster row to `removeFromHouse`. There is one roster row per person per house (`uq_team_members_user`, baseline :11957). If TeamService is not wired, it refuses with a 500. It never falls back to revoking access alone. A person with no roster row has no shifts to release, so they keep the old access-only path.
- `AuthService.leaveRestaurant` and `deleteAccount` look `MembersService` up through `ModuleRef` at call time and run `removeMember(self)`. `deleteAccount` does this for each active house, before any account row goes. Without the lookup, both refuse with a 500 and change nothing. They look it up rather than inject it because `RestaurantsModule` imports `AuthModule`, so an import the other way would be a module ring. `RestaurantsModule` now imports `TeamModule`. That graph has no ring: it was checked over every `*.module.ts`.
- **Self-leave.** The leaver gets no "you were removed" notice. The audit row carries `self_leave: true` and `via`. If the leave opened or split shifts, or left shifts the house had no clock to judge (`unjudged`, which are still on the leaver's name), `noticeToHouseLeads` writes an inbox notice to every owner and manager with a live membership (read through `houseMembersInRoles`, which applies `isLiveMembership`, so a lapsed `valid_until` is not told) except the leaver, and `ExpoPushService.sendToUsers` pushes the same words. For example: *"Sam left the team — 2 of their upcoming shifts are open again and need someone on them."*
- A removal by an owner through Settings now says "An owner removed you". On the Team page, removing someone else keeps its wording ("A manager removed you …"). A manager removing their own roster row there is now a self-leave: they get no removal notice, and the other owners and managers get the leave notice.

## Adversarial pass (a separate agent, told to kill it)

Verdict: **SURVIVES, with fixes.** These fixes were built:
- The leads' notice was inbox-only. It now also pushes.
- Shifts the house had no clock to judge stayed on the leaver's name with no notice. They are now named in the notice and trigger it on their own.
- A loop over "roster rows" allowed duplicate removals. It was replaced by the single row the unique index guarantees.
- `deleteAccount` was a fourth door that released nothing. It now runs the same removal for each house first, so "one removal path" holds for every door that ends a membership.

These were **not taken**, stated plainly:
- **The leaver sees no shift count before confirming.** The profile's leave dialog (`ProfileNext.tsx`) would need a preview endpoint and a web change. That is a follow-up, not built here.
- **Settings sends no device time zone** (`deviceZone` is null on the members door). A house with no zone and no country therefore keeps possibly-started shifts whole and unjudged. They are named in the leads' notice, but not cut.
- **`removeMember` still returns nothing to the Settings caller.** Returning the receipt needs a controller change that did not fit the 15-file cap.
- **The `ModuleRef` lookup is proven by specs that stub it, not by booting the app.** The CI gateway-boot job builds the DI context but does not call the route. **[Closed 2026-09-30 by PR #532: `apps/api-gateway/src/auth/leave-and-delete-account.routes.spec.ts` boots the full `AppModule`, calls `POST /auth/me/leave-restaurant` and `DELETE /auth/me`, and leaves `moduleRef` alone; `{ strict: true }` on both lookups fails all four cases.]**
- **The last manager can leave.** Only the last owner is guarded, which is unchanged.
- **`deleteAccount` can now stop part-way** (the audit's note). It leaves each house in turn, so a removal that fails in house 2, for example a shift-release error, leaves house 1 already left and the account still present. A retry re-reads the houses and carries on. A persistent failure in one house now blocks deletion rather than deleting while shifts stay on a person who no longer exists. It fails closed, and it widens OD-202 (a removal is several writes, not one transaction). `deleteAccount` stops the person's calendar links in every house before this loop, so after such a failure the links in the houses not yet left are already stopped.
- **Log lines on the removal path still begin "deleteMember could not …"**, whichever door ran it. There are four: the users-row clear and the access revoke in `removeFromHouse`, `releaseShiftsOf`'s refusal, and `cannotReadRemovalTarget`. ADR-0162-LEAVING-ENDS-MEMBERSHIP pins the first one's text, so all four were left as they were rather than renamed piecemeal.
- **The error codes for leaving changed.** A non-member who leaves now gets 403 from `assertMembership`, where it used to get 400. The last-owner refusal is still a 400. When the `ModuleRef` lookup finds no `MembersService`, `get` throws, so the request fails with a 500 before any write. A member known only by a `users` row can now leave.
- **A person known only by a `users` row who leaves is not stamped `left`.** The members door's `users`-row branch writes no `house_memberships_ended` stamp, so they land on /no-access rather than /get-started. The old `leaveRestaurant` refused such a person outright. This is narrow, new, and a small departure from ADR 0164.
- **Two owners leaving at the same moment can both pass the last-owner check.** Count-then-write was true of every removal path before this change. The window is wider now, because shift release and the calendar stop run between the count and the delete. See OD-202.
- **The leaver's `display_name` appears only in the title** of the leads' notice (`"<name> left the team"`). The inbox notice cuts that title to 500 characters. The push title is sent without a limit. The message holds only shift counts. Both are plain text, with no HTML sink.
- **The last-owner counts and the gates (`assertAccess`, `assertMembership`) still read `is_active` alone, not `valid_until`.** Only the leads' notice was moved onto the live-membership reader here. Moving the gates and the counts together is a follow-up: moving one would make the guards disagree. Nothing in the gateway writes `valid_until` today.
- **Leaving from the profile now fails with a 500 when the shift release fails**, and the person stays a member. It fails closed, as account deletion does.
- **Zone setup access (#518) goes with the access row.** `removeFromHouse` and the members door's access-only branch both delete `user_restaurant_access`, and with it `zone_setup_access`, so a returning person starts without it.

## Consequences

- **Easier:** a person who leaves or is removed by any door is off the roster, and their unstarted shifts are open, every time. There is one place to change what a removal does.
- **Harder, or given up:** a self-leave now changes the schedule without a manager choosing it. The notice is the mitigation, not a veto. Removing a rostered person through Settings now needs `TeamService`, so the members service no longer works on its own for that case.
- **Revisit when:** a leave opens a shift that nobody covers, and the notice turns out to have been missed. Then build Deputy's rule (option 5): self-leave waits for a manager while the person has shifts in the next N hours. Also revisit if the founder wants the leave dialog to show the count first.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-29 | Founder | Delegated OD-204 (verbatim above). |
| 2026-09-29 | Research agent | The vendor findings above; 7shifts, Deputy and Homebase pages returned 401/403, so those rest on snippets. |
| 2026-09-29 | Adversarial agent | SURVIVES with fixes; four built, five named as not taken. |
| 2026-09-29 | Build session | `team-pay.spec.ts` K5 (9 cases). With `members.service.ts`, `auth.service.ts`, `access-audit.ts` or `team.service.ts` reverted to `origin/main`, K5 fails 6, 3, 4 and 5 of its 9 cases respectively. Five older claims (ADR-0162 ×2, ADR-0164 ×1, ADR-0111 ×1, and the OD-204 tripwire) were re-cut in place to the code's new location. |
| 2026-09-29 | Build session (after #497 merged) | The leads' notice moved onto `houseMembersInRoles`. #497's claim `SEC-2026-09-28-WEBSOCKET-ROLE-GATE` pins the count of role readers on `user_restaurant_access`, and the move also closes the lapsed-lead gap the full-gate planner raised. K5 now has 10 cases, adding "a lead whose membership has lapsed is not told". Re-measured with each file reverted to `origin/main`, K5 fails 7, 3, 5 and 6 of those 10. |
| 2026-09-30 | Build session (PR #532) | Real-route spec for leave and delete-account; mutations (leave skipping `removeMember`, the delete loop skipping it, `{ strict: true }`, `TeamModule` dropped from `RestaurantsModule`, the access-only branch forced) each fail it; both ADR 0090 reviewers re-ran them independently. |
