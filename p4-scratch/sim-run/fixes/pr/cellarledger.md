## fix(cellar): Sold and Taken read the till's own record (AW10, ADR 0301)

**[2026-10-06 ~03:41Z, coordinator, at merge]**
- **Merged head: `ab0f599a4`.** This replaces the "head to audit" named in the note below.
  - `612daa5a7` PASSED the ADR 0090 audit (comment 6006999386). After that, #644 merged as `1c0e8a696`.
  - `ab0f599a4` merges `origin/main` `1c0e8a696` with no conflict. The delta is #644's 10 files, and none of them is in this PR.
  - Re-run at `ab0f599a4`: guards 0, claims PASS, `ownership_between` = `[]`. Local Postgres 5/5 `[fix]` PASS (`audits/627-local-pg.txt`). CI 41 pass, 1 skipped.
- **Re-audit: PASS at `ab0f599a4`** (comment 6008841621; `audits/627-ab0f599a4/report.md`).
- **Owed from the final, non-blocking. None is fixed by this merge:**
  1. ADR 0301's serve-size fork is answered (servesize lane) but has no OPEN-DECISIONS row or record pointer.
  2. The ADR 0108 rows carry no bracket note.
  3. Production PostgREST `max_rows` has not been read. Reading it needs the founder's yes.
  4. Two things are unmeasured: production timing per page, and whether Lightspeed and Clover send a unit price or a line total.
  5. The Q9 claim still carries the stale verified date 2026-09-22.
  6. The "nothing is capped" comment is still at `beverages.service.ts:1042-1043`.
- **Stacked work.** servesize (slot `20261222180000`) and #628 rebuild onto main after this squash. #628 also renumbers off `20261221091500`.

