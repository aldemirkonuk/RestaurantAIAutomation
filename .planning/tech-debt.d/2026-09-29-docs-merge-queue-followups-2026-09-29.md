## Offline mutations replay under whoever is signed in at replay time, and are dropped in silence after three failures — ~~OPEN~~ CLOSED 2026-09-29 by `fix/od-203-offline-queue-binds-and-never-drops` and `fix/od-203-outboxes-never-drop` (OD-203, [ADR 0241](../decisions/0241-an-offline-change-belongs-to-its-person-and-house-and-is-never-dropped-for-failing.md); the door and spot-count outboxes named under "Not covered" are covered by the second) — 2026-09-29

Filed from the ADR 0090 audit of #508. This entry records the defect. The fork is OD-203.

**What.**
- `logout()` (`apps/web/src/contexts/AuthContext.tsx:936-956`) clears tokens, the house id and the axios headers, but never touches the offline mutation queue.
- `SyncManager.syncNow()` (`apps/web/src/lib/sync-manager.ts:239-258`) replays every pending mutation with the current session's headers. No entry records who queued it or for which house.
- So a mutation queued by person A in house X, still pending at sign-out, is sent later under person B, or under A's other house.
- Separately, a mutation that has used up `MAX_RETRIES` is removed with only a `console.warn` / `console.error` (`sync-manager.ts:251-275`). A change the person believed was saved disappears, and nobody is told.

**Severity.** High while open for a shared device, such as a tablet at the pass. A replayed create (`calendar.create`, `provider.create`, `sync-manager.ts:52-76`) lands in whichever house is signed in, and any replayed write is attributed to whoever is signed in. An update or delete by id reaches another house only where the gateway's lookup by id is not scoped to the house. Medium otherwise.

**Measured 2026-09-29 — which edits by id could cross houses.** The severity above turned on whether the gateway scopes a write by id to the caller's house. It was measured for every `PATCH`/`PUT`/`DELETE` route at `71ae5449b` plus #518's one addition: `.planning/07-reference/GATEWAY-EDIT-BY-ID-SCOPE-2026-09-29.md` — 130 routes, 124 scoped. None of the six that were not is a route the offline queue replays (`calendar.*`, `provider.*`, `notification.*` are all scoped); `fix/gateway-edit-by-id-house-scope` fixed three (unmounted contacts routes) and narrowed one (`DELETE /mobile/devices/:token`, which a token holder can still reach by registering the token first), and two (`/organizations/chains/:id`) stay on OD-131 (b). So, at that commit, a replayed update or delete by id could not reach another house's row; a replayed create could (it lands in whichever house is signed in), which ADR 0241 (in open PR #527 when this was written) closes by binding each entry to its house.

**Not covered.** The door-receipt and spot-count outboxes use the same queue with their own handlers. They are skipped at `sync-manager.ts:239-248` and were not reviewed here.

## `MembersService.removeMember` is a second removal path that leaves shifts and the roster behind — ~~OPEN~~ CLOSED 2026-09-29 by `fix/od-204-one-removal-path` (OD-204, [ADR 0242](../decisions/0242-one-removal-path-and-leaving-is-that-removal.md): every door, leave and account deletion included, ends in `TeamService.removeFromHouse`) — 2026-09-29

Filed from the ADR 0090 audit of #502. The fork is OD-204.

