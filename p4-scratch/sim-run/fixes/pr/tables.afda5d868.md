> **Last call (final say) at `0863ae2d2`: SHIP.** `0863ae2d2` merges origin/main `155960b59` (#645) into the docs-rework head `2723a7518`. The merge had no conflict and changed none of this branch's 15 files (#645 touches only /notifications files). Since the SHIP at `51eaa0224`, no code, SQL statement or test has changed. The founder answered the three forks it left open (2026-10-05 ~16:00Z), and the coordinator measured the backfill under the digit rule on production, read-only (~16:10Z). The docs rework (`20c189cef`, `2723a7518`) records both. The answers are verbatim in ADR 0303, and the measured counts replace the derived 40. In the ADR and this body the stale text is bracketed in place and dated. The migration's header comment (comment lines only) and the README row are rewritten. `check_migration_order` stays red until the version is renumbered at merge.
>
> **Before merge:** this PR writes production when it merges (see "The production write on merge"). Measured read-only under the digit rule: 3,621 checks link, 40 tables are learned, and 14 checks keep a digitless word with no table. His fork-1 option text says *"#621 merges as it is."* Two follow-up lanes are owed, `addtable` and `seatsnote` (see "Forks answered 2026-10-05").

## What was wrong for the owner

The analytics walk read Tuzlu Rüzgar on production, read-only, on 2026-10-03.

- **AW25 / A-051 (minor, latent).** Every check Tuzlu's till sent names a table in `raw.tableRef`. The coordinator's read-only production run (2026-10-05) found the words t1-t24 and booth. Tuzlu still had **no `restaurant_tables` row**, so all **3,593** checks had `table_id` NULL.
  - The room register `rp-tables-90` returned **`tables.length` 0** with `dataStatus 'live'`.
  - A check reached a table only at ingest, through pos-hub's in-memory `resolveTable` (`pos-hub.service.ts:510`, `:1247` @`1aa4dcb8c`). After that, the till's word lived only in `raw` (`:526`).
  - Nothing wrote `restaurant_tables.pos_refs`. The only table writer, `upsertTable` (`table-analytics.service.ts:45`), linked no past check.
  - `getTablePerformance` dropped every unlinked check without counting it (`if (!c.table_id) continue;`, `:226`).
- **AW30 / A-055 (minor).** The register and its export told the owner *"The room has to be drawn before it can be read."* (`rp-registers-house.tsx:360`, `report-export-cuttings.ts:587`). The only table writers are `POST /analytics/tables` and `PUT /analytics/venue` (`analytics.controller.ts:563`, `:591`), and no web or mobile code calls either one.

## What changed and why

The founder ruled *"Learn from the POS (Recommended)"* on 2026-10-04. Each table word the till sends becomes a table the owner can rename or hide, past checks re-link to it, and nothing is drawn. On 2026-10-05 he narrowed the rule to *"Only words with a number (Recommended)"*. ADR 0303 records the method. It stays Proposed until he locks it.

- **The database learns tables.** Migration `tables_learned_from_the_pos` does this.
  - **Columns.**
    - `pos_checks.table_ref` holds the till's word.
    - `restaurant_tables` gains `learned_at` and `hidden_at`.
    - `seats` and `is_outdoor` become nullable. A learned table then carries no seat count or outdoor flag that nobody gave (ADR 0020, 0051).
  - **`pos_table_ref_from_raw`** reads the word out of `raw` the way the adapters do:
    - Square: `ticket_name`.
    - Toast: `table.guid`, then `table.name`.
    - Every other source: `tableRef`, then `table_ref`, then `table`.
    - Clover gives NULL, because its order type is a channel (AW24, ADR 0302).
  - **A BEFORE trigger on `pos_checks`**:
    - It sets `table_ref` from `raw`.
    - It resolves the word with `resolveTable`'s precedence: the source's pos ref, then the label, then `table <label>`. The match ignores case and spaces, and it covers active tables, hidden ones included.
    - When nothing answers, it learns a table only if **the word has an ASCII digit in it** (`v_ref ~ '[0123456789]'`). The learned table has `seats` NULL, `is_outdoor` NULL and `pos_refs {source: word}`. "T12", "12", "Patio 3", "7a" and "2nd floor" are learned.
    - A word with no digit ("booth", "Ayla") is kept as `table_ref` and makes no table. It links once a table answers it.
    - A retired table that answers blocks learning.
    - A learning failure is a WARNING, so a sale is never refused.
  - **Rename and re-link.**
    - A rename merges the till words already linked to the row into its `pos_refs`, so "Window 7" keeps catching T7.
    - Adding, renaming, re-mapping or re-activating a table fills the house's NULL links whose word now resolves to it. So an owner-added "Bar" catches past and new "bar" checks.
    - A learned insert re-links at commit (a deferred constraint trigger), so one `INSERT … ON CONFLICT DO UPDATE` import batch cannot abort.
    - A re-link never moves an existing link. T19 and T20 pin this.
  - **Backfill.** The migration writes `table_ref` on every stored check whose `raw` carries a word. That fires the trigger, so history learns and links in one statement, by the same digit rule.
- **pos-hub is unchanged.** The trigger reads `raw`, and the gateway writes no new column, so the gateway and the migration deploy in either order (ADR 0303 option 3b).
- **`PATCH /analytics/tables/:restaurantId/:tableId` renames or hides a table.**
  - **Access.** `@Roles('owner','manager')` (F1). RolesGuard is exact (ADR 0164), and the class JwtAuthGuard pins the house.
  - **Validation.**
    - A label must be 1-60 characters, and `hidden` must be a boolean. Anything else, or an empty body, is 400.
    - A non-uuid, foreign or retired id is 404.
    - A name another table of the house already has is 409. The comparison ignores case and includes retired tables.
  - **Route-access fixture.** `route-access.expected.json` gains the row. The `ADR-0164-ROLES-EXACT-MANAGERS-KEPT` claim's fixture size goes from 199 to 200: one route added, none removed and none changed.
- **Hidden tables leave the room (F2).** A hidden table still catches its checks, and they stay in takings.
  - `getTablePerformance` and its export leave hidden tables out and count what they left out, in `checksWithoutTable`, `checksAtHiddenTables` and `hiddenTables`. `hiddenTablesInHouse` tells "every table is hidden" apart from "no table yet".
  - The hot list leaves hidden tables' open checks out and counts them as `openChecksAtHiddenTables`.
  - The insight generator's part is owed to the stacked `fix/hidden-tables-leave-insights` (#625). Until it lands, the copy names only what a hidden table leaves today.
- **The waiter adjustment keeps hidden tables in its table control,** as the founder picked. `getWaiterPerformance` reads no `hidden_at`. A gateway case and a claims row pin this.
- **No page asks for a drawing (AW30).** The register and the export now say one of the following:
  - With no table: *"This house has no table yet, so no check can be attributed to a seat. A table is learned when a check arrives naming one with a number in it, such as T12, 12 or Patio 3; rename or hide it under Settings → Point of sale."*
  - With checks that have no table: *"N checks in this window have no table, so none can be attributed to a seat. They are in takings. A till word with no number in it, such as Booth or a name, makes no table."*
  - With every table hidden and an empty window: *"Every table in this house is hidden, and this window held no check. Show a table again under Settings → Point of sale."*
  - With checks only at hidden tables: the room sentence without the "absent attribution" clause, plus a count of those checks.
  - No sentence claims a screen that adds a table, because none exists. The founder made that screen the follow-up lane `addtable` (see "Forks answered 2026-10-05").
- **Settings → Point of sale gains "Tables the till has named".**
  - The list sits behind a closed disclosure and is read only when opened.
  - Loading, a failed read (ADR 0067) and an empty read are kept apart.
  - Rename, Hide and Show appear only for an owner or manager.
  - It says: *"A table name the till sends on a check becomes a table here when it has a number in it (T12, 12, Patio 3). A word with no number, such as Booth or a name, stays on its check and makes no table."*
- **The room register's correlations and drivers read only recorded values** (`recorded()`). A NULL seat count, distance or outdoor flag is no longer read as 0. A driver feature needs at least 5 recorded values that vary; with no feature kept, there is no model.

## Founder answers this PR builds (verbatim picks)

- **AW25+AW30**, 2026-10-04 ~00:30Z: **"Learn from the POS (Recommended)"**. The option text read: *"Every POS table ref becomes a table the owner can rename or hide. Past checks re-link from the stored ref when a table is added or renamed. No drawing."*
- **Which words become tables**, 2026-10-05 ~14:15Z, asked after the production dry run: **"Only words with a number (Recommended)"**.
  - The question read: *"#621 tables dry run: back-filling would link 3,635 old checks and learn 47 tables. But Tuzlu would get a table called 'booth' (its street-fair booth), and a sim house would get six 'tables' named after people (ayla, jon, priya…). Square sends tab names like these in the same field. Which words become tables?"*
  - The option text read: *"'T12', '12' and 'Patio 3' are learned; 'booth' and 'Ayla' stay on the check as its word but make no table. Cost: a table named only 'Bar' or 'Window' must be added once by hand in the table control. About 3 files in #621 and the rule applies to new checks too."*
  - He rejected "Every word, retire odd ones" and "Every word but booth/event".
- **F1, who renames or hides**, 2026-10-04 ~20:50Z: **"Owner or manager (Recommended)"**.
- **F2, how far hiding reaches**, 2026-10-04 ~20:50Z: **"Out of every figure (Recommended)"**. This PR builds the room register, its export and the hot list. The insights part is the follow-up #625, which the brief sanctions.
- **Hidden tables in the waiter adjustment's control**, 2026-10-05 ~01:39Z: **"Keep them in the control (Recommended)"**.
- **Read for the Clover rule:** booth, **"Wait, then owner maps (Recommended)"**, and AW24, **"Own row, POS field (Recommended)"**.

ADR 0303 quotes each of these verbatim. His answers of 2026-10-05 ~16:00Z, which leave the build as it is, are under "Forks answered 2026-10-05", and the ADR quotes them too.

## Tests, guards, harness

The base is origin/main `155960b59` (#645), merged at `0863ae2d2`, which is HEAD. The worktree is clean, and the branch is **15 files**, 2,482 insertions and 111 deletions, against merge-base `155960b59`.

**Local Postgres** (`pgtest.sh lane … tables`, template `28d32de36`; run at `51eaa0224`; re-run at `20c189cef` and `2723a7518` after the comment-only migration change, and at the last call's `0863ae2d2`, each time with the same output; all appended to `p4-scratch/sim-run/fixes/audits/tables-local-pg.txt`):
```
applied 4 migration(s) to tables_fix
[fix] PASS 20261220110000_tables_learned_from_the_pos_test.sql
[ctl] FAIL 20261220110000_tables_learned_from_the_pos_test.sql: ERROR:  column "table_ref" of relation "pos_checks" does not exist
template=28d32de368d3f57df52ce6f490758908d9fa924d lane_migrations=4 tests=1
```
- The count of 4 includes main's `20261221093000`, `20261222100000` and `20261222120000`, which merged after the template. None of the three writes `pos_checks` or `restaurant_tables`; #603's migration only names `pos_checks` in a comment.
- **The test** (T1-T23) runs in one transaction, which is rolled back. Every block RAISEs on failure.
  - T21 covers new checks. "booth", "ayla" and a Square tab "Ayla" make no table and keep their word. "t12", "12", "patio 3", "table 7", "7a", "2nd floor" and the number 14 are each learned once.
  - T22 covers the backfill. It keeps BOOTH and Ayla as words with no table, and it learns T5 and "Patio 6".
  - T23 covers words that wait. An owner-added "Bar" links past and new "bar" checks, and a rename into "Window" links an earlier "window" check.
- **Last-call mutation, through the real harness.** The verifier found that a digit-last rule passed the whole file. The mutant was committed only in a `git clone --shared` of the lane, and the scratch databases and clone were dropped afterwards:
  ```
  MUTATION digit-last ([0123456789]$), clone 468413f08:
  [fix] FAIL 20261220110000_tables_learned_from_the_pos_test.sql: ERROR:  T21 FAIL: the word "7a" was not learned exactly once
  ```
- **Earlier mutations.**
  - Round 0 killed 5: T2, T11, T16, T8 and T15.
  - Round 1 killed 6, at T17 and T18.
  - Round 2 killed 2 through the harness: T19, the immediate re-link without `c.table_id IS NULL`, and T20, the deferred one.
  - The rework's scratch matrix:
    - The as-built `b440d85fa` migration fails at T21 ("booth" got a table).
    - T22 and T23 alone fail on it too.
    - Removing the digit line fails at T21.
    - A digits-only rule `^[0-9]+$` fails ("t12").
    - A T-number rule `^t?[0-9]+$` fails ("patio 3").
- **Insert cost** (every-word build; 20,000 inserts into one house, local, 2 runs each on a shared machine). The digit test adds one regular-expression match per row that nothing answers, and it was not re-timed.

  | Case | Time |
  |---|---|
  | Without the migration | 153-178 ms |
  | With it, learning the tables | 981-1,011 ms |
  | With every table learned beforehand | 991-1,096 ms |
  | When the writer sets `table_id` itself | 449-736 ms |

  The cost is the per-row resolve, not learning. Tuzlu's volume, about 3,593 checks in a quarter, is far below this.
- **Gateway jest** (`--runInBand --forceExit`).
  - At `0863ae2d2` (last call): the lane spec plus `src/auth/guards` (`route-access.spec`, `jwt-auth.guard.spec`) gave **3 suites, 41 tests pass**. The lane spec alone has 28 cases.
  - At `2723a7518` (the verifier): the lane spec, `route-access`, `scenario-verify`, `table-analytics.service`, `pos-revenue`, `src/reports/exports` and `src/pos-hub` gave **21 suites, 344 tests pass**.
  - At `51eaa0224`: the lane spec, `table-analytics*`, `src/reports/exports` and `route-access` gave 8 suites, 132 tests pass.
  - The lane spec has 28 cases. 22 of the first 24 fail against the `1aa4dcb8c` sources. The 3 all-hidden cases fail against the round-1 sources. The waiter-control case fails when `getWaiterPerformance` drops hidden tables' checks.
  - Against the `b440d85fa` copy files, 3 cases fail.
  - The verifier's round over origin/main's service, controller and export: 25 of 28 fail. The 3 that pass pin kept behaviour.
- **Web vitest.**
  - At `0863ae2d2`: the lane test, **13 pass**.
  - At `2723a7518` (the verifier): `src/pages/settings` and `src/pages/reports`, **17 files, 309 tests pass**.
  - At `51eaa0224`: the lane test plus `src/pages/reports/next`, 6 files, 144 tests pass.
  - All 13 lane cases fail against origin/main's `PosSection` and `rp-registers-house`.
- **Typecheck** (re-run at `0863ae2d2`). Gateway `tsc -p tsconfig.spec.json` shows 2 errors, both the known `@simplewebauthn/server` ones. Web `tsc` shows only the known `@simplewebauthn/browser` TS2307.
- **Lint** (re-run at `0863ae2d2`). eslint reports 0 errors on the 4 changed gateway files and the 3 changed web files. The gateway files carry 65 prettier warnings. The verifier found none of them on a line this branch added, and `report-export-cuttings.ts` already had 59 of them.
- **Guards** (re-run at `0863ae2d2`).
  - ci.yml names 49 guard scripts. Of these, 46 return 0 here: every python guard plus `check_no_direct_stock_writes.sh`, `check_no_direct_type_attributes_access.sh` and `check_model_calls_logged.sh`. All 38 `--self-test` modes those scripts offer also return 0, `check_migration_order`'s included.
  - Among them, `check_adr_numbers_unique.py` (*"introduced by this ref: 0303"*, 1,724 refs), `check_od_ids_exist.py`, `check_citation_pairing.py` and `check_no_conflict_markers.py` all pass.
  - `check_decision_claims.sh`: **879 checked, 879 holding**.
  - The ownership classifier, run locally with `pr_audit_gate.ownership_between` from merge-base `155960b59` to `0863ae2d2`, returns `[]` (**RELEASED**).
  - **`check_migration_order` FAILS** as a pull-request event: `20261220110000` is behind main's `20261222120000`. The version was kept on purpose and is renumbered at merge (see "Merge order"). [2026-10-05 ~19:22Z, coordinator: renumbered at `f5cbccdd4` to `20261222160000`, past main's newest and past the versions #627 (`20261222130000`) and #647 (`20261222140000`) hold; `check_migration_order` OK, uniqueness guard OK against main + 76 open PRs, `pgtest.sh` [fix] PASS / [ctl] FAIL at that head. The `20261220110000` named in the test transcripts above is the pre-renumber name of the same file.]
  - `check_gateway_boots.sh` was not run, because it needs a dist build. The PATCH reuses `RolesGuard`, which `AnalyticsController` already applies on origin/main, so it adds no provider or constructor dependency.

## ADR, claims, register

- **ADR 0303** `tables-learned-from-the-pos` is new and Proposed. It quotes every answer above verbatim.
  - Residuals 1-14 name what is not built.
  - Residual 12: no screen adds a table by hand. Answered: the follow-up lane `addtable`.
  - Residual 13 (added at the last call): a tab name with a digit in it still learns a table. Answered: keep the rule, and revisit when the first Square house connects.
  - Residual 14 (added in the docs rework): the seats chart is empty for a house whose tables are all learned. Answered: the follow-up lane `seatsnote`.
  - The Decision's last bullet quotes the four answers of 2026-10-05 ~16:00Z with their option text. Consequences gives the measured round-2 counts, and the derived 40 is bracketed in place, dated.
- **`decisions/README.md`**: this branch's 0303 row only. No existing row is edited. At the last call, its sentence was narrowed from "no house had a table row" to a house whose till names its tables (Tuzlu, T1-T24). Sim Bistro already had 21 linked checks. In the docs rework, its last sentence gives the measured counts and names the two follow-up lanes.
- **`claims.d/feat-tables-learned-from-the-pos.jsonl`** has 6 static rows:
  - `ADR-0303-A-CHECK-LEARNS-ITS-TABLE-FROM-THE-TILL`, which needs the digit condition and `c.table_id IS NULL` in both re-link UPDATEs
  - `-THE-DATABASE-READS-THE-TILLS-WORD`
  - `-THE-ROOM-COUNTS-WHAT-IT-LEAVES-OUT`
  - `-RENAME-OR-HIDE-IS-OWNER-OR-MANAGER`
  - `-NO-PAGE-ASKS-FOR-A-DRAWING`, which needs the new register, export and Settings sentences
  - `-THE-WAITER-CONTROL-KEEPS-HIDDEN-TABLES`, which pins kept behaviour and so holds on main

  Each row holds on the lane and fails under its own mutation. The first five fail on `1aa4dcb8c` and on `28d32de36`.
- **`CLAIMS.jsonl`** amends `ADR-0164-ROLES-EXACT-MANAGERS-KEPT` in place, from `len(fx)==199` to `200`.
- **`scripts/sql_outside_migrations.txt`** gains one line, for the new SQL test.

## The production write on merge

Migrations auto-apply, so the backfill **writes production when this merges**.

- **What it writes.** For every house whose stored `raw` carries a table word, it writes:
  - `pos_checks.table_ref`;
  - a `restaurant_tables` row for each word with a digit in it;
  - `table_id` on every check a table answers.
- **Measured before the digit rule** by the coordinator, read-only (`p4-scratch/sim-run/fixes/audits/prod-dryruns-2026-10-05.md`):
  - 3,656 checks had a word. 21 were already linked (Sim Bistro, and kept). 3,635 would be linked, none of them to an existing table.
  - 47 tables would be learned: Tuzlu 25 (t1-t24 and booth) and Sim Meyhouse `aaecdb17` 22 (16 t-words, plus ayla, deniz, emre, jon, priya and sarah).
- **Measured under the digit rule** by the coordinator, read-only, 2026-10-05 ~16:10Z (round 2 of the same file; the dry run's lines 48-123 at `51eaa0224`, verbatim, plus one label column; every call inside a `READ ONLY` transaction). His yes for it, verbatim: **"Yes, all three read-only (Recommended)"**.

  | House | Checks with a word | Already linked (kept) | Would be linked | To an existing table | Word kept, no table | Digitless words | Blocked by retired | Tables learned |
  |---|---|---|---|---|---|---|---|---|
  | Tuzlu Rüzgar | 3,593 | 0 | 3,591 | 0 | 2 ("booth") | 1 | 0 | 24 |
  | Sim Meyhouse `aaecdb17` | 42 | 0 | 30 | 0 | 12 (first names) | 6 | 0 | 16 |
  | Sim Bistro | 21 | 21 | 0 | 0 | 0 | 0 | 0 | 0 |
  | **All houses** | 3,656 | 21 | **3,621** | 0 | **14** | 7 | 0 | **40** (min = max) |

  [Superseded 2026-10-05 ~16:10Z by the measurement above. This bullet read: *"**Under the rule.** By those word lists, the backfill learns **40 tables** (Tuzlu 24, Sim Meyhouse 16) and links every t-word check. The booth and name checks keep their word with no table. **This was derived from the word lists, not re-run.** How many checks carry booth or a name was not measured."* The 40 held.]
- **The read-only dry run for the coordinator to run and put to the founder:** `p4-scratch/sim-run/fixes/audits/tables-backfill-dryrun.sql`.
  - It is a SELECT inside `BEGIN TRANSACTION READ ONLY … ROLLBACK`. It runs before the migration, inlines the reader and the matching, and names no column or function the migration adds.
  - It gives, per house and in total:
    - the words written;
    - the links kept;
    - the checks re-linked, and how many of them go to tables that already exist;
    - `kept_word_no_table`;
    - `no_number_words`, a count of distinct words that are not printed;
    - `blocked_by_retired`;
    - `tables_learned_min` / `_max`, from digit words only.
  - **It has not been run against production since the digit rule.** [Corrected 2026-10-05 ~16:10Z: the coordinator ran it read-only; the counts are in the table above.]
- **Local proof of the dry run** (scratch database cloned from the template; fixtures `tables-backfill-dryrun-fixtures.sql` hold 2,640 synthetic checks over 4 houses, 2,630 with a word):
  ```
  dry run  ALL HOUSES | 2630 words | 2 kept | 2418 relinked | 9 to existing | 209 kept_word_no_table | 7 no_number_words | 1 blocked_by_retired | learned 30-31
  actual   ALL HOUSES | 2630 words | 2 kept | 2418 relinked | 9 to existing | 209 kept_word_no_table | 7 no_number_words | 1 blocked_by_retired | links_moved 0 | wordless_rows_changed 0
  learned  ALL HOUSES | 30 tables | learned_without_a_digit 0
  ```
  Every per-house row matched too.
  - The verifier's own seeded run gave the same result. A Tuzlu-shaped house learned 24 tables, linked 2,400 checks and kept 100 BOOTH checks without a table.
  - Its backfill of 2,593 rows took 0.37 s in a single transaction, with no pending-trigger-events error.
  - On the every-word build, 20,000 synthetic checks backfilled in 941 ms.
- **SimPOS houses** learn tables labelled with SimPOS table UUIDs, which carry a digit (residual 2). Whether any production house has such checks shows in the dry run's per-house rows. [2026-10-05 ~16:10Z: the merge learns no such table. The 40 learned are Tuzlu's t1-t24 and Sim Meyhouse's 16 t-words, the digit words of the round-1 word lists.]

## Forks answered 2026-10-05 (the founder, ~16:00Z, AskUserQuestion; verbatim)

These were the forks the SHIP at `51eaa0224` left open. ADR 0303 quotes each one, with its option text, in the Decision's last bullet.

1. **No screen adds a table by hand** (residual 12). The option he picked on 2026-10-05 ~14:15Z says a digitless table *"must be added once by hand in the table control"*. The only writer, `POST /analytics/tables/:restaurantId`, has no web or mobile caller.
   - His pick: **"Follow-up: 'Add a table' (Recommended)"**.
   - The option text read: *"A small separate PR adds 'Add a table' to Settings → Point of sale, for owners and managers. Waiting checks with that word link to it automatically. About 4 files. #621 merges as it is."*
   - He rejected "Build it into #621" and "Leave it".
   - So: the follow-up lane `addtable` is owed. The re-link on add in this PR is what links the waiting checks: 14 on production, by the round-2 count.
2. **A tab name with a digit in it still learns a table** (residual 13). Square's `ticket_name` is free text, so "Party of 4", "Ayla 2" or "Order 4521" would each learn a table.
   - His pick: **"Keep the rule, revisit later (Recommended)"**.
   - The option text read: *"Revisit when the first Square house connects and we can see real tab names. The owner can hide any odd table in the meantime. Nothing to build now."*
   - He rejected "Tighten it now" and "Learn nothing from Square".
   - So: nothing is built. ADR 0303's "Revisit when" names the first Square house.
3. **Seat counts for learned tables** (residual 14). The till does not say how many seats a table has, and no screen asks. So for an all-learned house like Tuzlu, the register withholds per-seat figures, and the seats-vs-average-check scatter has no point to draw.
   - His pick: **"Explain the empty chart now (Recommended)"**.
   - The option text read: *"A small follow-up: the report says why the chart is empty ('seat counts are not recorded yet'). Add a seats field later if you want per-seat figures."*
   - He rejected "Add a seats field" and "Both".
   - So: the follow-up lane `seatsnote` is owed, on `rp-registers-house.tsx`. No seats field is added.
4. **The production read before merge.** His pick: **"Yes, all three read-only (Recommended)"**. The option text read: *"Same way as this morning: inside READ ONLY transactions, counts saved to a file and shown to you. Nothing is written. Without them, neither PR can merge safely: the re-date stops on merge if a trigger exists, and the tables count of ~40 is only an estimate."* This PR's part is the tables dry run, measured above.

**Not asked, still open:** whether rename and hide should write an audit row (residual 3), and merging two till words into one table (residual 5). Neither is offered.

## Merge order and shared files

- **Order.** The ADR's order is sig (#602, merged `f5f658934`) → cap (#609) → postime (#603, merged) → netsales (#615) → booth (#618) → tables.
  - Sig had to go first. Its `MIN_RANK_N` gate keeps Tuzlu's 24 newly learned tables from lighting an ungated "Table #1" insight.
  - Nothing stacks this PR on another branch.
- **Renumbering the migration at merge.** `20261220110000` is behind main's newest, `20261222120000` (#606). The renumber touches four places:
  - the migration file;
  - its test file `supabase/tests/<ver>_tables_learned_from_the_pos_test.sql`;
  - the line in `scripts/sql_outside_migrations.txt`;
  - the header comment of `apps/api-gateway/src/analytics/tables-learned-from-the-pos.spec.ts`, line 27, which names the test file.

  The claims rows find the migration by slug, and the ADR cites it by slug.

  [2026-10-05 ~19:22Z: done before merge, at `f5cbccdd4`, all four places; `git grep 20261220110000` finds nothing. The stacked #625 is brought onto main by a merge, not the rebase above (no force-push).]
- **#625** (`fix/hidden-tables-leave-insights`) is stacked on this PR. Rebase it after this merges: `git rebase --onto origin/main <this head>`. It edits the same `PosSection.tsx` paragraph and header, the web test regex, the claims rows next to `A-CHECK-LEARNS-ITS-TABLE-FROM-THE-TILL` and `NO-PAGE-ASKS-FOR-A-DRAWING`, ADR 0303, the spec header and `analytics.controller.ts`. Those hunks predate the digit rule; resolve them by later-truth, which is the digit rule. The docs rework adds ADR 0303 hunks in the Status line, the Decision's last bullet, Consequences, residuals 12-14 and the review trail; #625's ADR hunks (residual 1 and the hide copy) sit apart from them, and any overlap resolves the same way.
- **Open PRs that share files** (`gh pr list --json files`, 76 open, at the last call on `0863ae2d2`). All are textual conflicts; resolve them by later-truth.
  - `table-analytics.service.ts`: cap #609 (`loadChecks` paging) and netsales #615 (the aggregation loop next to this lane's counts).
  - `report-export-cuttings.ts`: #615, #616, #617, #619, #624 and #626. Only netsales #615 is near `writeSeats`.
  - `rp-registers-house.tsx`: #615, #617, #619 and #624. Only netsales #615 edits the seats register.
  - `analytics.controller.ts`: #564 and #616. This lane adds one method after `setVenue`.
  - `route-access.expected.json`: #564 re-roles four routes and adds none, so the `len(fx)==200` claim is unaffected. A later PR that adds a route must bump the same number.
  - `CLAIMS.jsonl`: #561, #569, #607, #614, #626 and #627 edit other rows. This lane edits only the `len(fx)` figure.
  - `scripts/sql_outside_migrations.txt`: #617, #618, #620, #626, #627 and #628 each append a line. Keep every line.
  - `decisions/README.md`: 23 other open PRs touch it. Keep every row, ordered by number.
- **Booth #618** nulls Clover's `tableRef` in the adapter, and the SQL reader already ignores Clover, so the two do not interact. A later booth change might skip booth or event checks in `getTablePerformance`. If so, this lane's `checksWithoutTable` count must come after that skip.

## Not covered (CLAUDE.md §0.5)

- **Two follow-up lanes are owed, by the founder's 2026-10-05 answers, and not built here:**
  - `addtable`: "Add a table" in Settings → Point of sale, for owners and managers (his option text: about 4 files). Until it lands, the 14 production checks with a digitless word keep it with no table.
  - `seatsnote`: `rp-registers-house.tsx` says why the seats chart is empty.
- **No Browser-pane check** (residual 11). Settings → Point of sale and the room register were tested in vitest only. The no-server recipe needs the main checkout, which a fix lane may not touch, and a live page needs a signed-in gateway. This is left for the walk-through after merge.
- **Trigger cost under the digit rule was not re-timed.** The figures above are from the every-word build.
- **The seats scatter draws an empty frame** for an all-learned house, and no sentence says why. Bars is the default drawing, and the register is not on the default sheet. The copy still calls the tables "mapped" in two sentences. Fork 3 is answered: the sentence is owed to `seatsnote`.
- **The insight generator still ranks hidden tables** (residual 1, follow-up #625).
  - Its ridge driver step still treats a NULL distance or seat count as 0, and a NULL outdoor flag as indoors (`insight-generator.service.ts:1303-1306` @`28d32de36`).
  - With no geometry recorded, its r² is 0, under the gate.
  - In a mixed synthetic house, r² was 0.30, above the gate.
- **The old `POST /analytics/tables` is open to any role** and writes `seats` 2 and `is_outdoor` false when none is given. It could overwrite a learned table's NULLs on a label upsert. It predates this lane and has no caller (residual 4 names only the seat default).
- **Learned tables have no upper bound** for free-text sources with digits: Square tabs (residual 13), Toast GUIDs and SimPOS UUIDs. `listTables` and the rename/hide read take no range. Past PostgREST's 1,000-row cap, the Settings list and the case-insensitive clash check would read only part of the house's tables. The unique index still refuses an exact duplicate, as a 409.
- **The hot list and retired tables.** The hot list does not count a retired table's open checks with the hidden ones; it lists them without a label, as before. "Checks at a retired table count with the hidden ones" holds for the room and its export only. `openChecksAtHiddenTables` has no web consumer.
- **`loadChecks` is unpaged until cap #609 merges.** Until then, a 90-day window reads at most 1,000 checks.
- **Labels.**
  - Toast tables are learned under their GUID until renamed, and SimPOS tables under their UUID (residual 2).
  - A Toast "14" and "14.0" are two words (residual 9).
  - The gateway's in-memory `resolveTable` neither trims nor orders ties as the trigger does (residual 8).
- **Weaker evidence.**
  - T22 replays the migration's backfill statement as a copy. It does not run the migration's own step 6 over history stored before the migration. Two other runs applied the real migration file over pre-migration history, with the same result: the verifier's Tuzlu-shaped run (3,593 checks: 3,591 linked, 24 learned, 2 BOOTH kept as words) and the dry-run proof's actual arm. A later edit to step 6 alone would not fail T22.
  - The raw output of the round-2 insert-cost runs was not saved.
  - T19's rename case failing under mutation 2 was shown on a scratch build, not through `pgtest.sh`.
  - eslint was not re-run at the last call, because no TS or TSX file changed after `fe9d7936e`.
  - At the last call's `0863ae2d2` these were re-run: the lane spec with the auth-guard specs, the lane web test, both typechecks, eslint, every guard and self-test, the claims check, the classifier and the harness. The wider jest set (21 suites) and vitest set (17 files) stand from the verifier's run at `2723a7518`. The merge since then changed no file of this lane.
  - The ADR's review trail still says "Answering the independent verify" and "Answering the last call's HOLD". These are history, not rules, and the classifier returns released.
- **Docs and history.**
  - The `.planning/06-pages` docs for /reports and /settings are not updated, because of the 15-file cap (residual 10).
  - The first commit's body describes a gateway `table_ref` write that fix round 1 replaced. History is not rewritten; this body is the record.
- **Not pushed.** The pushed head of #621 is still `b440d85fa`. Everything after it is local until the coordinator pushes: the merges `c16686aca`, `1d4cfab3f`, `c96b7ec8f` and `0863ae2d2`, and the lane commits `fe9d7936e`, `51eaa0224`, `20c189cef` and `2723a7518`.

## History

- **`7526a24c7`** first build.
- **Fix round 1** (`19ad823e9`): the database reads the word from `raw` instead of the gateway, so deploy order is free. The hidden-table copy says what it leaves.
- **Fix round 2** (`ca04a3d36`, `56aa76a43` and `b440d85fa`), answering the HOLD at `19ad823e9`:
  - T19 and T20 pin "a re-link never moves a link".
  - The all-hidden copy is true.
  - The waiter-control answer is pinned.
  - The dry run is proved equal to the migration's changes.
- **Rework** (`fe9d7936e`), answering the founder's 2026-10-05 pick: the digit rule, T21-T23, the copy and the revised dry run.
- **Last call** (`1d4cfab3f` and `51eaa0224`): merged origin/main `8fdb819b4`. The only conflict was the `sql_outside_migrations.txt` append, and both lines were kept. Also: the README row was narrowed, T21 gained "7a" and "2nd floor", and residual 13 was added.
- **Docs rework** (`c96b7ec8f`, `20c189cef` and `2723a7518`): merged origin/main `eaa479c93` with no conflict. Recorded the founder's 2026-10-05 ~16:00Z answers verbatim and the measured round-2 production counts, in ADR 0303, the migration's header comment and the README row. No code, SQL statement or test changed. `2723a7518` only rewords the ADR's new text to name the forks by the build rather than by a review verdict.
- **Last call, final say** (`0863ae2d2`): merged origin/main `155960b59` (#645) with no conflict and no lane file changed, then re-ran the checks above. SHIP.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
