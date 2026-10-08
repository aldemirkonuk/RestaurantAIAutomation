> **[2026-10-07 21:05Z, fixer, local head a78a2adfb, after the ADR 0090 audit BLOCK at 84aec1eea]**
>
> New head: `a78a2adfb`, on merge-base `ca3582988`. It is local only and not pushed. It has 15 files against origin/main. The pushed head `84aec1eea` is stale. origin/main has since moved to `a323cc80b` (#613, locations: no migration, no cellar file). `git merge-tree` shows a clean merge, but it is not merged in.
>
> The audit (`audits/628-84aec1eea/report.md`) blocked on this: the page said no invoice had been filed, but the door row steps aside only for an invoice linked to the order or paired with its line. So a filed but unlinked invoice counts twice. This round narrows the words, names the limit and pins it. It does not decide whether an unlinked invoice should make the door row step aside. That fork is open, and the coordinator is deciding it under the founder's 2026-10-07T20:04:10Z delegation (research running).
>
> Commits since `84aec1eea`:
> - `3c9246e2d` fix(cellar): say "no invoice linked to this order", not "no invoice filed". This changes words only, and no SQL statement changed (checked by diff).
>   - `cellar-format.ts`: `DOOR_CHECKED_NOTE` / `DOOR_CHECKED_SOURCE`.
>   - `cellar-columns.ts`: First bought meaning, and Paid source and meaning.
>   - Comments in `registerCells.tsx`, `useCellarNextData.ts` and `house-record.ts`.
>   - The migration's comments and both `COMMENT ON` strings.
>   - `CellarNext.test.tsx`: the mark's `title` is asserted, plus one new case that fails on the old copy.
> - `0245e7ab0` test(cellar): pin one delivery counted twice when its invoice is not linked.
>   - SQL T18: one delivery with a door check and an unlinked invoice reads Paid 420 and 12 bottles. After a link is inserted it reads 210 and 6.
>   - New open CLAIMS row `CELLAR-DOOR-ROW-STEPS-ASIDE-FOR-AN-UNLINKED-INVOICE`.
>   - The resolved row's text now says "linked or paired" (its verify is unchanged).
> - `a78a2adfb` docs(adr-0301): name the unlinked-invoice double count and record the audit.
>   - A dated entry under *Harder / given up*, with the open fork left to the coordinator.
>   - Three NARROWED brackets, keeping the existing words.
>   - A review-trail row for the audit and this fix.
>
> Local Postgres, run as instructed (`pgtest.sh lane /Users/aldemirkonuk/Projects/wt-fix-cellardoor refix628`):
> ```
> applied 2 migration(s) to refix628_fix
> [fix] PASS 20261223030000_a_house_zone_says_where_it_came_from_test.sql
> [fix] PASS 20261223060000_the_cellar_counts_the_door_checked_price_test.sql
> [ctl] FAIL 20261223030000_a_house_zone_says_where_it_came_from_test.sql: ERROR:  T0 FAIL restaurants.timezone_source is absent, expected text
> [ctl] FAIL 20261223060000_the_cellar_counts_the_door_checked_price_test.sql: ERROR:  T1 FAIL first_bought = , expected 2026-08-03 (the door check)
> template=42fe1252b3fcec0566a5fee0960affbcab27c07f lane_migrations=2 tests=2
> ```
> - The zone test is main's (`20261223030000`). The harness applies it because the template `42fe1252b` predates it, so its `[ctl]` FAIL only shows the template is stale.
> - The named run (`refix628b`: door, till, menu) gave `[fix] PASS` ×3, `[ctl] FAIL` door at T1, and `[ctl] PASS` till and menu. Output: `template=42fe1252b… lane_migrations=2 tests=3`.
>
> Mutations:
> - SQL, on a scratch clone, rolled back, with the committed migration untouched. The door function was made to also step aside for an unlinked invoice of the same key, date and vendor. T1–T17 PASS. T18 FAIL "T18 FAIL o24 has 0 door rows, expected 1: the door row stepped aside for an invoice nobody linked…".
> - Web: with `cellar-format.ts` and `cellar-columns.ts` reverted to `84aec1eea`, the new CellarNext case fails.
> - The open claim's verify:
>   - It gives rc=1 unmutated (the claim does not hold yet, as `open` requires).
>   - It flips to rc=0 on each of these: a 4th `NOT EXISTS` in `house_door_checked`; pairing widened by `description` or `vendor_sku`; the ledger's `door` CTE anti-joined to `inv`.
>   - An unrelated `WHERE dc.paid > 0` stays rc=1.
>   - A renamed function or a missing file prints "cannot open" (loud, not passing).
>   - The 4 resolved rows each still hold (rc=0).
>
> Tests at `a78a2adfb`:
> - apps/web `npx vitest run src/pages/cellar`: `Test Files 15 passed (15)`, `Tests 303 passed (303)`.
> - apps/api-gateway `npx jest src/beverages src/cellar --forceExit`: `Test Suites: 7 passed`, `Tests: 152 passed, 152 total`. This includes house-record.spec.
> - eslint `--quiet` on the 5 touched web files: rc=0 (with the scratch plugin dir). Gateway `house-record.ts`: rc=0.
> - `tsc --noEmit`:
>   - Web has 1 error and the gateway has 2. All are `@simplewebauthn/*` not found, in passkeys files that are not in this PR (the linked node_modules lacks the package).
>   - This is the same as at `e84c06eca`.
> - `lanecheck.sh wt-fix-cellardoor`: all 6 checks rc=0, files=15, ownership rc=0 `[]`.
>
> Skipped or not done, stated plainly:
> - Not pushed, and the PR body is not edited.
> - `check_decision_claims.sh` was not run by the fixer (the coordinator runs it).
> - There was no Browser-pane check of the changed hover and column words. The vitest DOM cases stand in for it.
> - `main_tpl` is still `42fe1252b`. It is shared and was not rebuilt.
> - origin/main `a323cc80b` is not merged in.
> - The ADR README row for 0301 still says "the methods are Proposed". It is untouched, because a 16th file would break the 15-file cap.
> - The fork is undecided, and the CI audit has not re-run at this head.
>
> **Stale lines in the live PR body (277 lines, fetched 2026-10-07; numbers are the body's own, with the original body starting at L127) and their replacements:**
> 1. L1 "Pushed head `84aec1eea`…": update on push to the new head.
> 2. L9 "**This PR has never been audited.** A full ADR 0090 audit is owed before merge." → "Audited (ADR 0090) at `84aec1eea`: BLOCK (copy broader than code on filed vs linked invoices). Fixed at `a78a2adfb`; re-audit owed at the new head."
> 3. L129 "…Branch `fix/cellar-door-checked-cost` @ `f8dde42e6`." → "… @ `a78a2adfb`" (and the earlier note's item 1 wording).
> 4. L131 "**Stacking:** …" → "**Base:** main (merge-base `ca3582988`; origin/main now `a323cc80b`, clean merge-tree, not merged in)."
> 5. L133 "**Files:** 15 of this lane's own (`git diff --stat 767c79ae6 f8dde42e6`)." → "**Files:** 15 against origin/main (`git diff --name-only origin/main...a78a2adfb`)."
> 6. L145 "…until a filed invoice takes over." → "…until an invoice linked to the order, or paired with its line, takes over. One filed but not linked counts alongside (see Gaps)."
> 7. L147 "(version `20261221091500`; …)" → "(version `20261223060000`; …)".
> 8. L178 "The column help for First bought and Paid now says what each counts." → "The column help for First bought and Paid and the mark's note now say that the door check stands while no invoice is linked to the order, and that an invoice filed but not linked counts alongside."
> 9. L187 "### Tests, guards, harness (at `f8dde42e6`)" → "(at `a78a2adfb`)".
> 10. L190 "Gateway jest …: 150/150…" → "Gateway jest (`src/beverages src/cellar`, `--forceExit`): 152/152 (7 suites), re-run at `a78a2adfb`."
> 11. L191 "Web vitest (`src/pages/cellar`): 294/294…" → "Web vitest (`src/pages/cellar`): 303/303 (15 files). The new copy case fails on the old words."
> 12. L194 "Typecheck shows only the known simplewebauthn errors." → "Typecheck: web 1, gateway 2 errors, all `@simplewebauthn/*` not found (passkeys files, not in this PR)."
> 13. L195 "eslint: 0 errors." → "eslint `--quiet`: touched web files and `house-record.ts` rc=0."
> 14. L196 "…`check_migration_order` (3 lane migrations after `28d32de36`)…" → "`lanecheck.sh`'s 6 guards exit 0 at `a78a2adfb`, files=15, ownership `[]`."
> 15. L197 "`check_decision_claims.sh`: 865/865 hold." → coordinator's count at the new head (925/925 at `84aec1eea`; one open row added since, so the coordinator re-runs it).
> 16. L198 "Claims mutations: 24/24 caught." → keep, and add: "The open row `CELLAR-DOOR-ROW-STEPS-ASIDE-FOR-AN-UNLINKED-INVOICE`: rc=1 unmutated, rc=0 on a 4th `NOT EXISTS`, on pairing widened by description or SKU, and on a door-CTE anti-join to `inv`; an unrelated edit stays rc=1; a missing function prints 'cannot open'."
> 17. L200 SQL mutations → keep, and add: "Door function also stepping aside for an unlinked same-key invoice: T18 FAIL, T1–T17 PASS."
> 18. L202–212, the `pgtest.sh` block at `f8dde42e6` → the `refix628` block above (and the `refix628b` line).
> 19. L213 "The new test also fails in all 13 blocks on the PR-1 state." → "On main without the migration the test FAILs at T1 (the run stops there). T18 needs the migration too."
> 20. L215–226: change the heading to "What the 18 blocks cover", and add these rows:
>     - "| T14 | A door-only row sorts above a row with fewer books, and `p_limit` keeps it. |"
>     - "| T15 | A door check that saw no bill is not bought and lifts no row. |"
>     - "| T16 | The order moves no figure. |"
>     - "| T17 | Three door lines on one row are one book, not three or two. |"
>     - "| T18 | One delivery with a door check and an unlinked invoice counts twice (the recorded limit); linked, it counts once. |"
> 21. L230 "ADR 0301 §2 is now marked built. Its review trail has a 2026-10-05 row." → "ADR 0301 §2 is built, with the two 2026-10-07 picks under *Forks answered*. *Harder / given up* names the unlinked-invoice double count (2026-10-07). The review trail runs through the 2026-10-07 audit row."
> 22. L231 "…adds 3 new rows." → "adds 5 rows: 4 resolved, and 1 open (`CELLAR-DOOR-ROW-STEPS-ASIDE-FOR-AN-UNLINKED-INVOICE`)."
> 23. L232 "No README row is touched; the 0301 row came with PR-1." → keep, and add: "That row still says the methods are Proposed; it is not updated here (15-file cap)."
> 24. L234–241 "### Forks deferred" → replace with the earlier note's item 19 (*Forks answered*), and add: "**Open (not the founder's to answer now; the coordinator decides under the 2026-10-07T20:04:10Z delegation, research running):** should an invoice filed but not linked to the order, of the same delivery, make the door row step aside?"
> 25. L245–247 → the earlier note's items 20–22. #650 still also replaces the ledger body, so whichever merges second re-syncs to the first's.
> 26. L264 "**An invoice filed but neither linked … Tests T9 and T10 pin this behaviour. ADR 0301 states the take-over rule (linked or paired) but does not name this limit. …" → "**An invoice filed but neither linked to the order nor paired with its line does not take over.** Its bottles and money count alongside the door row, so that delivery is counted twice. SQL test T18 pins it by name (T9 and T10 sum an invoice line and a door row on one row the same way). ADR 0301 names it under *Harder / given up* (2026-10-07). Whether it should step aside is an open fork, decided by the coordinator under the founder's 2026-10-07T20:04:10Z delegation. Tuzlu files no paper, so this does not arise there today."
> 27. L266 "**The row order ignores door checks** (fork 2)." → delete (answered and built).
> 28. L270 "The second migration version is `…091500`…" → "The migration version is `20261223060000` (renumbered past main's `20261223030000` on 2026-10-07)."
> 29. L271 "There was no Browser-pane check of the marks." → keep. It holds for this round's word change too.
> 30. The earlier fixer note (L11–126) is history. Its replacements are folded into items 3–28 above, at the new head.

> **[2026-10-07 14:06Z, fixer, local head e84c06eca]**
>
> New head: `e84c06ecaea88fe98bdcbaaffb1685597beccc68`, on origin/main `b270a45b8` (merge-base `b270a45b8`). Local only, not pushed. 15 files against main. The pushed head `f8dde42e6` is stale; so is the note below at `33cdef10f`.
>
> Commits since `33cdef10f`, first-parent:
> - `372214e82` merges origin/main `b270a45b8` (#609, ADR 0292: `readWholeWindow`). No conflicts. `merge_main.sh` printed `MERGED 372214e82`. The migration keeps `20261223060000` (`check_migration_order` rc=0: newest on main is `20261223030000`).
> - `e84c06eca` strengthens SQL T17. With the old label, an `ORDER BY` whose door term is `CASE ... THEN 2`, or `least(door_checked_lines, 2)`, put Triple Door at 5, level with the five-order row, which won the tie by name, so T17 passed. The five-order row is renamed `Zqdc Yellow Five Orders` in T17 only, so it sorts after Triple Door and a tie fails. No code changed. ADR 0301's review trail: the `b186b0c6a` row, committed cut off after "which", is completed with a dated bracket, and this round gets its own row.
>
> Mutations (main_tpl clones on fixlane-pg, same steps as `pgtest.sh lane` but the lane migration taken from a scratch copy, since the harness reads `HEAD:`; the committed migration was never edited, `cmp` = backup):
> - `THEN 2`: old T17 PASS, new T17 FAIL "T17 FAIL Triple Door sits at 1, above Yellow Five Orders at 2: its door lines weighed more than one book".
> - `least(b.door_checked_lines, 2)`: old PASS, new FAIL (same line).
> - `+ b.door_checked_lines` (the `d754b58f8` body): new T17 FAIL (same line).
> - `+ 0` (no door term): T14 FAILs first ("Fords Gin sits at 8, below Campari at 6").
> - The migration as committed: PASS.
>
> Local Postgres, `pgtest.sh lane` at `e84c06eca` (template `42fe1252b`; the harness also applied main's zone migration `20261223030000`, the only migration between the template and `b270a45b8`; it adds two nullable `restaurants` columns the tests do not read):
> ```
> [fix] PASS 20261223060000_the_cellar_counts_the_door_checked_price_test.sql
> [fix] PASS 20261222120000_the_ledger_lists_only_the_current_menu_test.sql
> [fix] PASS 20261222170000_the_cellar_reads_the_tills_own_record_test.sql
> [ctl] FAIL 20261223060000_the_cellar_counts_the_door_checked_price_test.sql: ERROR:  T1 FAIL first_bought = , expected 2026-08-03 (the door check)
> [ctl] PASS 20261222120000_the_ledger_lists_only_the_current_menu_test.sql
> [ctl] PASS 20261222170000_the_cellar_reads_the_tills_own_record_test.sql
> template=42fe1252b3fcec0566a5fee0960affbcab27c07f lane_migrations=2 tests=3
> ```
>
> Tests at `e84c06eca`:
> - `npx jest src/beverages src/cellar --forceExit` (apps/api-gateway): `Test Suites: 7 passed, 7 total`, `Tests: 152 passed, 152 total`.
> - `npx vitest run src/pages/cellar` (apps/web): `Test Files 15 passed (15)`, `Tests 302 passed (302)`.
> - eslint `--quiet` on the 8 lane TS files: web rc=0 (scratch plugin dir), gateway rc=0.
> - `tsc --noEmit`: web 1 error, gateway 2 errors, all `@simplewebauthn/*` not found (passkeys files, not in this PR; the linked node_modules lacks them).
>
> Guards: `lanecheck.sh wt-fix-cellardoor` at `e84c06eca`: all 6 checks rc=0, files=15, ownership rc=0 `[]`. `check_decision_claims.sh`: `== Decision claims: 925 checked, 925 holding`, PASS.
>
> [Corrected 2026-10-07: the note below says the standing rules mention answers "recorded by the coordinator at 12:04:50Z". That batch ("Add the link", "F-test + r² > 0.15", "Whole lens, as built", "Say it couldn't be read") was answered 12:02:43Z per the transcript; 12:04:50Z was the coordinator's later `date -u`. None of those answers is this lane's. ADR 0301's #628 answers stay as recorded: asked 2026-10-06 19:57:41Z, answered 2026-10-07 04:15:17Z (fixes/README.md:253).]
>
> **Stale lines in the live PR body (written at `f8dde42e6`, 2026-10-05) and their replacements:**
> 1. L3 "Lane `cellarledger`, PR-2 of 2. Branch `fix/cellar-door-checked-cost` @ `f8dde42e6`." -> "Lane `cellarledger`, PR-2 of 2 (fixes since 2026-10-07: lane `cellardoor`). Branch `fix/cellar-door-checked-cost` @ `e84c06eca`."
> 2. L5 "**Stacking:** this branch is stacked on PR-1 (...`767c79ae6`...), which is stacked on #606 (`17f991a31`). Open it after PR-1. It merges third, after #606 and PR-1." -> "**Base:** main. #606 merged 2026-10-05 (`8fdb819b4`) and PR-1 #627 merged 2026-10-06 (`54f833e4b`); this branch has origin/main `b270a45b8` merged in."
> 3. L7 "**Files:** 15 of this lane's own (`git diff --stat 767c79ae6 f8dde42e6`)." -> "**Files:** 15 against origin/main (`git diff --name-only b270a45b8 e84c06eca`)."
> 4. L21 "(version `20261221091500`; reads only, changes no row)" -> "(version `20261223060000`; reads only, changes no row)".
> 5. After L39, add: "- **The row order counts a door check as one book** (the founder's pick, 2026-10-07 04:15:17Z, verbatim *\"Count it as a book (Recommended)\"*): the ledger's `ORDER BY` adds `(CASE WHEN b.door_checked_lines > 0 THEN 1 ELSE 0 END)`, however many door rows the row has, and the web's books sort adds 1 to `books.length` when `bought.doorChecked > 0`. It moves only a row's place, and so which rows `p_limit` keeps, never a figure."
> 6. L61 "### Tests, guards, harness (at `f8dde42e6`)" -> "### Tests, guards, harness (at `e84c06eca`)".
> 7. L64 "Gateway jest (`src/beverages src/cellar`, `--forceExit`): 150/150, re-run at last call." -> "Gateway jest (`src/beverages src/cellar`, `--forceExit`): 152/152 (7 suites)."
> 8. L65 "Web vitest (`src/pages/cellar`): 294/294, re-run at last call. 3 new CellarNext cases fail before the change." -> "Web vitest (`src/pages/cellar`): 302/302 (15 files). The new CellarNext cases fail before the change; the `doorChecked: 3` case fails on the web rule without the door and on one that adds the count (measured at `b186b0c6a`, not re-run)."
> 9. L68 "Typecheck shows only the known simplewebauthn errors." -> unchanged in substance: "Typecheck: web 1, gateway 2 errors, all `@simplewebauthn/*` not found (passkeys files, not in this PR)."
> 10. L70 "...`check_migration_order` (3 lane migrations after `28d32de36`)..." -> "`lanecheck.sh`'s 6 guards exit 0, including `check_migration_order` (1 lane migration after `b270a45b8`: `20261223060000`, past main's newest `20261223030000`) and `check_adr_numbers_unique`."
> 11. L71 "`check_decision_claims.sh`: 865/865 hold." -> "`check_decision_claims.sh`: 925/925 hold."
> 12. L72 "Claims mutations: 24/24 caught." -> "Claims mutations: 24/24 caught at `f8dde42e6`; the order claim `CELLAR-DOOR-CHECK-COUNTS-AS-A-BOOK-IN-THE-ORDER` caught 6/6 at `b186b0c6a`; not re-run at `e84c06eca` (no claim or code changed)."
> 13. L74 "**SQL mutations of the migration:** 21 run, 20 caught..." -> keep, and add: "The ledger order's door term: 4 more run at `e84c06eca` (`THEN 2`, `least(door_checked_lines, 2)`, `+ door_checked_lines`, `+ 0`), 4 caught (T17, T17, T17, T14)."
> 14. L76-86, the `pgtest.sh` block at `f8dde42e6` (template `28d32de36`, versions `20261219120000`/`20261221090000`/`20261221091500`) -> the block above, at `e84c06eca`. The till and menu tests now PASS on `[ctl]`: their migrations are on main, so on this branch they are pins.
> 15. L87 "The new test also fails in all 13 blocks on the PR-1 state." -> "On main without the migration the test FAILs at T1 (the run stops there; the header says T1-T13 all fail, not re-measured block by block). T14 fails on the build from before the order pick; T15 and T16 are pins; T17 fails on the pre-pick build, on the line-count build, and on a door weight of 2."
> 16. L89-100, the 13-block table -> add rows: "| T14 | A door-only row sorts above a row with fewer books, and `p_limit` keeps it. |", "| T15 | A door check that saw no bill is not bought and lifts no row. |", "| T16 | The order moves no figure. |", "| T17 | Three door lines on one row are one book, not three or two. |". Heading: "What the 17 blocks cover".
> 17. L104 "ADR 0301 §2 is now marked built. Its review trail has a 2026-10-05 row." -> "ADR 0301 §2 is built, with the two 2026-10-07 picks under *Forks answered*. Its review trail has rows through 2026-10-07."
> 18. L105 "`claims.d/fix-cellar-door-checked-cost.jsonl` adds 3 new rows." -> "adds 4 rows (the fourth: `CELLAR-DOOR-CHECK-COUNTS-AS-A-BOOK-IN-THE-ORDER`)."
> 19. L108-115, "### Forks deferred (the founder's call)" -> "### Forks answered (the founder's call, asked 2026-10-06 19:57:41Z, answered 2026-10-07 04:15:17Z)": 1. no-bill door check: *"Keep it out (Recommended)"*, as built, no code change (T7, T15). 2. door check in the order: *"Count it as a book (Recommended)"*, built (item 5 above; T14, T17). Plus the ADR's bracket: the question said the ledger "orders wines"; it orders the non-wine registers, and the rule built does not depend on that.
> 20. L119 "**Merge order:** #606, then PR-1, then this PR... carry its current body into `20261221091500`." -> "**Merge order:** #606 and PR-1 are merged. #650 (open) also replaces the ledger body: whichever of #650 and #628 merges second must re-sync its ledger body to the first's."
> 21. L120 "...this PR edits `supabase/tests/20261219120000_the_ledger_lists_only_the_current_menu_test.sql`..." -> "this PR edits `supabase/tests/20261222120000_the_ledger_lists_only_the_current_menu_test.sql` and `20261222170000_the_cellar_reads_the_tills_own_record_test.sql` (bracketed, pinning the first 31 columns)."
> 22. L121 "**Migration version:** `20261221091500` sorts before #591 (`20261221093000`) and #620 (`20261221100000`)..." -> "**Migration version:** `20261223060000`, past main's newest `20261223030000` (#591 and #620 are merged). If a later migration lands on main first, the version moves past it at merge."
> 23. L140 "**The row order ignores door checks** (fork 2)." -> delete (answered and built).
> 24. L144 "The second migration version is `…091500`, not the brief's..." -> "The migration was renumbered `20261221091500` -> `20261223060000` in `9ba90e0c2`, past main."
>
> NOT done or NOT verified this round:
> - Not pushed; the live PR body is not edited; the PR is not retargeted.
> - CI does not run `supabase/tests`; the SQL proof is local only, on `main_tpl` at `42fe1252b` plus main's zone migration (not rebuilt: it is shared with other lanes).
> - The mutation runs used a scratch runner (`pgmut.sh`, same container, template and steps as `pgtest.sh lane`), not `pgtest.sh` itself, which reads lane migrations from `HEAD:`.
> - L19's "AskUserQuestion 2026-10-04 ~00:30Z" (also ADR 0301:3) is not in the exact-time list and was not re-checked against the transcript.
> - No Browser-pane check this round (no UI changed).
> - The ADR index README row for ADR 0301 is still stale (follow-up, as before).

> **[2026-10-07 12:51Z, fixer, local head 33cdef10f]**
>
> New head: `33cdef10f`, on origin/main `5e6c0684e` (merge-base `5e6c0684e`). Local only, not pushed. 15 files against main. The pushed head `f8dde42e6` is stale.
>
> Commits since `f8dde42e6`, first-parent:
> - `6c2e14d05` merges the base's later audit fixes (`ab0f599a4`).
> - `550e1476a` merges origin/main `42fe1252b`.
> - `9ba90e0c2` renumbers the door migration to `20261223060000`, past the till migration.
> - `0819e394c` re-syncs the door migration's ledger body to the till migration as merged.
> - `d754b58f8` builds ruling A on the web (books sort `+1` when `doorChecked > 0`). In SQL, the `ORDER BY` added `door_checked_lines`, a line count.
> - `b186b0c6a` fixes this round's verifier findings on `d754b58f8`:
>   - The ledger's `ORDER BY` now adds `(CASE WHEN b.door_checked_lines > 0 THEN 1 ELSE 0 END)`. A row's door checks count as one book there, as in the register's books sort. The other terms still count lines.
>   - SQL T17 is added after T16. A row with three door-checked orders sits between five orders and three orders, and `p_limit 1` keeps the five.
>   - A vitest with `doorChecked: 3`: `sortValueFor('books')` is 2, and the row draws between a 3-book and a 1-book row.
>   - The mislabelled pin is renamed to what it asserts: the books cell lights only the order's mark, and First bought, Paid and the two door-checked marks still show.
>   - The claim `CELLAR-DOOR-CHECK-COUNTS-AS-A-BOOK-IN-THE-ORDER` now requires the CASE term.
>   - ADR 0301 gets a dated bracket at the "Count it as a book" question. The question said the ledger "orders wines"; this ledger orders the non-wine registers. The question stays verbatim. The rule built reads no register or kind, so it is the same either way.
>   - The `d754b58f8` records are narrowed in place. The books sort is the default of the five CatalogueRegister registers and the whole-cellar list. The cocktail register draws the ledger's order.
> - `33cdef10f` merges origin/main `5e6c0684e` (#620). No conflicts.
>
> Guards: `lanecheck.sh wt-fix-cellardoor` at `33cdef10f`: all 6 checks rc=0, files=15, ownership rc=0 `[]`. `check_decision_claims.sh`: `== Decision claims: 922 checked, 922 holding`, PASS.
>
> Tests at `33cdef10f`:
> - `npx vitest run src/pages/cellar` (apps/web): 15 files, 302 passed.
> - `npx jest src/beverages` (apps/api-gateway): 3 suites, 69 passed.
>
> Local Postgres, `pgtest.sh lane`, saved at `fixes/audits/628-local-pg.txt`:
> - `[fix]`: the door, till and menu-ledger tests all PASS.
> - `[ctl]`: the door test FAILs at T1; till and menu PASS (pins).
> - **The template was stale:** `main_tpl.sha` was `42fe1252b`, not origin/main `5e6c0684e`. The 15-minute wait ended with no match at 12:44:41Z. The harness also applied #620's zone migration, the only migration between the two shas. So `[fix]` ran on main's migrations plus this PR's.
>
> Mutations, each failing before the change:
> - Web: the new vitest fails on the rule without the door, and on a rule that adds the door-checked count.
> - SQL on main_tpl clones:
>   - `d754b58f8`'s body: "T17 FAIL Triple Door sits at 1, above Five Orders at 2".
>   - The pre-ruling body: T14 fails first. With T14 cut, T17 fails ("Triple Door sits at 3, below Three Orders at 2"). The till and menu tests pass on every build.
> - Claim: verify rc=1 under each of 6 mutations: the line count, no door term, a weight of 2, a 'door' books word, the web line count, and the web pre-ruling rule. rc=0 when restored.
>
> NOT done or NOT verified:
> - The ADR index README row for ADR 0301 is stale, left as the brief said (follow-up).
> - Not pushed. The live PR body is not edited. The PR is not retargeted.
> - CI does not run `supabase/tests`. The SQL proof is local only, on the stale template above.
> - `tsc --noEmit -p apps/web` gives 1 error: `src/services/api/passkeys.ts` cannot find `@simplewebauthn/browser`. The worktree's linked node_modules lacks it. That file is not in this PR.
> - Timestamps: the standing rules mention answers "recorded by the coordinator at 12:04:50Z". The ADR keeps this lane's times: asked 2026-10-06 19:57:41Z, answered 2026-10-07 04:15:17Z (fixes/README.md:253). No new founder answer was recorded this round. The coordinator should confirm which time is right.
> - The bracket on question A needs telling to the founder (the coordinator's job, per the brief).
> - #650 (unmerged) also replaces the ledger body. Whichever of #650 and #628 merges second must re-sync its ledger body to the first.
