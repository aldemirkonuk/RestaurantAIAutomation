**[2026-10-06 ~04:32Z, coordinator, at merge]**
- **Merged head: `cc0935f18`. ADR 0090 audit PASS** (comment 6009358246; `audits/621-cc0935f18/report.md`). This is a fresh audit after the `afda5d868` BLOCK, and the final found all four blockers fixed. Main was `54f833e4b`, the branch's merge base. CI 41 pass, 1 skipped.
- **This merge writes production.** The migration back-fills tables from the till words. The founder approved the tables back-fill as an audited migration on merge.
  - The dry-run figures (3,621 checks link, 40 tables learned, 14 checks keep a word with no digit) date from before the rework and were not re-measured.
  - The 120 s statement bound is untested at production scale. A timeout rolls the migration back.
- **Two body sentences were narrowed at merge** (":53" and ":76", now "while its word stands"), on the final's note, so the squash history does not carry the broader wording.
- **Owed from the final, non-blocking:**
  1. A committed test for the back-fill "kept" case: an already-linked check with a NULL `table_ref` and a word that resolves elsewhere. Only the reviewers' probes cover it today.
  2. An ADR 0303 residual saying that a manual SQL `table_id` repair is silently undone while the check's word stands.
  3. Still open: residual 15 (learning count flood, `POST /pos-hub/import` with no `@Roles`, unpaged reads; follow-up `fix/table-learning-ceiling`) and residual 16 (the case race).
- **Next in this stack:** seatsnote, addtable, then #625.

**[2026-10-06 ~04:03Z, coordinator, at `cc0935f18`]**
- **Renumbered and pushed.** `cc0935f18` moves the migration and its test from `20261222160000` to **`20261222230000`**. That is past main's newest, `20261222170000` (#627), and past every slot in flight (180000 servesize, 190000 #612, 200000 #617, 210000 #618, 220000 #620). It updates the two paths that name the version: `scripts/sql_outside_migrations.txt` and the spec comment in `tables-learned-from-the-pos.spec.ts`. ADR 0303 cites the migration by slug.
- **Re-run at `cc0935f18`:**
  - migration order, versions unique, ADR numbers unique, OD ids, conflict markers and citation pairing all 0;
  - `check_decision_claims.sh` PASS;
  - `ownership_between` = `[]`;
  - 15 files.
- **Local Postgres** (`pgtest.sh lane … tables230`, template `28d32de36`): every `[fix]` test PASSES, including `20261222230000_tables_learned_from_the_pos_test.sql`. That test FAILS on `[ctl]` ("column "table_ref" of relation "pos_checks" does not exist"). The other `[ctl]` failures are main's newer tests, an artifact of the template. Log: `p4-scratch/sim-run/fixes/audits/621-local-pg.txt`.
- **This is the head to audit.** The SHIP note below names `0b21f2172`; `cc0935f18` adds only the renumber.