**[2026-10-06 ~00:14Z, coordinator, at `27faf423a`]**
- **Renumber.** `27faf423a` renumbers this PR's migration and its test from `20261222130000` to **`20261222170000`**, past main's newest, `20261222140000` (#647). The change is `git mv` plus the matching line of `scripts/sql_outside_migrations.txt`. ADR 0301 cites the migration by name, so no record changes.
- **Guards.** migration order, versions unique, ADR numbers unique and OD ids all 0. `check_decision_claims.sh` PASSES.
- **Local Postgres** (`pgtest.sh lane … cellar170`, template at `28d32de36`, which replays every migration main gained since). All 5 `[fix]` tests PASS. This PR's test `20261222170000_the_cellar_reads_the_tills_own_record_test.sql` FAILS on `[ctl]` (*"the rakı reads pos_lines = 0, expected 1"*). Log: `p4-scratch/sim-run/fixes/audits/cellarledger-local-pg.txt`.
- **Serve-size fork.** The fork deferred below is now answered. The founder picked **"Join by contained name, split Sold (Recommended)"** (2026-10-05 ~23:07Z; verbatim in `p4-scratch/sim-run/fixes/briefs/cellarledger.md`). It is built as a separate follow-up PR stacked on this one (lane `servesize`, migration slot `20261222180000`), so this PR's scope is unchanged.
- The head named below (`7d3f8f2c3`) is the last call's. ~~The pushed head is `27faf423a`.~~ [~00:20Z: `612daa5a7` merges `origin/main` `63ce97e62` (#646 offbook). The only conflict was the README index rows, with both kept. The PR shares no other file with #646. Re-run at `612daa5a7`: guards 0, claims PASS, `ownership_between` = `[]`, 15 files. **This is the head to audit.**]

Lane `cellarledger`, PR-1 of 2 (#627). Branch `fix/cellar-till-and-door-checked-cost`, local head `7d3f8f2c3`. It contains `origin/main` `8e16fbcef` (#647), and its diff against `main` is 15 files. PR-2 (#628, `fix/cellar-door-checked-cost` @ `f8dde42e6`, AW14) is stacked on this PR's older head `e8db39c05`; its body is `p4-scratch/sim-run/fixes/pr/cellarledger-pr2.md`.

**Scope, stated up front.** This PR fixes A-016's record half and A-015 on the cocktail, soft-drink and bottled-beer rows. It does **not** close A-015 for rakı, spirits, draft beer and wine by the glass: Tuzlu's till adds a serve size to the menu's name, and how such a name joins its row is a founder fork (*Forks deferred*). It does **not** fix A-045 (AW14): #628 builds that.

### Last call (2026-10-05, `7d3f8f2c3`)

The verifier passed `1ef0cb24e` with six minors. This round:

- **Merge `1cacf6793`** brings in `origin/main` `8e16fbcef` (#647). The only conflict was `scripts/sql_outside_migrations.txt`, which is append-only, and both lines are kept. #647's migration (`old_pos_rows_carry_their_check_date`) defines none of this PR's functions and adds no trigger on `pos_checks` or `pos_unresolved_lines`.
- **Commit `7d3f8f2c3` narrows prose. No code changed**, and the migration body with comments stripped is identical to `1ef0cb24e`'s.
  - **"As on main" / "main's own boundary"** described the admit rule, and that was broader than the code. Main's `pour` read only the open queue (`resolved = false`). This PR admits a till-only name that the queue ever held, resolved or not, and only while `house_till_lines` holds a line of that exact name. Nothing in the code sets `resolved`: a grep of `apps/`, `services/`, `scripts/`, `supabase/migrations` and `supabase/functions` finds no write to it. This is fixed in the migration's header and `keys` comments, ADR 0301 §1 and Consequences, the ledger claims row's text (its verify is unchanged) and the README 0301 row. All of these are this branch's own round-2 words.
  - **"The ledger got faster"** held only on the builder's fixture, which had 2,000 queue rows. With an empty queue, as at Tuzlu Rüzgar, the verifier's local build measured about 35 ms before and about 175 ms after, on 20,000 checks (about 120,000 lines). ADR 0301 now says so, in brackets.
  - The README row's "cells stay blank" is now scoped to the sim's till feed, where it was measured.
- **The verifier's other minors:**
  - **Serve-size cells (product-open).** This is the founder fork below. A-015 is not called closed.
  - **`check_migration_order` against `8e16fbcef`.** It now fails, because main has a newer migration. This is expected under ADR 0235 (migrations are numbered at merge): see *Merge order*. Prose cites the migration by slug only. A version appears only in the two filenames and in their `sql_outside_migrations.txt` line, so the renumber is a pure rename plus that one line.
  - **No payload cap on the row record.** This is on purpose, as the brief asks, and it is listed under *Not covered*.
  - **Merge commits `87e0aa22c` and `a77025a73` have no trailer.** This is disclosed below. `1cacf6793` and `7d3f8f2c3` carry the trailer.

### What was wrong for the owner (Tuzlu Rüzgar, analytics walk 2026-10-03)

- **A-016 (major).** Yeni Rakı's record said "The till has not rung this up", though 436 singles and 67 bottles were rung in July and August. Çankaya (178.8 bottles poured) and Kılıç (100 units, $3,900) showed the same: 0 till lines.
- **A-015 (major).** On /cellar, Sold and Taken were blank on every house row of the six non-wine registers. That hid three things:
  - 2,152 cocktails, about $36.8K;
  - about 1,090 soft drinks on the seven soft-drink rows (1,290 with the booth's Uludağ);
  - every spirits, beer, whiskey and non-alcoholic row (poured null on 73 of 73).

  The app already counts these products elsewhere: `velocityPerDay` gives S.Pellegrino 13.5, Efes 9.867 and Yeni Rakı 2.133.
- **Root cause.** `pos_checks.items` keeps every line the till rang (pos-hub `ingest`), but two readers looked elsewhere:
  - **The ledger's `pour` CTE** read only `pos_unresolved_lines WHERE resolved = false` (migration `the_ledger_lists_only_the_current_menu`), the review queue. Two kinds of line never enter it: a mapped line whose sale volume resolves against this house's own item, and every non-wine line, which pos-hub skips before the queue. pos-hub does queue a mapped wine line in three cases: its mapping names another house's item, the read of the house's items failed, or its sale volume does not resolve.
  - **The row record** read that queue plus an unordered sample of 200 checks (`POS_CHECK_SCAN_LIMIT`), and it skipped every wine-flagged line.

### What changed and why

- **Migration `the_cellar_reads_the_tills_own_record`** is functions only. It has no INSERT, UPDATE or DELETE and no table change, so merging it writes no production row.
  - **`public.house_till_lines(p_restaurant_id, p_names text[] DEFAULT NULL)`** is the till's own record, one row per line, made of two halves:
    - every item of every `pos_checks` row that is not voided;
    - the `pos_unresolved_lines` rows with no check behind them, resolved or not, anti-joined on the check's unique key `(restaurant_id, source, external_check_id)`.

    A queued line whose check exists is counted once, from the check. A voided check's queued line leaves with its check. A qty or price that is not a number comes back NULL, never a cast error. A line is dated `closed_at`, else `opened_at`.
  - **`public.house_till_names(p_restaurant_id)`** returns the distinct names, each with its line count.
  - **Grants.** Both functions are `LANGUAGE sql STABLE` and SECURITY INVOKER. Both are revoked from PUBLIC, anon and authenticated and granted to service_role only, because `p_restaurant_id` is a parameter, which makes EXECUTE a tenancy boundary.
  - **`house_beverage_ledger`'s `pour`** reads `house_till_lines`, grouped by name first, so `beverage_house_key` runs once per name.
    - A product that any other book names gets the till lines whose name has the same `beverage_house_key` (the same words, in any order). That is how menu cocktails and colas get Sold and Taken.
    - A till-only name becomes a row only when the queue ever held it, resolved or not, and only while `house_till_lines` holds a line of it. Main's rule was "the open queue held it". A name whose every line sat on voided checks leaves with them (T2). Round 2 dropped an `is_wine` admit that made a row of every mapped, sized till name. Food the house never queued stays out; OD-113 and ADR 0115 own food.
    - Sold is still `sum(coalesce(qty, 0))` and Taken is still `sum(coalesce(price, 0) × coalesce(qty, 1))`, main's rules unchanged.
    - The signature, the 31 columns and the grants are unchanged (CREATE OR REPLACE). #606's menu CTE is carried verbatim.
- **Gateway, `BeveragesService.readTillLines`.** It reads `house_till_names` and matches names with `matchLine`, the rule the record's other four books use. It then reads `house_till_lines` for the matched names.
  - Each name is sent back exactly as `house_till_names` returned it (`rawTillName`). SQL `btrim` strips spaces only, while JS `trim()` also strips a tab or NBSP, so sending the trimmed name lost that name's lines.
  - Both reads are keyset-paged, 1,000 rows a page, until a short page. Nothing is sampled or capped.
  - A failed read leaves the book unreadable, never zero, and a missing function names the migration.
  - The record and the cell read the same till record but group names by different rules. The cell uses `beverage_house_key`; the record uses `matchLine`, the weaker rule that `ROW_RECORD_MATCH_RULE` states. So one row's lines can differ between the two (ADR 0301 §1, *Stated behaviours*).
- **Web copy.** The Sold and Taken column help (`cellar-columns.ts`) names the new record. It also says that a till name with a size ("(single 50ml)", "70cl bottle") is not counted in the cell and shows in the row's record. Stale comments are corrected in `row-record.ts`, `registerShapes.ts`, `cellar-format.ts` and `CatalogueRegister.tsx`.
- **Speed, local only.**
  - With 15,000 synthetic checks (about 59,000 lines) and 2,000 queue rows: 162-176 ms against 562-681 ms before (the verifier measured 141-157 ms against about 451 ms).
  - With 20,000 checks (about 120,000 lines) and an empty queue, Tuzlu's shape: about 175 ms against about 35 ms. It is slower, still well under a second.
  - `house_till_names` takes about 23-27 ms, and `house_till_lines` 8-36 ms for a few names.

### Tests, guards, harness

- **Local Postgres, re-run at `7d3f8f2c3` by the last call.** `pgtest.sh lane … cellarledger`, template `28d32de36`. Appended to `p4-scratch/sim-run/fixes/audits/cellarledger-local-pg.txt`:
  ```
  applied 5 migration(s) to cellarledger_fix
  [fix] PASS 20261222130000_the_cellar_reads_the_tills_own_record_test.sql
  [fix] PASS 20261222120000_the_ledger_lists_only_the_current_menu_test.sql
  [ctl] FAIL 20261222130000_the_cellar_reads_the_tills_own_record_test.sql: ERROR:  T1 FAIL the rakı reads pos_lines = 0, expected 1 (the till rang it once)
  [ctl] FAIL 20261222120000_the_ledger_lists_only_the_current_menu_test.sql: ERROR:  T1 FAIL the current menu's line reads menu_lines = 2, expected 1 (the archived copy is still counted)
  template=28d32de368d3f57df52ce6f490758908d9fa924d lane_migrations=5 tests=2
  ```
  - `lane_migrations=5` now includes main's #647 migration.
  - #606's menu test fails on `[ctl]` only because the template predates #606; it is run here as a `[fix]` regression check.
  - At `1ef0cb24e` the verifier's run also passed main's `an_order_letter_is_staged_once` and `a_pos_sale_is_dated_by_its_check` on `[fix]`.
  - A hand-built `[ctl2]` (template plus main's newer migrations, without this PR) also fails T1, so the failure comes from the fix, not from template drift.
- **What the SQL test pins (T1-T15):**
  - T1: the mapped rakı is sold.
  - T2: a voided check sells nothing.
  - T3: a menu cocktail gets Sold and Taken.
  - T4: food makes no row.
  - T5: a queued line whose check exists counts once.
  - T6 and T7: an orphan counts, even when resolved.
  - T8 and T9: the `p_names` filter and the name list.
  - T10: the current-menu rule survives.
  - T11: the browser roles cannot execute the functions.
  - T12: the signature is unchanged.
  - T13: an open check counts, and a qty that is not a number reads Sold 3 and Taken 16.
  - T14: every listed name returns its own lines when passed back as listed, including a name with a tab or NBSP at its edge.
  - T15: sized till names reach no cell and make no row, and `house_till_lines` still holds them.

  At `5d30e7c09`, split block by block, T4 and T12 pass on both `[fix]` and `[ctl]`, because they pin kept behaviour.
- **SQL mutations** (the verifier, at `1ef0cb24e`, in scratch DBs that were then dropped):
  - dropping `AND NOT c.voided` fails T2;
  - dropping the `NOT EXISTS` anti-join fails T2;
  - `admit = true` fails T4;
  - filtering the queue by `NOT resolved` fails T7;
  - dropping `* qty` from revenue fails T1;
  - empty keys fails T1.

  Two more:
  - The first build's migration (`ae35bf82d`, the `is_wine` admit) fails T15: `3 till-only names with a serve size read as ledger rows of their own, expected 0`.
  - Two T14 mutants (names regexp-trimmed in either function) fail T14.
- **Gateway jest** (`src/beverages src/cellar`, `--runInBand --forceExit`): 7 suites, 149/149 pass at `7d3f8f2c3` (re-run by the last call). With origin/main's `beverages.service.ts` swapped in (by the verifier), all 12 new till cases fail. Two of them:
  - "reads all 2,152 lines of a row across three pages, with no sample cap (A-015)";
  - "finds Tuzlu Rüzgar's own till names, which add a serve size to the menu's name (A-016)".
- **Web vitest** (`src/pages/cellar`): 15 files, 291/291 pass at `7d3f8f2c3`.
- **Typecheck and lint** (at `1ef0cb24e`; no TypeScript has changed since):
  - Gateway `tsc` shows only the known `@simplewebauthn/server` error, and web `tsc` only the known `@simplewebauthn/browser` error.
  - eslint reports 0 errors. The gateway's prettier warnings are not on lines this PR edited.
- **Guards at `7d3f8f2c3` (last call).** These exit 0:
  - `check_adr_numbers_unique` (1,726 refs)
  - `check_no_conflict_markers`
  - `check_citation_pairing`
  - `check_od_ids_exist`
  - `check_migration_versions_unique` (main plus 74 open PRs)
  - `check_migrations_single_home`
  - `check_decision_claims.sh` (882 of 882 holding)

  `check_migration_order` exits 1, because main has a migration newer than this one (*Merge order*).
- **Guards at `1ef0cb24e` (builder and verifier).** These exit 0:
  - `check_read_columns_exist`
  - `check_migration_probe_safety`
  - `check_money_states_its_currency`
  - `check_queried_tables_exist`
  - `check_read_errors_not_swallowed`
  - `check_new_tables_are_locked_down`
  - `check_no_seeded_defaults`
  - `check_web_reads_gateway_dto_keys`
  - `check_windowed_figures`
  - `check_fk_targets_exist`

  `--self-test` passes for migration_order, migration_versions_unique, adr_numbers_unique, no_conflict_markers, read_columns_exist, read_errors_not_swallowed and web_reads_gateway_dto_keys.
- **CLAIMS mutations.** Each edited row was mutated in a scratch copy, and each unmutated row exits 0.
  - `CELLAR-LEDGER-SOLD-READS-THE-TILLS-OWN-RECORD` exits 1 when:
    - `is_wine` goes back into `till`;
    - the `pour` admit is changed;
    - the admit becomes `true AS admit`;
    - (at `5d30e7c09`) `WHERE admit` is dropped;
    - (at `5d30e7c09`) `till` is pointed at the queue;
    - (at `5d30e7c09`) `resolved = false` is added;
    - (at `5d30e7c09`) the migration is removed.
  - `CELLAR-ROW-RECORD-TILL-BOOK-IS-PAGED-NOT-SAMPLED` exits 1 when:
    - either loop goes back to `seriesStr(r.item_name)`;
    - the names loop trims;
    - `rawTillName` trims;
    - `.limit(200)` is used.
  - `CELLAR-TILL-LINES-ARE-THE-TILLS-OWN-RECORD` exits 1 when `AND NOT c.voided` is removed.
  - `ADR-0160-Q9-NON-ALCOHOLIC-HEATMAP-LIVE-SALES` exits 1 when the rpc is renamed.

  The last call changed only one row's claim text, not its verify.
- **Ownership.** `pr_audit_gate.ownership_between('.', 'origin/main', 'HEAD')` returns `[]` at `7d3f8f2c3`.

### ADR and CLAIMS touched

- **ADR 0301 (new).** §1 is this PR. §2 records the AW14 ruling, which #628 builds. *Fork deferred* holds the serve-size join.
- **ADR 0108.** Only its Links line changes, noting the amendment to its books table.
- **`.planning/decisions/README.md`.** One new row, 0301 (this branch's own row). No existing row is edited.
- **`CLAIMS.jsonl`.** The row `ADR-0160-Q9-NON-ALCOHOLIC-HEATMAP-LIVE-SALES` is corrected in place, in brackets. Its "is_wine left to the unresolved queue" half was the A-016 defect.
- **`claims.d/fix-cellar-till-and-door-checked-cost.jsonl`.** Three new rows, each mutation-tested.

### Founder answers

- **AW10 is a defect fix, not a fork.** ADR 0160 item 7 (Q9) already ruled that live sales reach the cellar.
- **AW14**, AskUserQuestion 2026-10-04 ~00:30Z, verbatim pick: *"Door-checked, labelled (Recommended)"*. ADR 0301 quotes it, and #628 builds it. A-045 stays open until #628 merges.
- The lane brief lists no other founder fork for this lane.

### Forks deferred

**How a till name with a serve size joins its row** (ADR 0301, *Fork deferred*). This is the founder's call and is not built. The ledger joins a till name to a row only when the two `beverage_house_key`s are equal, so 'Yeni Rakı (single 50ml)' reaches Yeni Rakı's record (`matchLine`, 'contains') but not its Sold and Taken.

Measured on the sim's feed (`p4-scratch/sim-run/rebuild/run/feed/pos-*.json`, 92 days, keyed on a local build; not production). The verifier reproduced it.

| The feed's category | Till names | Lines | Reach their menu row's cell on this branch |
|---|---|---|---|
| Cocktails | 11 | 3,410 | 10 names, 3,367 lines |
| Non-alcoholic | 20 | 4,269 | 18 names, 4,265 lines |
| Beer | 12 | 4,189 | the 8 bottled names, 1,393 lines; none of the 4 draft names, 2,796 lines |
| Rakı | 24 | 2,175 | none |
| Spirits | 25 | 1,211 | none |
| Wine | 81 | 5,727 | none |

The 'Efes Pilsen' row has two menu lines (draft and packaged), and it will read only its packaged lines: about 479, against about 1,828 sold in all.

1. **Equal keys (built; main's join rule).** It costs the blank rakı, spirit, draft-beer and wine-by-the-glass cells.
2. **Containment, the record's own rule.** A till name joins the most specific row whose key words it contains, and a tie joins none. On the feed it joins every beer, rakı and spirit line, and 5,510 of 5,727 wine lines (2 wine names tie). It costs two things:
   - Sold adds singles, bottles and glasses into one count, unless it is split by the mapping's `sale_unit` / `sale_volume_ml`, which a mapped `pos_checks.items` line carries.
   - A cocktail named after a spirit that no book names would join the spirit's row.
3. **Strip serve-size words before keying** ('single', 'bottle', 'glass', 'draft', '50ml', '70cl' and so on). That is a word list to keep in SQL, with the same Sold-units cost as option 2.
4. **Join by the POS mapping's stock item** (`inventory_id`), by identity, as ADR 0115 does. It covers mapped lines only, so cocktails stay on equal keys.
5. **A row of its own per sized name** (the first build). It is true but split, and sits beside a blank menu row.

**Recommendation: option 2.** Taken is summed, and Sold is split into bottles and pours by sale unit, following his units pick for /communications (*"Bottles · glasses (Recommended)"*, 2026-10-04). T15 pins today's answer, so building the chosen option changes T15 on purpose. Either answer is a follow-up on top of this PR; merging this one first narrows no option. PR-2 carries its own forks (see its body).

### Merge order

1. **Renumber at merge (ADR 0235).** This migration's version now sorts before main's newest (#647's), so `check_migration_order` fails until the serial merge step moves it past `origin/main`'s newest. Three things move: the migration file, its `supabase/tests` file and the matching `scripts/sql_outside_migrations.txt` line. No ADR, claims row, README row or comment cites the version. The migration defines no function that #647 or any other open PR's migration defines, except #628's, so order relative to them does not matter.
2. **This PR merges before #628.** #628 is stacked on `e8db39c05`. It has to take this PR's final head (`git rebase --onto origin/main` after this merges), and its migration `the_cellar_counts_the_door_checked_price` has to be renumbered past this one. No open PR other than #628 shares a code file with this one. #628 shares ADR 0301, `cellar-columns.ts`, `cellar-format.ts` and `sql_outside_migrations.txt`.
3. **Shared ledger files only** (checked with `gh` across the open PRs):
   - `README.md` adds one row; keep both rows by number.
   - `CLAIMS.jsonl` corrects one row. #561, #569, #614, #621 and #626 touch other rows.
   - `scripts/sql_outside_migrations.txt` is append-only. #617, #618, #620, #621, #626 and #628 also append to it.
4. **The iswine lane** (no PR yet). The ledger's admit no longer reads `is_wine`, so that lane's re-flag does not change which names are rows here.

### Not covered (CLAUDE.md §0.5)

- **A-015 is partly fixed, and A-045 is not fixed by this PR.**
  - On the sim's feed, the rakı, spirit, draft-beer and wine-by-the-glass cells stay blank until the founder picks a join (*Forks deferred*).
  - #628 builds A-045. It was not verified, rebased or renumbered by this lane's last rounds.
- **Production.** Nothing was read, measured or written there. It is not known how many of Tuzlu's rows gain Sold and Taken, or whether production's till names match the sim feed's. The two read-only queries below are for the coordinator to ask the founder about; neither was run, not even locally.
  ```sql
  -- 1. How many lines the ledger reads now, against what it read before.
  SELECT (SELECT count(*) FROM public.pos_checks c
            CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.items)='array' THEN c.items ELSE '[]'::jsonb END) li
           WHERE c.restaurant_id = '<tuzlu id>' AND NOT c.voided) AS till_lines_now_read,
         (SELECT count(*) FROM public.pos_unresolved_lines u
           WHERE u.restaurant_id = '<tuzlu id>' AND NOT u.resolved) AS open_queue_lines_read_before;

  -- 2. Which distinct till names key to a current-menu line, the way the ledger keys them
  --    (pos_checks only, voided excluded; mirrors house_till_lines' check half and the ledger's menu CTE).
  WITH t AS (SELECT btrim(li.item->>'name') AS item_name, count(*) AS lines
               FROM public.pos_checks c
               CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.items)='array' THEN c.items ELSE '[]'::jsonb END) li(item)
              WHERE c.restaurant_id = '<tuzlu id>' AND NOT c.voided
                AND jsonb_typeof(li.item) = 'object' AND btrim(coalesce(li.item->>'name','')) <> ''
              GROUP BY 1),
       m AS (SELECT DISTINCT public.beverage_house_key(mi.producer, mi.name) AS k
               FROM public.menu_items mi
               JOIN public.restaurant_menus rm ON rm.id = mi.menu_id AND rm.restaurant_id = mi.restaurant_id AND rm.status = 'active'
              WHERE mi.restaurant_id = '<tuzlu id>' AND mi.status <> 'discarded' AND btrim(coalesce(mi.name,'')) <> '')
  SELECT t.item_name, t.lines, public.beverage_house_key(NULL, t.item_name) AS k,
         EXISTS (SELECT 1 FROM m WHERE m.k = public.beverage_house_key(NULL, t.item_name)) AS keys_to_menu
  FROM t ORDER BY t.lines DESC;
  ```
  Query 2 copies the shapes of the ledger's `menu` and `pour` CTEs. It counts names against the menu only, not against the order, invoice or quote keys.
- **Speed** was measured on local synthetic seeds only. With an empty queue (Tuzlu's case) the ledger is slower than main's, about 175 ms against about 35 ms on 120,000 lines.
- **The row record's till book has no payload cap.** It is paged, not sampled, as the brief asks. Tuzlu's largest row is about 2,152 lines, but a line sold tens of thousands of times would ship every line, with its price and quantity series. Paging also relies on PostgREST `max_rows` being at least 1,000: `supabase/config.toml` says 1000, and production's value was not read. Each page re-runs the function for the matched names.
- **Guards that need a database or a deploy URL were not run:**
  - `check_definer_functions_closed`;
  - `check_beverage_identity_parity` (it needs `.env`);
  - `check_beverage_kind_regression`;
  - `check_display_name_parity`;
  - `check_migration_ledger`;
  - `check_house_item_invariants`;
  - `check_deployed_sha`;
  - `check_web_deployed_sha`.

  Read directly on the local DB, the three functions are `prosecdef = false`, with EXECUTE for `postgres` and `service_role` only. T11 pins the browser roles' lack of EXECUTE.
- **The last call did not re-run some checks after its own commits:**
  - `tsc`, eslint and the `1ef0cb24e`-only guards. Its commits change SQL comments and Markdown/JSONL prose only.
  - The SQL mutations, because the migration body is identical with comments stripped.
- **The open-PR migration overlap check** (no other open PR's migration defines `house_beverage_ledger`, `house_till_lines`, `house_till_names` or `beverage_house_key`, except #628's) read the 9 open PRs' migration files from local remote-tracking refs, which may be older than their current heads. The refetch failed on a shell quoting error and was not retried. The file-level overlap list comes from `gh` and is current.
- **No Browser-pane check** of the rendered cells. The web change is column-help copy and comments only, and the vitest DOM tests stand in for it.
- **Behaviours inherited from main and not changed:**
  - Mapped sales on the Toast direct path are not counted: that path writes no `pos_checks` row and queues only some lines.
  - Mixed currencies inside one row's Taken are not converted.
  - Sale dates are `closed_at`, else `opened_at`, not the house's day (ADR 0296, #616).
  - The record's `matchLine` is loose: 'Yeni Rakı Âlâ' lines show in Yeni Rakı's record. This is stated in ADR 0301 and pinned by jest.
- **The pgtest template** is at `28d32de36` and was not rebuilt, as instructed.
- **Scratch databases.** `cellarledger_fix`, `cellarledger_ctl`, `cellarledger_ctl2`, `cellarledger_scratch`, `cellarledger_perf2`, `cellarledger_vperf` and `cellarledger_ctlc` are left on the local `fixlane-pg`. All mutation databases were dropped.
- **Merge commits `87e0aa22c` and `a77025a73`** were made without a co-author trailer. History is not rewritten.
- **Nothing was pushed.** #627's remote head is still `e8db39c05`, so CI and the audit gate must run again on `7d3f8f2c3`, or on its renumbered successor.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
