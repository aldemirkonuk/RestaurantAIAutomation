# feat(tables): an owner or a manager adds a table by hand (ADR 0303 amendment)

> **Stacked on #621** (`feat/tables-learned-from-the-pos`, not yet on main). The branch was fast-forwarded to #621's current head `f5cbccdd4` (the migration renumber to `20261222160000`) and carries three commits on top: `91c30008b` (the build), `c24cc1565` (fix round 1) and `75678fa12` (last call: stale test and check counts in ADR 0303's amendment and the claim row's prose, bracketed in place). `origin/main` is `155960b59`, which is already the merge base. **Base this PR on `feat/tables-learned-from-the-pos` until #621 merges.** It merges right after #621, and after `seatsnote` if that one lands first; the two share only ADR 0303 (see Merge order). **After #621 squash-merges, do not plain-merge main into this branch: git reports no conflict in `table-analytics.service.ts` but leaves two `renameOrHideTable` methods.** Use the recipe in Merge order, item 1.

## What was wrong for the owner

Under the founder's digit rule (#621), a till word with no number in it ("Bar", "Window", "Booth") never makes a table. His pick named the cost: such a table is *"added once by hand in the table control"*. No screen could add one. The only writer was `POST /analytics/tables/:restaurantId` (`AnalyticsController.upsertTable` at `0863ae2d2`), and it:

- had no web or mobile caller, and one script caller: the ADR 0093 scenario runner (`scripts/simulate/scenario_apply.py`, `upsert_tables`, called from `scripts/simulate/cli.py`), which posted `{label, seats}` for every scenario table on each `--apply` and relied on the upsert;
- admitted any signed-in member of the house (fixture row `"open"`);
- upserted on the label, so posting a name another table already had overwrote that table's seats and geometry;
- wrote `seats` 2 and `is_outdoor` false when none was given: answers nobody gave (ADR 0020; ADR 0303 residual 4).

Once #621 merges, 14 production checks keep a digitless word with no table: 2 "booth" checks at Tuzlu and 12 first-name checks at Sim Meyhouse. The source is round 2 of the coordinator's read-only dry run, 2026-10-05 ~16:10Z. Without this PR they would have no way to reach a table.

## What changed and why

Twelve files (eight in the first commit, four more in fix round 1; the last-call commit touches two of them again). The founder's option text estimated *"About 4 files"* and the brief aimed at about 4, at most 8. The other files are tests and records (the spec, the web test, the pytest file, ADR 0303, the claim row) and three fixes the verifier required: the route's one other caller, the scenario runner (`scenario_apply.py`, `cli.py`), and the shared failure line that doubled a full stop (`SectionKit.tsx`).

