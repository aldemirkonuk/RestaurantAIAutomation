## What was wrong for the owner (Tuzlu Rüzgar, analytics walk 2026-10-03, read-only)

The owner-quarter sim back-filled July and August through the generic POS import in October. `pos_checks.closed_at` kept each check's own close time, but nothing the import derived from the check used it.

- **A-007, /inventory velocity about 2x and runway about half.** `apply_stock_movement` and `record_glass_pour` took no date and stamped `inventory_transactions.transaction_date = now()`. So two months of sales landed on 2026-10-02, the only day with movement (out 48 / in 98).
  - Median velocity was 2.04x the truth (n = 112, range 0.65 to 4.12).
  - 34 rows showed five days of cover or less, against 11 in the truth, and only 7 of those overlap.
  - S.Pellegrino read 13.5/day with 3 days of cover, against a true 6.64/day and 5.44 days.
- **A-009, the /reports week shape and 14-day forecast were built from one import day.** `wine_consumption_log` rows took their defaults, `recorded_at = created_at = now()`.
  - Friday was the only trading day (78.46, every other weekday 0).
  - The forecast history had one non-zero day (2026-10-02 = 1,020).
  - "Next 14 days" read 4,543, with a backtest MAPE of 100%.
- **A-029, about 811 Jul-Aug POS lines (847 pours) plus 8 bottle lines moved no stock, and the import read as clean.** Of these, 752 failed on the stranded-lot cause (AW08) and 59 on rows whose book was already empty. `applyStockEffects` returned `void` and a refused write was only logged. `errors[]` never carried it, and the unresolved queue was empty.
- **A-041 (AW11), the sale-unit review said 57 glass, single and carafe buttons "deplete nothing" while their sales took stock out.** The review read mappings without `sale_volume_ml` and hard-coded `effect_if_unanswered: "depletes_nothing"`. The import reads `sale_volume_ml` first (ADR 0011). For example, Moscofilero glass lines depleted 35 units against a true 34.4.
- **A-064 (register only).** 17 never-counted made-to-order drinks raise critical "completely out of stock" alerts. They are added to OD-161's citation, and no code changes for them here.

Out of lane: the door half of AW03 (A-008, A-010, A-011, where `delivered_at` = now) is lane `doortime`, under the founder's C02. `receiving.service.ts` is not touched.

## What changed and why

