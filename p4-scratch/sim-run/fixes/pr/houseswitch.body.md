TITLE: fix: a house switch clears the last house's reads, and an assignee must be on this house's team
> **[2026-10-07 22:40Z, coordinator] Head `cf2f2a06c`.** It merges origin/main `214779a76` (#612) cleanly and is 15 files against main. A fresh verifier pass on `2c23a0c47` found two MUSTs and one should; all three are fixed in `3f5bf32f1`:
>
> - **`createFirstHouse` now empties the device read cache** (`offlineStorage.clearEntityCache()`, under the same time cap sign-out uses) before it stores the new house's session. Before this, only the query cache was forgotten, so a new house could be drawn from the last house's device cache.
> - **The consent trail on Settings (`ConsentPanel.tsx:97`) is listed as not done.** It is keyed `['consent-trail', spec.register]` without the house, and the gateway takes the house from the token (`settings-audit.controller.ts:84`). It was left unkeyed to stay at the 15-file cap.
> - **The frame test now sees ordering.** `/auth/me` is held open until after the first frame under house B is checked. Moving the forget after `/auth/me` now fails the test; before, it passed.
>
> At this head:
> - The six fast guards exit 0, and gate ownership is `[]`.
> - Decision claims hold **940/940** (Python 3.11).
> - Web vitest (the six folders below): **60 files, 985 passed**. Gateway jest `src/analytics` recommendation suites: **224 passed**.
> - Mutations, each restored with `cp -p` and compared with `cmp`: removing the new clear fails the createFirstHouse test; moving the forget after `/auth/me` fails the switch test.
>
> **No ADR 0090 audit has run yet.** No browser was driven and no production data was read.
>
> The text below was drafted at `2c23a0c47`. Where it and this note disagree, this note holds.

<!-- Drafted 2026-10-07 for branch fix/a-house-switch-clears-the-last-house at 2c23a0c47, merge-base ca3582988 (origin/main is now a323cc80b; none of its 15 new files overlap this branch; not rebased, per the lane rules). Lane houseswitch: PROCURE-04, MENU-01, OPS-03. -->

## Why

After a house switch, pages drew the last house's data under the new house's name.

- **Vendors and promotions (PROCURE-04).** Promotions and the usual-currency coverage were affected.
- **Menu (MENU-01).** Locked prices, price advice, kept versions and the house currency were affected. So was the cellar's lock note.
- **/recommendations (OPS-03).**
  - The Standing figures stayed.
  - The "who takes this" menu offered the last house's team.
  - A failed roster read could never be read again.

There were two causes.
- The react-query cache outlived the token.
- Six reads were keyed without the house, so a refetch filled the same entry that the old answer had used.

The gateway also wrote `assignedTo` exactly as sent. That could be another house's person, someone taken off the team, or any string.

## What changed

**1. A switch, a new house and a sign-out forget the cached reads (`AuthContext.tsx`).**

`AuthProvider` reaches the QueryClient through `QueryClientContext`; `App.tsx` mounts it inside `QueryClientProvider`. `setActiveRestaurantId` runs these steps in order:
1. Empty the device read cache, with the same bound as sign-out's clear.
2. Store the new session.
3. Call `forgetHouseReads`. Every cached query is `reset()`, which cancels a read in flight and tells its watchers. A query with no watcher is removed.
4. Set the new house, in context and in zustand.

An effect then refetches only the active queries, under the new token (`cancelRefetch: false`). `createFirstHouse` forgets the same way. [EXTENDED 2026-10-07, `3f5bf32f1`: it also empties the device read cache before storing the new session.] `endSession` forgets the reads and clears the mutation cache before `setUser(null)`. A refused switch forgets nothing.

**2. The six named reads carry the house in their key.**

| Read | Key |
|---|---|
| Promotions | `['promotions-next','read',house,includeDismissed]` |
| Vendor currency coverage | `['vendor-usual-currency-coverage',house]` |
| Price locks (Menu and the cellar lock note) | `['pricing','locks',house]` |
| Price advice | `['pricing','advice',house]` |
| Menu versions | `['menu','versions',house]` |
| Menu's house currency | `['settings','currency',restaurantId]` |

The promotions invalidation prefix is unchanged, so its invalidations still match.

The sweep covered every `queryKey:` in `apps/web/src`. It flagged 85 keys without a house token. The ones not fixed here are listed with file:line in the new tech-debt fragment. A switch now forgets and re-reads all of them, but their keys still omit the house.

**3. /recommendations (`useRecommendationsNextData.ts`).**
- The figures go back to null in the same render where the house changes: counts, rules evaluated, generated-at, suppressed, hidden-for-you and unread sources. The read sequence moves too, so a late answer from the last house is dropped.
- The roster is held together with the house it was read for. `loadTeam` behaves like this:
  - it does not repeat a read in flight or one already answered;
  - it reads again after a failure;
  - while it reads, the roster is `undefined`, which shows as reading; a failed read is `null`, which shows as failed;
  - it drops a late answer by sequence;
  - a body that is not a list is a failed read, never an empty team;
  - it offers only rows whose status is `active` or absent.

**4. Gateway (`recommendation-actions.service.ts`).**

`setAction` now awaits `assertAssigneeOnRoster` before it builds the row, whenever `assignedTo` is set. Every assigning route reaches `setAction` after its permission gates. The check works like this:

| Case | What happens |
|---|---|
| The value is not a uuid | Refused without a read |
| Any uuid | `team_members` is read for the path's `restaurant_id` and that id |
| No row, or status is not `active` | `ActRefused` → **400**: "That person is not on this house's active team, so the entry was not assigned to them." |
| The roster could not be read | **400**: "Could not read this house's team, so nobody was assigned. Try again." It is never taken as a pass. |
| The assignee is cleared | No roster read |

**No ADR.** "Active" is read as `status = 'active'`. That follows the task's words, "an active member of the path restaurant", and the founder's existing reading of the active roster for the crew audience: ADR 0218, round 4 answer 3, "Active roster only". So trial and inactive rows are refused, and the page no longer offers them. If trial staff should take entries, that is a new ruling, and both checks change together. The fragment's item 5 records this.

## Evidence

**Web vitest.** I ran six folders: `src/contexts`, `pages/menu/next`, `pages/cellar/next`, `pages/providers/next`, `pages/promotions/next` and `pages/recommendations/next`. Result: **60 files, 985 tests passed**.

New tests:
- `contexts/houseSwitch.test.tsx`: 9 tests. It mounts the real `AuthProvider` over a real `QueryClient`. It records every frame and asserts that none under house B draws house A's data. [SHARPENED 2026-10-07, `3f5bf32f1`: `/auth/me` is held open, so the check runs before the server answers; a forget moved after `/auth/me` now fails it.] It also covers:
  - the refetch under B's token;
  - the device-cache clear while the token still names A;
  - the new-house path;
  - a refused switch;
  - sign-out, for reads and mutations;
  - the key sweep for Menu, the cellar lock note, vendor coverage and promotions.
- `useRecommendationsNextData.test.tsx`: 42 tests, 5 of them new (OPS-03). After a type fix to one test, I ran it again: 42/42.

**Gateway jest.**
- `src/analytics`: **57 suites, 879 tests passed**. That includes the new `recommendation-assignee-roster.spec.ts` with 9 tests: through the real `setActionAs`, and one through the real controller handler, which returns 400 with the sentence.
- `reports/exports/report-cutting-reader.spec.ts` (the one other importer of the service): 16/16.

**Mutations: 27 of 27 RED, every file restored byte-for-byte.** Each was snapshotted with `cp -p` semantics, mutated, run, restored and compared with `cmp`.
- W1–W7 cover the switch, refetch, sign-out reads, sign-out mutations, the device cache, the new house, and removal of unwatched queries.
- K1–K7 restore each bare key.
- R1–R8 cover the figures reset, the roster's house tag, late-answer drop, retry, reading as undefined, a non-list as failed, active-only, and one read in flight.
- G1–G5 cover the check being called, the active status, the house filter, the uuid guard, and refusal on a failed read.
- After the type fix, I ran R2 and R3 again: both RED.

**Claims.** `claims.d/fix-a-house-switch-clears-the-last-house.jsonl` has 4 static rows, all `resolved`. Comments are stripped before each check.
- All 4 were run by hand with `bash -c` from the worktree root: rc 0.
- Revert proof: 13 cases. Each code file was reverted to `origin/main`, and each new test file was removed. Every case gave rc 1, and every file was restored and compared.
- `_claims_parse.py` over all fragments: rc 0.
- `scripts/check_decision_claims.sh` was **not run**, per the lane rule (the coordinator runs it).

**tsc.**
- `npx tsc --noEmit -p apps/api-gateway` shows only `passkeys.service.ts` (16,8) and (22,8): `@simplewebauthn/server` not found.
- The web check shows only `services/api/passkeys.ts(14,81)`: `@simplewebauthn/browser` not found.
- Both packages are absent from `node_modules`, and neither file is touched by this branch. These errors are environmental and already present.

**Lanecheck.** `lanecheck.sh wt-fix-houseswitch` returned rc 0:
- all six guards rc 0;
- **files=15**;
- ownership `[]`.

The `_debt_frozen.py` fragment guard also returned rc 0.

## What is NOT done (also in `.planning/tech-debt.d/2026-10-07-fix-a-house-switch-clears-the-last-house.md`)

- **No browser was driven.** Everything above is jsdom plus a table stub. The switch was not watched in a real browser, and no production data was read.
- **Reads still keyed without the house.** Examples are `DeliveriesToName` items-to-name, `ReceivingWorkspace`'s `['settings','currency']`, provider comparison and promotions panels, notifications (person only), inventory research, and vendor-prices reads. The full list with file:line is in the fragment. A switch now forgets them, but their keys do not carry the house.
- **Paths that change the house or end the session without a forget:**
  - a switch in a second tab (no `storage` listener on `accessToken`);
  - session restore (`applyBranches`);
  - `joinViaInvite`;
  - a sign-in over a live session;
  - a refused refresh through AuthContext's own interceptor or `authStore.ts`, which removes the tokens without `endSession` or a page load.
- **A late device-cache write after the switch's clear.** This is the 2026-09-29 note's item 9 race.
- **`loadGoals`** still never re-reads after a failure, and it maps a body that is not a list to `[]`.
- **The failed-roster sentence** in `WhoTakesThisPopover.tsx` does not say that reopening the menu tries again. It was left out to stay at the 15-file cap.
- **An assignment sent as `assignedName` alone** is not checked against the roster. An `assignedName` sent with an `assignedTo` is not compared with the roster's name.
- **Staff cannot read the roster.** `GET …/team` (`listMembers`) is manager-gated, so staff get a failed roster read. It is reported as failed, not empty. Whether staff should assign is not decided here.
- **The 2026-09-29 storage note's item 15** is bracket-closed for sign-out only. The forced end above stays open.
- **The consent trail is keyed without the house.** `pages/settings/next/ConsentPanel.tsx:97` reads `['consent-trail', spec.register]` from GET /settings-audit, which takes the house from the token (`settings-audit/settings-audit.controller.ts:84`). After a switch it can show the last house's trail until it refetches. Left out to stay at the 15-file cap.
- **AuthContext overlaps the paused houses lane.** The refuter noted this. That lane has no uncommitted AuthContext edits, but its paused branch will need this change merged in when it resumes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
