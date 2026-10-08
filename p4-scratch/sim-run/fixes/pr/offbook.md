## What was wrong for the owner (Tuzlu Rüzgar, follow-up to #606)

**[2026-10-06 ~00:16Z, coordinator, at merge]**
- **Head.** The merged head is **`eb605580f`**: `053881687` plus a merge of `origin/main` `8e16fbcef` (#647). `git diff 053881687 eb605580f` over this PR's 11 files is empty, so every "re-run on HEAD `053881687`" below describes the same content.
- **CI.** Run `37387056230` passed at `eb605580f` (40 success, 1 skipped).
- **Claims.** `check_decision_claims.sh` at `eb605580f`: **882 checked, 882 holding**, re-run at merge.
- **Audit.** ADR 0090 three-role audit **PASS** at `eb605580f`. Both reviews APPROVE WITH NOTES; the final call HOLDS. Comment 6006217227; report `p4-scratch/sim-run/fixes/audits/646-eb605580f/report.md`.
- **Owed follow-ups** (already listed below; restated here):
  - the stale note at `Registers.tsx:431` ("keyed on the wine library");
  - no browser check of how the longer par line wraps;
  - the rejected F2 options' text is not recorded.
- **Squash message.** Use the narrowed wording ("wine or not"), not `51b2edb27`'s "beers and spirits included".

- **A-053 (AW27). #606 fixed the tile's figure but not its words.**
  - #606 changed `BuildingVM.offBook` to count this house's active rows that have no wine-library link: `rows.filter((r) => !r.wineId).length` (`apps/web/src/pages/cellar/next/useCellarNextData.ts:1399` at HEAD). The figure covers every item, not only wine. The schema leaves that link NULL on every row that is not a wine (column comment on `restaurant_inventory.master_wine_id`, `supabase/migrations/20260903171000_the_house_item_is_the_ledgers_key.sql:181-185`), and `getRestaurantInventory` filters only on `restaurant_id` and `is_active` (`apps/api-gateway/src/database/database.service.ts:42-52`).
  - The tile still read *"Carried but off this read"* (`Registers.tsx`, `CellarSection.tsx`), with the source line *"this house’s wine rows vs the wine library"*. Those words describe a comparison against the library pages loaded so far. The figure no longer makes that comparison: on a first load, the old comparison would have read 119 of 134 for a house whose every row is linked. That number was worked out from the code and never seen on screen.
  - #606 listed the label as an unasked fork. The founder has since answered it, and later answered F2 and F3 (below).
  - The four sibling tiles (bottles, titles, par, par not set) also said "this house’s wine rows", though each is counted from the same whole inventory read (`useCellarNextData.ts:1377-1399`). F3 (below) asked about them.
- **#606's review asked for a record.** No ADR stated what #606 did to a house whose only menu is a draft. ADR 0193 item 7 lands every menu read as a draft, and a draft becomes current only through `make_menu_current`.

## What changed and why

Commits: `89aa9b10c` (rename, ADR, claims), `3a8090041` (ADR wording, docs only), `88d1b4939` (F2: the source line says "items"), `51b2edb27` (F3: the four sibling source lines say "items"), `83c627448` (F3's two code comments say "wine or not"; no printed string changes), `053881687` (ADR 0293 cite: where the menu book's uncapped read pages; docs only). Merges of origin/main: `417437b94` and `65e65e425` (clean), and `ca7ec42ba`, which brings in #607 (`1884dea38`, ADR 0291). That last merge conflicted only in `.planning/decisions/README.md`, where #607's 0291 row and this branch's 0293 row were added at the same place; both rows are kept, in number order. 11 files.

- **`apps/web/src/pages/cellar/next/Registers.tsx`**
  - `MEASURE_LABEL.offbook` (:63) reads *"Carried, not in the wine library"*.
  - `MEASURE_SOURCE.offbook` (:87) reads *"this house’s items with no wine-library link"*. That is F2's option text, except that it prints the typographic apostrophe (’) its sibling source lines already use.
  - F3, the four sibling source lines (:82-84, :88):
    - `bottles` and `titles`: *"this house’s items"*;
    - `par`: *"this house’s items with a par recorded, against each item’s own par"*. Its figure looks only at items with a `thresholdMin` (`min !== null && stock <= min`);
    - `parUnset`: *"this house’s items with no par recorded"*. The old line, "against each item’s own par", described items that have no par.
    - "items" is the founder's answer. The rest of the two par lines is this lane's wording, so each line is true of its figure; ADR 0293 says so.
  - The doc comment above `MEASURE_SOURCE` said the first four tiles were counted off "this page's own wine read". It now says every tile but `registers` is counted off the house's whole inventory read, wine or not.
  - Short comments cite ADR 0293, F2 and F3.
- **`apps/web/src/pages/settings/next/CellarSection.tsx`** keeps its own copy of `MEASURE_LABEL.offbook`. That copy now carries the same label (:54).
- **Unchanged:** every tile label except `offbook`'s, the measure ids, `GAZETTEER_MEASURE_IDS` and `DEFAULT_GAZETTEER_MEASURES` (web and gateway `hold-ceremony.ts`), every house's stored `gazetteerMeasures`, and every figure.
- **`useCellarNextData.ts`, the `BuildingVM.offBook` doc comment** (brief item 5):
  - It names the tile by its new label.
  - It says every item counts, not only wines (F2).
  - "read 119 of 134" becomes "**would** read 119 of 134 … (worked out from the code, not seen on screen)".
  - It explains why "no link" means "not in the library". The link is a foreign key under any delete action, and `GET /wines` filters out no library row (`wines.service.ts:490-527` applies only the caller's own filters). The comment no longer rests on the key being RESTRICT.
- **The same stale wording is fixed elsewhere** (found with `git grep` for "119 of 134", "off this read" and "vs the wine library"):
  - The A-053 comment in `cellar-book.test.tsx` gets the same "would read" fix and calls the old label the old label.
  - `.planning/06-pages/wines.md:67` names the tile by its new label, quoted because the label contains a comma.
  - Left alone: the sketch HTML (`.planning/sketches/095-cellar-merged/merged-parent.html`), a historical artefact; and `recommendation-actions.service.ts:1651`, where "off this read" means something unrelated.
- **Tests:**
  - `CellarNext.test.tsx:490-520`, "names the off-library tile for what it counts". It pins the label and the source line, and that the tile says neither "wine rows" nor the old words.
  - `SettingsNext.test.tsx:936-943`, "names the off-library measure as the cellar tile does". It pins that the Settings switch is named by the new label.
  - `CellarNext.test.tsx:522-553`, "the %s tile names the items it was counted from" (F3; the `it.each` starts at :527). One case per sibling line: it draws that one tile and pins its source line exactly, and that the tile does not say "wine rows".
  - `CellarNext.test.tsx:466-488`, "draws the house's configured tiles, each naming the source it was counted from", matched `/this house.s wine rows|…/`. It now matches `/this house.s items|…/` (:486).
- **ADR 0293 (new) holds two decisions plus F2 and F3.**
  1. **The rename.** Locked on the founder's pick, quoted verbatim. An F2 section records the question, the answer, the option text and the rejected options, verbatim. It also says why F2 was asked, cites the migration, and lists what was built and what F2 did not change. Earlier sentences that F2 made untrue are bracketed in place and dated, not deleted.
     - An F3 section (`0293-…md:82-116`) records F3's question, answer, option text and rejected option, verbatim; why it was asked (what each of the four figures counts); the four lines built; which wording is the lane's; and what F3 did not change. F3 made two sentences stale, and both are bracketed in place: F2's "Not changed by F2" paragraph, and the Verification count of claims rows (two → three). The status line, keywords and review trail name F3.
  2. **A record of what #606 built for a house whose only menu is a draft.** Proposed, and it changes no code. It describes the code at `8fdb819b4`, with cites:
     - The registers readout returns `currentMenus: 0` (`current-menu-lines.ts:65`), and the unplaced card says "No menu is current" (`UnplacedMenuLines.tsx:66-74`).
     - A register that only the menu supported infers `carried: false`, with the basis "Nothing in this cellar and nothing on this menu names …" (`cellar-registers.ts:555`, `:568-578`).
     - In the ledger, `menu_lines` is 0, so `onMenu` is null and `books` drops `menu` (`house-record.ts:265`, `:274-276`). A product that is only on the draft gets no ledger row.
     - The row record says "This house has no current menu …" (`beverages.service.ts:809-816`).
     - The arrival assistant accepts an *inferred* proposal only when the readout agrees and has inventory or menu evidence (`arrival.service.ts:531-545`). An owner's own answer does not go through that check. Onboarding offers make-current right after a read (`MenuReviewScreen.tsx:284-292`).
     - F1, whether a kept draft is evidence of what a house carries, is left to the founder (below).
  - This round (`053881687`), the "still owed" bullet about the uncapped menu read now cites where the paging happens: the menu book's reader (`beverages.service.ts:793-817`) calls `readCurrentMenuLines`, which keyset-pages every line through `readAll` (`current-menu-lines.ts:67-79`). The old cite named only the reader.

## Tests, guards and harness

**Final round, re-run on HEAD `053881687`** (merge base origin/main `1884dea38`; the worktree is clean):

- **Vitest:** `CellarNext.test.tsx`, `SettingsNext.test.tsx`, `cellar-book.test.tsx` and `UnplacedMenuLines.test.tsx` give **4 files, 174 passed**.
- **Fail before, pass after (all three answers at once, re-run this round):**
  - Method: `Registers.tsx` and `CellarSection.tsx` were snapshotted with `cp -p` to scratch, overwritten with their origin/main (`1884dea38`) versions, then restored from the snapshot (`cmp` identical, `git status` clean). git stash was not used.
  - Result: `npx vitest run CellarNext.test.tsx SettingsNext.test.tsx` gives **7 failed, 151 passed**. The 7 are: the configured-tiles test, "names the off-library tile for what it counts", the four F3 cases (bottles, titles, par, parUnset) and the Settings switch test. At HEAD all pass.
- **Fail before, pass after (F3 alone, the builder's round at `51b2edb27`):** with `Registers.tsx` at `88d1b4939`, `vitest -t "In the building tonight"` gave 5 failed, 4 passed (the four F3 cases plus the configured-tiles test). For example:

    ```
    × … the par tile names the items it was counted from, not "wine rows" (ADR 0293 F3)
    Expected: "this house’s items with a par recorded, against each item’s own par"
    Received: "this house’s wine rows, against each item’s own par"
    × … the parUnset tile names the items it was counted from, not "wine rows" (ADR 0293 F3)
    Expected: "this house’s items with no par recorded"
    Received: "this house’s wine rows, against each item’s own par"
    ```

- **Fail before, pass after (F2 alone, the round at `88d1b4939`):** with `Registers.tsx` at `3a8090041`, the off-library tile test failed with:

    ```
    Expected element to have text content:
      this house’s items with no wine-library link
    Received:
      Carried, not in the wine library3this house’s wine rows with no wine-library link
    ```

- **Typecheck:** `npx tsc --noEmit | grep -v '^../../packages'` reports only the known `src/services/api/passkeys.ts(14,81)` '@simplewebauthn/browser' error, which every worktree has and which has nothing to do with the touched files.
- **Lint:** `npx eslint --quiet --resolve-plugins-relative-to …/web-lint` on the 6 web files in the diff exits 0.
- **Claims:**
  - `env LC_ALL=C bash scripts/check_decision_claims.sh` reports **880 checked, 880 holding** (876 before #607 merged into this branch).
  - `test_check_decision_claims.sh` passes (31 ok, 0 failed).
  - Mutation checks from earlier rounds (each makes its row exit 1) are listed under the claims rows below. The verifier repeated two itself: `parUnset` put back to "wine rows" fails `CELLAR-TILE-SOURCES-SAY-ITEMS`, and `menuRows > 0` made `>= 0` fails `CELLAR-DRAFT-ONLY-HOUSE-HAS-NO-CURRENT-MENU`.
- **Guards:** each of these exits 0, both on a normal run and with `--self-test`, at HEAD:
  - `check_adr_numbers_unique` (0293 appears in no other ref; a sweep of the sibling worktrees in an earlier round found no other 0293)
  - `check_od_ids_exist`, `check_citation_pairing`, `check_no_conflict_markers`
  - `check_a_count_is_recorded`, `check_windowed_figures`, `check_web_reads_gateway_dto_keys`, `check_read_errors_not_swallowed`, `check_no_seeded_defaults`, `check_money_states_its_currency`
  - `check_verified_at_is_not_a_boolean`, `check_analytics_cost_honesty`, `check_ask_ai_is_gated`, `check_flag_readby_anchors`, `check_test_scripts_are_real`

  In an earlier round the verifier ran every `scripts/check_*.py`. All passed except 8 that need a database, `.env` or deploy URL (`check_beverage_identity_parity`, `check_beverage_kind_regression`, `check_display_name_parity`, `check_definer_functions_closed`, `check_deployed_sha`, `check_house_item_invariants`, `check_migration_ledger`, `check_web_deployed_sha`); they cannot run here and none touches this diff.
- **Decision-record ownership:** origin/main's `pr_audit_gate.ownership_between('.', 'origin/main', 'HEAD')` returns `[]` at `053881687`.
- **Local Postgres harness: not applicable.** This PR has no SQL and no migration, so `offbook-local-pg.txt` was not written.

## ADR, CLAIMS and register touched

- **New:** `.planning/decisions/0293-the-off-library-tile-names-the-wine-library-and-a-draft-menu-is-not-current.md`.
- **`.planning/decisions/README.md`:** one **new** row, 0293, after 0291. No existing row is edited. The branch-added row names F2, F3 and the four sibling lines.
- **New:** `.planning/decisions/claims.d/fix-offbook-tile-names-the-library.jsonl`. All three rows are static and mutation-tested.
  - `CELLAR-OFFBOOK-TILE-NAMES-THE-LIBRARY` pins:
    - the label and source-line strings in `Registers.tsx`;
    - the label in `CellarSection.tsx`;
    - `offbook` in both id lists, web and gateway;
    - none of "Carried but off this read", "vs the wine library" or "wine rows with no wine-library link" in non-test web source.

    The baseline exits 0, and each of these mutations makes it exit 1: `Registers.tsx` at `3a8090041`; `Registers.tsx` at `8fdb819b4`; `CellarSection.tsx` at `8fdb819b4`; the "wine rows" source line alone put back; `offbook` dropped from the gateway's `DEFAULT_GAZETTEER_MEASURES`; the old label written into a non-test file; "wine rows with no wine-library link" written into a non-test file. A harmless appended comment still exits 0, so the check is not a no-op.
  - `CELLAR-DRAFT-ONLY-HOUSE-HAS-NO-CURRENT-MENU` pins the eight text anchors of decision 2, across seven files. Each of its listed mutations exits 1. It checks text, not behaviour; the specs pin behaviour.
  - `CELLAR-TILE-SOURCES-SAY-ITEMS` (F3) pins the four sibling `MEASURE_SOURCE` strings exactly, as quoted above; that the parsed map still holds `offbook` and `registers` (so the whole block was read); that no `MEASURE_SOURCE` entry contains "wine rows"; and that no non-test `.ts`/`.tsx` under `apps/web/src` says "house’s wine rows" or "house's wine rows". The baseline exits 0, and each of these makes it exit 1: `Registers.tsx` at `88d1b4939`; each of the four lines alone put back to its `88d1b4939` text; `MEASURE_SOURCE` renamed; "this house’s wine rows" written into a comment in `useCellarNextData.ts`. An appended harmless comment still exits 0.
- **`claims.d/fix-cellar-invoice-book-and-menu-copy.jsonl:3`** (`CELLAR-OFFBOOK-COUNTS-THE-WHOLE-LIBRARY`):
  - Only the claim prose and `verified` (2026-10-05) change. The `verify` and `status` are byte-identical to main's.
  - The prose now names the new label, rests the equivalence on two facts (the link is a foreign key, and `GET /wines` is unfiltered), and drops "The tile's label is unchanged (renaming it is an open founder fork)", which is no longer true.

## Founder answers (binding, verbatim)

- **2026-10-05 ~07:30Z (AskUserQuestion), the rename:** **"Rename, small follow-up (Recommended)"**.
  - The option text set the label to *"Carried, not in the wine library"* and the source line to *"this house's wine rows with no wine-library link"*, as a small follow-up after #606 merged.
  - The label is built word for word. F2 replaced the source line.
- **2026-10-05 ~20:30Z (AskUserQuestion), F2:**
  - Asked after the review of this PR at `3a8090041` found that the figure counts beers and spirits too.
  - **Question:** *"The cellar tile you renamed ('Carried, not in the wine library') counts every item with no wine-library link, including beers and spirits, which never get one. Its source line says 'this house's wine rows…', which is wrong for any house that carries more than wine. What should it do?"*
  - **Answer:** **"Say 'items', count all (Recommended)"**.
  - **Option text:** *"Source line becomes 'this house's items with no wine-library link'. The figure stays as it is today and the label stays true. Copy plus ADR fix, about 3 files, re-audit. Matches your all-beverages rule."*
  - **Rejected:** "Count wines only" and "Keep 'wine rows'". The lane brief records these by name only.
- **2026-10-05 ~21:29Z (AskUserQuestion), F3:**
  - Asked because F2 changed only the off-library tile, and the four sibling source lines had the same defect.
  - **Question:** *"Cellar page: four other tiles (bottles, titles, par, par not set) also say "this house's wine rows" but count every item the house carries, like the off-library tile you just fixed. Change them to "items" too?"*
  - **Answer:** **"Say 'items' on all four (Recommended)"**.
  - **Option text:** *"Same fix as the off-library tile, in the same PR: one page file, its test and an ADR note. Matches your all-beverages rule (wine-only wording is a defect)."*
  - **Rejected:** "Keep the words for now", option text *"Only the off-library tile changes; the four stay 'wine rows' and go on the owed list."*
  - Built as above: one page file (`Registers.tsx`), its test (`CellarNext.test.tsx`) and the ADR 0293 note, plus the claims row and this branch's README row.

## Forks deferred (not decided here)

- **F1. Is a kept draft menu evidence of which kinds of drink a house carries?**
  - **What ADR 0193 says.** Item 7 says a draft's lines "do not touch inventory or prices". It says nothing about register inference, the arrival assistant's inferred proposals, or the ledger's listing.
  - **What #606 did.** It treated a draft as no evidence for all three.
  - **Who it affects:** a house that read its menu and has not made it current. A register that only the menu supported (cocktails, soft drinks) reads "not carried", and the assistant will not propose it as inferred.
  - **Options:**
    - **(a) Keep as built.** Only a current menu counts. This matches /menu, /vendors and price locks, and onboarding offers make-current right after the read. Cost: a house that skips the choice sees those registers as not carried until it chooses or answers.
    - **(b) Count the newest draft for register inference only, when a house has no current menu.** Confidence would be "likely", with a basis that names "a menu read but not made current". Cost: a second meaning of "the menu" in one reader, a gateway change plus tests, and the arrival check would accept the proposal.
    - **(c) Read "unknown — no current menu" instead of `carried: false`.** Cost: a new inference state, which the register cards and the arrival check would both have to handle.
  - **Recommendation: (a).** The honest-sentence half of (c) is already owed below and needs no change to the inference.
- **The words past "items" on the two par lines** (see "Not covered"): the founder's F3 option set no strings, so if he wants different words for "with a par recorded" / "with no par recorded", that is a copy follow-up, not a change to any figure.

## Merge-order notes

Re-measured at HEAD `053881687` against origin/main `1884dea38`: `gh pr list --state open --json files` (76 open PRs), then `git merge-tree --write-tree --name-only` for each PR that shares a file.

- **`.planning/decisions/README.md`:** this PR adds one row, 0293, after 0291. About 22 open PRs also add rows there, and #627 conflicts with this branch only in this file (it conflicts with main there too since #607 merged). On conflict, keep both rows, ordered by number.
- **#628** (`fix/cellar-door-checked-cost`, stacked on #627) shares `useCellarNextData.ts` and `CellarNext.test.tsx`.
  - Against this HEAD, `git merge-tree` reports conflicts in 6 files: README.md, `claims.d/fix-cellar-invoice-book-and-menu-copy.jsonl`, `beverages.service.spec.ts`, `cellar-book.test.tsx`, `useCellarNextData.ts` and `sql_outside_migrations.txt`.
  - Against origin/main alone it already conflicts in 3: README.md, `beverages.service.spec.ts` and `sql_outside_migrations.txt`.
  - The cause is that the #627 → #628 stack still carries #606's pre-squash history, so it must take main first. After that, the stack's own changes in the shared files are `useCellarNextData.ts:~459` (`OnMenuVM`) and `CellarNext.test.tsx:~719`, far from this PR's hunks (`CellarNext.test.tsx:486` and `:490-553`). `git merge-tree` reports no conflict in `CellarNext.test.tsx`.
  - On a stale-base conflict in the `offBook` doc comment, the A-053 comment or claims row 3, keep this PR's wording, which is the later truth.
- **#589** (`docs/adr-0115-drinks-lock`) also edits `.planning/06-pages/wines.md`, far from :67. It does not conflict with this HEAD.
- No other open PR shares a file with this branch. This PR stacks on nothing and can merge in any order.

## Not covered (shortcuts, stated per CLAUDE.md §0.5)

- **No browser check.** The tiles and the Settings switch were checked only through vitest (jsdom). None was rendered in the Browser pane, so the longer par line's wrapping was not seen (the tile note wraps freely in CSS).
- **The two par lines carry this lane's wording beyond "items".** The founder's F3 option set no strings. "with a par recorded" (par) and "with no par recorded" (par not set) were added so each line is true of its figure; ADR 0293's F3 section says which words are his and which are the lane's. He has not seen those exact strings.
- **The note under the tiles is stale about the schema and was left alone** (`Registers.tsx:431`): "Everything the cellar holds is booked against the wine library today — `restaurant_inventory` is keyed on it, so beer, spirits and cocktails can be browsed here but not yet counted as stock."
  - Since migration `the_house_item_is_the_ledgers_key`, the column comment calls `master_wine_id` an attribute, not the key, and NULL on every non-wine row, so "keyed on it" is stale. In a house whose off-library tile shows more than 0, "Everything the cellar holds is booked against the wine library" is also contradicted by the tile above it. This was already so before this PR (the old tile said "vs the wine library").
  - The rest of the sentence still holds for the app as built, checked this round: the gateway's two `restaurant_inventory` inserts both set `master_wine_id` from a required wine id (`apps/api-gateway/src/inventory/inventory.service.ts:987`, from `CreateInventoryItemDto.wineId`, a required `@IsUUID()` field in `inventory/dto/inventory.dto.ts:34-36`; and `:1342`, from `receiveBulkLine`'s `masterWineId: string`, `:1299`), so no app path creates a beer or spirit stock row today. Non-wine rows can exist only through SQL written outside the app.
  - It is not a "wine rows" line and F3 did not ask about it, so it is owed as a small copy follow-up.
- **The same "keyed on the wine library" claim appears in page copy on other surfaces,** not these tiles: `WholeCellar.tsx:255-260` (also "a wine row carries a stock figure and a beer row cannot"), `cellar-format.ts:466` and `:530-538`, `registerShapes.ts:61`, and `cellar-columns.ts:545` ("Bottles in the building. Wines only — …"). Code comments say it too (`CellarNext.tsx:46`, `CatalogueRegister.tsx:31`, `RowExpander.tsx:15`, `WholeCellar.tsx:19`, `Registers.tsx:187`, `registerShapes.ts:28`, `cellar-format.ts:519`). Several cite OD-113. Left alone.
- **The label "Bottles on hand"** sums `stockLive` over every item, whatever its `restaurant_inventory.uom`. F3 asked about source lines; labels and figures are unchanged.
- **Owed, and out of this lane by the brief:**
  - When `currentMenus` is 0, the register basis and the readout's `sources.menu` should say "no current menu", not "nothing on this menu" (`cellar-registers.ts:568-578`). This is #606's follow-up 2, a gateway change.
  - The row record's menu book reads the whole current menu with no cap (`beverages.service.ts:793-817` through `readCurrentMenuLines`, `current-menu-lines.ts:67-79`). That is fine at Tuzlu's 134 lines and should be watched on a very large menu. This is #606's follow-up 6.
- **The two `MEASURE_LABEL` maps are still kept by hand,** in `Registers.tsx` and `CellarSection.tsx`. Folding them into one export was left out, to keep this change to the words the founder chose. The tests and the claims row pin agreement on `offbook` only, not on the other five ids.
- **Decision 2 records #606's code at `8fdb819b4` as read.** The arrival flow and the MCP cellar resource were not run.
- **F1's options live in this PR body, not in ADR 0293.** The ADR names F1 and points here for the options and the recommendation.
- **F2's rejected options are on record by name only.** Their option text is not in the brief and was not reconstructed.
- **The source line is not byte-identical to the option text.** It prints the curly apostrophe (’) where the option has a straight one ('). ADR 0293 says so, and the claims row pins the curly form.
- **Commit history.** `51b2edb27`'s message body says "beers and spirits included"; `83c627448` narrowed the two code comments to "wine or not", and history was not rewritten. A squash message built from the commits should use the narrowed wording. The merges `417437b94` and `65e65e425` carry git's default message with no co-author trailer (made with `git merge --no-edit`); `ca7ec42ba` carries a body and the trailer.
- ~~**Nothing is pushed.** HEAD `053881687` is local, and #646 on GitHub still shows the earlier head `3a8090041` until the coordinator pushes.~~ [2026-10-06, coordinator: false at the merged head. `053881687` was pushed with main `8e16fbcef` merged in, as `eb605580f`. See the note at the top.]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
