**F2 redate lane.** Branch `fix/old-pos-rows-carry-their-check-date`, opened against `main` (`155960b59`). 5 files, 10 commits on the branch:
- `179c5474c`: the build.
- `c7b24101b`: merges `origin/main` `8fdb819b4` (#606).
- `2356d70c9`, `dbc7cc9cc`, `20d0bc79a`: ADR and claims wording, no code.
- `333bc572d`: merges `origin/main` `eaa479c93` (#608). No conflict.
- `2e35b55e8`: **fork 1, "never move a row later"**. The migration, its test and the dry run's classification.
- `caf28e890`: a test fix (T8's L19 target). No code change.
- `c01d37949`: merges `origin/main` `155960b59` (#645). Web files only.
- `0371df1a0`: the ADR 0281 note and claims rows for forks 1 and 2.

It is not pushed.

**Last call (final say), 2026-10-05: SHIP at `0371df1a0`.** The branch is ready to open and to go through its ADR 0090 audit. **Do not merge until the coordinator's F2 re-count fills the placeholder below.** [2026-10-05 19:15Z: filled; the re-count shows `shift_max` < 0 in every row and none of the four other outcomes.] Founder answer 4 says neither PR can merge safely without these reads. The re-count must show `shift_max` ≤ 0, or NULL, everywhere, and no row that is `no check`, `check open`, `unreadable` or `ambiguous` where this morning's count had none.

## THIS PR WRITES PRODUCTION ROWS WHEN IT MERGES

Supabase applies migration `old_pos_rows_carry_their_check_date` when this PR merges. Applying it re-dates POS stock and consumption rows in production. It is the write the founder said yes to (answers below), built with his two later answers: a row is only ever moved earlier, never later, and the undo stays until he says otherwise.

**What this morning's count said it would change.** Production, read-only, 2026-10-05 at about 14:07Z (`p4-scratch/sim-run/fixes/audits/prod-dryruns-2026-10-05.md`). That run used the classification as it was before fork 1. It counted **10,684 rows**:

| House | Consumption | Glass-pour ledger | Keyed ledger | How far they move |
|---|---|---|---|---|
| Tuzlu Rüzgar | 7,026 | 694 | 2,763 | 32 d 15 h to 92 d 16 h earlier: the July–Sept quarter moves off its import days |
| Sim Bistro, Sim Meyhouse, Sim Vanilla Kaleiçi | 116 | 44 | 41 | each stays on the same house day |

That count also found:
- 4 rows already right (Sim Bistro);
- no row that is `no check`, `check open`, `unreadable` or `ambiguous`;
- `partition_ok` true everywhere.

Tuzlu's and Sim Bistro's moves were all earlier, so fork 1 changes none of them. Sim Meyhouse's and Sim Vanilla Kaleiçi's were recorded as under 2 seconds, with no sign. Any of them that was a later move now reads `already` and is not written. The re-count below settles the numbers.

**The F2 re-count under fork 1 (c), production, read-only. The coordinator runs it, not this lane:**

**Filled 2026-10-05 by the coordinator (server `now()` 19:15:37Z), production, read-only.** The fork-1 file (lines 129-141 and 145-312), each call prefixed with `set local transaction_read_only = on`; result 1 read `read_only = on`. The dry run's CASE and the migration's (`…_old_pos_rows_carry_their_check_date.sql:264-275`) compared whitespace-normalised: identical but for the trailing comma. Full per-house table: round 3 of `p4-scratch/sim-run/fixes/audits/prod-dryruns-2026-10-05.md` (outside the repo).

| All houses | Scanned | would_change | already | shift_min | shift_max |
|---|---|---|---|---|---|
| consumption | 7,145 | 7,142 | 3 | −92 d 16:22:59 | **−0.64 s** |
| ledger (glass pour) | 738 | 738 | 0 | −92 d 16:22:59 | **−0.51 s** |
| ledger (key) | 2,805 | 2,804 | 1 | −92 d 16:22:58 | **−0.53 s** |

- `no_check`, `check_open`, `unreadable_closed_at` and `ambiguous` are 0 in every house and kind; `partition_ok` is true in every row.
- `shift_max` is negative in every house and kind, so every row the migration writes moves earlier.
- 10,684 rows change, the same as this morning's round-1 count: fork 1 changes none of production's rows.
  - Tuzlu Rüzgar: 10,483, all more than 30 house days earlier (−32 d to −92 d).
  - Sim Bistro: 89, within the same house day (−33 min to −8 h 14 min).
  - Sim Meyhouse: 89; Sim Vanilla Kaleiçi: 23. All of them −0.5 s to −1.6 s, earlier.
- The 4 `already` rows are 3 Sim Bistro consumption rows and 1 Sim Bistro ledger key row. Sim Bistro also has 1 `:void` ledger key row; the count does not say whether it is the `already` one.

How to run it:
- File: `p4-scratch/sim-run/fixes/tools/postime-f2-dryrun.sql` (outside the repo, 314 lines), the same way as this morning.
- Inside `BEGIN TRANSACTION READ ONLY` (the file opens one at line 124), or `set local transaction_read_only = on`.
- Strip the psql meta-commands, or run it whole in psql.
- The SQL bodies are at **lines 129-141** (result 1, what the session can see) and **lines 145-312** (result 2, the count).
- Its outcome CASE (lines 204-215, the fork-1 `already` at 210-213) is the migration's classification. A whitespace-normalised comparison of the two CASE blocks returns equal. The migration writes exactly the rows it reports as `would_change`.

**`shift_max` can no longer be positive.** Fork 1 makes a row `change` only when one of its dates is after its target:
- On ledger rows, the shift is negative.
- On consumption rows, the shift is measured on `created_at`, which is never before its target, so it is ≤ 0.
- It is empty when nothing changes.

A positive `shift_max` therefore means the file run was not the fork-1 version (the pre-fork-1 copy is kept beside it as `postime-f2-dryrun.pre-fork1.sql`).

**Triggers and rules on the two tables.** At about 16:10Z on 2026-10-05, the migration's own halt query, run read-only on production, returned **none**. The coordinator ran it; this lane has no production access. The query:

```sql
begin;
set local transaction_read_only = on;
select format('trigger %s on %s', t.tgname, t.tgrelid::regclass)
  from pg_catalog.pg_trigger t
 where t.tgrelid in ('public.inventory_transactions'::regclass, 'public.wine_consumption_log'::regclass)
   and not t.tgisinternal
union all
select format('rule %s on %s.%s', r.rulename, r.schemaname, r.tablename)
  from pg_catalog.pg_rules r
 where r.schemaname = 'public'
   and r.tablename in ('inventory_transactions', 'wine_consumption_log');
rollback;
```

If a trigger or rule is added after that read and before the merge, the migration raises `old_pos_rows_carry_their_check_date: trigger … — nothing was re-dated` and fails to apply. That would leave production's migrations behind `main` until it is fixed.

**Undo.** It stays in production, owner-only, **with no end date, until the founder says otherwise** (fork 2, answered below). Run it as the database owner, in the SQL editor or psql:

```sql
SELECT public.undo_pos_rows_redate();           -- every run, newest first
SELECT public.undo_pos_rows_redate('<run_id>');  -- one run; run_id is in the migration's NOTICE and in pos_row_redate_undo
```

It restores every row that still carries what the re-date gave it. A row whose date changed since is left alone and counted in `left_as_is`.

**After the merge, a read-only check (as the owner, in a READ ONLY transaction).** `pos_row_date_by_check()` is STABLE, writes nothing, and is the same classification as the dry run:

```sql
begin;
set local transaction_read_only = on;
select row_kind, outcome, count(*) from public.pos_row_date_by_check() group by 1, 2 order by 1, 2;
select run_id, row_kind, count(*) from public.pos_row_redate_undo group by 1, 2 order by 1, 2;
rollback;
```

Expect no `change` rows. The undo lines should equal the NOTICE's `changed`, split by kind as the re-count split `would_change`. A check re-sent to an earlier close after the merge would show up as `change`, which is the only way one can appear.

## What was wrong for the owner

#603 (ADR 0281) dates every new POS stock and consumption row by its check's `closed_at`. Rows written before it carry the moment they were typed in.

On Tuzlu Rüzgar, the owner-quarter sim back-filled July to September in a few October sittings. So these readers still see a handful of import days instead of a quarter of trading:
- /inventory velocity and runway (`inventory_analytics`, 30-day window);
- /reports' week shape;
- the 14-day forecast;
- the pour and consumption charts.

The founder's own words for the outcome: "Tuzlu's July–Sept stock, pour and consumption charts then show each sale on its real day."

## What changed, and why

**Migration `old_pos_rows_carry_their_check_date`.** Version `20261222140000`, after everything on `main` at `155960b59` (newest there: `20261222120000`).

0. **Halt.** If either table has a non-internal trigger or a rule, the migration raises before anything is created or written. Nothing is disabled.
1. **`public.pos_row_redate_undo`.** One line per re-dated row: `run_id`, `redated_at`, table, kind, row id, house, check, key, the old `transaction_date` / `recorded_at` / `created_at`, the new date, and `undone_at`.
   - Constraints: UNIQUE `(run_id, row_table, row_id)`, and a ledger line must hold its old `transaction_date`.
   - RLS is on with no policy. `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`.
   - **Why a table and not row metadata:** `wine_consumption_log` has no jsonb column, and `inventory_transactions.metadata` is read by the glass-pour link, the correlation index and /logs. Writing into it would change a row beyond its dates.
2. **`public.pos_row_date_by_check()`** (SQL, STABLE, SECURITY INVOKER, `search_path = ''`). It is the dry run's classification, copied verbatim:
   - the three row sets:
     - keyed ledger `pos:`;
     - the keyless glass-pour ledger row, linked to its `pour_events` row by house, item and the shared `created_at`;
     - consumption `notes` `pos:` (legacy `pos:pos:` read via substr);
   - the join to `pos_checks` on the key's prefixes;
   - the strict per-adapter reading of the till's own string in `raw`;
   - the outcome order: out of scope → ambiguous → no check → check open → unreadable → already → change;
   - the target `LEAST(pos_checks.closed_at, the row's created_at)`.

   **Fork 1, "Never move a row later".** A row is `already` when every date the re-date writes is at or before its target. For a ledger row that is `transaction_date`; for a consumption row it is `recorded_at` and `created_at`:

   ```sql
   WHEN m.cur <= LEAST(c.closed_at, m.entry)
    AND (m.tbl <> 'consumption' OR m.cur2 <= LEAST(c.closed_at, m.entry))
     THEN 'already'
   ```

   A NULL `recorded_at` reads `change` and is filled with the target. Before fork 1 the test was equality, so a row sitting before its target read `change` and moved later.
3. **`public.redate_pos_rows_by_check()`.** One statement with MATERIALIZED CTEs on one snapshot:
   - It logs every `change` row into the undo table.
   - Ledger: `SET transaction_date = LEAST(it.transaction_date, c.target)`.
   - Consumption: `SET recorded_at = LEAST(w.recorded_at, c.target), created_at = LEAST(w.created_at, c.target)`.

   So each date becomes the earlier of itself and the target. A consumption row whose `recorded_at` is already earlier keeps it while its `created_at` moves. For the ledger, LEAST writes the same value as the target, because a `change` ledger row's `transaction_date` (NOT NULL) is after its target; it is there so the rule reads the same on every column.

   It returns the counts and raises if logged ≠ changed ≠ updated. It writes no other table or column: never `pos_checks`, `pour_events`, `inventory_transactions.created_at`, quantities or lots.
4. **`public.undo_pos_rows_redate(p_run_id uuid DEFAULT NULL)`.**
   - It walks runs newest first.
   - It restores a ledger row only while its `transaction_date` still equals the new date.
   - It restores a consumption row only while its `recorded_at` and `created_at` still equal `LEAST(old, new_date)`, i.e. what the re-date gave them.
   - It marks `undone_at` and counts `left_as_is`.
5. **The run.** The migration calls the re-date once and raises a NOTICE with its result. It then asserts that every logged line carries what the write gave it (`LEAST(old, new_date)` on consumption) and halts if one does not.

All three functions and the table stay, owner-only (`REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`), **with no end date, until the founder says otherwise** (fork 2).

**Why glass pours too.** The answer names pour charts. A glass's consumption row is re-dated either way, so skipping its ledger row would put one glass's stock and consumption up to 92 days apart.

**Safety, as established:**
- **Triggers.** `supabase/migrations` defines none on either table: the baseline and every later file were read on 2026-10-05. No open PR adds one (measured on every open PR head, 2026-10-05). Production returned none at about 16:10Z (above). An UPDATE of these dates therefore re-applies no stock and fires nothing. Stock lives on `inventory_lots`, moved only by the two RPCs.
- **Derived data.**
  - **Recomputes on read:** `inventory_analytics` (a view) and `get_inventory_balance_at` (a function).
    - A moved ledger row keeps the `quantity_after` it was written with, a running balance in entry order. So `get_inventory_balance_at` can read wrong for an instant inside a re-dated span, the caveat ADR 0281 already states under Consequences.
    - Its one caller is the gateway route `GET inventory-ledger/inventory/:inventoryId/balance` (`inventory-ledger.controller.ts:179`). No web, mobile or services code calls that route (grep, 2026-10-05).
  - **`analytics_insights`** (a stored cache) is replaced at each category's next cadence run.
  - **`analytics_goals.current_value`** is rewritten on every progress read.
  - **`inventory_transaction_summary`** (a materialized view) has no reader in the repo, and nothing in the repo calls its refresh function. A Celery beat entry names `reports.refresh_views`, a task no code in the repo defines. It is not refreshed here.
- **Idempotent.** A re-dated row then classifies `already`. Run 2 in the test changes 0.
- **Rows #603 wrote stay where they are, except after a re-send to an EARLIER close.** That case moves the ledger and consumption rows together (test T8, L2 and C2). The two cases that used to move a #603 row later now read `already` and are not written:
  - a check re-sent to a later close;
  - a check whose `closed_at` was a few ms ahead of the database's clock at import.

  The test pins both (T1 and T8), and so does the probe re-run (below).
- **Bounded.** One set-based statement, with no per-row loop.

## Founder answers (verbatim, binding)

1. ADR 0281 F2, 2026-10-05 (AskUserQuestion): **"Dry run, then your yes (Recommended)"**. The option text: "I build a read-only count of the rows a re-date would change (by house and day shift), show it to you, and nothing is written until you say yes."
2. Running the count, 2026-10-05: **"You run both, read-only (Recommended)"**.
3. The write, 2026-10-05 at about 14:15Z, asked with the counts above: **"Re-date all, keep undo (Recommended)"**. The option text: "I build the write as its own small PR (script, test, ADR 0281 note), which saves each row's old date so it can be undone. It runs on production once its audit passes. Tuzlu's July–Sept stock, pour and consumption charts then show each sale on its real day."
   - Rejected: "Skip glass pours" (stock and consumption for one glass would disagree by up to 92 days) and "Leave old rows".
4. Production reads before merge, 2026-10-05 at about 16:00Z (AskUserQuestion): **"Yes, all three read-only (Recommended)"**. The option text: "Same way as this morning: inside READ ONLY transactions, counts saved to a file and shown to you. Nothing is written. Without them, neither PR can merge safely: the re-date stops on merge if a trigger exists, and the tables count of ~40 is only an estimate."
   - It covers the F2 re-count including `shift_max`, the trigger/rule query, and the tables dry run under the digit rule. The first two are this PR's. The trigger/rule query is done (none). The re-count is the placeholder above.
5. Fork 1, later moves: **"Never move a row later (Recommended)"**. The option text: "One more condition plus a test per case. Each row then either moves earlier or stays put, so stock and consumption for a glass always stay together. This morning's count found only earlier moves, so production gets the same rows either way. Cost: about 2 files in the same PR."
   - Rejected: "Keep as built" and "Skip rows written after this morning".
6. Fork 2, undo life: **"Until you say otherwise (Recommended)"**. The option text: "About 10.7k small rows. The undo stays one call away and costs almost nothing to keep."
   - Rejected: "Drop it after a set time".

## Forks deferred

**None.** Both forks this PR used to defer were answered at about 16:00Z (answers 5 and 6) and are built: fork 1 by `2e35b55e8`, fork 2 by keeping the undo with no end date. An earlier version of this body recommended (c) for fork 1 as a deferred choice. That recommendation is gone: (c) is now the founder's answer.

## Tests, guards and the local Postgres run

Everything below ran in the local Docker Postgres `fixlane-pg` (PostgreSQL 17.11), on synthetic fixtures, rolled back or on scratch databases dropped after. The full output is appended to `p4-scratch/sim-run/fixes/audits/f2redate-local-pg.txt`; the fork-1 rework is its section "Fork 1 rework", R1-R8.

**The harness, re-run by the last call at HEAD `0371df1a0`.** It gives the same result as at `caf28e890`. Nothing under `supabase/` changed after that commit, and `main`'s `155960b59` adds no migration beyond the template's three:

```
$ bash p4-scratch/sim-run/fixes/db/pgtest.sh lane /Users/aldemirkonuk/Projects/wt-fix-f2redate f2redate /Users/aldemirkonuk/Projects/wt-fix-f2redate/supabase/tests/20261222140000_old_pos_rows_carry_their_check_date_test.sql
applied 4 migration(s) to f2redate_fix
[fix] PASS 20261222140000_old_pos_rows_carry_their_check_date_test.sql
[ctl] FAIL 20261222140000_old_pos_rows_carry_their_check_date_test.sql: ERROR:  T0 FAIL public.pos_row_redate_undo does not exist
template=28d32de368d3f57df52ce6f490758908d9fa924d lane_migrations=4 tests=1
```

The 4 lane migrations apply in order: `an_order_letter_is_staged_once`, `a_pos_sale_is_dated_by_its_check`, `the_ledger_lists_only_the_current_menu`, then this one.

At the first fork-1 commit `2e35b55e8`, the harness failed T8 ("1 of L19 and C15 read already"). It was the test's fault. L19's `created_at` (09-11 07:00Z) is after the re-sent close (09-10 20:00Z), so its target is 20:00Z, not 18:00Z. `caf28e890` corrects the expectation; the code is unchanged.

**What the test covers** (`supabase/tests/20261222140000_old_pos_rows_carry_their_check_date_test.sql`). One transaction, raises on failure, rolls back. Its fixtures are 47 rows in two houses (Istanbul and LA):
- by outcome: 19 change, 12 already, 3 no check, 2 check open, 5 unreadable, 3 ambiguous, 1 out of scope, 2 not POS;
- keyed, glass-pour and consumption rows;
- a void;
- a legacy `pos:pos:` note;
- a zone-less till string;
- Square, Clover and Toast checks;
- rows written by the real `apply_stock_movement` and `record_glass_pour` both without and with `p_occurred_at` (pre- and post-#603 shape).

The new fork-1 cases, one per probe case:
- **A later re-send** (L19 and its consumption row C15): neither moves (T8).
- **A `closed_at` a few ms ahead.** Rows booked by the real functions with the gateway's clock 20 ms behind the database's `now()` (L23, G6, C17) all read `already` (T1, T4).
- **A consumption row whose `recorded_at` is already before its target** while its `created_at` is late (C16): `created_at` moves and `recorded_at` stays (T3).

| Step | What it checks |
|---|---|
| T0 | The ACL: owner-only table and functions, RLS on, not definer, no triggers. |
| T1 | Each row's outcome, target, table, kind, check and key. |
| T3 | Run 1 = 19 (12 ledger, 7 consumption), each date exactly its expected value, none later than it was. |
| T4 | Every non-change row is byte-identical, and each change row differs only in its dates. |
| T5 | `pos_checks`, `pour_events` and lots are unchanged. |
| T6 | The exact undo lines. |
| T7 | Run 2 = 0, and every former change row reads `already`. |
| T8 | Re-sent checks give run 3 = 2: an earlier close moves L2 and C2; a later close moves neither L19 nor C15. |
| T9 | Hand edits to L3 and C7, then undo: 12 ledger and 7 consumption restored, 2 `left_as_is`. |
| T10 | Everything else is byte-identical to the snapshot, and a second undo restores 0. |

Its own results, printed before the rollback (R7):
- run 1: `changed 19, ledger_updated 12, consumption_updated 7`;
- run 2: `changed 0`;
- run 3: `changed 2` (L2, C2);
- undo 1: `{"runs": 2, "left_as_is": 2, "ledger_restored": 12, "consumption_restored": 7}`;
- undo 2: 0 restored.

**The new test on the OLD code (R1).** The migration at `20d0bc79a` (identical at `333bc572d`) on a scratch clone, with every failing block reported:

```
ERROR:  T1 FAIL G6 is change, expected already; L23 is change, expected already
ERROR:  T3 FAIL run 1 changed 21 rows, expected 19 fixture + 0 other; C16 … expected 2026-08-20 12:00:00+00 and 2026-08-23 18:00:00+00; C16 moved later; L23 moved later; G6 moved later
ERROR:  T4 FAIL L23 (already) was written: …
ERROR:  T6 FAIL run 1 logged 21 lines
ERROR:  T8 FAIL run 3 changed 3 rows, expected L2 and C2; … L19 moved to 2026-09-10T20:00:00+00:00 on a later re-send; run 3 logged 3 lines, expected 2
ERROR:  T9 FAIL undo reported {"runs": 2, "left_as_is": 2, "ledger_restored": 15, "consumption_restored": 7}, expected 12 ledger, 7 consumption, 2 left as is
```

**The last-call probe, re-run (R4).** Script `audits/f2redate-lastcall-edge-probe.sql`, old code against new:

| Row | Old code (`20d0bc79a`) | New code (`caf28e890`) |
|---|---|---|
| ledger, `closed_at` 50 ms ahead (`f2lc-future`) | `change` | `already` |
| ledger, re-sent one day later (`f2lc-resend`), after the re-send | `change` (−3 d → −2 d) | `already` |
| both consumption rows | `already` | `already` |

**Migration mutants (R5).** Each is a copy of the migration on a clone:

| Mutant | Fails |
|---|---|
| `c_only`: the classification back to equality | T1, T3, T6, T7, T8, T9 |
| `consumption_least`: consumption written to the target, not LEAST | T3, T9, T10 |
| `undo_guard`: the undo guard back to `= new_date` | T9, T10 |
| `ledger_least`: ledger written to the target | **none**: an equivalent mutant (a `change` ledger row's date is after its target, so both texts write the same value). The claims row pins the LEAST text. |

The earlier mutation set (12 of 13 caught; M6, `service_role` dropped from the table REVOKE, survives on a plain local database) is in the audit file's first section. It was not re-run on the fork-1 code.

**The dry run against the migration's real effect (R6).** Scratch db `f2redate_dry`: `main_tpl`, the three earlier lane migrations, then the dry run's fixtures `postime-f2-dryrun-fixtures.sql` plus `postime-f2-dryrun-fixtures-later.sql`. The latter is new and adds four rows: a later re-send, a clock-ahead glass pour, a consumption row with an early `recorded_at`, and one with no `recorded_at`. ALL HOUSES, change / already:

| Kind | Pre-fork-1 dry run, before | Fork-1 dry run, before | After the migration | After the undo |
|---|---|---|---|---|
| ledger (glass pour) | 3 / 0, `shift_max` +20 ms | 2 / 1 | 0 / 3 | 2 / 1 |
| consumption | 10 / 4 | 10 / 4 | 0 / 14 | 10 / 4 |
| ledger (key) | 17 / 3, `shift_max` +13 h | 16 / 4 | 0 / 20 | 16 / 4 |

- **The migration's NOTICE:** `changed 28, ledger_updated 18, consumption_updated 10`.
- **After the migration:** every logged row (2 + 10 + 16) is at its new date, and none moved later. The two later-target rows (`h1-later`, `h2-ahead`) read `already` before it and were not logged. `h1-mixed` keeps its `recorded_at` (08-20 12:00) while its `created_at` moves to the target. `h1-nullrec` gets the target.
- **After the undo:** `{"runs": 1, "left_as_is": 0, "ledger_restored": 18, "consumption_restored": 10}`. Every count is back to "before". The md5 over every column of the four tables, ordered by id, is `746adbd0187284c72cedff4d856d504d` before the migration and after the undo.
- **`shift_max` is negative or NULL in every fork-1 row.** The pre-fork-1 consumption `shift_max` (−01:30) could not show `h1-mixed`'s `recorded_at` moving later, because shift is measured on `created_at`.
- **The step-5 landing check's mutant.** Put back as at `20d0bc79a` (`= new_date` on both columns), it halts the migration on the same fixtures: `ERROR: old_pos_rows_carry_their_check_date: 1 logged rows do not carry their new date`, exit 3, no undo table left. The one row is `h1-mixed`.

**Trigger halt** (first build, unchanged code path). With a no-op trigger added to `wine_consumption_log`, the migration fails with `old_pos_rows_carry_their_check_date: trigger probe_noop on wine_consumption_log — an UPDATE of these dates would fire it; nothing was re-dated (ADR 0281 F2)`. After it, neither the undo table nor the functions exist.

**Claims rows** (`.planning/decisions/claims.d/fix-old-pos-rows-carry-their-check-date.jsonl`). Both are static `python3 -c` checks of the migration file.

`ADR-0281-F2-OLD-POS-ROWS-CARRY-THEIR-CHECK-DATE`:
- 17 properties;
- its verify updated to the LEAST writes and the LEAST undo guard;
- its text bracketed, dated.

`ADR-0281-F2-NEVER-MOVES-A-ROW-LATER` (new), 5 properties:
- one migration file;
- the `already` WHEN text;
- the SET assignments are exactly the three LEAST assignments;
- the undo's LEAST guard;
- the landing check's LEAST.

Results:
- Both rows exit 0 here and exit 1 on `20d0bc79a`.
- Every single-property mutation exits 1 in at least one row: classification back to equality; each LEAST write back to the target; a fourth SET column; each undo guard; the landing check; two files with the slug.
- Reverting the classification while keeping the fork-1 text in a comment also exits 1.

**Guards at HEAD `0371df1a0`** (exit 0, with `--self-test` exit 0 where it has one):
- `env LC_ALL=C bash scripts/check_decision_claims.sh`: 875 checked, 875 holding (re-run at the end).
- `check_adr_numbers_unique`: no ADR introduced; next free 0305.
- `check_migration_versions_unique`: against `origin/main` and 76 open PRs.
- `check_migration_order`, `check_migration_probe_safety`, `check_migrations_single_home`, `check_new_tables_are_locked_down`.
- `check_citation_pairing`, `check_od_ids_exist`, `check_no_conflict_markers`, `check_a_count_is_recorded`, `check_proposal_preservation`.
- `check_no_direct_stock_writes.sh`.
- `pr_audit_gate.ownership_between(<worktree>, 'origin/main', 'HEAD')` returns `[]`.
- `check_migration_ledger` exits 2, CANNOT CHECK (no DB URL).

**The last call's own re-run at `0371df1a0`, against `origin/main` `155960b59`.**
- `check_decision_claims.sh`: 875 checked, 875 holding.
- Exit 0:
  - `check_adr_numbers_unique`, `check_migration_versions_unique`, `check_migration_order`, `check_migrations_single_home`, `check_migration_probe_safety`;
  - `check_new_tables_are_locked_down`, `check_no_conflict_markers`, `check_citation_pairing`, `check_od_ids_exist`;
  - `check_fk_targets_exist`, `check_fk_repoint_by_referenced_column`, `check_grant_writes_are_ledgered`, `check_queried_tables_exist`, `check_read_columns_exist`;
  - `check_no_seeded_defaults`, `check_quantity_units`, `check_a_count_is_recorded`, `check_proposal_preservation`, `check_lot_cost_provenance`;
  - `check_verified_at_is_not_a_boolean`, `check_no_quantity_received_column`, `check_test_scripts_are_real`, `check_no_direct_stock_writes.sh`.
- `ownership_between` returns `[]`.
- **The dry run matches the migration.** Compared with comments stripped and whitespace collapsed, the outcome CASE is the same 357 characters in both. These also appear verbatim in both:
  - the glass-pour link;
  - the row filters;
  - the `pos:pos:` read;
  - the key-prefix candidates and the check join;
  - the per-adapter till field;
  - the ISO regex and the ±14:00 offset bound.
- **No open PR adds a trigger or rule** on `inventory_transactions` or `wine_consumption_log`. Every open PR that carries a migration was read at its head: #541, #612, #617, #618, #620, #621, #627 and #628. #626 was read too; its two files are byte-identical to `main`'s. #621 adds a BEFORE trigger on `pos_checks`, which this migration never writes.
- **No table forces RLS.** No migration sets `FORCE ROW LEVEL SECURITY` on the four tables this reads or writes, so the migration's owner role sees and updates every row, as the production count's owner role saw them.

## ADR, CLAIMS and the register

- **ADR 0281: amendment only**, no new ADR.
  - **Kept from the first build:** the section "Amended 2026-10-05: F2, old POS rows carry their check's date" at the end of the file, with answers 1-3, the count, what is written, the undo and why a table, why glass pours, safety, and the local proof.
  - **New subsection at the end, "Fork 1 and fork 2, answered":**
    - answers 4-6, verbatim with their option texts;
    - what changed in the migration;
    - production read-only at about 16:10Z: triggers and rules none. The re-count is the coordinator's and is not recorded in the ADR;
    - the local proof.
  - **A third Review-trail row** for the two answers.
  - **Dated brackets** (`[2026-10-05 ~16:00Z: …]`) on every sentence the answers made stale:
    - the Status line;
    - line 92 ("Two questions inside it are left to the founder");
    - line 116 (a re-sent check's rows);
    - line 139 (Revisit);
    - in the end section: "Columns written", "The three functions stay", "Production's pg_trigger was not read", "Rows #603 wrote … except in two cases", "What to do with this case is open to the founder", the clock-ahead case, the `shift_max` sentence, the test counts, the dry-run proof, and the probe.
  - The README index row for 0281 is not touched.
- **CLAIMS:** one row updated, one added (above).
- **Register:** `scripts/sql_outside_migrations.txt` gains the test's line (unchanged by the rework).

## Merge order and conflicts

Measured with `git merge-tree` at HEAD `0371df1a0` against the open PRs that touch these files, 2026-10-05.

**#644** (`fix/pos-import-refusals-ring-the-bell`, open, head `e6227de5a`) conflicts in ADR 0281 only, in 5 hunks. It is the only conflict this PR adds besides #627's (below).

The bellnote lane's local, unpushed head `c84faf084` conflicts in the same 5 hunks. It also brackets #644's own F2 sentences, pointing at this branch ("[later on 2026-10-05 both were given; the repair is branch `fix/old-pos-rows-carry-their-check-date`'s]", and the same at line 96 and Revisit). Keep its brackets and this PR's side by side.

If #644 merges first, resolve hunk by hunk, keeping #644's text and adding this PR's brackets:

1. **Status, line 3.** Keep #644's line ("F2 … was answered by the founder on 2026-10-05: a read-only dry run first, and no production write without his yes (quoted under F2)."). Append this PR's two brackets after that sentence:
   - "[2026-10-05: F2 is answered. Migration `old_pos_rows_carry_their_check_date` re-dates each such row whose key matches exactly one check …]";
   - "[2026-10-05 ~16:00Z: the founder answered the two questions left inside F2. A row is only ever moved earlier, never later, and the undo stays until he says otherwise …]".
2. **Lines 92-94 and #644's paragraphs.**
   - Keep #644's line 92 ("… None of the five is open.", or at `c84faf084` "… None of these is open. …"). Append this PR's two brackets: "[2026-10-05: F2 is answered. Two questions inside it are left to the founder: …]" and "[2026-10-05 ~16:00Z: he answered both: never move a row later, and keep the undo until he says otherwise …]".
   - Keep line 94 (the F2 bullet) with this PR's bracket ("[2026-10-05: answered. Migration … re-dates these rows, and the keyless glass-pour ledger rows with them …]").
   - Then #644's two paragraphs, "Answered 2026-10-05 …" and "Glass pours, found by the dry run …".
   - **Owed (#644 has not merged, so this branch cannot bracket them):** bracket "no production row is re-dated until he has seen its count and said yes" with `[2026-10-05: he has seen it and said yes; migration old_pos_rows_carry_their_check_date, built never to move a row later.]`. Bracket "Whether the repair re-dates them is part of the yes the founder gives on that count." with `[2026-10-05: it does: "Re-date all, keep undo (Recommended)"; see "Amended 2026-10-05: F2" at the end.]`.
3. **"Easier", line 109.** Keep #644's "until the F2 repair runs, which waits for the dry run's count and the founder's yes (F2's answer)", with `c84faf084`'s bracket if present. Append `[2026-10-05: the yes is given; migration old_pos_rows_carry_their_check_date re-dates these rows when it is applied ("Amended 2026-10-05: F2").]`.
4. **Revisit, line 139, and #644's section after it.** Keep #644's "Revisit when the F2 dry run's count has been shown and the founder has answered it", with `c84faf084`'s bracket if present. Append this PR's two brackets: "[2026-10-05: ruled; revisit when the repair's undo is called]" and "[2026-10-05 ~16:00Z: or when the founder says the undo may go (fork 2)]". Then keep #644's whole "Amended 2026-10-05: refused checks reach the bell" section where #644 put it, before the Review trail (58 lines at `e6227de5a`, 84 at `c84faf084`).
5. **The Review trail's tail and the end of the file.** Keep #644's Review-trail rows (2 at `e6227de5a`, 4 at `c84faf084`), then this PR's three rows: the founder's F2 answer, the last call, and forks 1 and 2. After the table comes this PR's "Amended 2026-10-05: F2" section, with its "Fork 1 and fork 2, answered" subsection last.

Line 116 is not touched by #644 and merges clean. If this PR merges first, #644 resolves the same hunks the same way ("second to merge resolves by later truth").

**`scripts/sql_outside_migrations.txt`.** The append conflicts with #617, #618, #620, #621 and #628, which all already conflict with `main` there. It also conflicts with **#627**, which merges clean with `main` but not with this branch: both append after main's last line. Keep both lines. (#628 also conflicts in `beverages.service.spec.ts` and #541 in `procurement.service.ts`, with `main` too; not this PR's.)

**Migrations.** No open PR adds a migration that sorts after `20261222140000`; the latest is #627's `20261222130000`. If this one is renumbered at merge, it must stay after every migration on `main`.

## Not covered (shortcuts, named)

- **The F2 re-count under (c) has not run.** The coordinator runs it on production, read-only (placeholder above). This lane has no production access. Until it runs, the rows this merge writes are known only from this morning's pre-fork-1 count: (c) can only lower it, never add a row.
- **Production run time and lock duration are not measured.** It is one statement updating about 10.7k rows by primary key, after a classification over about 3.7k checks and about 11k candidate rows. The verify round at the first build ran 10,483 synthetic rows on local Postgres in about 2.6 to 2.8 s. That was not re-measured with fork 1's extra condition. The migration sets no `statement_timeout` of its own.
- **Triggers can still appear before the merge.** Production read none at about 16:10Z. A trigger or rule added later halts the apply.
- **Not every rule is pinned by the SQL test:**
  - The ledger LEAST is an equivalent mutant; only the claims row pins its text.
  - No consumption row with a NULL `recorded_at` is in the SQL test; the dry run's later fixtures cover it (`h1-nullrec`).
  - The migration's step-5 landing check runs only at apply time, so its LEAST is proven only on the dry-run scratch db and by its mutant, not by the SQL test.
- **M6 is a local blind spot.** It is covered only by the static claims row. The first build's mutation set was not re-run on the fork-1 code; the four fork-1 mutants were.
- **Readers that do not recompute.**
  - `analytics_insights` keeps insights computed from the old dates until each category's next cadence run.
  - Notifications, digests, goal-reached notes and report exports already sent stay as they were.
  - `inventory_transaction_summary` (materialized) is not refreshed; it has no reader in the repo.
- **Running balances stay as they were.** A re-dated ledger row keeps the `quantity_before`/`quantity_after` it was written with, which is ADR 0281's existing caveat for `get_inventory_balance_at`.
- **SQL is proven only on local Docker PG 17**, on synthetic fixtures. CI does not run `supabase/tests`.
- **Three guards were not runnable here:**
  - `check_migration_ledger` needs a DB URL (exit 2, CANNOT CHECK, re-run at this HEAD).
  - `check_definer_functions_closed` exits 2 on a plain local database (`supabase_functions`). T0 asserts none of the three functions is SECURITY DEFINER.
  - `check_beverage_identity_parity` reads `.env`, absent in a worktree.

  The last two were run at the first build and not again.
- **No UI changed**, so nothing was checked in a browser. The charts change only when production rows change.
- **Verify and audit.** One verify round ran at `2356d70c9` (7 minor issues, 4 fixed by the last call, 3 disclosed here). A second ran at `0371df1a0`, on the fork-1 commits. It passed with 5 minor issues, each disclosed in this section:
  - the `333bc572d` message;
  - no NULL-date fixture in the SQL test;
  - citations outside the repo;
  - the re-count and the #644 brackets owed;
  - two guards CANNOT CHECK locally.

  No ADR 0090 audit has run yet. It runs on the PR.
- **The migration cites files outside the repo.** Its header and DB comments name `p4-scratch/sim-run/fixes/tools/postime-f2-dryrun.sql` and the prod count record. A reader with only the repo cannot re-run this morning's count. After the merge, `pos_row_date_by_check()` in the database is the same classification (read-only check above). The dry run was not vendored: it would add a file that is not the write the founder approved.
- **The F2 re-count is a merge gate, not done.** If it finds any row that is `no check`, `check open`, `unreadable` or `ambiguous`, those rows are left alone, as built. If it finds a positive `shift_max`, the wrong file was run. Either way, its numbers go to the founder before the merge.
- **#644's two sentences are owed brackets** (above), because #644 has not merged.

## Coordinator notes

- **Merges into the branch:**
  - `c7b24101b` merges #606. Its only conflict was the register's tail: main's list was kept and this test added after it.
  - `333bc572d` merges #608 with no conflict. It carries git's default message with no body and no trailer. History was not rewritten to fix that. A squash merge carries this body's message into `main` instead.
  - `c01d37949` merges #645 (web files only) with no conflict.

  The harness ran after the first two merges. #645 touches nothing it reads.
- **A malformed fetch, from the first build.** While measuring conflicts, a `git fetch` whose branch list zsh did not word-split asked git to update `refs/remotes/origin/fix/bell-files-refused-checks` from another branch. Git did not apply it:
  - its reflog's last entry is still the push at 10:32 (`23e530233`, #645's head);
  - every open PR's remote-tracking ref matched its PR head.

  No branch, stash or worktree was touched. In the rework, list loops ran under `bash -c`.
- **Scratch databases.** `f2redate_old`, `f2redate_mut` and `f2redate_dry` were dropped. `f2redate_fix` and `f2redate_ctl` are the harness's own.

Files (5, in the repo):
- `supabase/migrations/20261222140000_old_pos_rows_carry_their_check_date.sql` (new)
- `supabase/tests/20261222140000_old_pos_rows_carry_their_check_date_test.sql` (new)
- `.planning/decisions/claims.d/fix-old-pos-rows-carry-their-check-date.jsonl` (new, 2 rows)
- `.planning/decisions/0281-a-pos-sale-is-dated-by-its-check-and-the-import-says-what-it-did.md` (amended)
- `scripts/sql_outside_migrations.txt` (one line)

Outside the repo (`p4-scratch/sim-run/fixes/`):
- `tools/postime-f2-dryrun.sql`: the fork-1 classification, header bracketed.
- `tools/postime-f2-dryrun.pre-fork1.sql`: the copy before it.
- `tools/postime-f2-dryrun-fixtures-later.sql`: new.
- `audits/f2redate-local-pg.txt`: R1-R8 appended (R8: the guard re-run at `0371df1a0`).

> **[2026-10-05, coordinator, at merge]** The merged head is `3426a3fcf` (a merge of main `1884dea38`, #607, which shares no file with this PR; the branch is current with main). Guards at that head: check_migration_order, check_migration_versions_unique, check_adr_numbers_unique and check_od_ids_exist exit 0; check_decision_claims.sh PASS. CI: 40 success, 1 skipped (Supabase Preview); PR Audit Gate pass. The ADR 0090 audit at `3426a3fcf` returned **PASS** (both reviewers APPROVE WITH NOTES; final HOLDS; report on this PR). Owed after merge, non-blocking: (1) the decisions README index line for ADR 0281 still says the F2 repair of written rows waits on the founder; README.md:18 says changing an existing index line needs his word, so it is asked after merge, not changed here; (2) test fixtures for the audit's surviving mutant and for a NULL date; (3) after the production apply, check that the migration's NOTICE and the undo table's row count agree with the round-3 dry run (about 10,684 rows to change across all houses; prod-dryruns-2026-10-05.md round 3). The earlier CI runs at `0371df1a0` were cancelled by GitHub's Actions outage of 2026-10-05 (~20:47–21:55Z), not by a failure.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