**What.**
- `TeamService.deleteMember` (#502) releases or hands over the leaving person's shifts and deletes their `team_members` row.
- `MembersService.removeMember` (`apps/api-gateway/src/restaurants/members.service.ts:323`) revokes access with neither step: its body names no shift and no `team_members`.
- A person removed through that route keeps their future shifts, and stays on the roster, as someone who can no longer sign in.

## RosterSheet keeps a stale hand-over pick after a 400 "reload" refusal, and no CI job runs `supabase/tests` — OPEN — 2026-09-29

Filed from the ADR 0090 audit of #502.

- **The stale pick.**
  - `RosterSheet.tsx` holds the hand-over choice in `handover` state (`apps/web/src/pages/team/next/RosterSheet.tsx:566`).
  - When the gateway refuses the removal with a 400 that asks for a reload, the sheet shows the error (`:615-619`) but does not reset `handover` or refetch the preview (`:570-575`).
  - A retry re-sends the same stale pick.
- **Unrun SQL tests.** `supabase/tests/*.sql` (13 files on main at `26f0e6b80`, including #502's) are run by no workflow: `grep -rn "supabase/tests" .github/workflows` finds nothing. So the SQL behaviour tests those PRs cite as evidence are not re-checked on any merge.

## #510 leftovers: edit double-submit, `assignMany` snapshot, a loose claim, a dead branch — OPEN — 2026-09-29

Filed from the ADR 0090 audit of #510. The entry is `tech-debt.d/2026-09-29-fix-storage-location-writes.md`.

- **Edit double-submit.** The Save button's `disabled` covers `isSavingCreate` only (`apps/web/src/components/inventory/StorageLocationManager.tsx:1080-1082`). `handleUpdate` (`:219`) has no in-flight guard, so a double click sends two PATCHes.
- **Stale snapshot.** `assignMany` (`apps/web/src/hooks/useStorageLocations.ts:434-443`) awaits `assignWineToLocation` in a loop. Each call reads state from the render that built `assignMany`, so later assignments in one batch roll back to, and count against, a stale snapshot.
- **Loose claim.** The claim `AUDIT-0090-PR510-CREATE-WAITS-FOR-SERVER` (`claims.d/fix-storage-location-writes.jsonl`) greps for three strings anywhere in the files. It should be scoped to `handleCreate` and `addLocation`, so that a copy elsewhere cannot satisfy it.
- **Dead branch.** `if (!data?.id) return optimistic` (`useStorageLocations.ts:542`) is dead since `addLocation` resolves the stored zone or `null`. It also returns a temp-id zone as if it had been stored. Remove it, or make it return `null`.

## OD-190–196, OD-201 and OD-202 still sit after `## Resolved` — ~~OPEN~~ CLOSED 2026-09-29 by `docs/od-rows-into-open-2026-09-29` (all eleven rows, OD-203/204 included, moved into `## Open`; waiver traced to session a493af02, 15:58:20Z, in ADR 0231) — 2026-09-29

These rows are OPEN, but they sit after `## Resolved` in `OPEN-DECISIONS.md`.

**What was measured.** Moving them to the end of the `## Open` table and running `scripts/check_citation_pairing.py --fix` on `origin/main` at `87792901c` passes the guard (211 citations). It rewrites 57 citations across **40 files**, including `v3.0-TECH-DEBT.md`.

**Why it was deferred.** That breaks ADR 0231's 15-file PR cap, and a waiver needs its own founder answer (ADR 0231 bracket, 2026-09-29). It also cannot share a PR with other follow-ups.

**Founder answer, 2026-09-29 (chat, relayed to this session by its coordinator; no session id was recorded here).** He picked *"Waive, own PR (Recommended)"*: one separate re-cite PR, over the 15-file cap, produced only by `--fix`, merged after this one. It moves the rows and runs `--fix`, with no wording changes, and it closes this entry. That PR must record the waiver traceably in ADR 0231, and it must move OD-203 and OD-204 too, since this PR also appends them after `## Resolved`.

## The gateway boot check never builds the OpenAPI document — OPEN — 2026-09-29

Found while merging the #502/#517 queue.

**What happened.** #509 (`744874263`) made `SwaggerModule.createDocument` throw at boot: "A circular dependency has been detected (property key: "mudavym_design_arrival")". The production gateway on Railway was down from that merge until #524.
- Every deploy audit in that window that reached Stage 2 (6 runs, `744874263` through `79c255cd8`) failed it with HTTP 000. One more run (36588274446) stopped at CI Gate.
- CI stayed green.

**Why CI missed it.** `scripts/check_gateway_boots.sh` builds the DI context with `NestFactory.createApplicationContext` and never the HTTP app or the OpenAPI document.

**Current coverage.** #524's `feature-flags-dto-swagger.spec.ts` covers the one DTO. Any other DTO that breaks the schema factory still crash-loops production with green CI.

**Fix direction.** Have the boot check create the app and call `SwaggerModule.createDocument` with `main.ts`'s config.

## `GET /settings/feature-flags/:restaurantId` says "admin only, any restaurant" and is neither — OPEN (low) — 2026-09-29

This was flagged for a tenant-guard review. The route is `apps/api-gateway/src/settings/settings.controller.ts:606-621`. Read on `origin/main` at `87792901c`, not exercised against a running gateway.

**It is tenant-safe as written.**
- The controller carries `@UseGuards(JwtAuthGuard, TenantGuard)` at class level (`:66`), and the route has no bypass decorator. The same tenant match also runs in `JwtAuthGuard` (`apps/api-gateway/src/auth/guards/jwt-auth.guard.ts:74`), with `TenantGuard` as the backstop.
- `TenantGuard` calls `assertTenantMatch`, which is `apps/api-gateway/src/common/tenant/assert-tenant-match.ts:23`.
- `assertTenantMatch` compares `params.restaurantId` with the JWT's `restaurantId`. It throws 403 on a mismatch, and also when the caller has no house.
- So the route reads only the caller's own house.

**What is wrong.**
- The Swagger summary and description promise an admin endpoint "for any restaurant". There is no role gate, and the tenant match makes "any restaurant" impossible.
- The route duplicates `GET /settings/feature-flags` (`:79`) for the caller's own house.

**Fix direction.** Delete the route if no caller uses it (check `apps/web` and `apps/mobile` first). Otherwise, correct its description. Nothing crosses tenants today.

## Follow-ups owed from the ADR 0090 audits of #527, #528, #529 and #530 — OPEN — 2026-09-29

These came out of the full-gate audits on #527, #528 and #529 (merged as e9fa899, d80e41e and 72e4529) and on #530. Each planner's verdict named them as owed after merge, and none blocked the merge.

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
- **From the #530 audit.**
  - **A door 4xx is still dropped and pinned, not parked.** This is a founder fork, recorded in ADR 0241 §The second OD-203 PR. A 4xx from a proxy or captive portal on dock wifi would drop a receipt.
  - **Door 401 refresh race.** If a second tab signs in as someone else while this tab's refresh is in flight, the retried receipt carries that person's token (`services/api/client.ts` 401 path). The 401 retry window above applies to door receipts too.
  - **No cross-tab lock.** `doorOutbox` has no `navigator.locks`. The idempotency key absorbs a double send.
  - **Two views of a parked door receipt.** `pendingDoorCount` counts parked door receipts as waiting, while the app-wide strip shows them as not sent.
- **The door drop notice names the wrong cause (#530).** `apps/web/src/pages/receiving/next/DoorNext.tsx:508-513` shows "The app was signed out. Sign in again …" when every drop's reason is `auth`. Since #530 a 401 is retried and never dropped, so `auth` means 403 only: this account may not record deliveries. The copy is now false for every new `auth` record, and it drops "tell a manager". It should say the account cannot record deliveries, keep the paperwork, tell a manager. Fix the copy and its comment, with a test.
- **Stale text left for a later docs pass.**
  - `apps/web/src/lib/queue-owner.ts:14` still says the outboxes adopt the retry rules "in OD-203's second PR".
  - ADR 0242 line 7 cites this file's OD-204 heading at `:15`; it is at `:17`, and the OD-204 row already says `:17`.
  - Text from the time of the 8-attempt budget:
    - `apps/web/src/lib/doorOutbox.ts:460` ("retry budget spent");
    - `apps/web/src/pages/receiving/next/DoorNext.test.tsx:12-13`;
    - `apps/web/src/pages/receiving/next/MOTIONS-receiving.md:18`;
    - `apps/web/src/lib/sync-manager.ts:297-299` ("attempt budgets").
