# 0293 — The cellar's off-library tile names the wine library, and a draft menu is not the current menu

- **Status:** Decision 1 is Locked on the founder's pick. AskUserQuestion, 2026-10-05 ~07:30Z, verbatim: *"Rename, small follow-up (Recommended)"*. Decision 2 is Proposed. It records what PR #606 built (merged at `8fdb819b4`) for a house whose only menu is a draft, and it changes no code. It applies ADR 0193 item 7's locked definition of the current menu. One question it raises (F1 below) goes to the founder and is not decided here.
- **Date:** 2026-10-05
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** cellar, In the building tonight, gazetteer measures, offbook, offBook, Carried but off this read, Carried, not in the wine library, wine-library link, master_wine_id, MEASURE_LABEL, MEASURE_SOURCE, current menu, draft menu, restaurant_menus.status, readCurrentMenuLines, currentMenus, onMenu, carried inference, house_beverage_ledger, arrival, A-053, A-028, AW27, F-148
- **Links:** [[0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes]] (sec110 item 2: the tiles are the house's to choose, and each names what it was counted from); [[0193-a-house-price-follows-its-menu-and-its-manager-and-advice-aims-at-its-own-margin]] (round 2, item 7: menu versions, a draft is "read and kept"); [[0020-no-fabricated-answers]]; [[0051-rebuilt-pages-show-live-data-only]]; [[0067-a-failed-read-is-never-an-empty-one]]; PR #606 (fix lane `cellar`, merged `8fdb819b4`); migration `the_ledger_lists_only_the_current_menu` (cited by slug, [[0235-a-migration-is-numbered-at-merge-and-cited-by-its-slug]]); `claims.d/fix-offbook-tile-names-the-library.jsonl`; `claims.d/fix-cellar-invoice-book-and-menu-copy.jsonl:3`

## Context

**The tile.** Before #606, `BuildingVM.offBook` compared the house's rows only with the wine-library pages loaded so far. On a first load, a house whose every row is linked would read 119 of 134. That is A-053 from the 2026-10-03 analytics walk, worked out from the code. #606 changed it to count this house's rows that have no wine-library link: `rows.filter((r) => !r.wineId).length` (`apps/web/src/pages/cellar/next/useCellarNextData.ts:1395` at `8fdb819b4`). The label still read *"Carried but off this read"* (`apps/web/src/pages/cellar/next/Registers.tsx:61`, `apps/web/src/pages/settings/next/CellarSection.tsx:54`), with the source line *"this house’s wine rows vs the wine library"* (`Registers.tsx:77`). Neither describes the new figure. #606 listed the label as an unasked fork, and the founder answered it.

**The draft menu.** #606 also made the cellar's three menu readers read only the house's **current** menu, `restaurant_menus.status = 'active'`. Before that, they read every kept copy. An archived copy of the current menu counted every line twice: 267 lines were read for a 134-line menu (A-028, F-148). The three readers:

- the registers readout and the unplaced-lines list (`apps/api-gateway/src/cellar/cellar-registers.service.ts:496-518`, `readMenuRows`);
- the row record's menu book (`apps/api-gateway/src/beverages/beverages.service.ts:793-817`);
- the ledger SQL `house_beverage_ledger` (migration `the_ledger_lists_only_the_current_menu`, the `JOIN public.restaurant_menus … status = 'active'` at :79-82).

The two gateway readers share `readCurrentMenuLines` (`apps/api-gateway/src/menus/current-menu-lines.ts:50-81`). Every menu read is inserted as a draft (`apps/api-gateway/src/menus/menus.service.ts:591`) and stays one until `make_menu_current` runs (ADR 0193 item 7). So a house that read a menu and never made it current has no current menu. The review of #606 asked that this consequence be recorded, since no ADR stated it.

## Options considered

**Decision 1, the tile's words** (the founder chose between the first two):

1. **Rename the label and the source line (chosen).** The words then match the figure. It costs two strings, which appear in two maps.
2. **Keep "Carried but off this read".** This costs nothing to build, but it describes a read the figure no longer depends on.
3. **Also rename the id `offbook`.** Rejected. Houses store the id in `restaurant_cellar_settings.gazetteer_measures`, and the gateway's DTO vocabulary holds it too (`apps/api-gateway/src/cellar/dto/hold-ceremony.ts:49-64`). Renaming it would migrate stored settings to change no word a reader sees, and the founder's option renamed only words.

**Decision 2, a house whose only menu is a draft:**

1. **Record it as built (chosen).** "On the menu" means on a current menu, which is ADR 0193's definition. `MenusService.readCurrentMenus` (`menus.service.ts:986-994`), `readVendorMenuSupply` (`apps/api-gateway/src/providers/vendor-menu-supply.ts:200`) and the price-lock read (`apps/api-gateway/src/pricing/price-locks.service.ts:543`) already apply it.
2. **Exclude archived copies but keep drafts.** This would itself be a new, undecided choice. It contradicts ADR 0193 item 7's "read and kept", where a draft's lines "do not touch inventory or prices", and it contradicts the three readers above.
3. **Do nothing.** The behaviour stays recorded only in a code comment and a migration header (`cellar-registers.service.ts:487-495`). A reader would then be left to guess whether it is a defect.

## Decision

**1. The tile says what it counts.** The founder's pick is quoted verbatim: *"Rename, small follow-up (Recommended)"*. The option he picked set the two strings, and they are built word for word:

- In both maps the label becomes *"Carried, not in the wine library"* (`Registers.tsx` and `CellarSection.tsx`, `MEASURE_LABEL.offbook`).
- The source line becomes *"this house's wine rows with no wine-library link"* (`Registers.tsx`, `MEASURE_SOURCE.offbook`). The page prints it with the typographic apostrophe (’) that its sibling source lines already use.

The option sized this as a small follow-up of about two files plus an ADR note, built after #606 merged. The measure id `offbook`, every house's stored `gazetteerMeasures` and the figure itself are unchanged. The `BuildingVM.offBook` doc comment now says the old figure *would* have read 119 of 134, because that number was worked out from the code and never seen on screen. It also rests the "no link = not in the library" equivalence on what actually carries it: the link is a foreign key under any delete action, and `GET /wines` filters out no library row (`apps/api-gateway/src/wines/wines.service.ts:490-527` applies only the caller's own filters). It no longer rests that equivalence on the key being `RESTRICT`.

**2. A house whose only menu is a draft has no current menu, on every cellar reader.** This records what #606 built, at `8fdb819b4`:

- **Registers readout.** `readCurrentMenuLines` finds no active menu, so it returns `{ currentMenus: 0, rows: [] }` and never reads `menu_items` (`current-menu-lines.ts:65`). The readout's menu source is readable with 0 rows, and its `menuLines` carries `currentMenus: 0` (`cellar-registers.service.ts:520-554`). The unplaced-lines card names the state: "No menu is current at this house, …" (`apps/web/src/pages/cellar/next/UnplacedMenuLines.tsx:66-74`).
- **Register inference.** A register with nothing of its kind in the cellar is inferred as carried only from `menuRows > 0` (`apps/api-gateway/src/cellar/cellar-registers.ts:555`). With no current menu it now infers `carried: false`, confidence `none`, with the basis "Nothing in this cellar and nothing on this menu names …" (`:568-578`). Before #606 it inferred `carried: true`, "likely", from the draft's lines. Cocktails or non-alcoholic drinks are typical registers with nothing of their kind in the cellar.
- **Ledger.** A draft's lines are not on the menu, so `menu_lines` is 0 and the row's `onMenu` is null (`apps/api-gateway/src/beverages/house-record.ts:265`, `:274-276`). `books` no longer lists `menu`. A product that appears only on the draft is no ledger row at all, because the ledger's keys are the union of the house's books (the migration's `keys` CTE).
- **Row record.** The menu book is empty, and its reason reads: "This house has no current menu, so no line is on it. A menu that was read but never made current is kept, not listed here." (`beverages.service.ts:809-816`).
- **Arrival assistant.** It accepts an *inferred* cellar proposal only when the live readout agrees and has inventory or menu evidence (`apps/api-gateway/src/arrival/arrival.service.ts:531-545`). A draft-only house's menu-only registers therefore cannot be proposed as inferred. An owner's own answer does not pass through this check. Onboarding offers the make-current choice right after a read (`apps/web/src/components/onboarding/MenuReviewScreen.tsx:102`). The MCP cellar resource serves the same readout (`apps/api-gateway/src/mcp-server/mcp-server.service.ts:398`).

**Open, not decided here (F1, for the founder).** ADR 0193 says a draft's lines do not touch inventory or prices. It does not say whether a kept draft is evidence of *which kinds of drink* a house carries, for register inference, the arrival assistant's inferred proposals and the ledger's listing. #606 treats it as no evidence. Whether that should hold is the founder's call; the options and a recommendation are in the PR that records this ADR.

## Consequences

- The tile and the Settings switch now read the same words, and those words are true of the figure. A house's stored tile choice is untouched.
- A reader of the draft-only behaviour now finds it stated with cites, and claims rows pin it. A change to any of these readers fails `scripts/check_decision_claims.sh` until this record changes with it.
- Still owed, not built here:
  - The register basis and the readout's `sources.menu` should name "no current menu" when `currentMenus` is 0, rather than "nothing on this menu" (`cellar-registers.ts:568-578`).
  - The row record's menu book pages the whole current menu with no cap (`beverages.service.ts:793-817`). That is fine at Tuzlu Rüzgar's 134 lines, and it should be watched on a very large menu.
- Revisit when:
  - the founder answers F1;
  - a house is seen on a draft-only menu in production with registers it plainly carries reading "not carried";
  - the gazetteer gains a measure whose label is copied by hand into both maps again (the two `MEASURE_LABEL` maps are still duplicates).

## Verification

- `apps/web/src/pages/cellar/next/CellarNext.test.tsx`, "names the off-library tile for what it counts". The tile reads the new label and source line, and the old words are gone. It fails on the source as it stood at `8fdb819b4`, and it fails when only the source line is put back.
- `apps/web/src/pages/settings/next/SettingsNext.test.tsx`, "names the off-library measure as the cellar tile does". The Settings switch is named by the new label. It fails at `8fdb819b4`.
- `claims.d/fix-offbook-tile-names-the-library.jsonl` holds two rows:
  - one pins both strings, the unchanged id, and no old words left in non-test web source;
  - one pins decision 2's anchors in the six files above.
- `claims.d/fix-cellar-invoice-book-and-menu-copy.jsonl:3` changes its prose only. It names the new label and drops "the tile's label is unchanged". Its verify is unchanged.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-05 | Founder (AskUserQuestion, ~07:30Z) | *"Rename, small follow-up (Recommended)"* |
| 2026-10-05 | Fix lane `offbook` | Created: decision 1 built, decision 2 recorded as #606 built it, F1 put to the founder |
