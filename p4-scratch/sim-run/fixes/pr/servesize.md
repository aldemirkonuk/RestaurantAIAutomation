**[2026-10-06 ~04:50Z, coordinator, at `3f3689307`]**
- **This is the head to audit.** One commit was added after the lane's last call (`2832515b9`, SHIP): `3f3689307`. It renumbers the migration and its test from `20261222180000` to `20261223000000`, past main's newest, `20261222230000` (#621). It also updates the two citations, in `beverages.service.spec.ts:587` and `scripts/sql_outside_migrations.txt`. The SQL is unchanged.
  - Collision sweep: no remote ref, local branch or worktree holds a `20261223*` migration.
  - Guards at `3f3689307`: migration order 0, versions unique 0, OD ids 0, conflict markers 0, citation pairing 0.
  - 15 files against origin/main `4528b9689`.
- **Local Postgres, re-run at `3f3689307`.** The serve-size migration now applies after #621's tables migration, where the lane's run applied it before. Template `28d32de36`, 7 lane migrations:
  - 7 of 7 [fix] PASS, including `20261223000000_a_till_name_with_a_serve_size_joins_its_row_test.sql` and #621's `tables_learned_from_the_pos_test.sql`.
  - 7 of 7 [ctl] FAIL. The serve-size test fails on [ctl] with S1, as before.
  - Output: `audits/servesize-local-pg-3f3689307.txt`.
- **No longer stacked.** The PR is against main and squash-merges. The commit list shows #627's pre-squash commits, but the file diff is the 15 files alone.
- **Owed by the coordinator, not in this PR:** main's ADR 0301 index row in `.planning/decisions/README.md` still says the serve-size fork is deferred. Changing an existing index row is a separate docs change.

## fix(cellar): a till name with a serve size joins its row, and Sold says bottles and glasses (ADR 0301, the 2026-10-05 ruling, and the 2026-10-06 answers)

Lane `servesize`, branch `fix/cellar-till-names-with-a-serve-size`, local head **`2832515b9`**. Nothing has been pushed.

**Base.** #627 has merged (squash `54f833e4b`), and so has #621 (`4528b9689`). The last call merged origin/main **`4528b9689`** into the branch (`57a6ea35b`), so the branch is **no longer stacked**: open this PR against `main`.
- Against origin/main: **15 files**.
- The lane's patch against main is byte-identical to its patch against #627's pre-squash head `612daa5a7`. The one exception is `scripts/sql_outside_migrations.txt`, which now holds both main's #621 line and this lane's line.
- GitHub's commit list will also show #627's pre-squash commits, because main holds only their squash. The file diff is the 15 files alone. Squash-merge.

| Commit | What it is |
|---|---|
| `bf8fea755` | The 2026-10-05 ruling: the contained-name join and Sold split into bottles and glasses. |
| `7e491e748` | A merge of #627's head at that time, `612daa5a7`. |
| `a5879b72d` | Docs: narrows one ADR consequence to what was measured per menu. |
| `7e1580bae` | The founder's 2026-10-06 answers. F1 (join without the maker) and F2 (tied names on the row) are built in the same migration, and F5 is pinned by a test. ADR 0301 and claims amended. |
| `519f14d66` | Copy only: the Sold column's maker-less example now names a till name that joins as told. |
| `57a6ea35b` | Last call: merge of origin/main `4528b9689`. Seven files conflicted, because #627 was squashed. Six took the branch side, since main's content there equals `612daa5a7`. `README.md` took main's side, since this branch never changed it. |
| `2832515b9` | Last call, ADR text only: two sentences the verifier flagged (see *ADR and claims*). |

**The founder's ruling of 2026-10-05, verbatim.** Asked with AskUserQuestion, ~23:07Z.
- He picked *"Join by contained name, split Sold (Recommended)"*.
- The option's text: *"A till name joins the most specific row whose words it contains (a tie joins none). Sold is split into bottles and pours by the till's sale unit; Taken is summed. Fills rakı, spirits, draft beer and most wine on the sim feed. Risk: a cocktail named after a spirit with no row of its own joins that spirit."*
- He rejected *"Strip size words first"*, *"Join by the POS mapping"* and *"Keep exact names only"*.
- The units follow his pick of 2026-10-04, *"Bottles · glasses (Recommended)"*.

**His answers to the five forks this PR left open, verbatim.** AskUserQuestion, 2026-10-06. F1 to F4 were asked ~00:50Z and answered ~00:58Z. F5 was asked after 01:10Z and answered by 01:42Z.
- **F1** *"Also match without maker (Recommended)"*: *"If a till name holds none of a row's full words, try the row's name without the maker, under the same most-specific and tie rules. Beer fills on both menu shapes, and no production read is needed. A small change in the same migration, plus tests."* Rejected: "Leave it", "Use the till mapping's item".
- **F2** *"List tied names on the row (Recommended)"*: *"Each tied row's record lists the till names that tied, so the owner sees why its Sold is short and can fix the menu name. The lines still join neither row."* Rejected: "Count only (as built)", "Split evenly".
- **F3** *"Every line (Recommended)"*: *"As built: the unit is a fact about the sale, whatever the flag says. Rakı or beer flagged not-wine still splits."* Rejected: "Only wine-flagged lines".
- **F4** *"Today's size for now (Recommended)"*: *"As built. No house has changed a size yet; revisit when one does. Past sales re-split if a size changes."* Rejected: "Size at the time of sale".
- **F5** *"Keep one rule (Recommended)"*: *"As built. The record lists exactly the lines its Sold counts, so the two never disagree. A catalogue-only row shows no till lines. The owner puts the wine on the menu to make its sales count. No extra work."* Rejected: "Look-alike lines for those rows".

### What was wrong for the owner (Tuzlu Rüzgar; A-015's remainder, follow-up on #627)

Tuzlu Rüzgar's till adds a serve size to the menu's name. Examples:
- 'Yeni Rakı (single 50ml)' and 'Yeni Rakı 70cl bottle';
- 'Efes Pilsen (draft 400ml)';
- 'Fords Gin (50ml)';
- 'Kavaklıdere Çankaya (glass)'.

#627's ledger joined a till name to a row only when their `beverage_house_key`s were equal. On the sim's feed, that left all of these out of every Sold and Taken cell:

| Category | Names | Lines |
|---|---|---|
| Rakı | 24 | 2,175 |
| Spirits | 25 | 1,211 |
| Draft beer | 4 | 2,796 |
| Wine by the glass and bottle | 81 | 5,727 |

So 'Efes Pilsen' read about 479 of about 1,828 sold.

There were two more problems:
- The row record (A-016's half) did show these lines, because `matchLine` found them as 'contains'. So the record and the cell disagreed.
- A row that did get lines added singles, bottles and glasses into one count.

On a menu that carries producers (the sim's house A, the v2 drinks menu), the till's 'Efes Pilsen' does not hold every word of the row 'Anadolu Efes' + 'Efes Pilsen'. So even under the ruling, all twelve beer names reached no row. That is F1.

### What changed and why

**Migration `a_till_name_with_a_serve_size_joins_its_row`.**
- It defines functions only. There is no INSERT, UPDATE, DELETE or table change, so **merging it writes no production row**, and no dry-run is owed.
- No applied migration is edited. Every changed or added part is marked `CHANGED` or `ADDED` with this migration's slug.

**`house_till_lines` gains `sold_as`**: 'bottle', 'glass', or NULL for an unknown unit. The rules follow ADR 0011's order in the POS bridge (`resolveSaleVolume`, `pos-hub.service.ts`).
- A line gets a unit only when its `inventory_id` is, as text, the id of an item of this house.
- A sale volume outranks the label:
  - under 10 ml, not a number, or over the item's bottle (750 ml when it has none) is unknown;
  - exactly the item's bottle is a bottle;
  - anything else is a glass.
- Otherwise the label decides: 'bottle' is a bottle, and 'glass' is a glass when the item has a pour size.
- A queued line with no check behind it is unknown.
- Not gated on `is_wine` (F3).
- Sizes are the item's current sizes (F4).
- The return type grows, so the function is dropped and created again with the same grants.

**`house_beverage_ledger` joins each till name to one row** of the menu, invoice, order and quote books.
- A row's words are the **distinct** tokens of its `beverage_house_key`.
- The join, in order:
  - An exact key wins outright.
  - Otherwise, of the rows whose every word the name holds, the one with the most words wins.
  - Rows level at the top tie, and the name joins none of them.
- **F1.** Only a till name that holds no row's full words tries each menu or order row's name without its maker (`bare_k`), under the same pick: exact, then the most words, and a level top is a tie.
  - Invoice and quote lines have no producer column, so they add no bare name.
  - Such a join reads `without_maker`, and the record shows it as a loose ('contains') match.
  - The full-words pass always comes first (S11).
- A name that joins no row keeps its own key. It is a row only when the queue ever held it, as in #627.
- The join is an equi-join on the word, once per distinct name. It never compares every name against every row.
- New columns, after the existing 31, making 37:
  - `poured_bottles`, `poured_glasses` and `poured_unit_unknown`, which sum to `poured_qty`;
  - `tied_lines`;
  - `till_names`;
  - **F2:** `tied_names`, `{item_name, lines, how: 'tie'}`, whose lines sum to `tied_lines`.
- Taken is summed as before. The signature and grants are unchanged.

**`house_till_names(p_restaurant_id, p_label)`, a new overload.**
- It lists the till names the ledger counted on the row whose key is the label's key, with how each joined. Under F2 it also returns the tied names, as `joined_by` 'tie'.
- It is service_role only. The one-argument overload is unchanged.

**Gateway.**
- `readTillLines` reads the new overload, then `house_till_lines` for the counted names only. So the record's till book and the Sold cell share one rule (F5's *"one rule"*). The other four books keep `matchLine`.
- Tied names go in the till book's `tied` list, and their lines are never read.
- They are said in words:
  - in the book's reason when no till line counts on the row;
  - otherwise at the end of the record's match rule.
  - The series panel shows the match rule always, and the reason when the book has no line.
- The record's `poured` gains `bottles`, `glasses`, `unitUnknown`, `tiedLines` and `tiedNames` (`house-record.ts`).
- A row whose only lines tied keeps a `poured` block with 0 lines and its tie, never a blank.
- `ROW_RECORD_MATCH_RULE` states the till rule, F1 included.

**Web.**
- The Sold cell reads, for example, '9 bottles · 4 glasses'.
- After that come a dimmed '· 2 unknown unit' and '· 3 lines tied'. The tied mark's title names each tied till name with its lines (`registerCells.tsx`).
- A row with no known unit keeps the plain count, and the sort stays on the total.
- The Sold and Taken column definitions are rewritten (`cellar-columns.ts`).

**Deploy order is safe either way.**
- **Migration first.** The old gateway calls the unchanged one-argument `house_till_names`, and ignores the new columns.
- **Gateway first.** The new call is not found (`MISSING_FUNCTION_CODES`: 42883, PGRST202, PGRST203). So the record's till book reads "unread, not empty" and names this migration. The cell shows the plain count (jest: "reads a database before the split as no split, not as zero").

### Measured on the sim's feed (local Postgres, not production)

The feed is `p4-scratch/sim-run/rebuild/run/feed`: 92 days, 11,158 checks and 111,020 lines over two houses.
- **House A** uses the v2 drinks menu, which has a producer column.
- **House B** uses the same menu with names only.

The figures are the builder's, at `bf8fea755` and `7e1580bae`. The verifier re-ran them with its own queries and got the same numbers. I did not re-measure them.

| Category | Before (#627) | After, house B | After, house A |
|---|---|---|---|
| Rakı | 0 of 24 names | 24 of 24 (2,175 lines) | 24 of 24 |
| Spirits | 0 of 25 | 25 of 25 (1,211) | 25 of 25 |
| Beer | B: 8 of 12; A: 0 of 12 | 12 of 12 | **12 of 12** (4,189 lines, all without the maker; 0 of 12 at `a5879b72d`) |
| Wine | 0 of 81 | 79 of 81 (2 names, 217 lines, tie) | 81 of 81 |
| Cocktails | 10 of 11 | 10 of 11 | 10 of 11 |
| Non-alcoholic | 18 of 20 | 19 of 20 | 19 of 20 |

House A:
- Each of the 12 beer names joins its own row. For example, 'Efes Pilsen' joins Anadolu Efes Efes Pilsen (464 lines), and 'Efes Pilsen (draft 400ml)' joins the draft row (1,190 lines).
- No name joins two rows.
- Sold on rows with a book went from 17,586 to 22,016. Bottles went from 3,077 to 4,489, and unknown unit from 6,107 to 9,125; glasses stayed at 8,402.

House B:
- Unchanged by F1 (21,798).
- Yeni Rakı reads 785 = 109 bottles + 676 glasses.
- The two Musar rows each list 'Château Musar Musar Jeune Rouge (bottle)' (13 lines) and '(glass)' (204 lines) as tied.

No cocktail joins a spirit on this feed.

Speed: before (`a5879b72d`) and after (`7e1580bae`), interleaved, 7 rounds, medians. This was a slower run of the machine than 2026-10-05's 134-142 ms figures, so the two are not comparable.

| Read | Before | After |
|---|---|---|
| ledger, house A | 246 ms | 235 ms |
| ledger, house B | 268 ms | 207 ms |
| `house_till_names` (label), A | 274 ms | 213 ms |
| `house_till_names` (label), B | 238 ms | 243 ms |
| `house_till_lines` (2 names) | 55 ms | 49 ms |

No slowdown shows above the run's noise; single runs ranged 177-425 ms.

### Tests, guards and harness

**Local Postgres harness, re-run by me at the merged head `57a6ea35b`.** [2026-10-06 ~04:50Z, coordinator: the block below names the old version `20261222180000`, which ran before #621's migration. After the renumber it runs after it, so the coordinator re-ran the harness at `3f3689307`; see the note at the top.] `2832515b9` after it changes ADR text only. The template is `28d32de36`, with 7 lane migrations: #627's and #621's (now on main) and this one. #621's `pos_checks` trigger is therefore under these tests. The output is appended to `p4-scratch/sim-run/fixes/audits/servesize-local-pg.txt`. The lane's three tests:

```
applied 7 migration(s) to servesize_fix
[fix] PASS 20261222180000_a_till_name_with_a_serve_size_joins_its_row_test.sql
[fix] PASS 20261222170000_the_cellar_reads_the_tills_own_record_test.sql
[fix] PASS 20261222120000_the_ledger_lists_only_the_current_menu_test.sql
[ctl] FAIL 20261222180000_a_till_name_with_a_serve_size_joins_its_row_test.sql: ERROR:  S1 FAIL 'Zqss Efes Pilsen' reads pos_lines 0, Sold ; expected 1 and 2 (its exact name)
[ctl] FAIL 20261222170000_the_cellar_reads_the_tills_own_record_test.sql: ERROR:  T1 FAIL the rakı reads pos_lines = 0, expected 3 (C1, and the two sized lines on C6)
[ctl] FAIL 20261222120000_the_ledger_lists_only_the_current_menu_test.sql: ERROR:  T1 FAIL the current menu's line reads menu_lines = 2, expected 1 (the archived copy is still counted)
template=28d32de368d3f57df52ce6f490758908d9fa924d lane_migrations=7 tests=3
```

The same head with no test arguments ran every test the head adds over the template, including #621's `tables_learned_from_the_pos_test.sql`: **7 of 7 [fix] PASS, 7 of 7 [ctl] FAIL**.

**Against this migration's earlier build** (builder's local build of `a5879b72d`, confirmed by the verifier on a scratch database):
- S8, S9, S10, S11 and S12 fail, and so do T4 and T12.
- S13 passes there, which is right: F5 kept the behaviour.
- Against #627's build alone, the S tests fail on `column l.tied_lines does not exist`.

**The SQL test, S1 to S13:**

| Block | What it pins |
|---|---|
| S1 | An exact key beats containment, and ties with nothing. |
| S2 | The most specific row wins. |
| S3 | A tie joins none; a tied name the queue held is a row of its own; `tied_lines` counts. |
| S4 | The cocktail joins the gin (the ruling's risk). |
| S5 | The unmapped draft joins its row. |
| S6 | Every unit rule. |
| S7 | The parts sum to Sold; queue lines have no unit. |
| S8 | The record overload, tied names included (F2). |
| S9 | Shape (37 columns) and grants. |
| S10 | F1: a draft and a bottle join without the maker; an exact bare name wins; the more specific bare name wins. |
| S11 | F1: a tie between bare names joins neither and is listed on both; the full-words pass comes first. |
| S12 | F2: `tied_names` per tied row, summing to `tied_lines`. |
| S13 | F5: a catalogue-only row's record has no till lines. |

#627's tests are changed on purpose, each with a dated CHANGED note:
- T1: rakı reads 3 lines, Sold 7, Taken 154.
- T12: 37 columns.
- T13: 'Zqtl Cola Zero' joins 'Zqtl Cola'.
- T15: the sized names join.
- `the_ledger_lists_only_the_current_menu_test.sql` T4: 37 columns.

**Mutants** (builder's runs; not re-run by me or the verifier):
- SQL: 8 of 8 killed (M1-M7, M2b), plus the five 2026-10-05 mutations.
- Gateway: 6 of 6 (G1-G6, re-run at `7e1580bae`).
- Claims: 19 of 19.

**Re-run by me at `2832515b9`:**

| Check | Result |
|---|---|
| Jest, `apps/api-gateway src/beverages`, `--runInBand --forceExit` | **73 of 73** pass. The builder's 5 new cases fail on `a5879b72d`'s source (builder and verifier). |
| Vitest, `apps/web src/pages/cellar/next` | **299 of 299** pass across 15 files. The new tied-names case fails on `a5879b72d`'s `registerCells.tsx` (builder and verifier). |
| Typecheck, gateway (`tsconfig.spec.json`) | Only the 2 known `@simplewebauthn/server` errors. |
| Typecheck, web | Only the known `@simplewebauthn/browser` TS2307 error. |
| Lint, gateway eslint on the 4 files | 0 errors, 56 warnings. main's versions of the same 4 files give 56 warnings, measured by me with `--stdin`. |
| Lint, web eslint `--quiet` on the 4 files | 0. |
| `env LC_ALL=C bash scripts/check_decision_claims.sh` | **905 of 905 holding**, up from 890 because main added rows. |
| `check_adr_numbers_unique` | OK; no new number, next free 0305. |
| `check_migration_versions_unique` | OK against origin/main and 72 open PRs. |
| `check_no_conflict_markers`, `check_citation_pairing`, `check_od_ids_exist`, `check_migrations_single_home` | OK. |
| `check_migration_order` | **FAILS**, as expected: this migration's version is behind #621's, now on main. See *Merge order*, item 1. |
| `pr_audit_gate.ownership_between(origin/main, HEAD)` | Returns **no owned path**. |

The builder also ran 26 `check_*.py` guards with `--self-test` at `7e1580bae`, all passing, with these exceptions:
- `check_definer_functions_closed` cannot check on a local DSN. A direct query on the local build shows the 4 functions are not SECURITY DEFINER and are EXECUTE for service_role only.
- `house_item_invariants`, `migration_ledger`, `beverage_identity_parity`, `display_name_parity` and `beverage_kind_regression` need a production DSN, and were not run.

### ADR and claims

**ADR 0301** is amended in place. The new number check is not needed, since no number was added.
- The Status line records the 2026-10-05 ruling, and the five forks as locked 2026-10-06.
- *Fork deferred* is marked answered.
- *The ruling of 2026-10-05* section holds:
  - the ruling, verbatim;
  - what was built;
  - the stated behaviours, each saying which test pins it or that none does;
  - the measure;
  - the consequences.
- *The answers of 2026-10-06* section holds:
  - all five answers, verbatim;
  - F1's method and its risk;
  - F2's method, and where the names are not shown;
  - the re-measure and the speed.
- Answered text is bracketed in place: *is_wine* (F3), sizes (F4), catalogue-only (F5), the build list, the join steps, the beer cell, and three consequences.
- Two review-trail rows are added.
- **The last call's correction (`2832515b9`)** changes two sentences the verifier flagged:
  - "Both files are outside this PR, which is at its 15-file cap" framed a durable record by one PR's size. It now says the rate line is untrue for a tied-only row, and that showing the names there is owed to a follow-up of those two files.
  - "(listed below)" pointed at a list of all twelve maker-less joins that the section does not hold. It now points at *Measured*, which gives two examples.

**Claims.** In `claims.d/fix-cellar-till-and-door-checked-cost.jsonl`, #627's fragment; no new fragment, which keeps the file count down.
- New static rows:
  - `CELLAR-TILL-NAME-JOINS-THE-MOST-SPECIFIC-ROW-IT-CONTAINS`
  - `CELLAR-TILL-NAME-JOINS-WITHOUT-THE-MAKER`
  - `CELLAR-ROW-RECORD-TILL-BOOK-READS-THE-LEDGERS-NAMES`
  - `CELLAR-TIED-ROW-LISTS-ITS-TIED-NAMES`
  - `CELLAR-SOLD-SPLITS-INTO-BOTTLES-AND-GLASSES`
- Two of #627's rows get dated CHANGED brackets; their checks are unchanged.

**No row of `.planning/decisions/README.md` is touched.** main's ADR 0301 index row, added by #627, still ends *"Fork deferred: … until the founder picks a join"*. That is stale now. This lane may not edit an existing index row. See *Not covered*.

### Merge order

1. **Renumber the migration at merge.** [2026-10-06 ~04:50Z, coordinator: done before push, in `3f3689307`. The migration and its test are now `20261223000000`, and `check_migration_order` passes. Re-check at merge: if another migration lands first, move it again.] Its version, `20261222180000`, is now behind main's newest, `20261222230000` (#621's `tables_learned_from_the_pos`). `check_migration_order` fails until it moves.
   - Rename it, and its test, past main's newest at merge time. Fix the matching line in `scripts/sql_outside_migrations.txt`.
   - Prose cites it by slug only, so nothing else changes.
   - In CI the guard sits in `migration-versions-unique`, so build and tests still run.
   - #612 (`…190000`), #617 (`…200000`), #618 (`…210000`) and #620 (`…220000`) are behind main too.
   - None of them, and not #626 or #541, mentions `house_beverage_ledger`, `house_till_lines` or `house_till_names` in its added lines (grepped each PR's diff).
2. **#628** (`fix/cellar-door-checked-cost`) redefines `house_beverage_ledger` in `the_cellar_counts_the_door_checked_price`, a version far behind main. It also touches six of this PR's files: ADR 0301, `house-record.ts`, `CellarNext.test.tsx`, `cellar-columns.ts`, `registerCells.tsx` and `useCellarNextData.ts`. When it is brought up:
   - it must start from this migration's ledger body: the join, F1, the split, `tied_lines`, `till_names`, `tied_names` and 37 columns;
   - it must be renumbered past this migration.
   - Otherwise the newest ledger loses the join, and this PR's claims rows fail the build. They are meant to.
3. **Shared only on `scripts/sql_outside_migrations.txt`** (one appended line each): #617, #618, #620 and #626. Whichever merges second keeps both lines.

### Verifier's last round

It passed, with four minor issues:
1. **The stale base.** Resolved by the last call's merge (`57a6ea35b`).
2. **F2 is not shown in `RowExpander.tsx` or `HouseRecordLeaf.tsx`.** Accepted and disclosed below. F2's words, *"Each tied row's record lists the till names that tied"*, are built in the record: the gateway's till book and the series panel. The two unshown views are owed to a follow-up.
3. **The ADR's 15-file-cap sentence and "(listed below)".** Reworded in `2832515b9`.
4. **F4 has no test, and F1's risk has no guard.** Both are accepted limitations, stated in the ADR and below.

### Forks answered (2026-10-06)

All five forks are answered (quoted above and in ADR 0301):
1. Producer gap: (b) built, without the maker.
2. Tie: (c) built, names listed.
3. `is_wine`: (a) kept.
4. Sizes: (a) kept, still untested.
5. Catalogue-only: (a) kept, now pinned.

No fork is left open for this PR.

### Not covered (CLAUDE.md §0.5)

- **F2 is not shown everywhere.** The tied names show in:
  - the Sold cell's '· N lines tied' title;
  - the record's till-book reason (no counted line), or else its match-rule note;
  - the series panel.

  They do not show in `RowExpander.tsx` or `HouseRecordLeaf.tsx`.
  - A row whose only names tied still reads *"The till has never rung this up"* in the expanded view's rate line, which is not so. On the sim that is house B's two Musar rows; house A has no ties.
  - The leaf shows 'Till lines 0' and 'Sold —' without saying why.
  - That needs a follow-up change of those two files. This PR is at 15 files.
- **The split stops at the /cellar Sold cell.** `HouseRecordLeaf.tsx` and `CocktailRegister.tsx` still show the plain Sold total. The record's till lines do not show each line's `sold_as`.
- **F1's risk is stated, not guarded.** A short maker-less name can take any till name that holds its words and no row's full words. On the sim's feed, all 12 such joins are the beer's own row.
- **F4 has no test.** Nothing proves sizes are read as today's and not as at the sale.
- **ADR 0301's index row on main is stale.** It still says the serve-size fork is deferred. This lane may not edit an existing row of `.planning/decisions/README.md`. The coordinator owes the update.
- **The record read's cost.** `house_till_names(uuid, label)` reads the whole ledger each time a record opens: about 213-274 ms on the slow local run, and unmeasured at production's catalogue size.
- **The register's cut can reorder.** The `p_limit` order counts joined till lines, so a row's place before the cut can move. Tied lines do not count toward it.
- **No browser check.** The cell was verified in vitest's DOM only.
- **Nothing was read or measured on production.** That includes whether Tuzlu's production menu carries producers. F1 makes both shapes fill, so the answer does not need it.
- **Not re-run by me:**
  - the sim-feed measure and speed table (builder's, with the verifier's spot checks);
  - the SQL, gateway and claims mutants (builder's);
  - the run against the earlier build (builder's and verifier's).
- **Trailers.**
  - The merge commit `7e491e748` carries git's default message, with no body or trailer.
  - Every other lane commit carries `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`, as CLAUDE.md and the lane brief say; the session reminder names 5.5.
- **Not pushed.** CI and the ADR 0090 audit have not run on `2832515b9`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