- **Migration `a_pos_sale_is_dated_by_its_check`** (cited by slug; it now sorts after `a_short_pour_opens_the_next_bottle`, past every migration on main, and the final number is assigned at merge).
  - `apply_stock_movement` goes from 18 to 19 arguments and `record_glass_pour` from 8 to 9. Each gains a last argument, `p_occurred_at timestamptz DEFAULT NULL`, and dates its ledger row `LEAST(COALESCE(p_occurred_at, now()), now())`.
  - Each function is dropped and recreated rather than overloaded, because a second overload makes PostgREST's named call ambiguous.
  - The `apply_stock_movement` body is copied verbatim from ADR 0141's migration. The `record_glass_pour` body is copied verbatim from ADR 0285's `a_short_pour_opens_the_next_bottle` (#600, merged first): it finishes the open bottle and opens the next from any lot. The only change in each is the argument and one marked line. A diff against the sources confirms it.
  - ADR 0285's draw writes one ledger row for every bottle a pour opens, whichever lot it came from, so the one dated line dates the bottles opened from the next lot too. `pour_events.created_at` stays entry time, since nothing reads it as the time of the pour.
  - A DO block asserts:
    - exactly one of each function, with the argument counts and defaults;
    - ADR 0141's refusal is still in `apply_stock_movement`;
    - ADR 0285's cross-lot draw, its 22004/22023 guards and its two refusals are still in `record_glass_pour`, which still returns jsonb and is still SECURITY INVOKER.
  - NULL means now(), as before, so the old gateway and every other caller (Toast, door, counts) behave exactly as they did yesterday.
- **`pos-hub.service.ts`**
  - **`saleInstant(closedAt, nowMs)`** reads the check's `closed_at` once, with JavaScript's `Date.parse`. `ingest()` calls it before it stores the check, and every date the import writes for that check comes from that one reading, sent as an ISO-8601 UTC string (changed after the ADR 0090 BLOCK at `01ac04eaa`; see "After the BLOCK at 01ac04eaa" below).
    - `pos_checks.closed_at` gets the reading as it is, not clamped.
    - `p_occurred_at` on both RPCs, and the consumption row's `recorded_at` and `created_at`, get the same string when it is not in the future. A future one is clamped to import time on these rows only, so the check keeps its future close time.
    - The ledger row is `LEAST(p_occurred_at, now())` with the database's clock, so it is earlier than the other rows only when the database's clock runs behind the gateway's.
    - A string JavaScript cannot read dates the stock and consumption at import time, is counted (`datedAtImportTime`) and is said in `errors[]`. The check keeps the till's value, as before: Postgres reads it its own way, or refuses it and the check is not stored, which `errors[]` also says.
    - Outside those cases, the check, its ledger rows and its consumption rows carry one instant. An ambiguous string is read JavaScript's way on all of them, revenue included (see Not covered).
    - A line booked more than 72 h after its check closed is counted in `backdatedOver72h`. Exactly 72 h does not count.
  - **Voids** are dated by the `closed_at` the voided check carries.
  - **The consumption row** gets `recorded_at` and `created_at` set to the sale instant. Every existing reader filters on `created_at`, and those readers belong to the `cap` lane, so writing both columns fixes them without touching that lane's files. One reader's meaning shifts with it. For a `bottles_sold` goal, `goal-reached.producer.ts:263-269` reports the newest `created_at` as the moment the goal was crossed. For POS rows written from now on, that is the newest sale's instant, not the newest import. Its code is unchanged, and ADR 0281's Consequences say so.
  - **`ingest()` returns a `stock` block** and appends grouped failures to `errors[]`.
    - The block puts every line on a closed check it stored into exactly one of `notStock`, `booked`, `alreadyBooked`, `queued.unmapped`, `queued.no_sale_volume` or `failed`.
    - `consumptionNotWritten`, `backdatedOver72h` and `datedAtImportTime` are sub-counts.
    - Failures are grouped by kind and item: at most 50 groups, then one line that counts the rest.
    - `queueUnresolvedLine` and `recordConsumption` now return their outcome. A queue insert that fails is `failed`, never `queued`.
  - `inventoryVolumesFromRow` is exported, so the review reads sizes by the import's own rule.
- **The sale-unit review (`pos-mapping-review.service.ts`, DTO)**
  - It selects `sale_volume_ml` and reads the inventory of every mapping, in chunks of 150 ids.
  - Each row gets `next_sale` (`whole_bottle`, `volume` with its ml, or `depletes_nothing` with a reason and `queued_as`), computed by the import's own `resolveSaleVolume`.
  - `needing_unit` counts what the import cannot resolve. `queue_on_next_sale` counts every mapping whose next sale lands in `pos_unresolved_lines`.
  - `EFFECT_IF_UNANSWERED` is deleted.
  - Found while building: `setSaleUnit` now passes the stored `sale_volume_ml` back. Answering "glass" on a 150 ml button used to wipe the volume the import reads first.
  - The other side of that, now written in ADR 0281's Consequences: the import reads `sale_volume_ml` before `sale_unit` (ADR 0011), so answering `bottle` on a button that stores 150 ml still imports 150 ml a sale. Only a stored volume equal to the inventory row's bottle size imports as a whole bottle. The answer's response says `sale_unit: "bottle"` and nothing about the volume, and the row then drops out of the default review list (with `includeAnswered=true` its `next_sale` reads `volume`, 150 ml). The volume is changed through `POST /pos-hub/mappings/:restaurantId`. This PR does not change that behaviour.
- **The review's API text now says what it returns** (added after the audit).
  - The DTO's `includeAnswered` description said the default returns "only rows still missing a unit", which was main's selection. It now says the default returns mappings whose sale volume the import cannot resolve. The DTO was already one of this PR's files.
  - The route's Swagger summary and description in `pos-hub.controller.ts` said "every mapping whose sale_unit is null" and named a `unit_if_unanswered` field. This PR removed both. The text now describes the resolver-based selection and `next_sale`. This is the PR's 16th file (commit `5148767bb`); the founder allowed 16 files for this PR as a one-off.
- **ADR 0285's SQL test is not in this PR.** Its T11 pins the 8-argument identity of `record_glass_pour`, so it **will FAIL once this migration lands, by design**. The 1-file follow-up PR #605 (a draft as of 2026-10-04) moves T11 to the 9-argument identity. **#605 must merge right after this PR.** It cannot go first: T11 cannot pass against main before this migration. CI does not run `supabase/tests`, so nothing goes red in between. ADR 0285's applied migration is not edited.
- **Why:** the database already held the true time on `pos_checks`, so that is the only honest date for what the import derives from a check. A count that partitions every line is the only shape in which "nothing failed" can be checked rather than assumed.

## After the BLOCK at 01ac04eaa

The ADR 0090 audit of `01ac04eaa` overturned that head (BLOCK; both reviewers approved with notes, the planner overturned). That BLOCK stands; this is a new head.

- **What it found.** `saleInstant` read `closed_at` with JavaScript only to decide past, future and 72 h, then handed the till's own string on, and Postgres read it a second time. The two readings differ for a zone-less string when the gateway's zone and the database session's differ, for a POSIX-style `UTC+3`, and for a two-digit year from 50 to 69. When either reading fell in the future, the ledger, `pos_checks.closed_at` and the consumption row came apart, while four sentences (the ADR's Decision and Assumptions, the docstring, and this body's "land on the same day") said they could not.
- **The fix, the auditor's option (b).** `ingest()` calls `saleInstant` once per check, before the `pos_checks` upsert, and hands the result to `applyStockEffects`. The check row, `p_occurred_at` on both RPCs, and the consumption row's `recorded_at` and `created_at` all take that one reading, sent as `new Date(parsed).toISOString()`. The clamp semantics are unchanged (the founder's F1, "No: trust the till"; C02's "older needs a manager" does not apply): a future close time is clamped on the stock and consumption rows only, and the 72 h count is a count. Two files changed in code: `pos-hub.service.ts` and `pos-hub.sale-time.spec.ts`, both already in this PR.
- **Two choices made in that fix, for the gate to judge:**
  - A string JavaScript cannot read is still stored on the check exactly as the till sent it (Postgres reads it or refuses it, as before), while its stock and consumption take import time, counted and said. Storing import time on the check as well was the other option; it would have changed what an unreadable check's revenue date is without anyone deciding that.
  - A future close time stays on the check, as UTC, unclamped, as `pos_checks.closed_at` held it before. Only the stock and consumption rows are clamped, as before.
- **What changed for revenue.** `pos_checks.closed_at` used to hold Postgres's reading of the till's string; when JavaScript can read it, it now holds JavaScript's reading, as UTC. For formats both read alike (the audit measured ISO with an offset, RFC 2822, `04.10.2026 15:00` and `10/04/2026 3:00 PM`, with the session in UTC; the last two carry no zone, so they agree only while the two zones match) nothing changes. For the three kinds above, a check's revenue day is now JavaScript's reading, the same as its stock's. The generic adapter still keeps the whole payload in `pos_checks.raw`, so the till's own string is still on the row. `opened_at` is still stored as sent.
- **The four sentences now say what the code does**, and what is still assumed (see Not covered): ADR 0281's Decision paragraph and `saleInstant` bullet, its Assumptions, the `SaleInstant`/`saleInstant` docstrings, and this body. The index row in `decisions/README.md`, the bracket in `08-softwares/pos-bridge.md` and the Toast entry in `tech-debt.d` say "one reading" too.
- **Also from the audit's notes:** ADR 0281's Consequences now say that answering `bottle` over a stored 150 ml still imports 150 ml (see the review bullets above), in its own commit; and #605 must merge right after this PR.
- **Commits on top of `01ac04eaa`:** `592cc04d4` (the one reading, its spec cases, the claims row, the timing prose) and `f9c0d2ef5` (the `setSaleUnit` consequence). No migration, SQL test, DTO, controller or review-service code changed.

## Tests and guards (run on the branch head named at the end, `f9c0d2ef5`)

- **Gateway jest** (from `apps/api-gateway`, `env LC_ALL=C`):
  - `npx jest src/pos-hub src/inventory --runInBand --forceExit`: 26 suites, 398 tests, all passing.
  - `npx jest read-errors-are-not-silence simpos team-ops-entry --runInBand --forceExit`: 4 suites, 65 tests, all passing.
  - `pos-hub.sale-time.spec.ts` (25 tests) covers the `saleInstant` boundaries, dating for a bottle sale, a glass sale and a void, the stock partition, a replay, a refused write, a failed queue insert, a 23505 queue, a missing consumption row, an unreadable `closed_at`, and the 50-group bound. After the BLOCK it gains five cases under "one reading of closed_at dates the check, its stock and its consumption". Each runs a bottle line and a glass line, so both RPCs and two consumption rows are written, and compares all seven dates (the check, two RPC calls, and `recorded_at` and `created_at` on each consumption row):
    - `"1/1/50"`: all seven are the same 1950 instant, as UTC.
    - `"2026-10-04 15:00:00 UTC+3"`: all seven are `2026-10-04T12:00:00.000Z`.
    - `"2026-10-04 15:00:00"` (no zone) on a gateway in Europe/Istanbul: all seven are `2026-10-04T12:00:00.000Z`. Setting `process.env.TZ` inside a jest test does not reach its `Date` (measured), so the spec spawns `node` with `TZ=Europe/Istanbul`, reads the string there, and feeds that reading to the test through a `Date.parse` spy.
    - A future close time: the check keeps it (as UTC); the other six are now.
    - An open check: stored with no `closed_at`, and no stock moves.
  - **Red, then green**, the final spec against three services (outputs in `p4-scratch/sim-run/fixes/snap/postime-block2/`, `red-old-service.final.txt`, `red-origin-main-service.final.txt`, `green-new-service.final.txt`):
    - the blocked head's service (`01ac04eaa`): 14 failed, 11 passed. The four new dating cases fail. So do the seven `saleInstant` cases (it returned no `closedAt`, and a past string as sent) and the bottle, glass and void cases (it handed on `...:00Z` as sent, not as one UTC reading). The 11 that pass are the open check, the 72 h and size boundaries, the unreadable `closed_at`, and the partition and error-bound cases, none of whose behaviour this round changed;
    - origin/main's service (`1aa4dcb8c`): 24 failed, 1 passed (the open check, whose behaviour did not change);
    - this head: 25 passed.
  - The review spec adds 4 cases: a volume with no label is answered, `'glass'` without a pour size is not, the volume is kept on answer, and the inventory read is chunked.
  - At an earlier head, the verifier ran 31 adjacent suites (565 tests) green: inventory-ledger, toast, simpos, procurement/canonical, inventory, beverages and read-errors. Not re-run since in that form.
- **Typecheck:** `npx tsc --noEmit -p tsconfig.spec.json` shows 2 errors. Both are the missing `@simplewebauthn/server` in `src/passkeys/passkeys.service.ts`, an environment gap in a file this PR does not touch.
- **Lint:** eslint on the 7 TS files this PR touches gives 0 errors. It shows 3 prettier warnings in `pos-mapping-review.service.spec.ts` (:568, :603, :632) on lines that are byte-identical to main, where the same 3 occur. Prettier `--check` passes on the two files changed after the BLOCK.
- **SQL, local Postgres** (PostgreSQL 17.11 in Docker, synthetic fixtures, one rolled-back transaction each). The template was built from every migration at origin/main `1aa4dcb8c`, which is still origin/main (fetched before this run). The migration and its test did not change after the BLOCK. `pgtest.sh lane` at `f9c0d2ef5`, this lane's test only:
  ```
  applied 1 migration(s) to postime_fix
  [fix] PASS 20261218180000_a_pos_sale_is_dated_by_its_check_test.sql
  [ctl] FAIL 20261218180000_a_pos_sale_is_dated_by_its_check_test.sql: ERROR:  T1 FAIL apply_stock_movement does not end with p_occurred_at DEFAULT NULL: ...
  template=1aa4dcb8c84062bb466c4b6cff0524e6272c61da lane_migrations=1 tests=1
  ```
  Full output: `p4-scratch/sim-run/fixes/audits/603-local-pg.txt` (the previous one is kept as `p4-scratch/sim-run/fixes/snap/postime-block2/603-local-pg.before-block2.txt`).
  - This lane's test is T1 to T6. T1 to T5 cover one overload each, past, future and NULL dating, a pour that opens a bottle, the 11-argument positional callers, and ADR 0141's refusal. T6 covers ADR 0285's draw, dated: a stranded lot (0 sealed + 25 ml) beside a lot of 3 sealed, where the pour opens the next lot's bottle and its ledger row carries the sale's date; and a 1500 ml pour that opens two bottles in one ledger row of -2, dated by its own sale.
  - ADR 0285's test was not re-run at this head. In an earlier run, it failed T11 on [fix] **by design**, because T11 pins the 8-argument identity this migration replaces, and passed on [ctl] (main alone). That output is `p4-scratch/sim-run/fixes/audits/postime-local-pg.txt`. #605's T11 passed on [fix]; that run is saved in `p4-scratch/sim-run/fixes/followup/glasspour-t11/`.
  - Mutation (earlier round): this branch's pre-merge migration (the baseline pour body) applied on top of ADR 0285 fails T6 with "insufficient stock for a full pour", the stranded-lot refusal 0285 removed.
  - Postgres reads an ISO-8601 UTC string as the same instant in any session time zone: checked in the PG17 container under UTC, Europe/Istanbul and America/Los_Angeles (`snap/postime-block2/pg-reads-iso-the-same.txt`). That is what lets the gateway send one reading and have every row keep it.
- **Guards, at `f9c0d2ef5`** (each exit 0):
  - `check_decision_claims.sh`: 858 checked, 858 holding.
  - `check_adr_numbers_unique.py`: checked 1685 refs; 0281 is introduced here.
  - `check_od_ids_exist.py`: every OD id resolves.
  - `check_migration_versions_unique.py` and its `--self-test`: checked against origin/main and 52 open PRs.
  - `check_migration_order.py`, its `--self-test`, and `--event pull_request --base-ref main`: 1 migration added since the merge base `1aa4dcb8c`, past `20261218150000` (`a_delivery_event_follows_its_order`), the newest on origin/main.
  - `check_migrations_single_home.py` and `check_migration_probe_safety.py` pass.
  - **The full sweep was not re-run here.** That sweep is every `scripts/check_*` invocation in `ci.yml` and every `--self-test`. It last exited 0 at `82e087f34`. CI runs it at this head. `check_gateway_boots.sh` was not run (see Not covered).
- **Claims after the BLOCK at `01ac04eaa`.** `TD-2026-10-03-POS-SALE-DATED-GATEWAY` keeps everything it checked and now also checks the check row: every `closed_at` property in the file is `when.closedAt`; `when` is read before the `pos_checks` upsert; every `this.applyStockEffects` call hands that `when` on as its last argument; `saleInstant` parses once (`const parsed = raw ? Date.parse(raw) : NaN`), every `at` it returns is `importTime` or `read` (`new Date(parsed).toISOString()`), and every `closedAt` it returns is `read` or `closedAt ?? null`. It does not check what Postgres makes of a string. Static Python, comments stripped. It exits 0 at this head, 1 at `01ac04eaa` and 1 on origin/main `1aa4dcb8c`. Mutated in a scratch copy of the service, each of these exits 1, and the unmutated copy exits 0 (harness in `snap/postime-block2/claims/`, results in `mutations.final.txt`):
  - `closed_at` back to `check.closedAt ?? null`; kept only in a comment; set to `when.at`; dropped;
  - the parse moved after the upsert; `when` not handed to `applyStockEffects`;
  - `at` returned as the raw string, or as the `closedAt` parameter; `closedAt` returned as the raw string; `read` set to the raw string; a second parse through `new Date(raw)`;
  - and two earlier mutations re-run on the extended row: one RPC's `p_occurred_at` dropped, `recorded_at` dated otherwise.

  No other claims row changed, and no SQL changed, so no SQL row needed a new mutation run.
- **Claims: the earlier BLOCK, at `82e087f34`, answered.** The ADR 0090 audit of `82e087f34` found that DATED-MOVEMENT and DATED-POUR matched `LEAST(COALESCE(p_occurred_at, now()), now())` anywhere in the migration. The expression also sits in its comments and DO block, so reverting either function's line still exited 0. All six rows in the shard are rewritten as static Python, one line each. Each row now does the following:
  - **The two DATED rows** tokenize the migrations, skipping comments, strings and dollar-quoted text. They take the last real `CREATE [OR REPLACE] FUNCTION` of each function and check its signature (`p_occurred_at` timestamptz `DEFAULT NULL`). They also check that every `INSERT INTO inventory_transactions` in its own `$$` body, comments and strings stripped, puts the expression in the `transaction_date` slot. They fail if a later migration drops the function.
  - **The four gateway and review rows** strip comments first. They check the structure each claim names: each RPC call's own arguments, the consumption insert's own fields, `when = saleInstant(check.closedAt, ...)`, the `nextSaleFor` and `volumesOf` bodies, and the `upsertItemMapping` call's own arguments.

  On origin/main e2cbe426a all six exit 1; at that head all six exit 0. Re-run 2026-10-04 at `f9c0d2ef5`: all six exit 0 here and 1 on a `git archive` of origin/main `1aa4dcb8c`. Every row was mutated in a `git archive` copy of the head tree, with 61 cases. A mutation that changed nothing would have aborted the run.

  | Row | Property-breaking mutations | Old verify stayed green | New verify exits 1 | Controls exit 0 |
  |---|---|---|---|---|
  | DATED-MOVEMENT | 8 | 8 | 8 | 2 of 2 (old: 1 false red) |
  | DATED-POUR | 9 | 8 | 9 | 2 of 2 (old: 1 false red) |
  | DATED-GATEWAY | 13 | 8 | 13 | 1 of 1 |
  | IMPORT-SAYS-STOCK | 9 | 4 | 9 | 1 of 1 |
  | SALE-UNIT-REVIEW-READS-VOLUME | 10 | 7 | 10 | 1 of 1 |
  | SALE-UNIT-ANSWER-KEEPS-VOLUME | 4 | 2 | 4 | 1 of 1 |

  These are the cases the audit asked for:
  - `apply_stock_movement`'s dated line reverted to `now(),` gives old 0, new 1.
  - The same line kept only in a comment gives old 0, new 1.
  - The same two edits to `record_glass_pour`'s line give old 0, new 1 each.
  - The unmutated tree gives 0 for both.

  Other cases that now fail and did not before:
  - the expression kept only in a `RAISE` string;
  - a second, undated ledger INSERT;
  - a later undated redefinition, including one with a quoted name;
  - a later DROP;
  - `p_occurred_at` kept in a comment, a string or a nearby object instead of the RPC call;
  - an RPC name held in a variable;
  - `nextSaleFor` losing its `resolveSaleVolume` call while the other call site stays;
  - `volumesOf` losing `inventoryVolumesFromRow` while the import line stays.

  The controls are a later file that only mentions the CREATE in a comment and a DO string, and the unmutated tree. Both exit 0; the old SQL rows went red on the first. Full table and harness: `p4-scratch/sim-run/fixes/audits/603-claims-mutations/`. The commit message of `1cf469ec0` says the old rows stayed green on "33 of the 52" breaking cases. That was my estimate before counting, and the harness count is **37 of 53**.
- **Merges:** origin/main fb862aa57 (#599 and #600) was merged in first. Two textual conflicts came up: `.planning/decisions/README.md` (the 0281 and 0285 index rows) and `scripts/sql_outside_migrations.txt` (the two test lines). Both sides were kept, and the second file was then regenerated with `check_migrations_single_home.py --update`. After the audit, origin/main e2cbe426a (#601, /logs, ADR 0277) was merged in. Its one conflict was the decision index, where both rows were kept in number order (0277, 0281). Then the coordinator merged origin/main twice more (f5f658934 #602, then 1aa4dcb8c #604); the only conflicts were the decision index rows and `scripts/sql_outside_migrations.txt` lines, and both sides were kept. #604's `20261218150000` landed on main, so the migration was renamed `20261218101500` → `20261218180000` (`01ac04eaa`, name only), because `check_migration_order.py` (ADR 0212) rejects a version behind main's newest; ADR 0284's dated review-trail line that names the old version is main's file and stays as written. That re-head's SQL run (this lane's test [fix] PASS / [ctl] FAIL at T1; with main's ADR 0284 test, both PASS on [fix]) is kept at `p4-scratch/sim-run/fixes/snap/postime-block2/603-local-pg.before-block2.txt`. origin/main is still `1aa4dcb8c`, and `git merge-tree` against it is clean.

## ADR, CLAIMS and register touched

- **ADR 0281** (new): "A POS sale is dated by its check, and the import says what it did", plus its index row in `decisions/README.md`. `check_adr_numbers_unique` passes. After the merge it says that glasspour merged first, that F3 was applied as the coordinator's option (a), why the migration sorts after ADR 0285's, and what the local Postgres run showed. After the audit, the F3 paragraph says only what the claims rows check, names the T11 follow-up as #605 and records the local Postgres re-run. Consequences gains the `goal-reached` reader, and the review trail records the BLOCK. After the BLOCK at `01ac04eaa`: the Decision paragraph and the `saleInstant` bullet describe the one reading and where it goes; Assumptions name the three kinds JavaScript reads its own way, the unverified Railway zone and the jest zone injection; Consequences gain "revenue's date for an ambiguous closed_at moves with its stock" and the `setSaleUnit` 150 ml case; the local Postgres paragraph records the re-run at `1aa4dcb8c`; and the review trail records the second BLOCK.
- **`claims.d/fix-pos-sales-dated-at-sale-time.jsonl`** has 6 rows, all `resolved`:
  - DATED-MOVEMENT and DATED-POUR read the last real definition of each function, structurally (see Claims above; DATED-POUR's prose also names glasspour's merge);
  - DATED-GATEWAY, extended after the BLOCK at `01ac04eaa` to read the check row and `saleInstant`'s returns (see Claims above);
  - IMPORT-SAYS-STOCK;
  - SALE-UNIT-REVIEW-READS-VOLUME;
  - SALE-UNIT-ANSWER-KEEPS-VOLUME.

  `CLAIMS.jsonl` itself is not touched.
- **OD-161** is amended in place with `dashboard.service.ts:714-718` and `:759-775` (A-064). No row is added, so no citations shift.
- **`tech-debt.d/2026-10-03-fix-pos-sales-dated-at-sale-time.md`** adds two OPEN entries: the Toast door still dates stock at arrival (its fix now also says to write `toast_closed_at` from the same `saleInstant` call), and a check that arrives already voided adds phantom stock. Its citations are re-measured at this head (`pos-hub.service.ts:121`, `:1201`, `:1204`). `v3.0-TECH-DEBT.md` is frozen by ADR 0240.
- **`08-softwares/pos-bridge.md`**: a bracketed supersession note where it described `effect_if_unanswered` as live, which now also says stock and consumption are dated by one reading of the check's `closed_at`.

## Founder answers (verbatim, AskUserQuestion, 2026-10-04 ~02:10Z)

- **F1, does C02's 72-hour rule also bound a POS check's closed_at?** "No: trust the till (Recommended)". It is built as worded: closed_at is trusted at any age, and lines older than 72 h are counted in `stock.backdatedOver72h`. It is quoted in ADR 0281 under "Founder ruling".

## Forks deferred (not decided here)

- **F2 (founder): repairing rows already written at import time.** These are `inventory_transactions` rows keyed `pos:` and `wine_consumption_log` rows keyed by `notes`, which a repair would re-date from `pos_checks.closed_at`. No repair SQL was written. The recommendation on record is a separate, unrun script with a dry-run SELECT first, for the founder to run.
- **Phantom void (product call, in `tech-debt.d`).** Should a void whose sale was never booked be skipped, queued or booked?
- **Already owned by other lanes:** C02 (the door's capture time) is `doortime`'s. AW08 (the stranded-lot behaviour) was `glasspour`'s and is now on main as ADR 0285; this migration carries its body unchanged.

## F3, applied (coordinator, not product)

Which lane owns the two RPC signatures: the coordinator took option (a). This lane owns `p_occurred_at` on both functions, and the lane that merges second copies the other's body verbatim and keeps the exactly-one-overload assertion. Glasspour merged first (#600, fb862aa57), so this branch carries its body, as described above.

## Merge-order notes

- **Deploy order: the migration first, then the gateway.** Migrations auto-apply when the PR merges, and the gateway deploys after.
  - If the new gateway ever runs against the old functions, every line that reaches either RPC fails. Each failure is counted as `failed` and said in `errors[]`, so nothing is silently mis-dated, but that stock does not move and is not queued, so those checks would need a replay.
  - The old gateway against the new functions is fine, because the argument defaults to NULL.
- **`glasspour` has merged** (#600, fb862aa57). This branch already carries its `record_glass_pour` body plus `p_occurred_at`, and its migration sorts after glasspour's.
  - Left at its old version, this migration sorted before glasspour's. A fresh `supabase db reset` would then have applied glasspour's 8-argument `CREATE OR REPLACE` after it, added a second overload and halted on glasspour's exactly-one assertion, while production would apply them in the other order (ADR 0212). `check_migration_order.py` failed on that before the rename and passes after it.
  - A plain rebase without the body change would have silently restored the baseline body. Glasspour's claims row catches that (it reads the last definer for the cross-lot draw), and so does the new T6 on local Postgres. This migration's DO block now also refuses any later edit of it that drops the cross-lot draw.
  - If another migration lands on main before this PR merges, this one must be renumbered past it again (by slug, ADR 0235).
- **Shared files are textual conflicts only.**
  - `.planning/decisions/README.md` index rows are shared with lanes caltakings, cap, dash, doortime, events, glasspour, logs, rec, recregisters, sig, sighting and stateeditor (glasspour's and logs' rows are now on main).
  - `scripts/sql_outside_migrations.txt` (tail) is shared with cellar and events (glasspour's line is now on main).
  - No other lane worktree touches `pos-hub.*`, `pos-mapping-review.*` or OD-161, and none defines either stock RPC in a migration of its own (cap, logs and sig hold glasspour's migration only because they merged main). I re-checked this on 2026-10-04 after the merge across every `wt-fix-*`.
- **`cap`** keeps the `wine_consumption_log` readers on `created_at` (branch as read 2026-10-04), which is what this PR writes the sale instant into, so the two are compatible in either order.
- **`stockout`** (wave 3) depends on this landing first.
- **`doortime`** must reuse `p_occurred_at` and start from this migration's body if it ever redefines `apply_stock_movement`. Its worktree, read 2026-10-04, does not touch either function.

## Not covered (shortcuts, stated per CLAUDE.md §0.5)

- **Tuzlu's numbers do not change on merge.** Only checks imported after the migration are dated by their check. The July-August back-fill keeps its 2026-10-02 dates, and so keeps inflating 30-day velocity and runway until it ages out of that window or F2's repair runs. Longer windows (the 90-day and 120-day demand series) carry it longer.
- **No screen shows the new fields.** The `stock` block and `next_sale` are API-only: the web has no caller of the POS import route or of `/sale-unit-review`. An owner sees the effect only through the corrected dates on new imports, not as a new message on a page.
- **Production was not touched or re-measured.** The Tuzlu figures above are from the 2026-10-03 walk. The production ACL on the two functions was not read. Dropping and re-creating them restores the default EXECUTE, as ADR 0141's migration already did. No migration grants or revokes them, and the baseline dump carries no GRANT at all.
- **SQL proof is PGlite and local PostgreSQL 17.11 in Docker**, not Supabase's hosted Postgres. I found no CI job that runs `supabase/tests`.
- **The till's string is read by JavaScript's `Date.parse`, so an ambiguous format is read JavaScript's way, on every row of the sale, revenue included.** Three kinds were measured where Postgres would have read it differently:
  - a zone-less string (`2026-10-04 15:00:00`) is read in the gateway's own time zone;
  - a two-digit year from 50 to 69 (`1/1/50`) is read as 19xx, where Postgres reads 20xx;
  - a POSIX-style zone (`… UTC+3`) is read with ISO's sign, three hours ahead of UTC, where Postgres reads three hours behind.
- **The gateway's time zone on Railway is not verified.** If it is not the house's zone, a zone-less `closed_at` is dated in the wrong zone, the same way on every row of that sale. The jest case for it injects an Istanbul reading through a `Date.parse` spy; it does not run a gateway process in that zone.
- **The ledger still uses the database's clock** for `LEAST(p_occurred_at, now())`, so a sale that closed moments before the import, or a clamped one, can sit a little earlier on the ledger than on the check if the database's clock runs behind the gateway's. Not measured.
- **The Toast door still dates its stock at arrival** (three RPC call sites, OPEN in `tech-debt.d`).
- **A check that arrives already voided still adds phantom stock.** It is now dated and counted, but not fixed.
- **Two counting limits:**
  - A replayed void counts as `booked`, because the RPC answers a known key the same as a new one.
  - A sale whose consumption write failed on its first import counts as `booked` again when it is replayed.
- **`get_inventory_balance_at` can read wrong for an instant inside a back-dated span**, because a back-dated row carries its entry-time `quantity_after`. It read wrong there before too. No web caller exists. This is written in ADR 0281's Consequences.
- **`setSaleUnit` edge cases:**
  - A stored volume outside 10 to 30000 ml (writable only by SQL) now makes the answer fail.
  - A stored volume larger than the bottle stays unresolved after the unit is answered.
  - Answering `bottle` over a stored 150 ml still imports 150 ml a sale, and the answer's response does not say so (written in ADR 0281's Consequences; behaviour unchanged here).
- **Not re-run by me:**
  - `check_gateway_boots.sh` was not run locally. The local tree lacks `@simplewebauthn/server`, and no module wiring changed.
  - The 31-suite adjacent jest run is the verifier's result at an earlier head. At this head I ran `src/pos-hub` and `src/inventory` (26 suites) and 4 adjacent suites (read-errors, simpos ×2, team-ops-entry).
  - ADR 0285's SQL test was not re-run at this head (its T11 belongs to #605).
- **This head has not been gated.** The ADR 0090 audits BLOCKED `82e087f34` and `01ac04eaa`, and both BLOCKs stand; this head is new and goes to a fresh gate. It adds two commits on `01ac04eaa`: `592cc04d4` and `f9c0d2ef5` (see "After the BLOCK at 01ac04eaa"). I re-checked it with jest, tsc, eslint, claims, the guards listed above and local Postgres.
- **What the rewritten claims rows still cannot see:**
  - A function defined through `EXECUTE` inside a DO block.
  - An `E'...'` string with a backslash-escaped quote.
  - A TypeScript regex literal that contains `//` or a quote. The tokenizer does not parse regex literals.
  - An RPC call written without `.rpc(`.
  - `IMPORT-SAYS-STOCK` checks the four code lines that carry the stock block, not the bucket arithmetic. The jest spec covers that.
- **ADR 0285's own claims row** (`ADR-0285-A-SHORT-POUR-OPENS-THE-NEXT-BOTTLE`, merged in #600) still matches its needles in the last definer's body text with comments included. A body that keeps them only in comments would pass it. That row belongs to glasspour's shard and is not edited here.
- **The PR is 16 files**, the founder's one-off; the fix after the BLOCK added none. Glasspour's SQL test is main's content (the coordinator's call). So between this merge and #605, main holds a test whose T11 fails against main's own migrations. CI does not run it, so nothing goes red, and **#605 must merge right after this PR**.

Branch `fix/pos-sales-dated-at-sale-time`, PR #603. This body describes head `f9c0d2ef5`, which has 16 files against origin/main `1aa4dcb8c` (merged in). The coordinator pushed it. Follow-up: #605 (1 file), which must merge right after this one. The body for the blocked head is kept as `p4-scratch/sim-run/fixes/pr/postime.01ac04eaa.md`.

## Re-head onto main 28d32de36 (coordinator)

The ADR 0090 audit PASSed at `f9c0d2ef5`. Before it could merge, main moved: #595 landed as `28d32de36`. That change touches only Python and docs (`provider_communication_agent.py`, its test, ADR 0260, one claims file) and has no migration. The coordinator merged it in at `1a7a4137d`, with no conflicts. The PASS at `f9c0d2ef5` does not carry over, so this head is audited afresh. Re-run at this head:
- `check_adr_numbers_unique`, `check_od_ids_exist`, `check_decision_claims` and `check_migration_versions_unique` all pass.
- `check_migration_order` is OK: `20261218180000` sorts after main's newest, `20261218150000`.
- The file count is still 16.
- `pgtest.sh lane` on a template rebuilt at `28d32de36` gives `[fix] PASS`, and `[ctl] FAIL` at T1. This is appended to `603-local-pg.txt`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
