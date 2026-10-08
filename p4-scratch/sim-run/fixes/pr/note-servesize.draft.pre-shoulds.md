> **[2026-10-08 00:33Z, coordinator] Head `fc72bf58c`: merged origin/main `62f8967b4` (#628) with six conflicts, all resolved keeping both sides, and rebuilt the lane migration `20261223180000_a_till_name_with_a_serve_size_joins_its_row.sql` on #628's ledger body, which it had replaced with the till migration's (that would have undone #628's door rows on db reset and on apply; the pre-merge lane migration over #628's fails the door test T1 locally). Ledger shape 40 (31, then #628's three, then this branch's six), pinned in T4, both T12s and S9. Three claims rows' verifies follow (`bought_agg`; door columns by place), each mutation-checked. Evidence: local Postgres `pgtest.sh lane` (template `214779a76`, 2 lane migrations: #628's and this one; b30ca260e and 62f8967b4 add no other) `[fix]` PASS 4/4 (menu, till, door, serve-size tests), `[ctl]` FAIL 4/4; jest `src/beverages` 83/83 (3 suites); vitest `src/pages/cellar` + `src/pages/beverages` 310/310 (15 files); gateway and web tsc only the 3 known `@simplewebauthn` TS2307; claims 952/952; lanecheck all six guards rc=0, files=17 against origin/main `62f8967b4`, ownership `[]`. Commits since `3f3689307` at this head: 14 first-parent, 6 merges. Not run: SQL block by block and mutants, eslint, the open-PR version sweep. Not pushed.**
>
> **[2026-10-07 23:59Z, coordinator] Head `ab3c49231`: merged origin/main `b30ca260e` (#612 `214779a76`, #653), no conflicts; the merge adds none of this PR's 15 files. Re-checked the migration order: main's newest is now `20261223040000` (#612) [Corrected 2026-10-08 00:33Z, coordinator: at origin/main `b30ca260e`. At `62f8967b4` (#628, merged after this note) main's newest is `20261223060000` (#628), and this branch's `…180000` still sorts after it.], and this branch's `20261223180000_a_till_name_with_a_serve_size_joins_its_row.sql` still sorts after every migration on origin/main, with no duplicate version there. Evidence: jest `src/beverages` 80/80 (3 suites), vitest `src/pages/cellar/next` 302/302 (15 files), gateway and web tsc only the 3 known `@simplewebauthn` TS2307, claims 947/947, lanecheck all six guards rc=0, files=15, ownership `[]`. Not re-run: `pgtest.sh`, SQL blocks and mutants, eslint, the open-PR version sweep. Not pushed.**
>
> **[2026-10-07 21:46Z, fixer, local head `856f6a3d7`, push note: post this one]**
>
> This is the head to audit: `856f6a3d7ee7b6f16ec5b6d017134f058ccebcba`. It is not pushed, and the live body is not edited. The live PR head is `3f3689307` (`gh pr view 650`, read 2026-10-07 21:15Z), and the body was last edited 2026-10-06T05:20:01Z. The three notes below this one (20:13Z at `4668c4640`, 14:31Z at `b31ee7f33`, 13:15Z at `aa5b5ce19`) were never posted. This note replaces all three and stands alone.
>
> **Founder answers.** None of the three blocks in `fixes/briefs/answers-2026-10-07-pm.md` (14:41:21Z, 18:59:42Z, 19:48:13Z; the file was last written 19:49Z) concerns #650. They name #611, #613, #614, #616 and #619 only. Nothing from them is recorded on this branch.
>
> ### 1. Commits since the live head `3f3689307` (first parent, oldest first)
>
> | Commit | What it is |
> |---|---|
> | `3adac4a98` | Merge of origin/main `42fe1252b` (#651), before the BLOCK rework. No conflicts. |
> | `11bc35156` | The #650 BLOCK's two answers, in the same migration: menu rows first (four passes), and size words only break ties. SQL S14 to S18. The Sold and Charged column sources say a menu row's comes first. |
> | `ea0598ace` | The BLOCK's Finding 2: the till book says whether the till holds a name containing the row's label (`holdsLabel` and the reason). A part of Sold below zero keeps its sign (`nonZero`). |
> | `aa5b5ce19` | ADR 0301 records both answers verbatim, with the rejected options. Four new claims rows; six rows' verify rewritten to the new shapes, each with a dated bracket. |
> | `c85dc8ed7` | Merge of origin/main `b270a45b8` (#609). No conflicts. |
> | `4cb9ecbae` | Renumbers the migration and its test to `20261223180000`, past main's newest `20261223030000` (#620). Two citations follow. The SQL is unchanged. |
> | `b31ee7f33` | The audit of `aa5b5ce19`. SQL S19 to S23 kill five one-spot mutations that passed S1 to S18, with a claims row (`CELLAR-TILL-NAME-SIZE-WORDS-BREAK-TIES-WITHOUT-THE-MAKER`). The refund part is pinned for glasses and unknown unit as for bottles (jest, vitest). A label under four characters that no till name equals gets `TILL_NAME_TOO_SHORT_TO_SEARCH`, not "no till name contains it" (`CONTAINS_FLOOR` = 4, jest). |
> | `0ee7a10be` | Merge of origin/main `ca3582988` (#649). No conflicts. It brings main's `tables-learned-from-the-pos.spec.ts` (+3 lines) and one changed line of its claims fragment; neither is this PR's. |
> | `2aed5aa8a` | SQL S24 to S27 pin pass 4 (order rows, by their name without the maker). ADR 0301's mutation table re-run on 27 blocks. The bare-pass claims row also keeps S24's assertion. |
> | `4668c4640` | ADR text only: the till book's reason list says four, and `TILL_HOLDS_NO_SUCH_NAME` is said for a label of four or more characters. |
> | `2771f8346` | Merge of origin/main `a323cc80b` (#613). No conflicts. It brings #613's 15 files: `organizations/` and `settings-audit/` in the gateway, the location editor in the web, ADR 0289, its claims fragment and one README index row. None is this PR's. |
> | `856f6a3d7` | ADR text only, for the verifier at `4668c4640`: three sentences narrowed in place to the code, and a review-trail row. |
> | `ab3c49231` | [ADDED 2026-10-08 00:33Z, coordinator] Merge of origin/main `b30ca260e` (#612 `214779a76`, #653). No conflicts; its tree equals `git merge-tree --write-tree`. Default message, no trailer. |
> | `fc72bf58c` | [ADDED 2026-10-08 00:33Z, coordinator] Merge of origin/main `62f8967b4` (#628). Six conflicts, each kept both ways: ADR 0301, `house-record.ts`, `registerCells.tsx`, `sql_outside_migrations.txt`, and the two #627 tests (T4, T12). The lane migration's ledger body is now #628's plus this branch's (the `door` CTE, `bought`/`bought_agg`, the invoice book on `i.lines > 0`, door columns 32-34, the `ORDER BY` that counts a door check as one book; `book` reads `bought_agg`), so #628 is not undone on db reset or apply. The door test's T12 and S9 move to 40 columns. Three claims rows' verifies follow the new shape. A body and the Opus 5 trailer. |
>
> Each merge's tree equals `git merge-tree --write-tree` of its two parents, so no merge carries a hand edit. The four merges carry git's default message and no trailer. [Corrected 2026-10-08 00:33Z, coordinator: at `ab3c49231` there were five merges (13 first-parent commits since `3f3689307`), and `ab3c49231` too equals `git merge-tree --write-tree` and carries git's default message. At `fc72bf58c` there are six merges (14 commits, `git rev-list --first-parent 3f3689307..fc72bf58c`): `fc72bf58c` resolves six conflicts with #628 and edits the lane migration by hand, so its tree differs from `git merge-tree`'s, and it carries a body and the Opus 5 trailer. The eight non-merge commits are unchanged.] The eight other commits carry `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
>
> ### 2. Results at `856f6a3d7`
>
> Between the audited `4668c4640` and `856f6a3d7`, this PR's 15 files differ in ADR 0301 only. `supabase/`, `scripts/`, `src/beverages`, `src/vendor-intel` and `pages/cellar` have no diff. The merge changed only `organizations/`, `settings-audit/`, the web's location editor and docs, and no lane source or test file imports any of them (grep of the lane's files and of the files they import).
>
> - **Gateway jest**, `env LC_ALL=C npx jest src/beverages --runInBand --forceExit`, after the merge: `Test Suites: 3 passed, 3 total` / `Tests: 80 passed, 80 total`.
> - **Web vitest**, `src/pages/cellar/next`, after the merge: `Test Files 15 passed (15)` / `Tests 302 passed (302)`.
> - **Local Postgres**, `pgtest.sh lane` at `856f6a3d7` (`audits/650-local-pg-856f6a3d7.txt`). Template `42fe1252b`, 2 lane migrations: #620's, which the template lacks, and this one.
>   - Label `ssz650g`, every test the lane adds over the template: `[fix] PASS` on `20261223030000_a_house_zone_says_where_it_came_from_test.sql` and on `20261223180000_a_till_name_with_a_serve_size_joins_its_row_test.sql` (all 27 S blocks in one run). `[ctl] FAIL` on both: `restaurants.timezone_source is absent`; `column l.tied_lines does not exist`.
>   - Label `ssz650h`, the two #627 tests this branch changes: `[fix] PASS` on both. `[ctl] FAIL`: `T4 FAIL the return shape has 31 columns, expected 37`; `T1 FAIL the rakı reads pos_lines = 1, expected 3`.
> - **Block by block and the SQL mutants** were not re-run. The migration and test bytes are those of `4668c4640`, where (`audits/650-local-pg-b31ee7f33-pass4.txt`) the branch passed 27 of 27, `3f3689307`'s build passed 19 and failed S14, S15, S17, S18, S20, S22, S23 and S25, and each of 15 one-spot mutations failed the blocks ADR 0301's table lists.
> - **tsc**, after the merge. Gateway (`tsconfig.spec.json`): only the 2 known `@simplewebauthn/server` TS2307 errors (`src/passkeys/passkeys.service.ts:16`, `:22`). Web: only the known `@simplewebauthn/browser` TS2307 (`src/services/api/passkeys.ts:14`).
> - **Gateway eslint** on the PR's 4 gateway files: 0 errors, 56 warnings. main has not changed those files since `4528b9689`, where the body's run gave main's versions 56 as well.
> - **Web eslint** `--quiet --resolve-plugins-relative-to p4-scratch/web-lint` on the PR's 4 web files: rc=0, 0 messages. The run is live: an injected unused variable, linted from stdin, draws `@typescript-eslint/no-unused-vars`. That rule is a warning, so it shows only without `--quiet`.
> - **`lanecheck.sh wt-fix-servesize`**: all six guards rc=0 (migration order, versions unique, OD ids, conflict markers, citation pairing, ADR numbers). `files=15` against origin/main `a323cc80b`. Ownership `[]`. Exit 0. [2026-10-07 23:59Z, coordinator: at `ab3c49231`, all six rc=0, `files=15` against origin/main `b30ca260e`, ownership `[]`.] Run alone for their messages:
>   - `check_migration_order`: `OK -- 1 migration(s) added since the merge base a323cc80b: 20261223180000_a_till_name_with_a_serve_size_joins_its_row.sql. Newest on origin/main (a323cc80b): 20261223030000`. [2026-10-07 23:59Z, coordinator: at `ab3c49231`, `OK -- 1 migration(s) added since the merge base b30ca260e: 20261223180000_… Newest on origin/main (b30ca260e): 20261223040000 (20261223040000_a_door_receipt_says_which_clock_dated_it.sql)`.]
>   - `check_migration_versions_unique`: OK against origin/main and 68 other open PRs.
>   - `check_adr_numbers_unique`: no new number; next free 0310, swept across 1,748 refs.
>   - `check_migrations_single_home`: rc=0.
>   - `python3` on this PATH is 3.9.6.
> - **Claims.** `check_decision_claims.sh` was not run this round, on the coordinator's instruction. At `4668c4640` it gave 931 of 931 with Python 3.11 first on PATH. With 3.9.6 first it gives 930 of 931, failing `ADR-0224-EVERY-HOST-NAMED-OR-EXCUSED`; that is the environment, not this PR (the verifier's note). The count at `856f6a3d7` is not measured, since the merge of `a323cc80b` adds #613's 7-line fragment. [2026-10-07 23:59Z, coordinator: at `ab3c49231`, `PATH=/usr/local/bin:$PATH`, 947 checked, 947 holding.] This PR's 13 rows read only `beverages.service.ts`, `house-record.ts`, `row-record.ts`, `vendor-intel/bottle-size.ts`, `registerCells.tsx`, `supabase/migrations/*.sql` and the serve-size test. All of those are byte-identical at `4668c4640` and `856f6a3d7`.
> - **Migration versions, re-swept** 2026-10-07 ~21:30Z over 1,748 local and remote refs and 158 worktrees. Past main's newest `20261223030000`: `…040000` (#612), `…060000` (#628), `…150000` (#618), `…170000` (#617), and this branch's `…180000`. Nothing is past `…180000`. This PR's pushed head still carries `…000000`. [2026-10-07 23:59Z, coordinator: #612 merged as `214779a76`, so `…040000` is now main's newest (`git ls-tree origin/main supabase/migrations`, 294 migration files, no duplicate 14-digit version, none named `20261223180000`). `…180000` still sorts after every migration on origin/main `b30ca260e`. The other open PRs' versions were not re-swept this round.] [2026-10-08 00:33Z, coordinator: #628 merged as `62f8967b4`, so `…060000` is now main's newest; `…180000` sorts after every migration on origin/main `62f8967b4` (`check_migration_order` rc=0 at `fc72bf58c`). The open-PR version sweep was not re-run.]
> - **The other open PRs that add a migration** are #541, #612, #617, #618, #626 and #628. [2026-10-07 23:59Z, coordinator: #612 has merged since (`214779a76`); this list was not re-read otherwise.] [2026-10-08 00:33Z, coordinator: #628 has merged too (`62f8967b4`), so of this list #541, #617, #618 and #626 may still be open; not re-read. With #628 merged, no open PR is known to add lines naming the ledger or the till functions; not re-grepped.] Only #628 adds lines naming `house_beverage_ledger`, `house_till_lines` or `house_till_names` (21 lines, from `gh pr diff`).
>   - #628's head is `84aec1eea` (pushed 2026-10-07T20:36Z). Its migration is `20261223060000_the_cellar_counts_the_door_checked_price.sql`, which DROPs and re-CREATEs `house_beverage_ledger`. [2026-10-08 00:33Z, coordinator: merged as `62f8967b4`; merged into this branch at `fc72bf58c`, whose migration now re-creates the ledger from #628's body (section 1, `fc72bf58c`).]
>   - None of #628's added lines has `tied_lines`, `tied_names`, `poured_bottles`, `bare_k` or `size_word`. So its ledger is built from #627's body, not this PR's.
>   - It shares 9 files with this PR (listed under *Merge order* 2, below).
>
> ### 3. What the delta re-audit must check (last audited head `4668c4640`, verdict "should")
>
> 1. `2771f8346` is a clean merge of origin/main `a323cc80b`. Its tree equals `git merge-tree --write-tree 4668c4640 a323cc80b`, and `git diff --name-only 4668c4640 2771f8346` shares no path with `git diff --name-only origin/main...HEAD`.
> 2. Nothing the lane's tests read changed. No lane source or test file imports `organizations/`, `settings-audit/`, `components/locations` or `pages/settings`. jest 80/80, vitest 302/302 and `pgtest.sh lane` (`[fix]` PASS, `[ctl]` FAIL) were all run after the merge.
> 3. `856f6a3d7`'s three brackets, against the code:
>    - ADR 0301 :285 against `beverages.service.ts:1180-1192`. `house_till_names(p_restaurant_id)` is read only in the `else` after `tied.length > 0` and `matched.size > 0`.
>    - ADR 0301 :287 against `beverages.service.ts:1193-1216`. The `every.error` branch comes before the containment test and the `CONTAINS_FLOOR` test, so a failed read gets `tillNamesUnreadReason` whatever the label's length.
>    - ADR 0301 :372 (the bracket on "No migration or gateway code changed") and :373 (the new trail row).
> 4. This note's re-measured figures: the version sweep, the 68 other open PRs, next free 0310, and #628's head, ledger body and 9 shared files.
> 5. The verifier's two stale pointers in the 20:13Z note are replaced here. The ADR lines at this head are :285 and :287, not ':273'. #628's numbers are re-read above, not carried forward.
>
> ### 4. Stale lines in the live body (at `3f3689307`) → exact replacement
>
> Bracket style is the body's own: the old words stay, and a dated bracket is added where shown. "L" is the line number in the live body.
>
> **Insert above L1**, as a new top note:
>
> ```
> **[2026-10-07, fixer, at `856f6a3d7`]**
> - **This is the head to audit: `856f6a3d7`.** [2026-10-07 23:59Z, coordinator: now `ab3c49231`, the merge of origin/main `b30ca260e`.] Twelve commits since `3f3689307` are added to the commit table below. They build the founder's two answers to the #650 BLOCK (menu rows first; size words only break ties) and its Finding 2, answer the items of three later audits, renumber the migration to `20261223180000`, and merge origin/main four times without conflicts, last `a323cc80b` (#613). [Corrected 2026-10-08 00:33Z, coordinator: at `fc72bf58c`, fourteen commits since `3f3689307` (six merges, eight others): origin/main merged five times without conflicts, last `b30ca260e` (`ab3c49231`), and a sixth time with six conflicts, `62f8967b4` (#628, `fc72bf58c`), which re-bases this migration's ledger on #628's body.]
> - Guards at `856f6a3d7`: all rc=0, `check_migration_order` included; 15 files against origin/main `a323cc80b`; ownership `[]`.
> - Lines of this body that `856f6a3d7` makes stale carry a dated bracket. The old words are kept.
> ```
>
> 1. **L2**, after *"The SQL is unchanged."*, add: *"[2026-10-07, fixer: superseded. `4cb9ecbae` renumbered the migration and its test again, to `20261223180000`, past main's newest `20261223030000` (#620). The citations are now `beverages.service.spec.ts:664` and `scripts/sql_outside_migrations.txt:164`. The head to audit is `856f6a3d7`.]"*
> 2. **L3**, after *"…holds a `20261223*` migration."*, add: *"[2026-10-07, fixer: re-swept over 1,748 local and remote refs and 158 worktrees. Past main's newest, `20261223030000`: `…040000` (#612), `…060000` (#628), `…150000` (#618), `…170000` (#617) and this branch's `…180000`. Nothing is past `…180000`.]"*
> 3. **L4**, after *"citation pairing 0."*, add: *"[2026-10-07, fixer: at `856f6a3d7`, migration order 0, versions unique 0 (origin/main and 68 other open PRs), OD ids 0, conflict markers 0, citation pairing 0, ADR numbers 0, migrations single home 0.]"*
> 4. **L5**, after *"`4528b9689`."*, add: *"[2026-10-07, fixer: 15 files against origin/main `a323cc80b`.]"*
> 5. **L6**, after *"**Local Postgres, re-run at `3f3689307`.**"*, add: *"[2026-10-07, fixer: superseded by the run at `856f6a3d7`, under *Tests, guards and harness*.]"*
> 6. **L15**, after *"Nothing has been pushed."*, add: *"[2026-10-07, fixer: `3f3689307` was pushed. The local head is `856f6a3d7`, not pushed.]"*
> 7. **L17**, after *"open this PR against `main`."*, add: *"[2026-10-07, fixer: four later merges of origin/main, each without conflicts and each with a tree equal to `git merge-tree`'s: `3adac4a98` (`42fe1252b`), `c85dc8ed7` (`b270a45b8`), `0ee7a10be` (`ca3582988`) and `2771f8346` (`a323cc80b`).]"*
> 8. **L19**, after *"…and this lane's line."*, add: *"[2026-10-07, fixer: said of `2832515b9`; not re-checked since.]"*
> 9. **L30**, the commit table: append these rows after `2832515b9`'s.
>
>    ```
>    | `3f3689307` | Coordinator: renumber to `20261223000000` (the head the BLOCK audited). |
>    | `3adac4a98` | Merge of origin/main `42fe1252b`. No conflicts. |
>    | `11bc35156` | The #650 BLOCK's two answers, in the same migration: menu rows first (four passes), and size words only break ties. SQL S14 to S18. |
>    | `ea0598ace` | The BLOCK's Finding 2: the till book says whether the till holds a name containing the row's label. A part of Sold below zero keeps its sign. |
>    | `aa5b5ce19` | ADR 0301 records both answers verbatim; four new claims rows, six rows' verify rewritten. |
>    | `c85dc8ed7` | Merge of origin/main `b270a45b8`. No conflicts. |
>    | `4cb9ecbae` | Renumbers the migration and its test to `20261223180000`, past main's newest `20261223030000`. The SQL is unchanged. |
>    | `b31ee7f33` | The audit of `aa5b5ce19`: SQL S19 to S23; refund parts for glasses and unknown unit; a label under four characters says it was not searched. |
>    | `0ee7a10be` | Merge of origin/main `ca3582988`. No conflicts. |
>    | `2aed5aa8a` | SQL S24 to S27 pin pass 4; the mutation table re-run on 27 blocks. |
>    | `4668c4640` | ADR text only: the till book's reason is one of four. |
>    | `2771f8346` | Merge of origin/main `a323cc80b`. No conflicts. |
>    | `856f6a3d7` | ADR text only: three sentences narrowed to the code. |
>    ```
>
>    The `3f3689307` row is there because the table stops at `2832515b9`; drop it if the coordinator's note at the top is thought enough.
> 10. **After L43** (F5's bullet), add:
>
>     ```
>     **[ADDED 2026-10-07] His answers to the #650 BLOCK, verbatim.** AskUserQuestion, asked 2026-10-06 14:17:38Z, answered 15:13:54Z. A first asking at 05:22:10Z was cut off by the session's end and never answered.
>     - **Till books.** *"#650 (serve-size) was blocked: a supplier quote 'Yeni Rakı 70cl' took 111 till lines off their menu row, and 37 of them were 'Yeni Rakı Âlâ', a different product. Which books' rows may a till name join?"* Picked: *"Menu first (Recommended)"*: *"A till name joins a menu row whenever one contains it. Invoice, order and quote rows only take names that no menu row contains, so the Âlâ lines stay on the menu. Cost: a supplier's name never beats the menu's, even when the menu's name is vaguer."* Rejected: *"Menu only"*: *"Only menu rows take till names. Cost: a bottle that sells but isn't on the menu shows no Sold until the owner lists it."* And *"All books equally"*: *"As built. The defect above stays."*
>     - **Size words.** *"When two rows both fit a till name, the row with more words wins, and '70cl' counts as two words. That is how 'Yeni Rakı 70cl' beat 'Yeni Rakı Âlâ'. Should size words count?"* Picked: *"Only to break ties (Recommended)"*: *"Rows rank by product words, and size words only decide between rows tied on those. Âlâ beats 'Yeni Rakı 70cl', and 'Yeni Rakı 35cl' still beats 'Yeni Rakı' for a 35cl glass."* Rejected: *"Never"*: *"Cost: a 35cl glass ties 'Yeni Rakı' with 'Yeni Rakı 35cl' and joins neither row."* And *"Like any word"*: *"As built. The defect above stays."*
>     ```
>
> 11. **L90**, after *"The join, in order:"*, add: *"[CHANGED 2026-10-07, the #650 BLOCK's answers: four passes, and only the first with any candidate counts. (1) Menu rows whose every word the name holds; (2) menu rows whose name without its maker it holds (F1); (3) invoice, order or quote rows whose every word it holds; (4) order rows whose name without its maker it holds (F1). Inside a pass: exact, then the most product words, then the most size words. Size words are the volumes `VOLUME_IN_TEXT` finds, tokenized, so '70cl' gives '70' and 'cl'. Rows level on all three tie and join none. See ADR 0301, *The answers to the #650 BLOCK*.]"*
> 12. **L94**, after *"…and a level top is a tie."*, add: *"[CHANGED 2026-10-07, the #650 BLOCK's answers: a name that holds no menu row's full words tries menu rows' names without their maker (pass 2) before any invoice, order or quote row (S18). Order rows' names without the maker come last (pass 4: S21, S24 to S27).]"*
> 13. **L97**, after *"The full-words pass always comes first (S11)."*, add: *"[2026-10-07: the menu's full words come first (S11). A supplier row's full words come after the menu's names without the maker (S18).]"*
> 14. **L99**, after *"It never compares every name against every row."*, add: *"[CORRECTED 2026-10-07, as the migration's header now says: a word every row and every name share, such as a size unit, still pairs them all. Only (name, row) pairs that share a word are grouped and counted.]"*
> 15. **L120**, after *"`ROW_RECORD_MATCH_RULE` states the till rule, F1 included."*, add *"[2026-10-07: and menu first, with size words only breaking ties.]"*, then a new bullet: *"[ADDED 2026-10-07, the #650 BLOCK's Finding 2 and the audit of `aa5b5ce19`] When the register counts no name on the row and none tied, `readTillLines` also reads every distinct till name (`house_till_names(p_restaurant_id)`, keyset-paged) and keeps only whether one contains the row's label (`matchLine`). The book's reason then says one of four things: the till holds such a name and the register counts it on another row or on none (`TILL_HOLDS_THE_NAME_ELSEWHERE`); no till name contains it, for a label of four or more characters, folded (`TILL_HOLDS_NO_SUCH_NAME`); the label is under four characters and no till name equals it, so containment was not checked (`TILL_NAME_TOO_SHORT_TO_SEARCH`); or the read failed, whatever the label's length (`tillNamesUnreadReason`). `holdsLabel` is true, false, or null when unread or too short, and `nothingNamesIt` is false when it is true or null. When names are counted on the row but their lines were gone by the second read, nothing more is read, and the reason says those names held no line when the record read them. A part of Sold below zero is kept (`nonZero`), not nulled."*
> 16. **L125**, after *"…and the sort stays on the total."*, add: *"[ADDED 2026-10-07: a Sold with any part below zero, a net refund, shows the net count alone.]"*
> 17. **L126**, after *"(`cellar-columns.ts`)."*, add: *"[2026-10-07: the Sold and Charged column sources now say a menu row's comes before an invoice, order or quote row's.]"*
> 18. **L138**, after *"I did not re-measure them."*, add: *"[2026-10-07, fixer: this feed has no invoice, order or quote rows, so it never tested the books that compete for a till name; the BLOCK found that. Re-measured on synthetic local copies of this build only (ADR 0301, *Re-measured*). On the menu-only feed the BLOCK rework moves nothing: Sold on menu rows is 22,016 / 21,798 for A / B, before and after. With a quote 'Yeni Rakı 70cl' and an invoice of '<name> 70cl' lines added to each house, `3f3689307`'s build put 223 till lines per house on supplier rows, and this build puts none there. Ledger medians with those books, before → after: 183 → 170 ms (A), 172 → 160 ms (B). Production was not read.]"*
> 19. **L175**, after *"**Local Postgres harness, re-run by me at the merged head `57a6ea35b`.**"* and the coordinator's bracket, add: *"[2026-10-07, fixer: superseded again; the run at `856f6a3d7` follows the block below.]"* Then, **after L188**, add:
>
>     ```
>     **[ADDED 2026-10-07] Re-run at `856f6a3d7`** (`audits/650-local-pg-856f6a3d7.txt`). Template `42fe1252b`, 2 lane migrations: #620's, which the template lacks, and this one.
>     - Every test the lane adds over the template: [fix] PASS on `20261223030000_a_house_zone_says_where_it_came_from_test.sql` and `20261223180000_a_till_name_with_a_serve_size_joins_its_row_test.sql`; [ctl] FAIL on both (`restaurants.timezone_source is absent`; `column l.tied_lines does not exist`).
>     - The two #627 tests this branch changes: [fix] PASS on both; [ctl] FAIL (`T4 … 31 columns, expected 37`; `T1 … pos_lines = 1, expected 3`).
>     - Block by block, at `4668c4640`, whose SQL bytes `856f6a3d7` keeps (`audits/650-local-pg-b31ee7f33-pass4.txt`): 27 of 27 pass.
>     ```
>
> 20. **L195**, after *"**The SQL test, S1 to S13:**"*, add *"[2026-10-07: S1 to S27.]"*. On **L209** (S11's row), after *"the full-words pass comes first."*, add *"[2026-10-07: the menu's full words, before its names without the maker.]"*. After **L211** (S13's row), append:
>
>     ```
>     | S14 | [2026-10-07] The BLOCK's case: the menu's Âlâ keeps its 70cl bottle and its single against a quote 'Yeni Rakı 70cl'. |
>     | S15 | [2026-10-07] An invoice row's exact key loses to a menu row whose every word the name holds. |
>     | S16 | [2026-10-07] The 35cl tie-break between menu rows level on product words. |
>     | S17 | [2026-10-07] A product word beats a size. |
>     | S18 | [2026-10-07] The menu's name without its maker comes before a quote's full words. |
>     | S19 | [2026-10-07] The 35cl tie-break without the maker (pass 2). |
>     | S20 | [2026-10-07] An order row is a supplier row, whatever its words. |
>     | S21 | [2026-10-07] Pass 3 (a supplier row's full words) before pass 4 (an order row's name without the maker). |
>     | S22 | [2026-10-07] S17 without the maker. |
>     | S23 | [2026-10-07] A size word is read from any book's label (an invoice's). |
>     | S24 | [2026-10-07] S19 in pass 4: the 35cl tie-break between order rows, without the maker. |
>     | S25 | [2026-10-07] S22 in pass 4: a product word beats a size. |
>     | S26 | [2026-10-07] S10's exact rule in pass 4. |
>     | S27 | [2026-10-07] S11's tie in pass 4: it joins neither row and is listed on both. |
>     ```
>
> 21. **L223**, after *"Claims: 19 of 19."*, add: *"[ADDED 2026-10-07, the fixer's runs since `3f3689307`. SQL, block by block on 27 blocks: 15 one-spot mutations of the migration, each failing the blocks ADR 0301's table lists, and `3f3689307`'s build failing S14, S15, S17, S18, S20, S22, S23 and S25. Gateway: 4 of 4 jest mutants at `b31ee7f33` (glasses, then unknown unit, through `positive()`; the short-label branch disabled; removed). Web: 2 of 2 vitest mutants (`soldCell` without `glasses < 0`; without `unknown < 0`). Claims verify, in throwaway copies: 22 of 22 at `b31ee7f33`, and 3 of 3 for S24 at `4668c4640`.]"*
> 22. **L225**, *"**Re-run by me at `2832515b9`:**"*: add *"[2026-10-07, fixer: re-run at `856f6a3d7`, after the merge `2771f8346`; the brackets in the rows give the new results.]"* Then, in the rows:
>     - Jest, after *"**73 of 73** pass."*: *"[80 of 80.]"*
>     - Vitest, after *"**299 of 299** pass across 15 files."*: *"[302 of 302, 15 files.]"*
>     - Typecheck, gateway and web: *"[the same at `856f6a3d7`.]"*
>     - Lint, gateway: *"[the same at `856f6a3d7`: 0 errors, 56 warnings. main has not changed the 4 files since `4528b9689`.]"*
>     - Lint, web: *"[0 at `856f6a3d7`.]"*
>     - `check_decision_claims.sh`, after *"**905 of 905 holding**, up from 890 because main added rows."*: *"[2026-10-07: not run at `856f6a3d7`. 931 of 931 at `4668c4640`, with Python 3.11 first on PATH. The count at `856f6a3d7` is not measured: main added #613's fragment since. This PR's 13 rows read files that are byte-identical at `4668c4640` and `856f6a3d7`.]"*
>     - `check_adr_numbers_unique`, after *"next free 0305."*: *"[next free 0310, swept across 1,748 refs.]"*
>     - `check_migration_versions_unique`, after *"72 open PRs."*: *"[68 other open PRs.]"*
>     - The four other guards: *"[OK at `856f6a3d7`.]"*
>     - `check_migration_order`, after *"See *Merge order*, item 1."*: *"[2026-10-07: OK at `856f6a3d7`. 1 migration added since the merge base `a323cc80b`, `20261223180000_…`; newest on origin/main `20261223030000`.]"*
>     - `pr_audit_gate.ownership_between`: *"[none at `856f6a3d7` either, against `a323cc80b`.]"*
> 23. **L242**, after *"…all passing, with these exceptions:"*, add: *"[2026-10-07: not re-run since `7e1580bae`.]"*
> 24. **L266**, after the second sub-bullet, add a bullet: *"[ADDED 2026-10-07] Since `3f3689307`, ADR 0301 adds *The answers to the #650 BLOCK* (both answers verbatim with the rejected options), the four passes and what a size word is, the mutation table (15 one-spot mutations and the build before, on 27 blocks), *The record's two sentences* (Finding 2, four outcomes), the synthetic re-measure, a consequence (a supplier's name never beats the menu's), and four review-trail rows. Earlier text is bracketed in place: the join steps, the rows a name can join, the refund part, F1's risk and bullets, and both measures. `856f6a3d7` narrows three sentences to the code: the till book reads every till name only when the register counts no name on the row and none tied; the two 'no such name' reasons hold only for a readable book; and the 2026-10-07 trail row's 'No migration or gateway code changed' is this branch's side only."*
> 25. **L275**, after *"their checks are unchanged."*, add: *"[ADDED 2026-10-07] Five more static rows: `CELLAR-TILL-NAME-JOINS-MENU-ROWS-FIRST`, `CELLAR-TILL-NAME-SIZE-WORDS-ONLY-BREAK-TIES`, `CELLAR-TILL-NAME-SIZE-WORDS-BREAK-TIES-WITHOUT-THE-MAKER` (S19's and S24's assertions), `CELLAR-LEDGER-SIZE-WORDS-ARE-THE-GATEWAYS-VOLUMES` and `CELLAR-ROW-RECORD-SAYS-WHETHER-THE-TILL-HOLDS-THE-NAME`. Six rows' verify rewritten to the new shapes, each with a dated bracket: `CELLAR-ROW-RECORD-TILL-BOOK-IS-PAGED-NOT-SAMPLED`, `CELLAR-TILL-NAME-JOINS-THE-MOST-SPECIFIC-ROW-IT-CONTAINS`, `CELLAR-TILL-NAME-JOINS-WITHOUT-THE-MAKER`, `CELLAR-ROW-RECORD-TILL-BOOK-READS-THE-LEDGERS-NAMES`, `CELLAR-TIED-ROW-LISTS-ITS-TIED-NAMES` and `CELLAR-SOLD-SPLITS-INTO-BOTTLES-AND-GLASSES`. The fragment holds 13 rows."*
> 26. **L281**, after the coordinator's bracket, add: *"[2026-10-07, fixer: moved again in `4cb9ecbae`, to `20261223180000`, past #620's `20261223030000` on main. `check_migration_order` passes at `856f6a3d7`. Re-check at merge.]"*
>     **L285**, after *"…are behind main too."*, add: *"[2026-10-07: #620 has merged (`…030000`). #612, #618 and #617 now push `…040000`, `…150000` and `…170000`, all below `…180000`.]"*
>     **L286**, after *"(grepped each PR's diff)."*, add: *"[Re-grepped 2026-10-07 at their current heads: none of #541, #612, #617, #618 or #626 adds such a line. With #628, these are every open PR that adds a migration.]"*
> 27. **L287**, after *"…`registerCells.tsx` and `useCellarNextData.ts`."*, add: *"[2026-10-07, fixer: #628's head is now `84aec1eea`, and its migration `20261223060000_the_cellar_counts_the_door_checked_price.sql`, past main's newest and below this PR's `…180000`. It still DROPs and re-CREATEs `house_beverage_ledger`, from #627's body: none of its added lines has `tied_lines`, `tied_names`, `poured_bottles`, `bare_k` or `size_word`. It now shares 9 files with this PR: the six above, `scripts/sql_outside_migrations.txt`, and #627's tests `20261222120000_the_ledger_lists_only_the_current_menu_test.sql` and `20261222170000_the_cellar_reads_the_tills_own_record_test.sql`. If #628 merges first, this migration, being newer, must be rebuilt on #628's ledger body before it merges. Either way, whichever merges second starts from the other's ledger body and is the newest.]"* [2026-10-08 00:33Z, coordinator: #628 merged first (`62f8967b4`), and `fc72bf58c` rebuilt this migration on its ledger body; this bracket's condition is met.]
> 28. **L291**, after *"Whichever merges second keeps both lines."*, add: *"[2026-10-07: #620 has merged. #617, #618 and #626 still append to it, and so does #628 (item 2).]"*
> 29. **L293**, after *"### Verifier's last round"*, add: *"[2026-10-07, fixer: that was the round at `2832515b9`. Since then: the audit at `3f3689307` BLOCKED (`audits/650-3f3689307/report.md`); its two answers are built and its Finding 2 fixed. The audit of `aa5b5ce19` (five mutations unkilled, refund parts, a short label) is answered in `b31ee7f33`. The verifier's last items at `b31ee7f33` (pass 4 unpinned, the reason list) are answered in `2aed5aa8a` and `4668c4640`. The verifier at `4668c4640` returned 'should' (sentences broader than the code or the facts), answered in `856f6a3d7`.]"*
> 30. **L310**, after *"No fork is left open for this PR."*, add: *"[2026-10-07: and the #650 BLOCK's two, asked 2026-10-06 14:17:38Z and answered 15:13:54Z: *"Menu first (Recommended)"* and *"Only to break ties (Recommended)"*, both built (quoted above and in ADR 0301). Still no fork is open.]"*
> 31. **L324**, after *"…all 12 such joins are the beer's own row."*, add: *"[2026-10-07: under menu first, a short menu name without its maker also beats an invoice, order or quote row whose every word the till name holds. That is the *"Menu first"* answer's own stated cost.]"*
> 32. **L327**, after *"…unmeasured at production's catalogue size."*, add: *"[2026-10-07: a row the register counts no name on, with none tied, also reads every distinct till name, keyset-paged (Finding 2). That read is unmeasured.]"*
> 33. **L334**, after *"the run against the earlier build (builder's and verifier's)."*, add a sub-bullet: *"[2026-10-07] the synthetic re-measure with competing books, the SQL, gateway, web and claims mutants since `3f3689307`, and the block-by-block runs (the fixer's)."*
> 34. **L336**, after *"…with no body or trailer."*, add: *"[2026-10-07: so do the four merges since, `3adac4a98`, `c85dc8ed7`, `0ee7a10be` and `2771f8346`. The eight other commits since `3f3689307` carry the Opus 5 trailer.]"* [Corrected 2026-10-08 00:33Z, coordinator: at `fc72bf58c` the merges since `3f3689307` are six: the four named, `ab3c49231` (default message, no trailer) and `fc72bf58c` (a body and the Opus 5 trailer). The eight other commits are unchanged.]
> 35. **L338**, after *"…have not run on `2832515b9`."*, add: *"[2026-10-07: `3f3689307` was pushed and audited. `856f6a3d7` is not pushed, and CI and the ADR 0090 audit have not run on it.]"* Then add these bullets after L338:
>
>     ```
>     - [ADDED 2026-10-07] **Race branch.** When the register counts names on the row whose lines are gone by the second read, the till book carries no `holdsLabel`, so the record can still claim nothing names the row. As before; disclosed in ADR 0301.
>     - [ADDED 2026-10-07] **A short label.** A label under four characters that no till name equals reads "not checked" (`holdsLabel` null), even when no till name contains it either. It says unknown, never a false no.
>     - [ADDED 2026-10-07] **One row's two bare names.** `reach_bare`'s pick between one row's two names without the maker is pinned by a static claims row only. No SQL block has a row with two bare names that differ on product words.
>     - [ADDED 2026-10-07] **Locale.** Postgres's `\w` and `\s` follow the database's locale, so the ledger's volumes are not proven to match the gateway's character for character. No test pins that; a claims row fails the build if the two patterns' text drifts apart.
>     - [ADDED 2026-10-07] **Template.** The local runs use `main_tpl` at `42fe1252b`, behind origin/main by #620's migration and test only, which each run applies on top.
>     - [ADDED 2026-10-07] **Claims count.** `check_decision_claims.sh` was not run at `856f6a3d7`.
>     ```
>
> Unchanged and still true at `856f6a3d7` (checked): L10, L11, L18, L20, the ruling and answers (L32-L43), *What was wrong* (L45-L68), L73 (the migration defines functions only: no INSERT, UPDATE, DELETE or table statement), `house_till_lines` and `house_till_names(uuid, text)` (L76-L86, L107-L109; their bodies are byte-identical to `3f3689307`'s), the 37 columns (L100-L105), *Deploy order* (L128-L130), #627's changed tests (L213-L218; no diff since `3f3689307`), L277, and *Not covered* L314-L326 and L328-L330 except as bracketed.
>
> ### 5. Not done or not verified (this round)
>
> - **Production.** Nothing was read or measured on production.
> - **SQL block by block and the SQL mutants** were not re-run at `856f6a3d7`; its SQL bytes are `4668c4640`'s. `pgtest.sh lane` was re-run.
> - **`check_decision_claims.sh`** was not run (the coordinator's instruction), so the claims count at `856f6a3d7` is unmeasured.
> - **Template.** `main_tpl` is at `42fe1252b`. It was not rebuilt, as lanes may not run `template`. #620's migration is applied on top in each run.
> - **Merge order with #628** is re-read, not resolved. Whichever merges second must start from the other's ledger body and be the newest. [Corrected 2026-10-08 00:33Z, coordinator: resolved. #628 merged first (`62f8967b4`), and `fc72bf58c` re-creates the ledger from #628's body plus this branch's changes. The pre-merge lane migration on top of #628's fails the door test at T1 on local Postgres; the merged one passes it.]
> - **One row's two bare names** are pinned by the static claims row only.
> - **The ADR 0301 README index row** is still stale: it says the fork is deferred. Fixing it would make this PR 16 files, so it is owed to a later branch.
> - **The four merge commits** carry git's default message, with no trailer.
> - **No browser check.** The cell was checked in vitest's DOM only.

---

> **[2026-10-07 20:13Z, fixer, local head `4668c4640`, push note]**
>
> [SUPERSEDED in full, 2026-10-07 21:46Z: never posted. The note at the top, at `856f6a3d7`, replaces it; its old words are kept below.]
>
> This is the head to audit: `4668c46409a339fdabf00c921009f8a1b260f0d8`. It is not pushed, and the live body is not edited. The live body was last edited 2026-10-06T05:20:01Z, at the pushed head `3f3689307`. Neither note below (14:31Z at `b31ee7f33`, 13:15Z at `aa5b5ce19`) was posted. This note adds three commits to the 14:31Z note and restates its stale-line list for this head; where the two differ, this one holds.
>
> **Founder answers.** None of the answers in `fixes/briefs/answers-2026-10-07-pm.md` (14:41:21Z, 18:59:42Z, 19:48:13Z) concerns #650. They cover #619, #613, #611, #614 and #616. Nothing from them is recorded on this branch.
>
> **Commits on top of the 14:31Z note's head `b31ee7f33`**
>
> | Commit | What it is |
> |---|---|
> | `0ee7a10be` | `merge_main.sh`: origin/main `ca3582988` (#649) merged, **no conflicts**. #649 touches `claims.d/feat-tables-learned-from-the-pos.jsonl` and `tables-learned-from-the-pos.spec.ts` only. Git's default message, no body or trailer. |
> | `2aed5aa8a` | SQL S24 to S27: pass 4 of the till-name join (order rows, by their name without the maker). ADR 0301's mutation table re-run on 27 blocks. The bare-pass claims row also keeps S24's assertion. |
> | `4668c4640` | ADR 0301 text only: the till book's reason list says four, not three, and `TILL_HOLDS_NO_SUCH_NAME` is said only for a label of four or more characters. Review-trail row. |
>
> The full list since the pushed head `3f3689307` is the 14:31Z note's table (`3adac4a98` to `b31ee7f33`) plus these three.
>
> **What the verifier's last items asked, and what changed**
> 1. **S19 pinned the size tie-break without the maker for menu rows (pass 2) only.** Pass 4 runs the same pick on order rows, and no block failed when it broke there. Four blocks, two order lines each, which no menu row and no supplier row's full words reach:
>    - S24, pass 4's size tie-break: 'Zqmk Imbik' with 'Zqos Yeni Raki' and with 'Zqos Yeni Raki 35cl'. The till's 'Zqos Yeni Raki 35cl (glass)' joins the 35cl row without the maker; the plain row neither counts nor ties.
>    - S25, a product word over a size: 'Zqow Yeni Raki Ala 70cl bottle' joins the Ala, not the 70cl.
>    - S26, the exact rule: 'Zqoe Rouge' joins 'Zqmk Bagci Zqoe Rouge', not 'Zqmk Diger Zqoe Zqoe Rouge', level with it in words.
>    - S27, the tie rule: two makers' 'Zqoy Yakut' tie on 'Zqoy Yakut (glass)'. Neither's Sold counts it; each counts and lists it as tied.
> 2. **ADR 0301 :273.** *"one of three things"* is bracketed to four, and the `TILL_HOLDS_NO_SUCH_NAME` bullet to *"a label of four or more characters, folded"*; a shorter label that no till name equals gets `TILL_NAME_TOO_SHORT_TO_SEARCH` (`beverages.service.ts`, the branch after `fold(label).length < CONTAINS_FLOOR`). Old words kept.
>
> The migration, the gateway and the web are unchanged since `b31ee7f33`.
>
> **Results at `4668c4640`**
> - **Block by block** (`audits/650-local-pg-b31ee7f33-pass4.txt`, run on the committed test bytes):
>   - HEAD passes 27 of 27.
>   - `3f3689307` passes 19, failing S14, S15, S17, S18, S20, S22, S23 and **S25**. S24, S26 and S27 pass there: that build's most-words rule picks the 35cl row, and F1's exact and tie rules were already built.
>   - Five new one-spot mutants, each scoped to pass 4 (tier 2), each fail their block alone:
>     - `reach_bare`'s `CASE WHEN r.tier = 2 THEN 0 ELSE r.n - r.p END AS s` → S24;
>     - `cand`'s bare half `CASE WHEN b.tier = 2 THEN 0 ELSE b.s END` → S24;
>     - `bare_word`'s `p` filter `OR bk.tier = 2` → S25;
>     - `reach_bare`'s `bool_or(r.bare_k = r.name_k AND r.tier = 1)` → S26;
>     - `pick`'s tie test `AND c.pass <> 4` → S27.
>   - The ten earlier mutants, re-run on 27 blocks: four now fail one more block (size words never count +S24; the bare pass's `s` forced to 0 +S24; `bare_word`'s `p` any word +S25; size words from menu labels only +S25), as does the build before (+S25). The ADR table brackets those five cells. The other six earlier mutants fail the same blocks as before.
> - **`pgtest.sh lane`** (label `ssz650e`): `[fix] PASS` for `20261223030000_a_house_zone_says_where_it_came_from_test.sql` and `20261223180000_a_till_name_with_a_serve_size_joins_its_row_test.sql`; `[ctl] FAIL` on both (`timezone_source is absent`; `column l.tied_lines does not exist`). Template `42fe1252b`, 2 lane migrations: the template is behind origin/main, and #620's migration counts as a lane migration there.
>   - The two `#627` tests this branch changes, run explicitly (label `ssz650f`): `[fix] PASS` both; `[ctl] FAIL` (`T4 … 31 columns, expected 37`; `T1 … pos_lines = 1, expected 3`).
> - **Claims verify mutants**, throwaway copies: `CELLAR-TILL-NAME-SIZE-WORDS-BREAK-TIES-WITHOUT-THE-MAKER` holds at HEAD and fails (missing `s24-pass4-35cl-joins-its-row`) with S24 reading the plain row, with S24's till-names assert loosened, and with its Sold assert loosened.
> - **`check_decision_claims.sh`** (alone): `== Decision claims: 931 checked, 931 holding` / `PASS — every executable claim still describes reality.` rc=0.
> - **`lanecheck.sh wt-fix-servesize`**: every guard rc=0 (migration order, versions unique, OD ids, conflict markers, citation pairing, ADR numbers). `files=15` against origin/main `ca3582988`. Ownership `[]`. rc=0.
>   - `check_migration_order`: `OK -- 1 migration(s) added since the merge base ca3582988 … Newest on origin/main (ca3582988): 20261223030000`.
>   - `check_migration_versions_unique`: OK against origin/main and 69 other open PRs.
>   - `check_adr_numbers_unique`: no new number; next free 0305.
> - **Gateway jest** `src/beverages`: `Test Suites: 3 passed, 3 total` / `Tests: 80 passed, 80 total`. **Web vitest** `src/pages/cellar/next`: `Test Files 15 passed (15)` / `Tests 302 passed (302)`. Neither area changed in this round; run after the merge.
> - Not re-run this round: tsc and eslint (no TS file changed since `b31ee7f33`; the 14:31Z results stand for those files).
>
> **Stale lines in the live body (at `3f3689307`) → replacement.** The 14:31Z note's items 1 to 19 hold, with these changes:
> - Item 1: *"This is the head to audit: `b31ee7f33`"* → *"`4668c4640`"*. The commit table adds `0ee7a10be`, `2aed5aa8a` and `4668c4640`.
> - Item 3: *"Guards at `b31ee7f33`: all rc=0; 15 files against origin/main `b270a45b8`."* → *"Guards at `4668c4640`: all rc=0; 15 files against origin/main `ca3582988`."*
> - Item 4: the `pgtest.sh lane` line → the one above (label `ssz650e`, template `42fe1252b`, 2 lane migrations).
> - Item 5: *"local head `b31ee7f33`."* → *"local head `4668c4640`."*
> - Item 6: add *"and `0ee7a10be` (origin/main `ca3582988`, no conflicts)."*
> - Item 12: *"**The SQL test, S1 to S13**"* → *"S1 to S27"*. Add S24 (the 35cl tie-break in pass 4, order rows without the maker), S25 (a product word beats a size in pass 4), S26 (an exact name without the maker wins in pass 4), S27 (a pass-4 tie joins neither row and is listed on both).
> - Item 13: SQL mutants → *"15 one-spot mutants (10 earlier, 5 new for pass 4) plus `3f3689307`, block by block on 27 blocks"* (the 14:31Z note's *"11"* counted `3f3689307` as one); claims verify mutants add 3 for S24.
> - Item 14, the *"Re-run by me at `2832515b9`"* table: `check_migration_versions_unique` → 69 open PRs. Jest 80 / 80, vitest 302 / 302 and claims 931 / 931 are unchanged from the 14:31Z note.
> - Item 15, **ADR and claims**: add *"the till book's reason list reads four, and `TILL_HOLDS_NO_SUCH_NAME` is for a label of four or more characters"* and *"the bare-pass claims row also keeps S24's assertion"*.
> - Item 19, **Not covered**: *"CI and the ADR 0090 audit have not run on `b31ee7f33`"* → `4668c4640`.
>
> **Not done or not verified (this round)**
> - **Production.** Nothing was read or measured on production.
> - **Template.** `main_tpl` is at `42fe1252b`, behind origin/main `ca3582988`; it was not rebuilt. The per-block runs apply #620's migration on top of it; #649 adds no migration.
> - **Merge order with #628.** The 14:31Z note's item 17 is carried forward unchanged and was **not re-checked** this round. #628 also redefines `house_beverage_ledger`; this branch did not touch that.
> - **One row's two bare names.** Still pinned by the static claims row only, as the 14:31Z note says. S24 to S27 give each order row one bare name.
> - **tsc and eslint** were not re-run (no TS change since `b31ee7f33`).
> - **README index row** for ADR 0301 is still stale, as the 14:31Z note says; this round makes nothing in it more stale, and fixing it would make the PR 16 files.
> - **The merge commit** `0ee7a10be` carries git's default message, with no trailer.

---

> **[2026-10-07 14:31Z, fixer, local head `b31ee7f33`, push note]**
>
> [SUPERSEDED in full, 2026-10-07 21:46Z: never posted. The note at the top, at `856f6a3d7`, replaces it; its old words are kept below.]
>
> This is the head to audit: `b31ee7f331adc3d27530d1382d29f3eaeda2c6e1`. It is not pushed, and the live body is not edited. The live body was last edited 2026-10-06T05:20:01Z, at the pushed head `3f3689307`. The 13:15Z note below, written at `aa5b5ce19`, was never posted. This note covers both, and the 13:15Z note's stale lines are listed at the end.
>
> **Commits on top of the pushed head `3f3689307`**
>
> | Commit | What it is |
> |---|---|
> | `3adac4a98` | Merge of origin/main `42fe1252b` into the branch, before the BLOCK rework. |
> | `11bc35156` | The #650 BLOCK's two answers: menu rows first, and size words only break ties (SQL S14 to S18). |
> | `ea0598ace` | The BLOCK's Finding 2 (the till book says whether the till holds the name), and a refund keeps its sign. |
> | `aa5b5ce19` | ADR 0301 records both answers verbatim; claims check the new join. |
> | `c85dc8ed7` | `merge_main.sh`: origin/main `b270a45b8` merged, **no conflicts**. Git's default message, no body or trailer. |
> | `4cb9ecbae` | Renumbers the migration and its test to `20261223180000`, past main's newest `20261223030000` (#620). Two citations updated: `beverages.service.spec.ts` and `scripts/sql_outside_migrations.txt`. The SQL is unchanged. |
> | `b31ee7f33` | The audit of `aa5b5ce19`: see below. |
>
> **What `b31ee7f33` does (the audit of `aa5b5ce19`)**
> - **SQL S19 to S23.** Five one-spot mutations of the migration passed S1 to S18, so the ADR's *"Each mutation is killed by a named test"* held only for the mutations its table listed. Each now has a block that fails on it:
>   - S19: `reach_bare`'s size words forced to 0.
>   - S20: the order book's rows read as menu rows.
>   - S21: passes 3 and 4 read as one.
>   - S22: `bare_word`'s `p` counting size words.
>   - S23: size words read from menu labels only.
>
>   ADR 0301's mutation table is re-run on all 23 blocks, and its first sentence is bracketed. A new static claims row, `CELLAR-TILL-NAME-SIZE-WORDS-BREAK-TIES-WITHOUT-THE-MAKER`, pins the bare pass's `r.n - r.p AS s` and S19's two assertions.
> - **Refund parts.** A Sold part below zero was pinned for bottles only. The glasses and unknown-unit parts now each have a jest case (`nonZero`) and a vitest case (`soldCell`'s `glasses < 0`, `unknown < 0`).
> - **A short label.** The till book said `TILL_HOLDS_NO_SUCH_NAME` ("no till name contains this row's name") for a label under four characters. `matchLine` never looks for containment there, so the sentence was false for 'Gin' beside 'Gin Tonic'. That case is now its own outcome: `holdsLabel` null, reason `TILL_NAME_TOO_SHORT_TO_SEARCH`, and `nothingNamesIt` false. `matchLine` and the reason share one constant, `CONTAINS_FLOOR` = 4. A jest case pins it. The claims row and ADR 0301 now name four outcomes.
>
> **Results at `b31ee7f33`**
> - **Gateway jest** `src/beverages`: `Test Suites: 3 passed, 3 total` / `Tests: 80 passed, 80 total`.
> - **Web vitest** `src/pages/cellar/next`: `Test Files  15 passed (15)` / `Tests  302 passed (302)`.
> - **`check_decision_claims.sh`**: `== Decision claims: 931 checked, 931 holding` / `PASS — every executable claim still describes reality.`
> - **`lanecheck.sh wt-fix-servesize`**: every guard rc=0 (migration order, versions unique, OD ids, conflict markers, citation pairing, ADR numbers). `files=15` against origin/main `b270a45b8`. Ownership `[]`.
>   - `check_migration_order`: `OK -- 1 migration(s) added since the merge base b270a45b8: 20261223180000_a_till_name_with_a_serve_size_joins_its_row.sql. Newest on origin/main (b270a45b8): 20261223030000`.
>   - `check_migration_versions_unique`: OK against origin/main and 70 other open PRs.
> - **`pgtest.sh lane`** (label `ssz650d`): `[fix] PASS` and `[ctl] FAIL ... column l.tied_lines does not exist`. Template `42fe1252b`, 2 lane migrations.
>   - The template is **behind origin/main `b270a45b8`**. The only supabase difference is #620's `a_house_zone_says_where_it_came_from` migration and test, which touch `restaurants` only. So the harness applies that migration on `_fix` as a "lane" migration.
>   - The ctl fails at the first new column, so that alone proves little.
> - **Block by block** (`audits/650-local-pg-aa5b5ce19-rework.txt`):
>   - HEAD passes 23 of 23.
>   - `3f3689307` passes 16, failing S14, S15, S17, S18, S20, S22 and S23.
>   - Each of the 11 one-spot mutants fails its block, as the ADR's table lists.
> - **Mutants on the gateway and web**, files restored and `cmp`-checked:
>   - Jest, 1 failed / 79 passed on each of four mutants, each failing its own case: glasses via `positive()`; unknown unit via `positive()`; the short-label branch disabled; the short-label branch removed (`aa5b5ce19`'s two outcomes).
>   - Vitest, 1 failed / 101 passed on each of two mutants: `soldCell` without `glasses < 0`; `soldCell` without `unknown < 0`.
> - **Claims verify mutants**, in throwaway copies: 22 of 22 fail, and HEAD passes.
>   - 10 against the new row, including `3f3689307`'s migration and a missing SQL test.
>   - 12 against `…-SAYS-WHETHER-THE-TILL-HOLDS-THE-NAME`, including `aa5b5ce19`'s gateway.
> - **tsc**: only the known passkeys errors (gateway `src/passkeys/passkeys.service.ts` ×2; web `src/services/api/passkeys.ts` ×1).
> - **Gateway eslint** on the 4 files: 0 errors, 56 warnings. main's versions give the same per file (14, 0, 42, 0).
> - **Web eslint** `--quiet`, run with `--resolve-plugins-relative-to p4-scratch/web-lint`, on the 4 web files: rc=0, 0 messages. The run is live: injected faults fire `react-refresh` and `no-unused-vars`.
>
> **Stale lines in the live body (at `3f3689307`) → replacement**
> 1. Top note, *"This is the head to audit … `3f3689307` … renumbers … to `20261223000000`"* → *"This is the head to audit: `b31ee7f33`. The migration and its test are now `20261223180000`, past main's newest, `20261223030000` (#620)."* Then the commit table above.
> 2. *"Collision sweep: no remote ref, local branch or worktree holds a `20261223*` migration."* → *"Sweep, 2026-10-07: pushed heads #612 `…040000`, #617 `…010000` and #618 `…020000`. Local lanes are at `…040000` (doortime), `…060000` (cellardoor, #628), `…150000` (booth) and `…170000` (proxies). `…180000` is past them all, and versions-unique is OK against 70 open PRs."*
> 3. *"Guards at `3f3689307`: migration order 0, …"* and *"15 files against origin/main `4528b9689`"* → *"Guards at `b31ee7f33`: all rc=0; 15 files against origin/main `b270a45b8`."*
> 4. *"Local Postgres, re-run at `3f3689307` … Template `28d32de36`, 7 lane migrations … 7 of 7 [fix] PASS"* → the `pgtest.sh lane` line above (template `42fe1252b`, behind main, 2 lane migrations), plus the block-by-block run.
> 5. *"local head **`2832515b9`**. Nothing has been pushed."* → *"local head `b31ee7f33`."*
> 6. *"The last call merged origin/main **`4528b9689`**"* → add *"; later merges: `3adac4a98`, and `c85dc8ed7` (origin/main `b270a45b8`, no conflicts)."*
> 7. The commit table → add the rows above, from `3f3689307` to `b31ee7f33`.
> 8. *"The join, in order: An exact key wins outright. Otherwise … the one with the most words wins."* → *"Four passes, and only the first with a candidate counts: (1) menu full words, (2) menu name without its maker, (3) invoice, order or quote full words, (4) order name without its maker. Inside a pass: exact, then the most product words, then the most size words (`VOLUME_IN_TEXT`'s volumes). Rows level on all three tie."*
> 9. F1's bullet, *"Only a till name that holds no row's full words tries each menu or order row's name without its maker"* and *"The full-words pass always comes first (S11)"* → *"A till name that holds no menu row's full words tries menu rows' names without their maker (pass 2), before any supplier row (S18). A menu row's full words come first (S11)."*
> 10. **Gateway** → add *"When no line counts and no name tied, `readTillLines` reads every till name. The reason says one of four things: the till holds the name elsewhere; no till name contains it; the label is under 4 characters, so containment was not checked; or the read failed. `holdsLabel` is true, false or null, and `nothingNamesIt` is false when it is true or null. A part below zero is kept (`nonZero`), not nulled."*
> 11. **Web**, *"A row with no known unit keeps the plain count"* → add *"and a Sold with any part below zero shows the net count alone."*
> 12. *"**The SQL test, S1 to S13**"* → *"S1 to S23"*, adding: S14 (the BLOCK's Âlâ case), S15 (an invoice row's exact key loses to the menu), S16 (the 35cl tie-break), S17 (a product word beats a size), S18 (the menu's bare name before a quote's full words), S19 (the 35cl tie-break without the maker), S20 (an order row is a supplier row), S21 (pass 3 before pass 4), S22 (S17 without the maker), S23 (a size word read from an invoice label).
> 13. *"**Mutants** (builder's runs; not re-run by me or the verifier): SQL: 8 of 8 … Gateway: 6 of 6 … Claims: 19 of 19."* → keep, and add the `b31ee7f33` runs above: SQL 11 of 11 one-spot mutants plus `3f3689307`, block by block; gateway 4 of 4; web 2 of 2; claims verify 22 of 22.
> 14. The *"Re-run by me at `2832515b9`"* table, row by row:
>
>     | Row | Was | Now |
>     |---|---|---|
>     | Jest | 73 of 73 | 80 of 80 |
>     | Vitest | 299 of 299 | 302 of 302 |
>     | Claims | 905 of 905 | 931 of 931 |
>     | `check_migration_versions_unique` | 72 open PRs | 70 |
>     | `check_migration_order` | **FAILS** | **OK** |
>
>     Lint and typecheck: as above. *"next free 0305"* was not re-read; `check_adr_numbers_unique` rc=0.
> 15. **ADR and claims** → add: *The answers to the #650 BLOCK* section (both answers verbatim with the rejected options, asked 2026-10-06 14:17:38Z, answered 15:13:54Z), the mutation table, and the record's four outcomes. Five new claims rows since `3f3689307`: `…-JOINS-MENU-ROWS-FIRST`, `…-SIZE-WORDS-ONLY-BREAK-TIES`, `…-SIZE-WORDS-BREAK-TIES-WITHOUT-THE-MAKER`, `CELLAR-LEDGER-SIZE-WORDS-ARE-THE-GATEWAYS-VOLUMES`, `CELLAR-ROW-RECORD-SAYS-WHETHER-THE-TILL-HOLDS-THE-NAME`.
> 16. **Merge order 1**, *"Its version, `20261222180000` … #612 (`…190000`), #617 (`…200000`), #618 (`…210000`) and #620 (`…220000`) are behind main too."* → *"Done in `4cb9ecbae`: `20261223180000`. Re-check at merge. #620 has merged (`…030000`). #612, #617 and #618 push `…040000`, `…010000` and `…020000`, and none adds a line naming the ledger, `house_till_lines` or `house_till_names` (grepped each PR's diff, 2026-10-07)."*
> 17. **Merge order 2 (#628)** still holds, with new versions. #628 pushes `20261221091500` (`f8dde42e6`), and 15 of its added lines name the ledger functions. Its local lane is at `20261223060000`. Both are below this PR's `…180000`. So if #628 merges first, this migration redefines the ledger after it, from this branch's body. Whichever merges second must start from the other's ledger body and be the newest. The claims rows of each are meant to fail the build otherwise.
> 18. **Forks answered (2026-10-06)** → add the BLOCK's two: *"Menu first (Recommended)"* and *"Only to break ties (Recommended)"*, both built. *"No fork is left open for this PR"* still holds.
> 19. **Not covered** → add the 'Not done' items below. Change *"CI and the ADR 0090 audit have not run on `2832515b9`"* to `b31ee7f33`.
>
> **Stale lines in the 13:15Z note below → replacement**
> - *"(version kept)"* / *"`20261223000000`"* → `20261223180000` (`4cb9ecbae`).
> - *"**`check_migration_order` rc=1** … needs renumbering at merge"* and *"**Migration renumber.** It is owed at merge"* → rc=0; done.
> - *"**15 files** against origin/main `5e6c0684e`"* → against `b270a45b8`.
> - *"921 checked, 921 holding"* → 931 of 931.
> - *"**77 / 77**"* → 80 / 80. *"**300 / 300**"* → 302 / 302.
> - *"HEAD 18/18 … Each mutation is killed: …"* → HEAD 23/23, with the 11-mutant table in ADR 0301.
> - *"`main_tpl` … not origin/main `5e6c0684e`"* → not origin/main `b270a45b8`.
> - *"Web eslint was not run"* → it ran: rc=0, 0 messages.
>
> **Not done or not verified**
> - **Production.** Nothing was read or measured on production.
> - **Template.** `main_tpl` is behind origin/main (see above). It was not rebuilt, since lanes may not run `template`.
> - **Browser.** No browser check; the cell was checked in vitest's DOM only.
> - **A short label with no match at all.** A label under four characters that no till name equals now reads "not checked", even when no till name contains it as a substring either. The record does not search for that case. It says unknown, never a false no.
> - **One row's bare names.** `reach_bare`'s pick between one row's two bare names (`ORDER BY … r.p DESC, r.n DESC`) is pinned by the static claims row only. No SQL block has a row with two bare names that differ on product words.
> - **Race branch.** Names counted on the row whose lines are gone by the second read still carry no `holdsLabel`, so `nothingNamesIt` can be true. This is as before, and disclosed in the ADR.
> - **Locale.** The ledger's volumes are not proven to match the gateway's character for character. No test pins that.
> - **ADR 0301's README index row** (`.planning/decisions/README.md`, from #627) is stale. It still says the fork is deferred, and says nothing of the 2026-10-06 answers. Fixing it would make this PR 16 files, so it is owed to a later branch.
> - **The merge commits** `3adac4a98` and `c85dc8ed7` carry git's default message, with no trailer.


---

> **[2026-10-07 13:15Z, fixer, local head aa5b5ce19]**
>
> [SUPERSEDED in full, 2026-10-07 21:46Z: never posted. The note at the top, at `856f6a3d7`, replaces it; its old words are kept below.]
>
> [SUPERSEDED in part, 2026-10-07 14:31Z: never posted. The push note above covers this head too, and lists this note's stale lines with their replacements.]
>
> This is the rework after the BLOCK at `3f3689307` (report `audits/650-3f3689307/report.md`). It is not pushed, and the live body is not edited.
>
> **Commits on top of `3adac4a98`**
> - `11bc35156`, in the same migration `20261223000000_a_till_name_with_a_serve_size_joins_its_row` (version kept).
>   - **Menu first.** `book` tags a key tier 1 when the menu names it. A key named only by an invoice, order or quote row is tier 2. A till name's candidates come in four passes: menu full words, menu name without its maker, supplier full words, then order name without its maker. Only the first pass with a candidate counts, and F1's and F2's rules hold inside it.
>   - **Size words only break ties.** `size_word` holds the `beverage_tokenize` tokens of each volume that `VOLUME_IN_TEXT` finds in a row's own labels. The pattern is copied verbatim from `bottle-size.ts:201-202`, flags `gi`. The pick ranks exact, then product words, then size words.
>   - **SQL tests.** S14 is the Yeni Rakı Âlâ case. S15 is a menu row against size-bearing invoice rows; the invoice row's exact key loses. S16 is the 35cl tie-break. S17 has a product word beat a size. S18 puts the menu's bare name before a quote's full words.
>   - The Sold and Charged column sources in `cellar-columns.ts` describe the new order.
> - `ea0598ace`, Finding 2.
>   - When a row counts no name and no name tied on it, `readTillLines` reads every till name: `house_till_names(p_restaurant_id)`, keyset-paged. It keeps only `holdsLabel`, the `matchLine` yes or no.
>   - The reason is `TILL_HOLDS_THE_NAME_ELSEWHERE` or `TILL_HOLDS_NO_SUCH_NAME`, or `tillNamesUnreadReason` with `holdsLabel` null.
>   - `nothingNamesIt` is false when a name tied, or when `holdsLabel` is true or null. The spec asserts both sentences.
>   - **Smaller item.** `house-record` now uses `nonZero()` in place of `positive()`, so a refund keeps its sign. The Sold cell shows the plain count when a part is below zero.
> - `aa5b5ce19`, ADR 0301 and claims.
>   - **ADR.** Both answers are quoted verbatim: question, pick, and each rejected option with its description. They are dated from the transcript: asked 2026-10-06 14:17:38Z, answered 15:13:54Z. A bracket notes that the task dated them 2026-10-07 12:04:50Z, which is when they were relayed. A dated bracket says no ADR text named these forks as deferred or asked, so none was dropped. The ADR also defines size words and the pass order, and carries the mutation table and the synthetic re-measure.
>   - **Claims.** Six resolved CLAIMS rows had their verify rewritten to the new shapes, each with a dated `[CHANGED]` or `[CORRECTED]` bracket. Four rows are new:
>     - `…-JOINS-MENU-ROWS-FIRST`
>     - `…-SIZE-WORDS-ONLY-BREAK-TIES`
>     - `CELLAR-LEDGER-SIZE-WORDS-ARE-THE-GATEWAYS-VOLUMES`
>     - `CELLAR-ROW-RECORD-SAYS-WHETHER-THE-TILL-HOLDS-THE-NAME`
>   - Every changed or new verify passes at HEAD and fails on `3f3689307`. It also fails on 25 one-spot mutations, run in temp copies and not in the worktree.
>
> **Results at `aa5b5ce19`**
> - `lanecheck.sh wt-fix-servesize`:
>   - **`check_migration_order` rc=1**: `20261223000000` is behind origin/main's `20261223030000` (#620). The version is kept, as the task says. The migration needs renumbering at merge, well past the versions sibling lanes claim (up to `20261223150000`).
>   - The other five guards give rc=0.
>   - **15 files** against origin/main `5e6c0684e`. Ownership `[]`.
> - `check_decision_claims.sh`: **921 checked, 921 holding.**
> - **Gateway jest** `src/beverages`: 3 suites, **77 / 77**. With the pre-change `beverages.service.ts`, `house-record.ts` and `row-record.ts` swapped back, `beverages.service.spec.ts` gives **6 failed / 40 passed**. The 6 are the new or changed cases. The swap needed a compile-only shim: the old `row-record.ts` plus the new constants and the `holdsLabel` field.
> - **Web vitest** `src/pages/cellar/next`: 15 files, **300 / 300**. With the pre-change `registerCells.tsx` and `cellar-columns.ts` swapped back, `CellarNext.test.tsx` gives **2 failed / 98 passed**: the refund case and the tooltip case. Files were restored and `git status` is clean.
> - **tsc** (gateway and web): only the existing `@simplewebauthn` errors, in the passkeys files.
> - **Local PG** (`audits/650-local-pg.txt`):
>   - `pgtest.sh lane` gives `[fix] PASS` and `[ctl] FAIL`. The ctl fails at the first new column, so that alone proves little.
>   - Each block was run alone: HEAD 18/18. 3f3689307 is 14/18, failing S14, S15, S17 and S18. Each mutation is killed: no tiers fails S15 and S18; exact from any book fails S15; size words as any word fails S17; size words never fails S16; full words before bare names fails S18.
> - **Re-measure**, on synthetic local copies only, with a quote and a '<name> 70cl' invoice line per menu row in each house:
>   - Before, the supplier rows took 223 lines per house. After, they take 0, and the menu rows equal the no-books build: 20,938 / 20,721 lines.
>   - Ledger median 183 → 170 ms (house A) and 172 → 160 ms (house B).
>
> **Not done or not verified**
> - **Production re-measure.** It needs the founder's yes and was not attempted.
> - **`main_tpl` template.** It is at `42fe1252b` (the merge base), not origin/main `5e6c0684e`. It was not rebuilt, because lanes may not run `template`. The only supabase difference between them is #620's house-zone migration and test, which touch no beverage, till, menu or invoice table.
> - **Migration renumber.** It is owed at merge; until then `check_migration_order` stays red.
> - **Race branch.** When names count on the row but their lines are gone by the second read, the book carries no `holdsLabel`, and `nothingNamesIt` can still be true. This is as before, and disclosed in the ADR.
> - **Locale.** Postgres's `\w` and `\s` follow the locale, so the ledger's volumes are not proven to match the gateway's character for character. No test pins that.
> - **Web eslint** was not run: the worktree cannot resolve `eslint-plugin-jsx-a11y`.
> - **Untouched.** SeriesPanel and RowExpander. No browser check was run.
> - **ADR 0301's README index row is stale.** The row on main (`.planning/decisions/README.md:209`, from #627) still ends *"Fork deferred: … until the founder picks a join"*. That fork was answered on 2026-10-05, and the README says nothing of the #650 answers. Editing it would make this PR 16 files, so it is owed to a later branch.
