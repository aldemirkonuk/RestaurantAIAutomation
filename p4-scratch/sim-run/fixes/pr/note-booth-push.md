> **[2026-10-07 20:01Z, coordinator, push] Pushed head `28c59e9f8`.** It sits on the PASS at `764d60554` and adds:
> - Merges of origin/main `5e6c0684e`, `b270a45b8` (#609) and `ca3582988` (#649), all clean. The migration was renumbered to `20261223150000` (`76b73fbcf`).
> - `9afc0b9f3`, records in ADR 0302 only: the founder's *"Keep it"* on Clover's tableRef and CAP_NO_TABLES.
>
> At this head:
> - Lane jest with `read-whole-window.spec.ts` passes **72/72**.
> - The six fast guards exit 0, gate ownership is `[]` and files = 13.
> - Decision claims hold **924/924** (Python 3.11).
>
> The PASS does not carry to this head. A delta re-audit against `764d60554` is owed before merge. The fixer's prep note follows, written at local head `9afc0b9f3`. Where it says "not pushed", read this note instead. Its stale-line replacements for the body below still apply.

> **[2026-10-07 13:11Z, fixer, local head 9afc0b9f3]**
>
> Merge-turn re-head of #618 after the PASS at `764d60554` (report `audits/618-764d60554/report.md`). Not pushed. The live body is not edited.
>
> **Commits on top of `764d60554`**
> - `9f33433c6`: merges origin/main `5e6c0684e` (#622 `5c07cfb23`, #651 `42fe1252b`, #620 `5e6c0684e`) through `merge_main.sh`. **No file conflicted.** None of the three touches `apps/api-gateway/src/pos-hub/`; `git diff 764d60554 HEAD -- apps/api-gateway/src/pos-hub/` is empty.
> - `76b73fbcf`: renumbers the migration `a_check_carries_its_channel` from `20261223020000` to **`20261223150000`**. #620 put `20261223030000` on main, so `check_migration_order` failed on the merged tree. The commit is a pure rename of the migration and its `supabase/tests` file, plus the one line in `scripts/sql_outside_migrations.txt`; `git grep` finds the version nowhere else. Just before the rename I swept every local branch, every origin ref and every worktree's working tree. The only `20261223*` versions were 000000 (servesize), 010000 (proxies), 030000 (main), 040000 (doortime) and 060000 (cellardoor). I went well past that ceiling, not one step past it.
> - `9afc0b9f3`: ADR 0302 records the founder's answer of 2026-10-07 04:29:14Z on Clover's `tableRef: null` and `CAP_NO_TABLES`, *"Keep it (Recommended)"*. Method 4 quotes the question, the chosen option and the rejected *"Undo it"* option verbatim from the coordinating session's transcript (asked 04:26:12Z). The old *"They are method, proposed for review…"* sentence is kept inside a dated `[Was: …]` bracket. The Status line names the pick, and the review trail gains the row. Status stays *"Proposed for the method"*: only method 4's Clover change was put to him, so the column, the vocabulary, the tally and the readers are still for his review. The README row does not say a pick awaits him, so it is unchanged. No code changes.
>
> **Results at `9afc0b9f3`**
> - `lanecheck.sh wt-fix-booth`: migration order 0, versions unique 0, OD ids 0, conflict markers 0, citation pairing 0, ADR numbers unique 0. **13 files** against origin/main `5e6c0684e`. Ownership `[]`.
> - `check_decision_claims.sh` (python 3.11): **921 / 921** holding.
> - Gateway jest: this PR's `pos-hub.channel.spec.ts` + `pos-adapters.spec.ts` give **2 suites, 28 / 28**. `src/pos-hub` + `src/analytics/tables-learned-from-the-pos.spec.ts` give **15 suites, 329 / 329**.
> - `tsc -p apps/api-gateway/tsconfig.json --noEmit` on the merged tree reports only the 2 known `@simplewebauthn/server` worktree errors (`passkeys.service.ts:16,22`).
> - Local Postgres: `pgtest.sh lane … r618`, Docker PG 17. The template is `42fe1252b`. **origin/main has moved past it to `5e6c0684e`, and I did not rebuild it**, so #620's migration was applied as a lane migration beside this one (2 lane migrations).
>   - `[fix]` PASS on `20261223030000_a_house_zone_says_where_it_came_from_test.sql` and `20261223150000_a_check_carries_its_channel_test.sql`.
>   - `[ctl]` FAIL on both. This PR's test fails at T1 with "pos_checks.channel is absent".
>   - Output: `audits/618-local-pg.txt`. The current run is first, and the stale `9b76b2e40` run is kept below it.
>
> **Owed, not done here**
> - **The batch-abort follow-up** (audit finding, `pos-hub.service.ts:651-653` as audited). `tallyChannels` calls `String(named)` on whatever the canonical feed's `raw.channel` holds (`:657`). It is called at `:1000`, outside the per-check `try` (`:1010`). The audit measured in Node that `String()` on a 300,000-deep nested array parsed from JSON throws `RangeError`. So one crafted check on `generic_webhook` or `csv_import` would turn the whole request into a 500, with no check stored, where before this PR a bad check failed alone. It needs an HMAC-signed webhook or an authenticated `/import`. The fix is a `typeof named === "string"` guard or a `try` around the conversion. **This PR has no tech-debt entry, so the follow-up is recorded only here.** It is not in the repo.
> - The squash message should use the qualified *"no feed is known to have sent a channel"* (audit owed item 1).
> - Re-check the version against main again at merge. #650 (`20261223000000`) and #617 (`20261223010000`) are behind main too and must renumber. If either lands at or past `20261223150000` first, move this one again.
> - PR 2 (`feat/booth-and-event-checks-own-row`, local `31746cb70`) still carries the migration as `20261220100000` and lacks `3be3947ce` and `5024086af`.
>
> **Stale lines in the live body** (`gh pr view 618 --json body --jq .body` read at ~12:58Z; line numbers are from that output. The audit numbered differently: its "line 14" is :15 here and its "line 18" is :13.)
> - **:1** `**[2026-10-06 ~04:58Z, coordinator, at 764d60554]**`. Keep it as dated history under this note. Replace **:2**'s first sentence, *"This is the head to audit."*, with: *"This was the head to audit until 2026-10-07; the head to audit is now `9afc0b9f3` (see the note above)."*
> - **:2** *"…renumbered the migration from `20261222210000` to `20261223020000`, past main's newest, `20261222230000` (#621)…"*. Append: *"[2026-10-07, fixer: #620 then put `20261223030000` on main, and the migration is now `20261223150000` (`76b73fbcf`).]"*
> - **:3** *"Versions in flight: … #618 booth `20261223020000`, #620 zoneaddr `20261223030000`. No remote ref, local branch or worktree held a `20261223*` migration before these."* Replace with: *"Versions at 2026-10-07 ~13:00Z, from every local branch, origin ref and worktree working tree: `20261223000000` (servesize #650), `…010000` (proxies #617), `…030000` (#620, on main), `…040000` (doortime), `…060000` (cellardoor). This PR is `20261223150000`."*
> - **:5** *"Guards at `764d60554`: … 13 files against origin/main `4528b9689`."* Replace with: *"Guards at `9afc0b9f3`: migration order 0, versions unique 0, OD ids 0, conflict markers 0, citation pairing 0, ADR numbers unique 0. Ownership `[]`. 13 files against origin/main `5e6c0684e`."*
> - **:6** *"Main merged by the coordinator first: `7d97fd53c` …"*. Append: *"Then `9f33433c6` merges origin/main `5e6c0684e` (#622, #651, #620) with no conflicts; jest `src/pos-hub` + `tables-learned-from-the-pos.spec.ts` stay 329/329 at `9afc0b9f3`."*
> - **:7–:10** *"Local Postgres, re-run at `764d60554` … Template `28d32de36`, 7 lane migrations … Output: `audits/booth-local-pg-764d60554.txt`."* Replace with: *"Local Postgres, re-run at `9afc0b9f3` on template `42fe1252b` (origin/main is now `5e6c0684e`; template not rebuilt), 2 lane migrations (#620's and this one): [fix] PASS both, [ctl] FAIL both, this PR's at T1 'pos_checks.channel is absent'. Output: `audits/618-local-pg.txt`."*
> - **:11** *"Sentences below that say the renumber is owed, or that name `20261222210000`, describe the lane's head `5024086af`. The renumber is done."* Replace with: *"Sentences below that name `20261222210000` or `20261223020000` describe earlier heads; the migration is now `20261223150000`."*
> - **:13** *"…opened against `main`, head **`5024086af`**, 13 files."* Replace with: *"…opened against `main`, head **`9afc0b9f3`**, 13 files."*
> - **:15** *"> **Coordinator:** replace the whole live PR body with this file, don't append to it. …"* Delete it, with no replacement.
> - **:59** *"…PostgREST's refusal was not measured. No feed names a channel today."* Replace the last sentence with: *"No feed is known to name a channel today (not checked against production)."*
> - **:61** *"This goes beyond the picked option's text (*"Nothing for now"*), so it is marked as proposed method for the founder to see."* Replace with: *"This goes beyond the picked option's text (*"Nothing for now"*); the founder kept it on 2026-10-07 (*"Keep it (Recommended)"*, ADR 0302 method 4)."*
> - **:106** *"Scratch merge with current main `54f833e4b`, at `3be3947ce`: …"* Replace *"current main"* with *"main `54f833e4b` (current then)"*.
> - **:130** the `check_migration_order` bracket ending *"…renumbered past it to `20261223020000`; see the top note.]"*. Append: *"[2026-10-07, fixer: main's newest is now `20261223030000` (#620), and this migration is `20261223150000`.]"*
> - **Founder answers (after :163)**. Add a bullet: *"**Clover's order type out of `tableRef`, and `CAP_NO_TABLES`**, AskUserQuestion, 2026-10-07 04:29:14Z: *"Keep it (Recommended)"*. The option read: *"An order type such as 'To Go' is not a table; keeping it out of the table field stops it being read as one when a Clover house connects. The order type stays in the raw check for your later mapping."* Built as is; ADR 0302 method 4 quotes the question and both options."*
> - **:169** *"**For the founder to see, not a new fork.** Taking Clover's order type out of `tableRef` … undoing them is two lines."* Delete it. The founder answers bullet above replaces it.
> - **:180** *"Re-head onto current main (`54f833e4b`). I measured it with `git merge-tree` at `5024086af`. The only conflict is …"* Replace with: *"Re-headed onto origin/main `5e6c0684e` at `9f33433c6` (`merge_main.sh`), with no conflicts."*
> - **:182** *"`.planning/decisions/README.md` with #598, #609–#617, #619–#622, #626 and #648."* Replace with: *"`.planning/decisions/README.md` with #566, #577, #589, #596, #598, #609–#617, #619, #626 and #648 (open PRs at 2026-10-07 ~13:10Z)."*
> - **:183** *"`scripts/sql_outside_migrations.txt` with #617, #620, #621, #626 and #628."* Replace the list with *"#617, #626, #628 and #650"*.
> - **:184** *"PR 2 must be re-headed onto this head before it is audited. … it does not contain `3be3947ce` or `5024086af`."* Append: *"It also still carries the migration as `20261220100000`; on the re-head it takes `20261223150000`."*
> - **:190** *"…This PR's gateway writes `channel` only when a feed names a known one, and no feed does yet."* Replace the end with: *"…and no feed is known to name one yet (not checked against production)."*
> - **:191** *"The tables lane (#621) must not learn a table from a `booth_event` check. Clover order types are no longer table refs."* Replace with: *"The tables lane (#621) merged first, at `4528b9689`; per ADR 0302 method 8, PR 2's per-table exclusion skips a learned table's booth checks. Clover order types are no longer table refs."*
> - **:200** *"**No live feed names a channel today.** Clover, Toast and Square stay `none` until the mapping PR."* Replace with: *"**No live feed is known to name a channel today** (not checked against production; see the next line). Clover, Toast and Square stay `none` until the mapping PR."*
> - **:207** *"**The Clover change goes beyond the pick** (see Forks deferred). The `customerIdMethod` sentence …"* Replace the first sentence with: *"**The Clover change goes beyond the AW24-b pick**, and the founder kept it on 2026-10-07 (*"Keep it (Recommended)"*)."*