> **Final say at `0b21f2172`: SHIP (2026-10-06).** HEAD `0b21f2172` merges origin/main `54f833e4b` (#627) into the lane. The only conflict was `decisions/README.md`: #627's 0301 row and this branch's 0303 row both stay, in number order. The worktree is clean, and the branch is **15 files**, 2,878 insertions and 111 deletions, against merge-base `54f833e4b`. Since the rework after the `afda5d868` BLOCK, two lane commits were added. `96deded56` pins the belt's any-case, trimmed match and the case-only rename. `9e1ee70ce` narrows the ADR's prose on what the belt guarantees. No migration statement changed after `96a9e467a`.
>
> **Before merge:**
> 1. **The migration needs a new version at the serial merge step.** `20261222160000` is now behind main's newest, `20261222170000` (#627), so `check_migration_order` fails. This lane was told to keep its version, and versions are assigned at merge. Pick a version past `20261222170000` that no open PR holds. Open PRs hold `…190000` (#612), `…200000` (#617), `…210000` (#618) and `…220000` (#620); `20261222180000` is free today. Four places change (see "Merge order"). A scratch probe applied this migration after #627's, and both tests pass. [2026-10-06 ~04:03Z, coordinator: renumbered to `20261222230000` at `cc0935f18`; see the note at the top.]
> 2. **This PR writes production when it merges.** Measured read-only: 3,621 checks link, 40 tables are learned, and 14 checks keep a word that has no digit and get no table. See "The production write on merge".
>
> **Not pushed.** The pushed head of #621 is `afda5d868`. `96a9e467a` and everything after it are local until the coordinator pushes. [2026-10-06 ~04:03Z, coordinator: renumbered to `20261222230000` at `cc0935f18`; see the note at the top.]

## What was wrong for the owner

The analytics walk read Tuzlu Rüzgar on production, read-only, on 2026-10-03.

- **AW25 / A-051 (minor, latent).** Every check Tuzlu's till sent names a table in `raw.tableRef`. The coordinator's read-only production run (2026-10-05) found the words t1-t24 and booth. Tuzlu had **no `restaurant_tables` row**, so all **3,593** checks had `table_id` NULL.
  - The room register `rp-tables-90` returned **`tables.length` 0** with `dataStatus 'live'`.
  - A check reached a table only at ingest, through pos-hub's in-memory `resolveTable` (`pos-hub.service.ts:510`, `:1247` @`1aa4dcb8c`). After that, the till's word lived only in `raw` (`:526`).
  - Nothing wrote `restaurant_tables.pos_refs`. The only table writer, `upsertTable` (`table-analytics.service.ts:45` @`1aa4dcb8c`), linked no past check.
  - `getTablePerformance` dropped every unlinked check without counting it (`if (!c.table_id) continue;`, `:226`).
- **AW30 / A-055 (minor).** The register and its export told the owner *"The room has to be drawn before it can be read."* (`rp-registers-house.tsx:360`, `report-export-cuttings.ts:587` @`1aa4dcb8c`). The only table writers are `POST /analytics/tables/:restaurantId` and `PUT /analytics/venue/:restaurantId` (`analytics.controller.ts:563`, `:591` @`1aa4dcb8c`), and no web or mobile code calls either one.

## What changed and why

On 2026-10-04 the founder ruled *"Learn from the POS (Recommended)"*. Each table word the till sends becomes a table that the owner can rename or hide. Past checks re-link to it, and nothing has to be drawn. On 2026-10-05 he narrowed the rule to *"Only words with a number (Recommended)"*. After the audit he also ruled *"Keep every spelling (Recommended)"*. ADR 0303 records the method. It stays Proposed until he locks it.

- **The database learns tables.** Migration `tables_learned_from_the_pos` does this.
  - **Columns.**
    - `pos_checks.table_ref` holds the till's word.
    - `restaurant_tables` gains `learned_at` and `hidden_at`. It also gains `till_words` (`jsonb`, `{source: [word, ...]}`) and `former_labels` (`text[]`), both NOT NULL with a default of `'{}'`.
    - `seats` and `is_outdoor` become nullable. A learned table then carries no seat count or outdoor flag that nobody gave (ADR 0020, 0051).
  - **`pos_table_ref_from_raw`** reads the word out of `raw` the way the adapters do:
    - Square: `ticket_name`.
    - Toast: `table.guid`, then `table.name`.
    - Every other source: `tableRef`, then `table_ref`, then `table`.
    - Clover gives NULL, because its order type is a channel (AW24, ADR 0302).
  - **`pos_table_for_ref`** resolves a word in rank order:
    1. the source's pos ref;
    2. the label;
    3. `table <label>`;
    4. last, a word the table remembers: one in its `till_words` for that source, or a former label under either label rule.

    Matching ignores case and spaces, and it covers active tables, hidden ones included. A table that remembers nothing skips the last scans.
  - **A BEFORE trigger on `pos_checks`** (`pos_checks_find_or_learn_table`):
    - It sets `table_ref` from `raw`.
    - **The belt.** When an update leaves the check's word as it was (trimmed, in any case), the check keeps the table it had, whatever the statement sets. A past check therefore never moves on a re-send while its word stands [2026-10-06 ~04:32Z, coordinator, at merge: "while its word stands" added on the cc0935f18 final's note; a re-send whose word changed re-resolves the link (T18)].
    - When the word changes and the statement did not set `table_id` itself, the link is re-resolved.
    - When nothing answers a word, a table is learned only if all three of these hold:
      - **the word has an ASCII digit in it** (`v_ref ~ '[0123456789]'`);
      - it is at most 60 characters, the longest name PATCH accepts;
      - no retired table answers it.

      The learned table has `seats` NULL, `is_outdoor` NULL and `pos_refs {source: word}`. "T12", "12", "Patio 3", "7a" and "2nd floor" are learned.
    - A word with no digit ("booth", "Ayla"), or one over 60 characters, is kept as `table_ref` and makes no table. It links once a table answers it.
    - A failure to learn raises a WARNING, so a sale is never refused.
  - **Rename and re-map keep every spelling** (`restaurant_tables_keep_till_names`, `BEFORE UPDATE OF label, pos_refs`).
    - Into `till_words` it adds, per source, every distinct word on a check linked to the row, plus the row's earlier `pos_refs` words.
    - Into `former_labels` it adds the old label, unless the rename changed only its case or spacing.
    - Nothing kept is dropped, and nothing is added twice in any case.
    - So a renamed table answers every word it answered before, and the trigger never learns a twin for it.
  - **Re-link.**
    - Adding, renaming, re-mapping or re-activating a table fills the house's NULL links whose word now resolves to it. So an owner-added "Bar" catches past and new "bar" checks.
    - A learned insert re-links at commit, through a deferred constraint trigger. One `INSERT … ON CONFLICT DO UPDATE` import batch therefore cannot abort.
    - Both re-links fill only NULL links (`c.table_id IS NULL`), so they never move an existing link.
  - **Backfill.** The migration writes `table_ref` on every stored check whose `raw` carries a word. That fires the trigger, so history learns and links in one statement, by the same rule.
