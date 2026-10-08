TITLE: fix: the first menu reads from the house, and a housed account is never sent back into sign-up (MENU-07, SETUP-01, SETUP-11, MENU-08)

**Branch** `fix/the-first-menu-reads-from-the-house`, from origin/main `ca3582988`. Head is `6c2178b6f`: 3 commits, 13 files against main. `git merge-tree` against the current origin/main `a323cc80b` (#613) reports no conflicts. Local only: not pushed. Web only: no gateway file, no migration.

## Why

The scenario walk of 2026-10-07 found three P1s and one P2 on a new house's first menu.

- **MENU-07 (P1), /house/menu and /house.** The first proof lived only in this tab's `sessionStorage` (`firstProof.ts:45`, `readProof()`). The menu itself is kept on the server as a draft (ADR 0193). So a new tab, a reload or another device showed *"No menu has been read yet."* for a house that has a menu. The reading carried no house either. After a house switch in the same tab, the page showed the other house's lines, and *Add it.* posted to the other house's menu id (`HouseMenu.tsx:135`).
- **SETUP-01 (P1).** That false empty state had a button to `/get-started` (`HouseMenu.tsx:85`, `:100`). `/get-started` had no entry check, so the person started sign-up again from step *you*. Creating the house then failed with 409 *"This account already has a house"* (`auth.service.ts:1662`).
- **SETUP-11 (P1).** The setup nudge's *Finish setup* sent every owner and manager to `/get-started` (`SetupNudgeBanner.tsx:54`).
- **MENU-08 (P2).** Placing a pencilled line and adding a missing line had `try … finally` with no `catch`. A refused save said nothing.

**ADR 0309 (new, Proposed).** It was decided by the coordinator under the founder's 2026-10-07T20:04:10Z delegation: *"Do not ask me questions, I allow and approve for you to decide on your own. If its a decision question then research deep, find answers."*

Two real choices needed a record:
- which kept menu the proof shows;
- how to pencil a line whose library match the server does not keep. `menu_items` has no `matched`. `wine_library_id` is set for a provisional wine too (`menus.service.ts:1686`), so it cannot stand in for the match.

The house rules:
- **A failed read is never an empty one (ADR 0067).** The read pages and `/get-started`'s check each say why they failed, with *Try again*.
- **An unknown is not a zero.** A menu whose line count was never recorded is not skipped as empty. A match nobody recorded is `null`, never `false`.
- **Prose is never broader than the code.** The page says when its pencils follow the section alone. A missing crop says whether the original was kept with the menu or not kept at all.
- **Staff see no house money.** `/house/menu` shows the sale prices that `GET /menu-versions/:menuId` already serves any member. It shows no cost, margin or revenue.

## What changes

**`lib/firstProof.ts`**
- `useHouseProof(restaurantId)` reads `GET /menu-versions`, picks one menu, and reads `GET /menu-versions/:menuId`. It answers `loading`, `failed(reason)`, `none` or `ready`. `none` means only that the server listed no kept menu. A list or detail without an array is a failure.
- `pickHouseMenu` picks the current menu. Else it picks the newest draft whose `linesExtracted` is not `0` (null counts as unknown, so such a draft is not skipped). Else the newest kept menu.
- `proofFromServer` takes name, section and prices from the stored line. The tab's reading of the same house and menu adds only the match, the raw line and the crop box.
- `readProof(restaurantId)` returns the reading only when its stamp names that house; an unstamped reading is ignored. `writeProof(result, restaurantId, image)` writes the stamp.
- `markProofLine` keeps a placed line placed in that house's reading.
- `ProofLine.matched` is `boolean | null`. `lineNeedsPencil` pencils only `matched === false`, so an unknown match is pencilled by its section alone.

**`services/api/menus.ts`**
- `getMenuVersion(menuId)` wraps the existing `GET /menu-versions/:menuId`.

**`pages/HouseMenu.tsx`**
- It reads through `useHouseProof(activeRestaurantId)`.
- A failed read shows `role=alert` with the reason and *Try again*. No kept menu shows *Read a menu*, which leads to `/menu`. A menu without lines leads to `/menu`.
- It says where the menu stands: *"This is the house's current menu."*, or *"Kept as a draft — not the house's current menu, and none of its prices are the house's yet. An owner or a manager makes a menu current on the Menu page."*, or *"Retired: …"*.
- When any line's match is unknown, it says pencils follow the section alone.
- *Add it.* posts to the server's menu id.
- MENU-08: a refused place shows *"This line was not placed: …"* and leaves the line pencilled. A refused add shows *"The line was not added: …"* and keeps the form.

**`pages/HouseContents.tsx`**
- The Menu row reads the same hook. It shows loading, a failure with its reason and *Try again*, *No menu read yet* with *Read a menu* (→ `/menu`), or the pencilled count.

**`pages/GetStarted.tsx`**
- It decides once on arrival:
  - session has a house → `/house`;
  - none open, but `GET /auth/houses` lists a house or a held membership → `/choose-house`;
  - unverified → `/verify-email`;
  - the check failed or the reply had no list → an alert with *Try again*, never the wizard;
  - otherwise → the wizard.
- Deciding once keeps `createFirstHouse` from sending the person away before the menu step.
- The reading it keeps is stamped with the session's house.

**`guidance/components/SetupNudgeBanner.tsx`**
- *Finish setup* → `/house`.

**`.planning/decisions/`**
- ADR 0309 and its README row.
- `claims.d/fix-the-first-menu-reads-from-the-house.jsonl`: 10 static rows.

## Evidence

- `cd apps/web && npx vitest run src/pages/ArrivalFlow.test.tsx src/lib/firstProof.test.ts src/guidance src/pages/__tests__/GetStarted.cellarRegisters.test.tsx src/components/mudavym/HouseShell.test.tsx src/components/layout/DashboardLayout.shellGate.test.tsx src/components/mudavym/shellOverlays.test.tsx src/pages/ChooseHouse` → 10 files, **172 passed**, 0 failed. The changed tests:
  - `ArrivalFlow.test.tsx`: 33 cases. It had 11, all sessionStorage-only; each was converted to server responses plus a stamped reading, and 22 were added.
  - `firstProof.test.ts`: 15 cases (10 new).
  - `SetupNudgeBanner.test.tsx`: 1 case (new file).
  - `GetStarted.cellarRegisters.test.tsx`: updated for the arrival check.
- The first commit alone (`32ca16b56`, before the arrival check): ArrivalFlow, firstProof and cellarRegisters → 42 passed. Web tsc as in the last bullet.
- **Mutations: 20, one per behaviour.** Each mutation was applied to the source, run against its test file, then restored from an in-memory copy and `cmp`'d. **Every one failed at least one case:**
  - M1: a tab with no reading answers `none` (10 failed).
  - M2: the stamp check removed (3).
  - M3: a failed read reported as `none` (2).
  - M4: a housed account enters the wizard (1).
  - M5: a failed check opens the wizard (1).
  - M6: the check re-fires mid-wizard (3).
  - M7: the nudge points back at `/get-started` (1).
  - M8: the add error swallowed (1).
  - M9: the place error swallowed (1).
  - M10: the draft line dropped (1).
  - M11: the reading written unstamped (1).
  - M12: a placement not kept in the reading (1).
  - M13: newest over current (1).
  - M14: add posts to the cached menu id (1).
  - M15: `/house` reports a failed read as none (1).
  - M16: the unknown-match note dropped (2).
  - M17: a kept original called lost (1).
  - M18: held memberships ignored (1).
  - M19: a reply without a list read as none (1).
  - M20: an unrecorded line count read as zero (1).
- **Claims:** all 10 rows hold on the branch. In a scratch tree, each row's files were put back to `ca3582988` one at a time, and every row exited 1 for every one of its files, with no stderr. `scripts/check_decision_claims.sh` was **not** run, per the lane brief.
- `python3 scripts/check_adr_numbers_unique.py` → *"OK -- introduced by this ref: 0309"*, checked against 1748 refs.
- `bash p4-scratch/sim-run/fixes/tools/lanecheck.sh wt-fix-firstmenu` → every check rc=0, files=13, ownership rc=0.
- `npx eslint --resolve-plugins-relative-to p4-scratch/web-lint` on the 9 touched source and test files → exit 0, no warnings.
- `cd apps/web && npx tsc --noEmit | grep -v '^../../packages'` → one error, `src/services/api/passkeys.ts(14,81)`: *Cannot find module '@simplewebauthn/browser'*. That file is untouched, and the package is absent from the shared `apps/web/node_modules`, so this is an environment gap, not this change. No other error.

## Not done

- **Not verified in a browser.** There was no local gateway and database to serve `/menu-versions`, and production was out of bounds. Everything above is component-test evidence.
- **Gateway: the per-line library match (owed 1 in ADR 0309).** `GET /menu-versions/:menuId` does not return `matched`. A line read back from the server is pencilled by its section alone, and the page says so. A tab's own reading still carries the match, for that house and menu only.
- **LearnPanel's *Upload Now*** still points at `/get-started` (`LearnPanel.tsx:74`). It reaches `/house` through the arrival check, one hop later.
- **The nudge's threshold half cannot be finished anywhere.** `activated` needs `threshold_configured`, and `ThresholdStep.tsx` has no importer. This was true before this change; it is recorded in the ADR, not fixed.
- **`createFirstHouse`'s 409 check reads only `users.restaurant_id`.** An existing account that accepted an invite holds only an access row (`auth.service.ts:2626`), so it would pass. The arrival check now sends it to `/choose-house` first; the gateway is unchanged. This was read from the code, not exercised.
- **Gateway jest and gateway tsc were not run.** No gateway file changed.
- **A placement in another tab.** A placement is saved on the server. Only the tab that read the menu keeps its match. In another tab, the placed line shows inked by its new section, because its match is unknown there.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
