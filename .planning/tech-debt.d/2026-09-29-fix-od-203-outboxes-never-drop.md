## Follow-ups owed from the ADR 0090 audits of #527, #528 and #529 — OPEN — 2026-09-29

These came out of the full-gate audits on the three PRs, which merged as e9fa899, d80e41e and 72e4529. Each planner's verdict named them as owed after merge, and none blocked the merge.

- **Gates and last-owner counts read `is_active` alone (#528, ADR 0242).**
  - `TeamService.assertAccess` (`apps/api-gateway/src/team/team.service.ts` ~198-204) and `MembersService.assertMembership` (`apps/api-gateway/src/restaurants/members.service.ts` ~56-62) ignore `valid_until`.
  - So do the last-owner counts in `removeFromHouse` and `removeMember`.
  - Only the leavers' notice moved onto `houseMembersInRoles` / `isLiveMembership`.
  - Move the gates and the counts together. Moving one alone would make the guards disagree.
  - Nothing in the gateway writes `valid_until` today, so this cannot be reached yet.
- **No spec for socket eviction on removal (#528).** Removing `this.websocketGateway?.evictFromHouse(...)` from `removeFromHouse` turns no claim or spec red (the adversarial reviewer measured this). The gap predates the PR: the old doors had no such spec either.
- **The members-door owner guard is pinned by specs only (#528).** In `members.service.ts`, `if (targetRole === "owner" && actor.role !== "owner")` is caught by jest (3 cases) but by no claim.
- **A device row survives a non-settings sign-out (#529).**
  - Several paths never call `unregisterPush`: `apps/mobile/src/api/client.ts:102` (refresh refused), `lock.tsx`, `no-access.tsx`, `choose-house.tsx` and `verify-email.tsx`.
  - `registeredToken` stays in memory.
  - Since #529 scoped `DELETE /mobile/devices/:token` to the caller's own row, the next person's settings sign-out no longer deletes the previous person's row by accident.
  - `registerDevice` still hands a token's row to whoever registers it. The census names this under Limits.
- **Census wording (#529, `.planning/07-reference/GATEWAY-EDIT-BY-ID-SCOPE-2026-09-29.md`).**
  - The `/studio/*` rows say "n/a (no resource id)". The orchestrator routes do take ids; they are platform rows with no house, so relabel them.
  - Row `DELETE /mobile/devices/:token` could read "no → narrowed".
  - `PATCH /procurement/orders/:id` writes a body `locationId` without checking which house it belongs to. The write is house-filtered, so the "yes" grade stands. Add it to the list of things found beside the question.
- **Offline queue residuals (#527, ADR 0241).**
  - **401 retry window.** A second tab that signs in as someone else while this tab's refresh is in flight can carry a queued create out under that person.
  - **Resurrection race.** `updatePendingMutation` is a read then a write, so a sign-out delete landing between the two can bring an entry back.
  - **Reconnect load.** A reconnect ignores backoff and re-sends every waiting entry.
  - **Stale "not sent".** A mark-read for a notification that has since been deleted parks as "not sent".
  - **House stamp source.** The owner stamp takes `activeRestaurantId` before the token's house. Stamping from `tokenHouse` first would remove the dependency on `storeSession` keeping the two equal.
