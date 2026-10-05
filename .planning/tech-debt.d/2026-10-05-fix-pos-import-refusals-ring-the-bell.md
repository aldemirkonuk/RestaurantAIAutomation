## Every bell note but three still pushes people who switched push off — OPEN — 2026-10-05

Found while building [ADR 0281](../decisions/0281-a-pos-sale-is-dated-by-its-check-and-the-import-says-what-it-did.md)'s till-refusal bell note on `fix/pos-import-refusals-ring-the-bell`. The founder's answer for that note, "Respect their switch (Recommended)", carried this option text: "Other notes still ignore the switch today (separate, known fix)." This entry is that fix, filed so it is not lost.

**Where.** `persistForRestaurant`'s "Mobile fan-out" (`apps/api-gateway/src/notifications/notifications.service.ts:805-822`) pushes everyone it alerted (`alertIds ?? userIds`) whenever the row's priority is not `low` and the caller did not pass `skipMobilePush`. It reads no `notification_preferences.push_enabled`. So a person who switched push off in their settings is still pushed by every note that goes through the funnel at a priority other than `low`.

**Who already respects the switch** (each by its own read, not by the funnel):
- the team broadcast, `apps/api-gateway/src/team/team.controller.ts:610-618` (`skipMobilePush`, then its own push without the opt-outs; closed in `v3.0-TECH-DEBT.md:5533`, "A team broadcast pushed every recipient twice, and reached opt-outs and inbox-only sends");
- the Away-release delivery, `apps/api-gateway/src/team/away-release.service.ts:228-243` (same shape);
- the till-refusal note, `apps/api-gateway/src/pos-hub/refused-checks-note.ts:1097` (`splitByPushSettings`): a person whose `push` reads `false` gets the row at priority `low`, so the funnel does not push it.

`NotesService.create` (`apps/api-gateway/src/team/notes.service.ts:468`) is the case the same legacy entry lists as "Not fixed here", with claims row `TD-2026-09-26-NOTES-SERVICE-DOUBLE-PUSH-OPT-OUT-BYPASS` (open). Measured 2026-10-05 on this branch: `git grep -n "persistForRestaurant(" -- 'apps/api-gateway/src/**/*.ts' ':!*.spec.ts'` finds 25 call lines in 15 files besides the definition (`notifications.service.ts:619`). Of those, only the broadcast and the Away release pass `skipMobilePush` (`git grep -n skipMobilePush -- 'apps/api-gateway/src/**/*.ts' ':!*.spec.ts'`); the till-refusal note is the third through its own priority choice. The other 22 were not each read for a switch check of their own, and how many of them write at a priority other than `low` was not counted.

**Fix.** Read `push_enabled` for the alerted people inside the fan-out, one read per write, and leave out those whose switch is off. What a failed preferences read does is a product choice for that branch to ask: the founder answered it for the till-refusal note only ("Push anyway (Recommended)", because that note is the only place refused till checks are reported). Not done on this branch: one operation per branch, and the fan-out serves every note in the product.

## The Away ladder reads a role without trimming it; the till-refusal note trims — OPEN — 2026-10-05

`readRole` (`apps/api-gateway/src/areas/area-routing.service.ts:235-238`) lowercases `user_restaurant_access.role` but does not trim it. `isOwnerOrManager` (`apps/api-gateway/src/pos-hub/refused-checks-note.ts:572-576`) trims and lowercases. The till-refusal note picks its audience with `isOwnerOrManager`, then runs `AreaRoutingService.route` over it (`refused-checks-note.ts:789`), which reads the roles again with `readRole`. A role stored as `"owner "` would pass the note's filter and read as `staff` in the ladder. If every addressed person were Away, the ladder's last step (`apps/api-gateway/src/areas/area-routing.ts:194-200`) would find no owner or manager and address nobody, and the note would say "no owner or manager could be addressed" (`refused-checks-note.ts:795`) in a house that has an owner.

**Not reachable while the database keeps its constraint.** `user_restaurant_access_role_known` (migration `team_access_role_is_a_known_role`) checks `role IN ('owner', 'manager', 'staff')`, which a padded or mixed-case value fails. Production's constraint was not read here. Found by the review of PR #644 at `fe0f31f4d`.

**Fix.** One reading for both: trim in `readRole`, or compare exactly in `isOwnerOrManager`, as the constraint does. Not done on this branch: `readRole` serves the whole funnel's Away routing, and one operation per branch.
