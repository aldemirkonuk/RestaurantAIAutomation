## What was wrong for the owner (Tuzlu Rüzgar, analytics walk 2026-10-03, read-only)

/cellar was reading the wrong records in three places.

- **A-028 (major in the walk, F-148 minor in the register; cluster C03). /cellar counted the archived copy of the menu as still on it.**
  - Tuzlu has 1 current menu with 134 lines. /cellar read 267 menu lines (134 live plus a 133-line archived copy).
  - So 90 of the 91 non-wine rows counted 2 menu lines. Cocktails read 21 (11 + 10).
  - Register `menuRows` read wines 118, beer 22, cocktails 21, spirits 66 and non-alcoholic 36.
  - The unplaced-lines list showed 'Muscat de Beaumes-de-Venise' and 'Mighty Dry Cider' twice each.
  - On the spirits, beer, whiskey and non-alcoholic house rows, every row read `onMenu.lines = 2` (34/34, 14/14, 6/6 and 19/19).
  - Three readers had the same gap:
    - `cellar-registers.service.ts` `readMenuRows`, which feeds the tally and the unplaced list;
    - the `menu` CTE of `house_beverage_ledger` (migration `a_discarded_menu_line_leaves_the_ledger_too`);
    - `beverages.service.ts` `readMenuLines`, the row record's menu book.
- **A-043 (AW13). Every cellar row record's invoice book failed to read and showed "invoices unread".**
  - 5 of 5 row records were fetched, and the book returned `readable: false` with "more than one relationship was found for 'procurement_documents' and 'providers'". The card text comes from code; it was not rendered.
  - Cause: `INVOICE_LINE_COLUMNS` embedded `providers(name)` with no FK hint. Two foreign keys join the pair:
    - `procurement_documents.provider_id` (baseline `procurement_documents_provider_id_fkey`);
    - `providers.created_from_document_id`, added by migration `a_vendor_is_resolved_by_identity`.
  - The brief left this second path open. The plan settled it.
- **A-044 (latent). The same column list left out `doc_number`.** The ledger uses `doc_number` as each invoice line's note, so every note would have been blank even after the link error was fixed.
- **A-053 (AW27). The 'Carried but off this read' tile was judged against only the library pages loaded so far.**
  - On first load, 15 of the 134 house rows fall in the first 500 library titles, so the tile would have read 119.
  - The truth is 0, because all 134 rows are linked (`master_wine_id` 134/134).
  - The 119 is from code over the walk's raw data. It was not rendered.

Correction to commit e7febf7d0's body (corrected again in a116b61e6): the invoice read did **not** fail silently. `failed()` logged it, and the card said "invoices unread". A-044 was latent.

## What changed and why

- **`apps/api-gateway/src/menus/current-menu-lines.ts` (new): `readCurrentMenuLines(client, restaurantId)`, one current-menu read for the cellar's readers.**
  - It reads the `restaurant_menus` ids with `status = 'active'` for the house. That is ADR 0193's "current menu", which /menu, /vendors and the price locks already use.
  - It then reads those menus' `menu_items` and leaves discarded lines out. The read is tenant-scoped and keyset-paged on `id` through the existing `readAll`.
  - Several active menus are read as one union, as the other readers do.
  - With no active menu it returns `{ currentMenus: 0, rows: [] }` and never reads `menu_items`.
  - Either read error **throws**. The function never returns a shorter menu.
  - It is a plain function, not a `MenusService` method, because `MenusModule` imports `CellarModule` and injecting the service would close a module cycle.
- **`cellar-registers.service.ts` / `cellar-registers.ts`**
  - `readMenuRows` now uses the helper. The tally and the unplaced list still come from one read and one filter (OD-140).
  - The readout's tally becomes `CurrentMenuLineTally` (`MenuLineTally` + `currentMenus`). `UnplacedMenuLinesReadout` also gains `currentMenus`.
  - A failed read still gives `menuLines: null`: unknown, not zero.
- **`beverages.service.ts`**
  - `INVOICE_LINE_COLUMNS` now embeds `providers!procurement_documents_provider_id_fkey(name)` and reads `doc_number`. The JSON key stays `providers`, so the mapping is unchanged. This follows the repo's precedent `users!restaurants_manager_id_fkey`.
  - The menu book now uses `readCurrentMenuLines`, which removes its unordered 400-line slice. A read error goes to `failed('menu')`. With no current menu the book is readable and empty, and its reason says the house has no current menu.
