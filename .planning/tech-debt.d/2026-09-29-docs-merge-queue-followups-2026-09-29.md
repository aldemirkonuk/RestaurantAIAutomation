## Offline mutations replay under whoever is signed in at replay time, and are dropped in silence after three failures — OPEN — 2026-09-29

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