| File | Change |
|---|---|
| `apps/api-gateway/src/analytics/analytics.controller.ts` | `upsertTable` → `addTable`, `@UseGuards(RolesGuard) @Roles("owner", "manager")` (fork F1); the try/catch that turned every error into a 400 is gone |
| `apps/api-gateway/src/analytics/table-analytics.service.ts` | `upsertTable` → `addTable`: validate, refuse a clash with 409, insert, count the checks it took |
| `apps/api-gateway/src/auth/guards/route-access.expected.json` | the row becomes `AnalyticsController.addTable: ["owner","manager"]` (was `upsertTable: "open"`); still 200 rows |
| `apps/api-gateway/src/analytics/add-a-table-by-hand.spec.ts` | new, 36 cases (32 in the first commit, 4 in fix round 1) |
| `apps/web/src/pages/settings/next/PosSection.tsx` | "Add a table" for an owner or a manager; the new row's sentence |
| `apps/web/src/pages/settings/next/add-a-table-by-hand.test.tsx` | new, 11 cases (10 in the first commit, 1 in fix round 1) |
| `.planning/decisions/0303-tables-learned-from-the-pos.md` | dated amendment before Evidence; five in-place brackets; at last call, four count brackets inside the amendment's own Evidence |
| `.planning/decisions/claims.d/feat-add-a-table-by-hand.jsonl` | one static claim row |
| `scripts/simulate/scenario_apply.py` | fix round 1: `upsert_tables` → `ensure_tables`, which reads the house's tables and adds only the missing ones |
| `scripts/simulate/cli.py` | fix round 1: calls `ensure_tables`, prints how many were added and how many were already there, and its step-1 comment no longer says a later table never attaches (#621's trigger re-links) |
| `scripts/test_simulate_scenarios.py` | fix round 1: the fake transport answers the table route as the gateway now does; 4 new tests |
| `apps/web/src/pages/settings/next/SectionKit.tsx` | fix round 1: the shared failure line drops a sentence's own full stop, so it is not doubled |

**Who can add.** An owner or a manager. RolesGuard is exact (ADR 0164), so staff and admin get 403, and the class JwtAuthGuard pins `:restaurantId` to the caller's house. Anyone else sees the list without the control, and reads *"Only the owner or a manager can rename or hide a table. Adding one by hand is theirs too."* With an empty list they read *"Only the owner or a manager can add a table by hand."*

**What an add does.**

- **It only inserts.** The name is trimmed and must be 1 to 60 characters.
- **A name the house already answers to is a 409.** The comparison ignores case and surrounding spaces, and the sentence names the table:
  - a shown table with that name: *This house already has a table called "T7".*
  - a hidden one: the same sentence, plus *It is hidden: show it again instead of adding it.*
  - a retired one: *A table this house no longer uses is already called "Old bar", so the name cannot be added again.*
  - a till word an active table already catches in its `pos_refs`: *The till's word "T12" already goes to the table "Garden 12", so a new table by that name would catch no check.*

  A unique violation from the database (`23505`) is a 409 too. Settings shows the sentence where the save failed, followed by *"No table was added."*, and keeps the form open. The line reads `That did not go through — This house already has a table called "T7". No table was added.`: `SaveFailure` now drops the sentence's own full stop, so it is not doubled. A refused rename gets the same single stop and keeps its clause, *"The tables above are still the server’s."*
- **A value the body does not give is NULL.** `seats` and `is_outdoor` are written as NULL explicitly, because #621 dropped NOT NULL but kept the column defaults (2 and false). A value the body does give is validated; an invalid one is a 400. The ranges are what the columns hold, both ends allowed: seats 1 to 999, each distance 0 to 9,999.99 (`numeric(6,2)`), each position -999,999.99 to 999,999.99 (`numeric(8,2)`). A value past an end would round past it in Postgres and fail as a 500. The Settings form sends `{ label }` only.
- **The waiting checks join it in the same statement.** The insert carries no `learned_at`, so #621's `restaurant_tables_relink_on_add` trigger runs (`WHEN (NEW.learned_at IS NULL AND NEW.is_active)`). It fills `table_id` on the house's unlinked checks whose word now resolves to the new table through `pos_table_for_ref`. The gateway keeps no copy of the matching rule. #621's SQL test T23 already pins that an owner-added "Bar" links both past and new "bar" checks.
- **The answer says how many it took.** It carries `checksLinked`: the house's checks whose `table_id` is the new table, counted right after the insert. That count is null when it cannot be read, never 0. The list is then re-read, and the new row says one of:
  - *Added just now. It took 2 checks that were waiting with its name.*
  - *… No check was waiting with its name.*
  - *… How many waiting checks it took could not be counted.*
- **Failures say what happened.** A failed read of the house's tables is a 503 and nothing is inserted. Any other write error is a 500 with no database text.

**The route's other caller: the scenario runner.** `scripts/simulate/scenario_apply.py` (ADR 0093) is the one in-repo caller besides Settings. It posted `{label, seats}` for every table of a scenario on each `--apply`, and its docstring leaned on the upsert. Against a house that already had those tables, the new 409 would stop the first POST. The CLI would then record `tables: …` as a failure and exit 1 (`cli.py`, the failures block), so any `--replay` or later day would fail. Now:

- `ensure_tables` (was `upsert_tables`) reads `GET /analytics/tables/:restaurantId` first: active tables, hidden ones included. It posts only a label that no table answers to, by its label or by a till word in its `pos_refs`, trimmed and in any case, as the gateway compares.
- A table already there keeps its seats. The old upsert overwrote them with the scenario's; nothing in the expectation reads seats.
- A 409 that still comes back (a retired table has the name, or another writer added it meanwhile) raises with the gateway's sentence. Those checks would land with no table, so it is a failure, not "there".
- The CLI prints `tables: N added, M already there`.
- The runner logs in with `SIM_OWNER_EMAIL`. If that login is not an owner or a manager, an add is now a 403 and the run fails with it. A run that needs no add is unaffected, since the GET is open to every member. Which role that account holds was not checked.

## Tests and guards

**Gateway jest** (`env LC_ALL=C npx jest <specs> --runInBand --forceExit`):

- `add-a-table-by-hand.spec.ts`, 32 cases in the first commit (36 after fix round 1, below):
  - the route's metadata, and the real RolesGuard: owner and manager admitted; staff, admin and no role refused;
  - 14 bodies refused with 400;
  - each 409 sentence;
  - a word only a retired table caught is free;
  - `23505` → 409;
  - the exact inserted row, with NULLs and no `learned_at`;
  - given values are kept;
  - `checksLinked`, scoped by house and table id, and null on a count error;
  - 503 and 500.
- **Before the change:** with #621's sources at `0863ae2d2` restored into the tree, 32 of 32 fail.
- **Mutations, each killed:**
  - `seats ?? 2`: 1 fail;
  - the name clash removed: 3;
  - the `pos_refs` clash removed: 1;
  - `@Roles` removed: 4;
  - admin added to `@Roles`: 2;
  - `checksLinked: count ?? 0`: 1.
- **After the change**, together with `route-access.spec.ts` and `tables-learned-from-the-pos.spec.ts`: **66 of 66 pass**, re-run on `f5cbccdd4` plus this commit. `route-access.spec.ts` fails with the new controller and the old fixture row.
- `tsc --noEmit -p tsconfig.spec.json`: clean apart from the known `@simplewebauthn/server` errors.
- `eslint`: clean on the service and the spec. The controller's 6 warnings are all on lines this PR does not touch.

**Web vitest:**

- `add-a-table-by-hand.test.tsx`, 10 cases in the first commit (11 after fix round 1, below):
  - an owner or a manager is offered the form: one textbox, maxlength 60, no seats field;
  - staff, with tables and with none, see no control and read who may add;
  - an owner with no table yet can still add one;
  - an add posts `{ label: 'Bar' }` under writer key `table:add`, re-reads the list, and the new row says it took 2 checks;
  - counts of 0, 1 and null are each said as such;
  - a clash shows the gateway's sentence in the SaveFailure alert, the form stays open, and nothing is re-read;
  - a blank name cannot be sent, and Cancel closes the form.
- **Before the change:** with #621's sources restored, 10 of 10 fail.
- **Mutations, each killed:**
  - the add offered to everyone: 2 fail;
  - the re-read removed: 4 fail.
- **After the change**, together with #621's `tables-learned-from-the-pos.test.tsx`: **23 of 23 pass**.
- `tsc --noEmit` is clean apart from the known `@simplewebauthn/browser` worktree error, and `eslint --quiet` is clean on both files.

**Fix round 1** (one more commit on top; no history rewritten):

- **Scenario runner, pytest** (`python3 -P -m pytest -c /dev/null --confcutdir=scripts scripts/test_simulate.py scripts/test_simulate_hours.py scripts/test_simulate_scenarios.py -q -p no:cacheprovider`, as CI runs it): **137 passed**. `test_simulate_scenarios.py` has 81, 4 of them new:
  - a `--replay` against a house that has its tables exits 0, posts no table and prints `tables: 0 added, N already there`;
  - only the names no table answers to are posted (a padded label, a `pos_refs` word, a hidden table and a numeric `pos_refs` word each count as there);
  - a retired name fails with `HTTP 409` and the gateway's sentence;
  - a table list that is not a list raises and adds nothing.
  - **Before the change**, with the round-0 runner and CLI restored, all 4 fail. The replay one fails exactly as reported: `tables FAILED: POST …/analytics/tables/… -> HTTP 409: … already has a table called \"3\".`, exit 1.
  - **Mutations, each killed:** `pos_refs` ignored (1 fails), an exact-case compare (1), no read first (2), a 409 counted as there (1).
  - `black --check` and `ruff check` are clean on the three files (CI lints only `services/agent-orchestrator`).
- **Gateway jest:** `add-a-table-by-hand.spec.ts` now has 36 cases. Three new 400s: a distance of 9,999.999, which `numeric(6,2)` rounds to 10,000.00; an `x_pos` of -1,000,000; a `y_pos` of 999,999.995. They fail on the round-0 service. A new case keeps the largest values the columns hold, and making max exclusive fails it. With `route-access.spec.ts` and `tables-learned-from-the-pos.spec.ts`: **70 of 70 pass**. `tsc` and `eslint` are clean as before.
- **Local Postgres** (container `fixlane-pg`, a read-only `SELECT` on its `postgres` database; appended to `audits/addtable-local-pg.txt`): `9999.999::numeric(6,2)`, `(-1000000)::numeric(8,2)` and `999999.995::numeric(8,2)` raise `numeric field overflow`, while `9999.99` and `999999.99` fit.
- **Web vitest:** `add-a-table-by-hand.test.tsx` now has 11 cases. The clash case asserts the whole alert text, and a new case does the same for a refused rename. On the round-0 `SectionKit.tsx` both fail; on the round-0 `PosSection.tsx` the clash case fails. With #621's test: 24 of 24. All of `src/pages/settings`: **189 of 189** (13 files), since `SaveFailure` is shared by 14 sections. `tsc` and `eslint --quiet` are clean.
- **Claim row** `ADR-0303-AN-OWNER-OR-MANAGER-ADDS-A-TABLE` now has 9 checks, numbered 0 to 8 (an earlier copy of this body said 10; the verify's list has nine entries):
  - check 4 adds the inclusive ranges;
  - check 8 is new: the runner reads before it posts, tests presence, has no `upsert_tables`, and the CLI calls `ensure_tables`.
  - On the round-0 sources it fails checks 4 and 8.
  - **Mutations, each killed:** the runner reverted (8), no GET (8), no presence test (8), max exclusive (4), distance max 10000 (4), `x_pos` ±1,000,000 (4).
  - A comment-only control holds.
  - `check_decision_claims.sh`: **880 of 880 hold**.
- **Guards** re-run on the fix-round tree, each with its `--self-test`, rc 0: the 19 listed under "Guards" below, plus `check_money_states_its_currency`, `check_test_scripts_are_real`, `check_no_vendored_deps`, `check_nightly_manifest` (the nightly runs `test_simulate_scenarios.py`), `check_sentry_pii_scope`, `check_flag_readby_anchors` and `check_ask_field_classes`.

**SQL.** This lane changes no SQL and adds no SQL test. The trigger it relies on, and T23, are #621's. Because the stacked branch carries #621's migration, the verifier ran #621's test through the lane harness on this branch (`pgtest.sh lane … addtable`; appended to `audits/addtable-local-pg.txt`):

```
applied 4 migration(s) to addtable_fix
[fix] PASS 20261222160000_tables_learned_from_the_pos_test.sql
[ctl] FAIL 20261222160000_tables_learned_from_the_pos_test.sql: ERROR:  column "table_ref" of relation "pos_checks" does not exist
template=28d32de368d3f57df52ce6f490758908d9fa924d lane_migrations=4 tests=1
```

This proves #621's migration on this branch, not anything of this lane's. The verifier also ran a rolled-back one-off in `addtable_fix` with the gateway's exact insert (seats, is_outdoor, zone, distances and positions NULL, no `learned_at`): it linked the two waiting `booth` and `Booth ` checks and not `booths`, and the row came back with `seats` and `is_outdoor` NULL.

**Claims.**

- `env LC_ALL=C bash scripts/check_decision_claims.sh`: **880 checked, 880 holding**.
- The new row `ADR-0303-AN-OWNER-OR-MANAGER-ADDS-A-TABLE` holds on the lane. In the first commit it had 8 checks and failed all 8 on #621's sources; it now has 9, and at last call all 9 fail on #621's sources at both `0863ae2d2` and `f5cbccdd4` (the verify run from a tree of those files).
- Each of these mutations fails it:
  - `@Roles` removed (check 0);
  - the fixture row back to `"open"` (2);
  - `.upsert(` back (3);
  - `seats || 2` (3);
  - `is_outdoor` defaulting to false (4);
  - the name clash removed (5);
  - `checksLinked: count ?? 0` (6);
  - the add offered to everyone (7).
- A comment-only control still holds.

**Guards**, each run on the final tree with its `--self-test`, rc 0:

`check_adr_numbers_unique`, `check_citation_pairing`, `check_od_ids_exist`, `check_no_conflict_markers`, `check_read_errors_not_swallowed`, `check_read_columns_exist`, `check_queried_tables_exist`, `check_route_exposure`, `check_no_seeded_defaults`, `check_web_reads_gateway_dto_keys`, `check_analytics_cost_honesty`, `check_windowed_figures`, `check_proposal_preservation`, `check_a_count_is_recorded`, `check_money_routes_are_sealed`, `check_voice_gate_coverage`, `check_ask_ai_is_gated`, `check_migration_versions_unique`, `check_migration_order`.

**Last call** (re-run on this worktree at `c24cc1565`, then the claims and guards again at `75678fa12`; the last commit changes only ADR prose and the claim row's prose):

- Gateway jest, `add-a-table-by-hand.spec.ts` + `tables-learned-from-the-pos.spec.ts` + `route-access.spec.ts`: **70 of 70 pass** (3 suites).
- Web vitest, `add-a-table-by-hand.test.tsx` + `tables-learned-from-the-pos.test.tsx`: **24 of 24 pass**.
- Scenario runner pytest, as CI runs it: **137 passed**.
- `check_decision_claims.sh`: **880 checked, 880 holding**, before and after the last commit.
- Guards, each with its `--self-test`, rc 0/0: `check_adr_numbers_unique`, `check_route_exposure`, `check_web_reads_gateway_dto_keys`, `check_no_seeded_defaults`, `check_read_errors_not_swallowed`, `check_read_columns_exist`, `check_queried_tables_exist`, `check_citation_pairing`, `check_od_ids_exist`, `check_no_conflict_markers`, `check_nightly_manifest`, `check_test_scripts_are_real`. After the last commit, `check_citation_pairing`, `check_od_ids_exist`, `check_no_conflict_markers` and `check_adr_numbers_unique` again rc 0.
- Not re-run at last call: `tsc` and `eslint` (the verifier ran both on `c24cc1565`, and the last commit touches no code).

## ADR / CLAIMS touched

- **ADR 0303** (amendment only; no new ADR). A section, *"Amendment 2026-10-05 — an owner or a manager adds a table by hand (lane `addtable`)"*, sits between "Revisit when" and "## Evidence". It covers:
  - the answers, verbatim;
  - who can add, and what an add does to waiting checks;
  - the choices built the least surprising way;
  - seven residuals, and the evidence.
- **In-place brackets** in ADR 0303:
  - option 1a, "No screen adds one yet";
  - Decision, "No copy claims a screen that adds a table";
  - the Decision's last bullet, "the control is owed";
  - residual 4, seats 2 (fixed for this route);
  - residual 12 (built).
- **No Review-trail row** was added. #625 and `seatsnote` both append to the end of the file, so the attribution is in the section itself.
- **`claims.d/feat-add-a-table-by-hand.jsonl`**: the one new row.
- **`CLAIMS.jsonl` is not edited.** Row `ADR-0164-ROLES-EXACT-MANAGERS-KEPT` pins the fixture's size (200), which still holds. See "Not covered".

## Founder answers (verbatim)

- **Fork 1 of #621** (2026-10-05 ~16:00Z, AskUserQuestion). His pick: **"Follow-up: 'Add a table' (Recommended)"**. The option text read: *"A small separate PR adds 'Add a table' to Settings → Point of sale, for owners and managers. Waiting checks with that word link to it automatically. About 4 files. #621 merges as it is."* He rejected *"Build it into #621"* and *"Leave it"*.
- **Fork F1** (2026-10-04): *"Owner or manager (Recommended)"*.
- **The digit rule** (2026-10-05 ~14:15Z): *"Only words with a number (Recommended)"*. Its option text named this control's job: *"a table named only 'Bar' or 'Window' must be added once by hand in the table control."*
- **Seats** (2026-10-05 ~16:00Z): *"Explain the empty chart now (Recommended)"*, rejecting *"Add a seats field"*. So the form asks for a name only.

## Forks deferred (the founder's call, not made here)

Each was built the least surprising way. None is locked.

1. **A name a retired table has.**
   - **(a) Refuse with 409 and say so. Built.**
   - (b) Re-activate the retired table instead. Its old checks would come back into the table figures, and its words would re-link through the trigger.
   - (c) Allow a second table with that name in a different case. The database's unique index is case-sensitive, so it would accept this, but two tables would then answer the same word.
   - Recommend **(a)**. Re-activation is a different act from adding, and no answer asks for it. No screen re-activates a table today, and how many retired tables production holds was not checked.
2. **A name that is a till word another active table already catches** (in its `pos_refs`).
   - **(a) Refuse with 409, naming that table. Built.**
   - (b) Allow it. The new table would catch no check from that till, because `pos_refs` outranks a label.
   - (c) Move the word to the new table. That changes where future checks go, and it would have to decide what happens to past links.
   - Recommend **(a)**. Its cost: the comparison ignores which till a word came from, so in a house with two tills it can over-refuse.
3. **The fields the route still accepts.**
   - **(a) Keep accepting seats, is_outdoor, zone, distances and position: validated when given, NULL when not. Built.**
   - (b) Accept the name only, and 400 anything else.
   - Recommend **(a)** for this PR, to keep the change narrow. The founder ruled out drawing the room (*"No drawing."*) and a seats field. No screen sends these fields, and (b) is a one-line follow-up if he wants the route to match the screen.
4. **What staff see.**
   - **(a) The list, no control, and a sentence saying who may add. Built.**
   - (b) No sentence.
   - Recommend **(a)**. It matches #621's rename and hide sentence.
5. **What "how many waiting checks it took" counts.**
   - **(a) The checks whose `table_id` is the new table, counted right after the insert. A new table can hold no check before its insert, so this is what the trigger linked. Built.**
   - (b) Have the database return the trigger's own count. That needs SQL, for no difference in the number.
   - Recommend **(a)**.

## Merge order

1. **#621 first.** This branch contains #621's current head `f5cbccdd4` and adds three commits.
   - If #621 gains commits before it merges, the coordinator **merges** #621's new head into this branch (never a rebase).
   - After #621 squash-merges, the coordinator brings this branch onto main **by merges** (never a rebase or a force-push), then retargets the PR to main.
   - **Do not do a plain `git merge origin/main` here: it silently duplicates code.** In the trial below, a plain merge of the squash auto-merged `table-analytics.service.ts` with **no conflict reported**, and left **two `async renameOrHideTable(` methods** in the class. The merge base is pre-#621 main, so git sees #621's method as inserted on both sides at different offsets: this branch replaced `upsertTable` right above it. It also conflicts in ADR 0303 (add/add) and `PosSection.tsx`. Instead, with `<sq>` as #621's squash commit on main:
     1. `git merge <sq>^`: main just before the squash, with no #621 content. That is a normal merge, and a no-op if nothing else landed.
     2. `git diff <sq> f5cbccdd4 --stat`: must be empty, which proves the squash is exactly #621's head. If it is not empty, stop and merge #621's final head first.
     3. `git merge -s ours <sq>`: records the squash, whose content this branch already holds.
     4. `git merge origin/main`: anything that landed after the squash, as a normal merge.
   - **Check after step 3:** `git diff <sq> HEAD --stat` lists exactly this lane's files: 8 at `91c30008b` (807+/36-; the trial gave exactly that), 12 at `c24cc1565` and at `75678fa12` (1062+/57-; re-trialled at last call, see item 4 and "File count").
2. **#625** (`fix/hidden-tables-leave-insights`, also stacked on #621, based on the older `b440d85fa`). The two branches share four files: ADR 0303, the controller, the service and `PosSection.tsx`.
   - **This branch adds no conflict region of its own** (trial merge below). #625 already conflicts with #621's head, in 4 ADR 0303 regions and 1 `PosSection.tsx` region, because it was cut before #621's digit-rule rework.
   - The controller and the service auto-merge.
   - One of #625's existing ADR regions holds Decision's "Nothing is drawn" bullet (line 48), which this branch brackets at its end. Whoever resolves it should keep:
     - #621's digit-rule wording;
     - #625's rewrite of the next bullet ("correlations and drivers");
     - this branch's bracket at the end of line 48.
3. **`seatsnote`** (`fix/seats-chart-says-why-it-is-empty`, also on #621) shares only ADR 0303 with this branch.
   - Its brackets are on lines 53 and 91, and its section goes at the end of the file.
   - This branch's nearest hunks are lines 51 and 89, each one unchanged line away. Keep every section side by side.
4. **Trial merges.** All run with `git merge-tree --write-tree` (git 2.52), object-only, at `91c30008b`. The squash trial was repeated at `c24cc1565` with the same results: the squash tree equals `f5cbccdd4`'s, a plain merge conflicts in ADR 0303 and `PosSection.tsx` and leaves 2 `renameOrHideTable(` definitions (lines 207 and 303), and the recipe's diff from the squash is the lane's 12 files.
   - **#621's squash, simulated:**
     - `origin/main` merged with `f5cbccdd4` merges clean;
     - its tree equals `f5cbccdd4`'s tree, with an empty diff.
   - **A plain merge of that squash into this branch:**
     - conflicts in ADR 0303 (add/add) and `PosSection.tsx`;
     - silently duplicates `renameOrHideTable` in the service: 2 definitions;
     - even with `-X ours`, its tree differs from this branch's by those 96 lines.
   - **The recipe in item 1:** the result's diff from the squash is exactly this lane's 8 files.
   - #625 and `seatsnote` each merged with the same simulated squash keep one `renameOrHideTable`; the duplication is this branch's alone.
   - **#625** (`1a62bec78`): 4 conflict regions in ADR 0303 and 1 in `PosSection.tsx`, the same counts as #625 against `f5cbccdd4` alone.
   - **`seatsnote`** (`001b68b7f`): merges clean. Re-trialled at last call with its current head `ef8c08605` (no PR yet): clean, with one `renameOrHideTable(` and one `addTable(`.
   - **Last call, at `75678fa12`:** a plain merge of a simulated #621 squash still conflicts in ADR 0303 and `PosSection.tsx` and still leaves 2 `renameOrHideTable(` definitions, so item 1's recipe stands. #625 at `1a62bec78` still gives 4 ADR 0303 regions and 1 `PosSection.tsx` region, the same as against `f5cbccdd4` alone.
   - **Other open PRs sharing a file** (from `gh pr view N --json files`, last call): #564 (controller, `route-access.expected.json`), #609 and #615 (service), #616 (controller). The verifier's object-only trial merges with each found no conflict region added by this lane.

## File count

- Against `origin/main` this branch shows 22 files, because it carries #621 unmerged (merge base `155960b59`).
- Against #621's head `f5cbccdd4`, the lane is 12 files: the 8 of the first commit and 4 from fix round 1.
- It meets the 15-file cap only once #621 has merged and this PR is retargeted to main by the recipe above. Until then, base it on `feat/tables-learned-from-the-pos`.

## Deploy order

- **The gateway needs #621's migration first.** It writes `seats` and `is_outdoor` as NULL, which needs the migration's `DROP NOT NULL`. #621 merges first and its migrations apply on merge, so this holds in the normal order. Against an unmigrated database, an add fails with a 500 and writes nothing.
- **Gateway (Railway) before web (Vercel), or accept a short window.** While the new web runs against the old gateway:
  - an add goes to the old `upsertTable`, which is unguarded, upserts on an exact label, and writes seats 2;
  - the row's sentence says the count *"could not be counted"*, because the old answer has no `checksLinked`.
- **No flag.** Nothing here is behind one.

## Production

- **No production read or write by this lane.** There is no migration and no SQL change.
- **No row changes on merge.** Rows change only when an owner or a manager adds a table.
- For forks 1 and 2, a **read-only** look the coordinator may run if the founder wants numbers. It has not been run. Run the third query only after #621's migration has applied.

```sql
BEGIN READ ONLY;
-- Fork 1: retired tables per house (names an add would refuse).
SELECT restaurant_id, count(*) AS retired_tables
FROM restaurant_tables WHERE NOT is_active GROUP BY restaurant_id;
-- Fork 2: till words active tables already catch, per house.
SELECT t.restaurant_id, count(*) AS caught_words,
       count(DISTINCT lower(btrim(w.value))) AS distinct_words
FROM restaurant_tables t
CROSS JOIN LATERAL jsonb_each_text(
  CASE WHEN jsonb_typeof(t.pos_refs) = 'object' THEN t.pos_refs ELSE '{}'::jsonb END) w
WHERE t.is_active GROUP BY t.restaurant_id;
-- After #621's migration: the waiting checks a hand-added table could take.
SELECT restaurant_id, count(*) AS waiting_checks,
       count(DISTINCT lower(btrim(table_ref))) AS distinct_words
FROM pos_checks WHERE table_id IS NULL AND table_ref IS NOT NULL
GROUP BY restaurant_id;
ROLLBACK;
```

## Not covered (CLAUDE.md §0.5)

- **The register and export sentences** still say *"rename or hide it under Settings → Point of sale"* and do not mention adding (ADR 0303 amendment, residual 1). They live in `rp-registers-house.tsx`, which `seatsnote` edits, and `report-export-cuttings.ts`, which #625 edits. Changing them here would add two more overlapping files.
- **No audit row** for an add (as for rename and hide; residual 3 of the ADR).
- **The column defaults remain** (`seats` 2, `is_outdoor` false), so any other writer that leaves them out still gets them. Only this route writes NULL.
- **The runner's login role.** The scenario runner logs in with `SIM_OWNER_EMAIL`. Whether that account is an owner or a manager in each house it runs against was not checked; if not, an add is now a 403 and the run says so.
- **No live run of the scenario runner.** `ensure_tables` was tested with the suite's fake transport, which now answers the table route as the gateway does. It was not run against a gateway.
- **No Browser-pane check.** The vitest drives the real `TillTablesOpener` in jsdom, with the page's writer and React Query. Nobody looked at a rendered page in a browser: the no-server fixture recipe needs the main checkout, which a fix lane may not touch, and a live Settings page needs a signed-in gateway.
- **The `.planning/06-pages` doc for /settings** is not updated (ADR 0303 residual 10's reason).
- **`CLAIMS.jsonl` row `ADR-0164-ROLES-EXACT-MANAGERS-KEPT`.**
  - Its verify (200 fixture rows, the ten pinned rows) still holds. Its prose log of fixture changes does not record this one, which renames one key and narrows one row from open to owner/manager.
  - It was left unedited, as #564 left it for its goal rows, because #621 already amends that same line and any in-place edit here would conflict on it.
  - If the gate wants the log complete, the bracket belongs in a later docs pass.
- **No ownership-classifier run** (`pr_audit_gate.py --ownership`): it needs a PR number, and this branch is not pushed.
- **The file count is three times the founder's estimate.** His option text read *"About 4 files"*; the lane is 12 against #621's head (see "What changed and why" for which and why). It is under the 15-file cap only once #621 has merged and the PR is retargeted (see "File count").
- **`SaveFailure` is shared.** Dropping one trailing full stop from a gateway sentence changes the failure line of all 14 Settings sections that use it, not only the tables'. All 189 tests in `src/pages/settings` pass; a message that ends in an ellipsis would lose one of its dots.
- **Case-folding of non-ASCII letters was not compared.** The gateway compares names with JavaScript's `toLowerCase()`, the runner with Python's `lower()`, and the resolver with Postgres `lower()`. For ASCII they agree; for letters such as the Turkish `İ`/`ı` they were not checked against each other.
- **The house's tables are read without an explicit limit**, so the clash check sees at most PostgREST's default page (about 1,000 rows). No real house is near that.
- **Commit `91c30008b`'s body says the old route "had no caller".** The scenario runner was one. `c24cc1565` and the ADR amendment correct it; history is not rewritten.
- **Two tills, one word** (ADR amendment residual 5): the `pos_refs` clash ignores which till sent a word, so it can refuse a name that only the other till's table catches.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