- **Migration `the_ledger_lists_only_the_current_menu`** (cited by slug; this lane's slot sorts after everything on main and after #603 and #604, and the final number is set at merge).
  - It runs `CREATE OR REPLACE` on `public.house_beverage_ledger` with the same signature and return shape. The body is a verbatim copy of `a_discarded_menu_line_leaves_the_ledger_too`'s.
  - The only body change is that the `menu` CTE now inner-joins `restaurant_menus rm ON rm.id = mi.menu_id AND rm.restaurant_id = p_restaurant_id AND rm.status = 'active'`. The COMMENT is updated too. I diffed it against the previous definition myself: those two hunks and one re-worded comment line are the only changes.
  - Neither definition has a SECURITY or search_path clause, and `CREATE OR REPLACE` keeps grants. The applied migration is not edited, and no sibling lane redefines this function.
- **Web**
  - `useCellarNextData.ts`: `offBook` is now `rows.filter(r => !r.wineId).length`, computed from the inventory alone, and the memo no longer depends on `bottles`.
    - This is exact against the whole library: `restaurant_inventory_master_wine_id_fkey` is ON DELETE RESTRICT, so a linked row's wine is always in the library.
    - It costs no extra request.
    - The brief offered it as one of two acceptable fixes. The other, `GET /wines?ids=`, would still page at 500.
  - `MenuLineTallyVM` gains an optional `currentMenus`.
  - `UnplacedMenuLines.tsx` gains a "no current menu" state (`menu-lines-no-current`), kept apart from "empty menu" (ADR 0020/0051).
- **What a draft-only house sees now** (follows from ADR 0193's "a draft is read and kept, never chosen"; not a new choice):
  - A house whose only menu is a draft now reads "no current menu" on /cellar, and its ledger rows lose `onMenu`.
  - A register that only the draft supported, such as cocktails or non-alcoholic, now infers `carried: false`. Its basis reads "Nothing in this cellar and nothing on this menu names …".
  - This matches /vendors and the price locks. Tuzlu is not such a house: it has 1 active menu.

## Tests and guards (run on HEAD b94a9aef4, origin/main fb862aa57)

Afterwards `origin/main` `e2cbe426a` (#601, no SQL) was merged in at `92a09f393` with no conflicts. Re-run at that head: `check_adr_numbers_unique`, `check_od_ids_exist` and `check_decision_claims` PASS, and the `pgtest.sh` SQL proof below ([fix] PASS, [ctl] FAIL at T1).

- **Gateway**, `npx jest src/beverages/beverages.service.spec.ts src/menus/current-menu-lines.spec.ts src/cellar/cellar-registers.service.spec.ts src/cellar/cellar-registers.spec.ts --runInBand --forceExit`: **4 suites, 87 tests, all pass.** I re-ran this at last call.
  - The broader run (`src/beverages src/cellar src/menus src/providers/vendor-menu-supply`, by the verifier) gave **17 suites, 285 tests, all pass**.
  - New cases:
    - the invoice select carries the hint and `doc_number`;
    - `INV-7` becomes the line note;
    - a line on the current menu and its archived copy is listed once;
    - a house with no current menu says so and never reads `menu_items`;
    - an unreadable current menu gives an unread book, or `menuLines: null`;
    - the unplaced list length equals `notPlaced` (OD-140);
    - the helper's active-only and tenant filters;
    - two active menus read as one union;
    - 1000+3 rows paged to 1003;
    - both read errors throw.
  - **Fails on main** (the verifier, on a scratch copy with origin/main's three sources): 3 suites failed, 12 tests failed, 69 passed.
- **Web**, `npx vitest run src/pages/cellar/next/cellar-book.test.tsx src/pages/cellar/next/UnplacedMenuLines.test.tsx`: **2 files, 16 tests, all pass.** I re-ran this at last call.
  - The broader run (`src/pages/cellar src/pages/settings/next`) gave **26 files, 456 tests, all pass**.
  - With origin/main's `useCellarNextData.ts` and `UnplacedMenuLines.tsx` swapped in: 3 failed, 13 passed. The failures were `offBook` 4 vs 1, a null `offBook` and the missing no-current state.
- **SQL proof**, `pgtest.sh lane … cellar` on local Postgres 17, template sha fb862aa57 = origin/main. Output is in `p4-scratch/sim-run/fixes/audits/cellar-local-pg.txt`:
  ```
  [fix] PASS 20261219120000_the_ledger_lists_only_the_current_menu_test.sql
  [ctl] FAIL 20261219120000_the_ledger_lists_only_the_current_menu_test.sql: ERROR:  T1 FAIL the current menu's line reads menu_lines = 2, expected 1 (the archived copy is still counted)
  ```
  [2026-10-05: that run predates the renumber. Re-run at `093416f16` (main `e1d65b3ad` merged in) under the new version: `[fix] PASS 20261222120000_the_ledger_lists_only_the_current_menu_test.sql`, `[ctl] FAIL` at the same T1 (`p4-scratch/sim-run/fixes/audits/606-local-pg.txt`).]
  - T1: the current menu and its archived copy count once.
  - T2: a draft-only line is not on the menu.
  - T3: a discarded line stays off.
  - T4: the signature and the 31-column return shape are unchanged.
- **Typecheck**
  - Gateway `tsc -p tsconfig.spec.json`: 2 errors, both in `src/passkeys/passkeys.service.ts`.
  - Web `tsc`: 1 error, in `src/services/api/passkeys.ts`.
  - All three come from `@simplewebauthn/*` missing in the symlinked node_modules. None is in a lane file. I re-ran both at last call.
- **Lint**: eslint `--quiet` on the 7 gateway and 4 web lane files: rc 0. Only prettier warnings remain. They grew in `beverages.service.spec.ts` (19 to 24) and `cellar-registers.service.spec.ts` (40 to 56).
- **CI guards**
  - All 44 `scripts/check_*.py` named in ci.yml exit 0. `--self-test` exits 0 on the 12 that have one; `check_migrations_single_home.py` has none.
  - At last call I re-ran `check_adr_numbers_unique`, `check_migration_versions_unique` (origin/main plus the open PRs), `check_migration_order`, `check_migrations_single_home`, `check_read_columns_exist`, `check_read_errors_not_swallowed`, `check_queried_tables_exist` and `check_web_reads_gateway_dto_keys`: all rc 0.
  - Shell guards `check_no_direct_stock_writes`, `check_no_direct_type_attributes_access` and `check_model_calls_logged`: rc 0.
  - Mutation: adding a fake column to `CURRENT_MENU_LINE_COLUMNS` makes `check_read_columns_exist` fail at `current-menu-lines.ts:71`.
- **CLAIMS**, `env LC_ALL=C bash scripts/check_decision_claims.sh`: **844 checked, 844 holding** (re-run at last call). The 10 claim mutations on a scratch mirror each exit 1.

## ADR, CLAIMS and register touched

- **ADR: none written. 0293 stays reserved for this lane's follow-up.**
  - ADR 0193 (locked) already governs "current menu = `status = 'active'`, a draft is never chosen, `no_current_menu` is a named state".
  - ADRs 0020/0051/0067 govern "a failed read is not an empty one".
  - The FK hint is a mechanical correction.
  - The `offBook` change keeps the meaning (rows not in the wine library) and swaps the method for one that is exactly equivalent under the RESTRICT FK. The brief itself offered it.
  - An ADR plus its README row would put this PR at 17 files, past ADR 0231's 15-file cap.
- **CLAIMS**: `.planning/decisions/claims.d/fix-cellar-invoice-book-and-menu-copy.jsonl`, 3 rows, all `resolved`, static Python:
  - `CELLAR-INVOICE-BOOK-NAMES-ITS-VENDOR-FK`
  - `CELLAR-MENU-READERS-READ-THE-CURRENT-MENU`
  - `CELLAR-OFFBOOK-COUNTS-THE-WHOLE-LIBRARY`
- **Register**: not edited here. F-148 (C03), AW13, AW27 and A-043/044/028/053 are left for the register owner to strike after merge. The severity conflict on F-148 (minor) vs A-028 (major) is also the register owner's.

## Founder answers

None. The lane brief has no FOUNDER ANSWERS section, so nothing here was built from or quotes a founder answer.

## Forks deferred (not decided here)

- **The `offbook` tile label.** The figure no longer depends on the read, so 'Carried but off this read' (Registers.tsx:61, settings/next/CellarSection.tsx:54) is slightly stale.
  - (a) Keep it.
  - (b) Rename it to 'Carried, not in the wine library', and change the source line (Registers.tsx:77) to "this house's wine rows with no wine-library link".
  - Plan recommendation: (b), as a follow-up PR of 2 files plus ADR 0293 plus a README row.
  - The measure id `offbook` and the stored `gazetteerMeasures` do not change.
  - **Unasked.** The label is unchanged in this PR, and the source sentence "vs the wine library" stays true.

## Merge-order notes

- **`scripts/sql_outside_migrations.txt`** is the only file shared with other open lanes: #603 (postime, `fix/pos-sales-dated-at-sale-time`) and #604 (events, `fix/delivery-events-follow-the-order`). All three append one line at the tail. Whichever merges second gets an append conflict; keep every line, in version order.
- **Migration order is independent of merge order.** This lane's version sorts after #603's and #604's lane slots and after main's newest (`a_short_pour_opens_the_next_bottle`). None of them redefines `house_beverage_ledger`.
- **Soft overlap with local-only a2e1c27c6** (fix/cellar-hide-legacy-sweetness, ADR 0270; unpushed, on the founder's word). It edits `useCellarNextData.ts` lines about 50-260. This PR edits that file at about :281, :363 and :1384-1397. The hunks do not intersect.
- No other open PR touches a lane file. That was checked by the plan at 8c673db4b and by inflight.md (2026-10-04T18:14Z).

## Not covered (shortcuts, stated per CLAUDE.md §0.5)

1. **No ADR.** The draft-only-house consequence (no current menu, `onMenu` lost, menu-only registers infer `carried: false`) is recorded only here, in code comments and in the migration header. Writing it into an ADR 0193 amendment or ADR 0293 is owed in the follow-up PR.
2. **The FK hint was never run against a real PostgREST.** There is no local PostgREST and no production calls were allowed. The fix rests on:
   - the constraint name (`baseline_from_production.sql:13102`);
   - the second FK (`a_vendor_is_resolved_by_identity`:59-60);
   - the repo's precedent;
   - a test that asserts the select string.

   No providers→procurement_orders FK exists, so the order book's bare embed is not ambiguous. Tuzlu holds **0 procurement documents** (AW14), so after deploy its invoice book will read as empty rather than unread. Lines appear only once paper is filed. A-043 cannot be seen at Tuzlu until then.
3. **Not re-measured:**
   - the 119 / 134 figure;
   - the 4,226 library size (a 2026-09-05 note);
   - the premise that `GET /wines` filters no library row out. It is true of the default call, and the CLAIMS row says it does not re-check it.

   The `BuildingVM.offBook` doc comment says the old count "read 119 of 134 on a first load". That figure was computed from code over the walk's raw data and never rendered; "would read" is the supported wording.
4. **RLS and grants not exercised.** The SQL test runs as superuser on local Postgres 17, not on Supabase.
5. **`scripts/check_gateway_boots.sh` not run.** `nest build` fails locally on the missing `@simplewebauthn` packages. The lane adds no Nest provider or module (`readCurrentMenuLines` is a plain function), so the DI graph is unchanged. That is reasoned from the code, not run.
6. **Edge sentence not fixed.** Take a house with no inventory, no cocktails and only a draft menu. `hasAnyEvidence` is now false, so its registers read `carried: null` with the basis "…no menu has been read…", though a draft was read and kept. The state (unknown) is right but the sentence is slightly inaccurate. It is not Tuzlu's case and is not changed here.
7. **Deferred, as planned, and not filed as tech-debt.d entries** (file cap; the coordinator routes them):
   - **The embed-ambiguity guard** (C18/F-156: every embed resolves exactly one FK path or carries a hint). The plan measured 66 ambiguous directed FK pairs. Until the guard exists, a CLAIMS row pins this one pair.
   - **The row-record books' unordered 400-row slices** (invoice, order, quote and POS books in `beverages.service.ts`). Tuzlu's invoice truth is about 550 lines, so lines past the slice would read "no line names this" once paper is filed. C15 class.
   - **`readCatalogueCounts`** reads `master_wine_library` unpaged (1,608 rows read against a library of about 4,226 titles).
   - **Four copies of the current-menu read** now exist (`menus.service.ts`, `vendor-menu-supply.ts`, `price-locks.service.ts`, the new helper). Consolidating them is a follow-up.
8. **Lint warnings** (prettier only) grew in the two touched specs, as listed above.
9. **Commit e7febf7d0's body carries a false sentence** ("failing silently"). History was not rewritten. a116b61e6 and this body correct it.

## Re-head onto main 2b6782291 (coordinator, 2026-10-05)

- `729924069` merges origin/main `2b6782291` (#591, #602, #603, #604 and others since `fb862aa57`). The only conflict was the tail of `scripts/sql_outside_migrations.txt`; every line from both sides is kept.
- `0ffb8c07a` renumbers the migration and its test from `20261219120000` to `20261222120000`, past #603's `a_pos_sale_is_dated_by_its_check` (now main's newest), so a fresh `db reset` and production apply them in the same order (ADR 0212). It also updates the inventory line. No SQL changed. The section above names the old version in its test output.
- **Re-run:** `pgtest.sh lane` on the `28d32de36` template, replaying #591's and #603's migrations, then this one. `[fix]` PASS; `[ctl]` FAIL at T1 (menu_lines = 2, expected 1). Output: `p4-scratch/sim-run/fixes/audits/606-local-pg.txt` (outside the repo).
- Guards at `0ffb8c07a`: migration order OK; versions unique against main and 62 open PRs; single-home OK; ADR numbers unique; OD ids PASS.
- **Stacked on this PR:** #627 (cellarledger PR-1) and #628 (PR-2). They rebase onto main after this squash-merges.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