- **pos-hub is unchanged.** The trigger reads `raw`, and the gateway writes no new column, so the gateway and the migration can deploy in either order (ADR 0303 option 3b). `resolveTable` (`pos-hub.service.ts:1820`, called at `:963` @`0b21f2172`) reads only `pos_refs` and labels.
  - The remembered words rank last, so they never outrank an answer the gateway can give.
  - When the gateway finds nothing, it writes `table_id` NULL, and the trigger resolves the word, remembered words included.
  - On a re-send, while its word stands, the belt keeps the old link whatever id the gateway sends [2026-10-06 ~04:32Z, coordinator, at merge: narrowed on the cc0935f18 final's note].
- **`PATCH /analytics/tables/:restaurantId/:tableId` renames or hides a table** (`analytics.controller.ts:620`).
  - **Access.** `@Roles('owner','manager')` (F1). RolesGuard is exact (ADR 0164), and the class-level JwtAuthGuard pins the house.
  - **Validation.**
    - A label must be 1-60 characters, and `hidden` must be a boolean. Anything else, or an empty body, is 400.
    - A non-uuid, foreign or retired id is 404.
    - A name that another table of the house already has is 409. The comparison ignores case and includes retired tables.
  - **Route-access fixture.** `route-access.expected.json` gains the row. The `ADR-0164-ROLES-EXACT-MANAGERS-KEPT` claim's fixture size goes from 199 to 200: one route added, none removed and none changed.
- **Hidden tables leave the room (F2).** A hidden table still catches its checks, and they stay in takings.
  - `getTablePerformance` and its export leave hidden tables out and count what they left out, in `checksWithoutTable`, `checksAtHiddenTables` and `hiddenTables`. `hiddenTablesInHouse` tells "every table is hidden" apart from "no table yet".
  - The hot list leaves hidden tables' open checks out and counts them as `openChecksAtHiddenTables`.
  - The insight generator's part is owed to the stacked `fix/hidden-tables-leave-insights` (#625). Until it lands, the copy names only what a hidden table leaves today.
- **The waiter adjustment keeps hidden tables in its table control,** as the founder picked. `getWaiterPerformance` reads no `hidden_at`. A gateway case and a claims row pin this.
- **No page asks for a drawing (AW30).** Depending on the case, the register and the export now say one of these:
  - With no table: *"This house has no table yet, so no check can be attributed to a seat. A table is learned when a check arrives naming one with a number in it, such as T12, 12 or Patio 3; rename or hide it under Settings → Point of sale."*
  - With checks that have no table: *"N checks in this window have no table, so none can be attributed to a seat. They are in takings. A till word with no number in it, such as Booth or a name, makes no table."*
  - With every table hidden and an empty window: *"Every table in this house is hidden, and this window held no check. Show a table again under Settings → Point of sale."*
  - With checks only at hidden tables: the room sentence without the "absent attribution" clause, plus a count of those checks.
  - No sentence claims a screen that adds a table, because none exists. The founder made that screen the follow-up lane `addtable`.
- **Settings → Point of sale gains "Tables the till has named".**
  - The list sits behind a closed disclosure and is read only when opened.
  - Loading, a failed read (ADR 0067) and an empty read each look different.
  - Each table's kept words appear beside its pos ref ("csv_import: 5, Table 5").
  - Rename, Hide and Show appear only for an owner or manager.
  - It says: *"A table name the till sends on a check becomes a table here when it has a number in it (T12, 12, Patio 3). A word with no number, such as Booth or a name, stays on its check and makes no table."*
- **The room register's correlations and drivers read only recorded values** (`recorded()`). A NULL seat count, distance or outdoor flag is no longer read as 0. A driver feature needs at least 5 recorded values that vary. With no feature kept, there is no model.

## Founder answers this PR builds (verbatim)

- **AW25+AW30**, 2026-10-04 ~00:30Z: **"Learn from the POS (Recommended)"**. The option text read: *"Every POS table ref becomes a table the owner can rename or hide. Past checks re-link from the stored ref when a table is added or renamed. No drawing."*
- **F1, who renames or hides**, 2026-10-04 ~20:50Z: **"Owner or manager (Recommended)"**.
- **F2, how far hiding reaches**, 2026-10-04 ~20:50Z: **"Out of every figure (Recommended)"**. This PR builds the room register, its export and the hot list. The insights part is the follow-up #625, which the brief sanctions.
- **Hidden tables in the waiter adjustment's control**, 2026-10-05 ~01:39Z: **"Keep them in the control (Recommended)"**.
- **Which words become tables**, 2026-10-05 ~14:15Z, asked after the production dry run: **"Only words with a number (Recommended)"**.
  - The question read: *"#621 tables dry run: back-filling would link 3,635 old checks and learn 47 tables. But Tuzlu would get a table called 'booth' (its street-fair booth), and a sim house would get six 'tables' named after people (ayla, jon, priya…). Square sends tab names like these in the same field. Which words become tables?"*
  - The option text read: *"'T12', '12' and 'Patio 3' are learned; 'booth' and 'Ayla' stay on the check as its word but make no table. Cost: a table named only 'Bar' or 'Window' must be added once by hand in the table control. About 3 files in #621 and the rule applies to new checks too."*
  - He rejected "Every word, retire odd ones" and "Every word but booth/event".
- **How a renamed table keeps its till spellings**, asked 2026-10-05 ~23:22Z after the `afda5d868` audit, answered before 00:06Z 2026-10-06: **"Keep every spelling (Recommended)"**.
  - The question read: *"#621 (tables learned from the till) was blocked by its audit. Say the till learned table '5', and a 'Table 5' check also landed on it. You rename that table 'Patio'. The till then re-sends the 'Table 5' check and sends a new one. The system learns a second table called 'Table 5', and the old check moves off Patio onto it. That happens because a renamed table remembers only one till spelling per till. How should a renamed table keep its till spellings?"*
  - The option text read: *"A table remembers every till spelling it was ever linked by, not just one. A rename never creates a twin table, and past checks never move. Cost: the larger rework (migration, the lookup, and a new SQL test), so #621 needs another audit round of about 1–2 hours. seatsnote and addtable wait on it."*
  - He rejected "Stop the move only" (*"Past checks stay on Patio. The till's next 'Table 5' check still creates a twin 'Table 5' table that you would hide by hand. …"*) and "Disclose only" (*"Change no code. The ADR and the migration's own notes are corrected to say a rename can create a twin table and move a past check onto it. …"*).
- **Clover rule (a dependency of the reader):** booth, **"Wait, then owner maps (Recommended)"**, and AW24, **"Own row, POS field (Recommended)"**.
- **The four answers of 2026-10-05 ~16:00Z** (AskUserQuestion). Each leaves this build as it is.
  1. **No screen adds a table by hand** (residual 12): **"Follow-up: 'Add a table' (Recommended)"**. Option text: *"A small separate PR adds 'Add a table' to Settings → Point of sale, for owners and managers. Waiting checks with that word link to it automatically. About 4 files. #621 merges as it is."* He rejected "Build it into #621" and "Leave it". The follow-up lane `addtable` is owed. This PR's re-link on add is what links the waiting checks.
  2. **A tab name with a digit in it still learns a table** (residual 13): **"Keep the rule, revisit later (Recommended)"**. Option text: *"Revisit when the first Square house connects and we can see real tab names. The owner can hide any odd table in the meantime. Nothing to build now."* He rejected "Tighten it now" and "Learn nothing from Square".
  3. **Seat counts for learned tables** (residual 14): **"Explain the empty chart now (Recommended)"**. Option text: *"A small follow-up: the report says why the chart is empty ('seat counts are not recorded yet'). Add a seats field later if you want per-seat figures."* He rejected "Add a seats field" and "Both". The follow-up lane `seatsnote` is owed, on `rp-registers-house.tsx`.
  4. **The production read before merge**: **"Yes, all three read-only (Recommended)"**. Option text: *"Same way as this morning: inside READ ONLY transactions, counts saved to a file and shown to you. Nothing is written. Without them, neither PR can merge safely: the re-date stops on merge if a trigger exists, and the tables count of ~40 is only an estimate."* This PR's part is the tables dry run, measured below.

ADR 0303 quotes each of these verbatim.

## Tests, guards, harness

All runs below are appended, dated and with their SHAs, to `p4-scratch/sim-run/fixes/audits/tables-local-pg.txt`.

**Local Postgres at HEAD `0b21f2172`** (`pgtest.sh lane … tablesfs2`, template `28d32de36`, every test file the lane carries past the template):
```
applied 6 migration(s) to tablesfs2_fix
[fix] PASS 20261221093000_an_order_letter_is_staged_once_test.sql
[fix] PASS 20261222100000_a_pos_sale_is_dated_by_its_check_test.sql
[fix] PASS 20261222120000_the_ledger_lists_only_the_current_menu_test.sql
[fix] PASS 20261222140000_old_pos_rows_carry_their_check_date_test.sql
[fix] PASS 20261222160000_tables_learned_from_the_pos_test.sql
[fix] PASS 20261222170000_the_cellar_reads_the_tills_own_record_test.sql
[ctl] FAIL 20261222160000_tables_learned_from_the_pos_test.sql: ERROR:  column "table_ref" of relation "pos_checks" does not exist
template=28d32de368d3f57df52ce6f490758908d9fa924d lane_migrations=6 tests=6
```
Each of the other five `[ctl]` lines also FAILs, each on its own lane's missing change. The same `[fix]` PASS and `[ctl]` FAIL for this lane's test came from `tablesfs` at `9e1ee70ce`, `tables3` at `96a9e467a` and `3fa444155`, and every earlier head.

**Renumber probe** (`tablesfsr`). A `git clone --shared` at `0b21f2172` renamed this migration and its test to `20261222990000`, so it applied after #627's `20261222170000`:
```
[fix] PASS 20261222990000_tables_learned_from_the_pos_test.sql
[fix] PASS 20261222170000_the_cellar_reads_the_tills_own_record_test.sql
[ctl] FAIL 20261222990000_tables_learned_from_the_pos_test.sql: ERROR:  column "table_ref" of relation "pos_checks" does not exist
```
#627's migration only defines functions that read `pos_checks`. It adds no trigger and no column, so the two do not interact in either order.

**The SQL test** (`supabase/tests/20261222160000_tables_learned_from_the_pos_test.sql`, T1-T29) runs in one transaction, which is rolled back. Every block RAISEs on failure. [2026-10-06 ~04:03Z, coordinator: renumbered to `20261222230000` at `cc0935f18`; see the note at the top.]
- **T1-T20: learning, linking and re-linking.**
  - T1: the columns.
  - T2-T6: learning and linking.
  - T7-T8: rename.
  - T9-T10: add and re-activate re-link.
  - T11: the upsert batch.
  - T12: failure is a WARNING.
  - T13: the raw reader and the backfill.
  - T14-T15: links never move.
  - T16: the deferred re-link.
  - T17-T18: pos-hub's write shape and the re-send.
  - T19-T20: a re-link never moves a link, and leaves a linked row unwritten (`ctid`).
- **T21-T23: the digit rule.**
  - T21, new checks: "booth", "ayla" and Square's "Ayla" make no table. "t12", "12", "patio 3", "table 7", "7a", "2nd floor" and the number 14 are each learned once.
  - T22, the backfill: BOOTH and Ayla stay words with no table, and T5 and "Patio 6" are learned.
  - T23, words that wait: an owner-added "Bar" links past and new "bar" checks.
- **T24-T29: "Keep every spelling".**
  - T24: the founder's sequence. One table, Patio, holds c1, c2 and c3, and no "Table 5" table exists.
  - T25: a write naming another table moves no past check, including a re-send of the same word in another case or with spaces (`96deded56`).
  - T26: the hand-added variant.
  - T27: every word, not one per source.
  - T28: a `pos_refs` re-map, and a case-only rename that writes no former label (`96deded56`).
  - T29: the 60-character cap.

**Mutations, all through `pgtest.sh lane`.** Each mutant was committed only in a `git clone --shared` scratch clone, and the clone and its databases were dropped afterwards.
- **Last call** (`tableslcm_*`, clone at `93cbd0da7`). Each mutant fails the new test file and passes the one committed at `93cbd0da7`, so `96deded56` is what pins them:
  ```
  beltcase (belt compares without lower/btrim):  [fix] FAIL … T25 FAIL: a re-send of the same word in another case, naming the new "5", moved a past check off Patio
  belttrim (belt compares lower() without btrim): [fix] FAIL … T25 FAIL: a write of the same word with spaces, naming the new "5", moved a past check off Patio
  formerlabelalways (old label kept on any label change): [fix] FAIL … T28 FAIL: a rename that changed only the case wrote a former label
  ```
- **The rework** (`tables3m01`-`24`, clone at `96a9e467a`). Every `[fix]` line FAILs:

  | Mutation | First failure |
  |---|---|
  | as-built keep (one word per source into `pos_refs`) | T7 |
  | one word per source in `till_words` | T27 |
  | no former labels | T7 |
  | belt removed | T15 |
  | belt replaced by the as-built keep-when-nothing-answers rule | T25 |
  | resolver reads no remembered word | T8 |
  | no 60-character cap | T29 |
  | keep trigger on label only | T28 |
  | no learning INSERT / no `learned_at` condition on relink-on-add / no deferred re-link / no keep trigger | T2 / T11 / T16 / T7 |
  | the six fix-round-1 trigger mutations | T17, T18, T18, T18, T18, T17 |
  | `c.table_id IS NULL` removed from the deferred / immediate re-link | T20 / T19 |
  | no digit rule / `^[0-9]+$` / `^t?[0-9]+$` / `[0123456789]$` | T21 / T2 / T11 / T21 |
- **Earlier rounds** killed 5 mutants (T2, T11, T16, T8, T15), then 6 (T17, T18), then 2 (T19, T20). The as-built `b440d85fa` migration fails T21, because "booth" got a table.

**The audit's probe.**
- On `afda5d868`: Patio {c1} plus a twin "Table 5" {c2, c3}.
- On this build: one table, Patio, holding {c1, c2, c3}, with `till_words {"csv_import": ["5", "Table 5"]}` and `former_labels {5}`.

**Insert cost**, measured at `96a9e467a`'s SQL, which no later commit changed. One house, 20,000 inserts in one statement learning 26 tables, local, 2-3 runs in one sitting on a shared machine:

| Case | Time |
|---|---|
| Without the migration | 197-209 ms |
| As-built `afda5d868` | 969-1,015 ms |
| This build | 1,245-1,294 ms |
| All 26 tables renamed, upsert re-send of the 20,000 | 1,978-2,054 ms |
| All 26 tables renamed, 20,000 new checks under a remembered spelling | 1,993-2,096 ms |

In the renamed runs every check linked, and no twin was learned. Tuzlu's volume is about 3,593 checks a quarter.

**Gateway** (at `0b21f2172`):
- jest (`--runInBand --forceExit`) over the lane spec, `table-analytics.service.spec`, `src/pos-hub`, `src/auth/guards` and `src/reports/exports`: **22 suites, 423 tests pass**.
- The lane spec has **28 cases**. 22 of the first 24 fail against the `1aa4dcb8c` sources. Over origin/main's service, controller and export, the verifier counted 25 of 28 failing; the 3 that pass pin kept behaviour.
- `tsc -p tsconfig.spec.json` shows only the known `@simplewebauthn/server` errors.
- eslint reports 0 errors. Its warnings equal main's, and none falls in this branch's hunks.

**Web** (at `0b21f2172`, re-run after the #627 merge brought 4 web files):
- vitest over the lane test and `src/pages/reports/next`: **6 files, 145 tests pass**. The lane test passes 14/14.
- All 13 original lane cases fail against origin/main's `PosSection` and `rp-registers-house`. With the list ignoring `till_words`, the 14th fails.
- `tsc` shows only the known `@simplewebauthn/browser` TS2307. eslint reports 0 errors.

**Guards** (at `0b21f2172`):
- `check_decision_claims.sh`: **900 checked, 900 holding**. `scripts/test_check_decision_claims.sh` printed 31 ok, 0 failed, at `9e1ee70ce`.
- These return 0:
  - `check_adr_numbers_unique` (introduced by this ref: 0303);
  - `check_citation_pairing` and `check_no_conflict_markers`;
  - `check_od_ids_exist` and `check_migration_versions_unique`;
  - `check_read_columns_exist` and `check_web_reads_gateway_dto_keys`;
  - `check_route_exposure` and `check_new_tables_are_locked_down`;
  - `check_migration_probe_safety`.
- Every python guard in ci.yml returned 0 at `9e1ee70ce`. The self-tests of these return 0 too: `adr_numbers_unique`, `migration_order`, `migration_versions_unique`, `citation_pairing`, `no_conflict_markers`, `od_ids_exist`, `read_columns_exist`, `web_reads_gateway_dto_keys` and `new_tables_are_locked_down`.
- **`check_migration_order` returns 1**: `20261222160000` is behind main's `20261222170000`. The version is renumbered at merge (see "Before merge"). [2026-10-06 ~04:03Z, coordinator: renumbered to `20261222230000` at `cc0935f18`; see the note at the top.]
- `check_definer_functions_closed` against the local database: CANNOT CHECK (exit 2). The Docker database is not a Supabase stack and has no `supabase_functions` schema.
- `check_migration_ledger` was not run, because it reads production.
- The ownership classifier, `pr_audit_gate.ownership_between(origin/main 54f833e4b, HEAD)`, returns `[]`.

**Claim verifies against migration variants.**
- `ADR-0303-A-RENAMED-TABLE-KEEPS-EVERY-SPELLING` holds at HEAD. It fails on `afda5d868`, and under each of these:
  - the as-built keep;
  - one word per source;
  - no former labels;
  - no belt;
  - the trigger on label only;
  - a later migration that drops the keep trigger.
- `ADR-0303-A-CHECK-LEARNS-ITS-TABLE-FROM-THE-TILL` holds at HEAD. It fails on `afda5d868` and without the cap.
- The first five 0303 rows fail on `1aa4dcb8c` and on `28d32de36`.

## ADR, claims, register

- **ADR 0303** `tables-learned-from-the-pos` is new and **Proposed**. It quotes every answer above verbatim.
  - Options 5a-5g record the rejected rename designs.
  - Residuals 1-20 name what is not built. Stale text is bracket-corrected in place and dated.
  - `9e1ee70ce` narrows the belt's guarantee bullet. It no longer reads "A changed word still re-resolves", which would cover any statement. It now says that the trigger re-resolves only a link the statement did not set itself (T18).
- **`claims.d/feat-tables-learned-from-the-pos.jsonl`**: 7 static rows, all `resolved`:
  - `ADR-0303-A-CHECK-LEARNS-ITS-TABLE-FROM-THE-TILL`, which needs the digit condition, the 60-character cap and `c.table_id IS NULL` in both re-link UPDATEs;
  - `-A-RENAMED-TABLE-KEEPS-EVERY-SPELLING`;
  - `-THE-DATABASE-READS-THE-TILLS-WORD`;
  - `-THE-ROOM-COUNTS-WHAT-IT-LEAVES-OUT`;
  - `-RENAME-OR-HIDE-IS-OWNER-OR-MANAGER`;
  - `-NO-PAGE-ASKS-FOR-A-DRAWING`, which needs the register, export and Settings sentences;
  - `-THE-WAITER-CONTROL-KEEPS-HIDDEN-TABLES`, which pins kept behaviour and so holds on main.
- **`CLAIMS.jsonl`** amends `ADR-0164-ROLES-EXACT-MANAGERS-KEPT` in place, from `len(fx)==199` to `200`.
- **`decisions/README.md`**: this branch adds the 0303 row only and edits no existing row.
- **`scripts/sql_outside_migrations.txt`** gains one line, for the new SQL test.
- No document names the migration's version. The claims rows find the migration by slug, and the ADR cites it by slug, so a renumber leaves them true.

## The production write on merge

Migrations auto-apply, so the backfill **writes production when this merges**.

- **What it writes.** For every house whose stored `raw` carries a table word:
  - `pos_checks.table_ref`;
  - a `restaurant_tables` row for each word with a digit in it;
  - `table_id` on every check a table answers.
- `till_words` and `former_labels` arrive empty on every existing row, through a constant default with no table rewrite. The backfill renames nothing, so it writes neither.
- **Measured under the digit rule** by the coordinator, read-only, on 2026-10-05 ~16:10Z, inside `READ ONLY` transactions (`p4-scratch/sim-run/fixes/audits/prod-dryruns-2026-10-05.md`, round 2). His yes for it, verbatim: **"Yes, all three read-only (Recommended)"**.

  | House | Checks with a word | Already linked (kept) | Would be linked | To an existing table | Word kept, no table | Digitless words | Blocked by retired | Tables learned |
  |---|---|---|---|---|---|---|---|---|
  | Tuzlu Rüzgar | 3,593 | 0 | 3,591 | 0 | 2 ("booth") | 1 | 0 | 24 |
  | Sim Meyhouse `aaecdb17` | 42 | 0 | 30 | 0 | 12 (first names) | 6 | 0 | 16 |
  | Sim Bistro | 21 | 21 | 0 | 0 | 0 | 0 | 0 | 0 |
  | **All houses** | 3,656 | 21 | **3,621** | 0 | **14** | 7 | 0 | **40** (min = max) |

- **The read-only dry run:** `p4-scratch/sim-run/fixes/audits/tables-backfill-dryrun.sql`.
  - It is a SELECT inside `BEGIN TRANSACTION READ ONLY … ROLLBACK`. It runs before the migration, inlines the reader and the matching, and names no column or function the migration adds.
  - It does not model the 60-character cap. That cannot change a measured count, because every word that learns on production is a t-word.
- **Local proof of the dry run** (a scratch database cloned from the template, with 2,640 synthetic checks over 4 houses):
  ```
  dry run  ALL HOUSES | 2630 words | 2 kept | 2418 relinked | 9 to existing | 209 kept_word_no_table | 7 no_number_words | 1 blocked_by_retired | learned 30-31
  actual   ALL HOUSES | 2630 words | 2 kept | 2418 relinked | 9 to existing | 209 kept_word_no_table | 7 no_number_words | 1 blocked_by_retired | links_moved 0 | wordless_rows_changed 0
  learned  ALL HOUSES | 30 tables | learned_without_a_digit 0
  ```
  Every per-house row matched. The verifier's Tuzlu-shaped run, with the real migration file over pre-migration history, gave 3,593 checks: 3,591 linked, 24 learned and 2 BOOTH kept as words. A 2,593-row backfill took 0.37 s in a single transaction.

## Forks deferred (not asked; each is the founder's call)

- **Roles on `POST /pos-hub/import/:restaurantId`** (`pos-hub.controller.ts:129` @`0b21f2172`). Today any member of a house can import checks whose words learn tables there. This PR adds no `@Roles`. ADR residual 15.
- **A per-house ceiling on learned tables**: what number, and what happens past it (stop learning, or ring the bell). The audit's probe learned 5,002 tables from 5,000 distinct tab names. Owed to `fix/table-learning-ceiling`. ADR residual 15.
- **A case-insensitive unique index on table labels**, to close the race between the PATCH's case-insensitive 409 check and the case-sensitive `uq_restaurant_tables_label`. ADR residual 16.
- **A control to drop a kept spelling or an old label.** ADR residual 18.
- **An audit row for rename and hide** (residual 3), and **merging two till words into one table** (residual 5). Neither was offered.

## Merge order and shared files

- **Order.** The ADR's order is sig (#602, merged) → cap (#609) → postime (#603, merged) → netsales (#615) → booth (#618) → tables.
  - Sig had to go first. Its `MIN_RANK_N` gate keeps Tuzlu's 24 newly learned tables from lighting an ungated "Table #1" insight.
  - Nothing stacks this PR on another branch.
- **Renumber the migration at the serial merge step** (see "Before merge"). Four places change:
  - `supabase/migrations/20261222160000_tables_learned_from_the_pos.sql`; [2026-10-06 ~04:03Z, coordinator: renumbered to `20261222230000` at `cc0935f18`; see the note at the top.]
  - `supabase/tests/20261222160000_tables_learned_from_the_pos_test.sql`; [2026-10-06 ~04:03Z, coordinator: renumbered to `20261222230000` at `cc0935f18`; see the note at the top.]
  - its line in `scripts/sql_outside_migrations.txt`;
  - the header comment at line 27 of `apps/api-gateway/src/analytics/tables-learned-from-the-pos.spec.ts`, which names the test file.

  Then re-run `check_migration_order` and `check_migration_versions_unique`.
- **#625** (`fix/hidden-tables-leave-insights`) is stacked on this PR. It shares ADR 0303, the claims file, `analytics.controller.ts`, `table-analytics.service.ts`, the lane spec, `PosSection.tsx` and the web test. Bring it onto main by a merge after this lands. Resolve its hunks by later-truth, which is this branch for the digit rule and the rename rules.
- **Open PRs that share files** (`gh pr list --json files`, 73 open, at `0b21f2172`). All the conflicts are textual; resolve them by later-truth.
  - `table-analytics.service.ts`: cap #609 (`loadChecks` paging) and netsales #615 (the aggregation loop next to this lane's counts).
  - `report-export-cuttings.ts`: #615, #616, #617, #619, #624 and #626. Only netsales #615 is near `writeSeats`.
  - `rp-registers-house.tsx`: #615, #617, #619 and #624. Only netsales #615 edits the seats register.
  - `analytics.controller.ts`: #564 and #616. This lane adds one method after `setVenue`.
  - `route-access.expected.json`: #564 re-roles four routes and adds none, so the `len(fx)==200` claim is unaffected. A later PR that adds a route must bump the same number.
  - `CLAIMS.jsonl`: #561, #569, #614 and #626 edit other rows. This lane edits only the `len(fx)` figure.
  - `scripts/sql_outside_migrations.txt`: #617, #618, #620, #626 and #628 each append a line. Keep every line.
  - `decisions/README.md`: 21 other open PRs touch it. Keep every row, ordered by number.
- **Booth #618** nulls Clover's `tableRef` in the adapter, and the SQL reader already ignores Clover, so the two do not interact. If a later booth change skips booth or event checks in `getTablePerformance`, this lane's `checksWithoutTable` count must come after that skip.

## Not covered (CLAUDE.md §0.5)

- **Follow-ups owed, by the founder's answers, and not built here:**
  - `addtable`, "Add a table" in Settings → Point of sale. Until it lands, the 14 production checks with a word that has no digit keep that word and have no table.
  - `seatsnote`: the seats scatter draws an empty frame for an all-learned house, and no sentence says why. The copy still calls the tables "mapped" in two sentences.
  - #625: the insight generator still ranks hidden tables. Its ridge driver step still treats a NULL distance or seat count as 0 and a NULL outdoor flag as indoors (`insight-generator.service.ts:1303-1306` @`28d32de36`). With no geometry recorded its r² is 0, under the gate. In a mixed synthetic house it was 0.30, above the gate.
- **No Browser-pane check** (residual 11). Settings → Point of sale and the room register were tested in vitest only. The no-server recipe needs the main checkout, which a fix lane may not touch, and a live page needs a signed-in gateway. The check is left for the walk-through after merge.
- **The belt overrides any `table_id` UPDATE while the word stands.** That includes a person's or a script's manual correction: the check keeps its table until its word changes. The ADR's Decision says so ("whatever the statement sets"). There is no test of a manual re-assignment, because none exists in the product.
- **`pos-hub.service.ts` does not read `till_words` or `former_labels`.** The remembered words rank last instead, and the belt holds re-sends. Changing the gateway would have made 16 files.
- **Residual 15, the open flood.**
  - The import route has no `@Roles`.
  - There is no count ceiling on learning (Square tabs with digits, residual 13; Toast GUIDs and SimPOS UUIDs, residual 2).
  - `listTables` and the PATCH's read of a house's tables ask for no page. Past PostgREST's row cap (`max_rows = 1000` locally; production's setting was not read), Settings would list only part of a house's tables. The PATCH could also answer 404 for a real table, or miss a clash that differs only in case. Tuzlu learns 24.
- **Residuals 16-20 stay open:**
  - 16: the case race;
  - 17: a current label outranks a remembered word;
  - 18: no control drops a spelling;
  - 19: "Table 5" before "5" still learns two tables;
  - 20: a writer's own `table_id` under a word no table answers.
- **Residuals from earlier rounds:**
  - Toast GUID and SimPOS UUID labels (2).
  - No audit row (3).
  - The old `POST /analytics/tables` is open to any role and writes `seats` 2 and `is_outdoor` false when none is given, so a label upsert could overwrite a learned table's NULLs (4; it predates this lane and has no caller).
  - No merge of words (5).
  - The gateway's `resolveTable` neither trims nor orders ties as the trigger does (8).
  - "14" and "14.0" are two words (9).
- **The hot list and retired tables.** The hot list does not count a retired table's open checks with the hidden ones. It lists them without a label, as before. `openChecksAtHiddenTables` has no web consumer.
- **`loadChecks` is unpaged until cap #609 merges.** Until then, a 90-day window reads at most 1,000 checks.
- **Weaker evidence.**
  - The insert cost is local, measured on a shared machine with 2-3 runs per case in one sitting. The raw output of the earlier rounds' cost runs was not saved.
  - T22 replays the migration's backfill statement as a copy. A later edit to the migration's step 6 alone would not fail T22. The real file over pre-migration history was exercised by the verifier's Tuzlu-shaped run and by the dry-run proof's actual arm.
  - The web vitest set and the gateway jest set are the lane's own suites plus their neighbours, not the full suites.
  - `check_definer_functions_closed` could not check locally (exit 2), and `check_migration_ledger` was not run.
  - `check_gateway_boots.sh` was not run, because it needs a dist build. The PATCH reuses `RolesGuard`, which `AnalyticsController` already applies, so it adds no provider.
- **The storage design had no separate fan-out.** The choice of two columns over arrays in `pos_refs`, an alias table, or remembered words ranked above labels was argued in one session and recorded as ADR options 5d-5g. It had no separate parallel fan-out or adversarial pass. The audit round the founder named is that pass.
- **Docs.** The `.planning/06-pages` docs for /reports and /settings are not updated, because of the 15-file cap (residual 10).
- **History is not rewritten.** The first commit's body describes a gateway `table_ref` write that fix round 1 replaced. This body is the record.
- **The migration renumber is owed at merge**, and `check_migration_order` fails until it is done. [2026-10-06 ~04:03Z, coordinator: renumbered to `20261222230000` at `cc0935f18`; see the note at the top.]
- **Not pushed.** The coordinator pushes. [2026-10-06 ~04:03Z, coordinator: renumbered to `20261222230000` at `cc0935f18`; see the note at the top.]

## History

- **`7526a24c7`**: first build.
- **Fix round 1** (`19ad823e9`): the database reads the word from `raw` instead of the gateway, so deploy order is free. The hidden-table copy says what it leaves.
- **Fix round 2** (`ca04a3d36`, `56aa76a43` and `b440d85fa`), answering the HOLD at `19ad823e9`:
  - T19 and T20 pin "a re-link never moves a link".
  - The all-hidden copy is now true.
  - The waiter-control answer is pinned.
  - The dry run is proved equal to the migration's changes.
- **Rework** (`fe9d7936e`): the digit rule, T21-T23, the copy and the revised dry run.
- **Last call** (`1d4cfab3f`, `51eaa0224`): T21 gained "7a" and "2nd floor", and residual 13 was added.
- **Docs rework** (`c96b7ec8f`, `20c189cef`, `2723a7518`): the founder's ~16:00Z answers and the measured production counts.
- **Last call, final say** (`0863ae2d2`): SHIP.
- **Renumber** (`f5cbccdd4`, the coordinator): `20261220110000` → `20261222160000`. Merges of origin/main followed at `0d93b370c` (#607) and `afda5d868` (#647). [2026-10-06 ~04:03Z: and again at `cc0935f18`, `20261222160000` → `20261222230000`, past #627's `20261222170000` and every slot in flight.]
- **Audit at `afda5d868`: BLOCK (OVERTURNED).** A rename dropped spellings. That learned a twin table and moved a past check.
- **Rework after the BLOCK** (`96a9e467a`, merge `3fa444155`, `8e42a999d`): built *"Keep every spelling (Recommended)"*.
- **Last call** (merge `93cbd0da7` of #644 `1c0e8a696`, then `96deded56` and `9e1ee70ce`): pinned the belt's case and trim match and the case-only rename, and narrowed the belt's prose.
- **Final say** (`0b21f2172`): merged origin/main `54f833e4b` (#627), kept both README rows and re-ran the checks above. SHIP, with the migration renumber owed at merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
