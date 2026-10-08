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
**[2026-10-06 ~04:58Z, coordinator, at `764d60554`]**
- **This is the head to audit.** The lane's last call said SHIP at `5024086af`. The coordinator then renumbered the migration from `20261222210000` to **`20261223020000`**, past main's newest, `20261222230000` (#621). The migration and its test were moved, and the line in `scripts/sql_outside_migrations.txt` updated. The SQL is unchanged, and no other file names the version.
  - Versions in flight: #650 serve-size `20261223000000`, #617 proxies `20261223010000`, #618 booth `20261223020000`, #620 zoneaddr `20261223030000`. No remote ref, local branch or worktree held a `20261223*` migration before these.
  - Re-check at merge: if another migration lands first, move this one again.
- **Guards at `764d60554`:** migration order 0, versions unique 0, OD ids 0, conflict markers 0, citation pairing 0. Ownership `[]`. 13 files against origin/main `4528b9689`.
- **Main merged by the coordinator first:** `7d97fd53c` merges origin/main `4528b9689` (#621) into the lane's `5024086af`. The README index rows were kept by number. #621 also writes `pos_checks` in `pos-hub.service.ts` (the till's table word); the merge was textually clean, and jest `src/pos-hub` plus #621's `tables-learned-from-the-pos.spec.ts` pass **329/329** in 15 suites at `7d97fd53c`.
- **Local Postgres, re-run at `764d60554`.** The migration now applies after #621's, where the lane's run applied it before. Template `28d32de36`, 7 lane migrations:
  - 7 of 7 [fix] PASS, including `20261223020000_a_check_carries_its_channel_test.sql` and #621's `tables_learned_from_the_pos_test.sql`.
  - 7 of 7 [ctl] FAIL. This PR's test fails on [ctl] as in the lane's run.
  - Output: `audits/booth-local-pg-764d60554.txt`.
- Sentences below that say the renumber is owed, or that name `20261222210000`, describe the lane's head `5024086af`. The renumber is done.

**Booth lane, PR 1 of 2.** Branch `feat/a-check-carries-its-channel`, opened against `main`, head **`5024086af`**, 13 files. PR 2 (`feat/booth-and-event-checks-own-row`, body in `pr/booth-pr2.md`) is stacked on this branch and adds the readers and the row. PR 2 must not merge until this PR's column is confirmed live in production (see Merge order).

> **Coordinator:** replace the whole live PR body with this file, don't append to it. The body posted at `9b76b2e40` says an unknown channel "is stored as table service" and that an older gateway "never writes" the column. Both sentences were narrowed after the review of `9b76b2e40`, and leaving them above a correction would keep them on the page.

## What was wrong for the owner

On Tuzlu Rüzgar, the street-fair booth's sales were counted as one server's table service. This is finding **A-050**, fork **AW24**, from the read-only analytics walk of 2026-10-03.

- The booth rang up **2 checks** under Kerem: **$4,201.10 on 22 Aug** and **$3,508.42 on 23 Aug**. Neither had covers, and both had a tip of 0. The event check `TR-2026-09-17-EVENT` (**$5,283.47**, 60 covers) went to Owen, who is not one of the five servers.
- **At 42 days**, Kerem's average check read **$248.16 (+27.6% over the staff mean)** and his tip rate **9.82%**. Without the booth those are **$192.25** and **12.87%**, in line with the others.
- **Over the true 90 days**, the booth puts him top on revenue: **$134,007 against Priya's $127,689**. Without the booth he has $126,298. His tip rate reads 12.08% against the others' 12.80–12.82%.
- Today the 1,000-check sample leaves both booth checks out, so this is latent. Lane cap (#609, ADR 0292) reads the whole window and will turn it on.

The root cause is that a check had nowhere to say how it was rung up. Cites are at `e2cbe426a`:

- `CanonicalCheck` (`pos-types.ts:24-45`) had no channel field, and neither did `pos_checks`, whose `source` is the provider key.
- Clover's adapter put the order type into the table slot (`tableRef: o.orderType?.label`, `pos-adapters.ts:155`). An order type is a name like "To Go", not a table.

**This PR is the data layer only. It moves none of Tuzlu's figures by itself** (see Not covered).

## What changed, and why

**ADR 0302: a check names its channel.** The ruling is Locked on the founder's picks. The method is Proposed.

- **The column.** Migration `a_check_carries_its_channel` adds `pos_checks.channel`.
  - It is `text` and nullable, with no default and no backfill.
  - The CHECK `pos_checks_channel_known` allows only `'table'` and `'booth_event'`. Null means no channel the hub knows was named, and it reads as table service.
  - The CHECK is added validated, in one step. The CLI runs the file as one transaction, so the `ADD COLUMN`'s ACCESS EXCLUSIVE lock is held until commit either way. A `NOT VALID` then `VALIDATE` pair would scan under that same held lock and gain nothing. This was measured on local PG 17.
  - The column has a COMMENT. The file closes with a catalogue self-check and can be re-run safely.
  - **This migration changes no existing row**, so no dry-run count is owed.
- **An exact vocabulary.** `CanonicalCheck.channel` is `'table' | 'booth_event' | null`.
  - `checkChannelOf` trims and lower-cases the value, then requires an exact member.
  - The generic adapter (canonical feed and CSV import) reads `channel: checkChannelOf(r.channel)`.
  - Nothing is guessed from a table called "BOOTH" or from an order-type label.
- **Said, not swallowed.** Every import result carries a `channels` tally: `booth_event`, `table`, `none` and `unrecognised`. The empty result carries it too.
  - The tally counts every check received, before any is stored, so a refused or failed check is counted too.
  - A check that names a channel outside the vocabulary is counted as `unrecognised` and **not written as a channel**. One `errors[]` line names it, quoting the first five names and then "and N more". This is ADR 0281's pattern, so an absence is never reported as health.
  - What is stored then depends on the case:
    - a new check is stored with no channel, and a row with no stored channel reads as table service;
    - a re-send of a stored check leaves its channel as it was, so a stored `booth_event` stays `booth_event`;
    - a check refused for its closed_at, or whose upsert fails, is not stored at all.
  - The unknown name is read back from `raw.channel` **only on the canonical feeds** (`generic_webhook`, `csv_import`; `CANONICAL_FEEDS`, `tallyChannels(checks, providerKey)`). On those feeds `raw` is the row the feed sent. A Square, Clover or Toast `raw` is the provider's own object, and whether it carries a top-level `channel` is not verified. It is not read, so those checks count as `none`.
- **Written only when named.** The ingest row carries `channel` only when the check names a channel the hub knows, through a spread.
  - A check that names none sends no `channel` key, so it is stored even by a gateway deployed before the column exists.
  - A re-send that names none, or names an unknown one, leaves the stored channel alone.
  - A re-send that names a known channel corrects it in place, through the existing `(restaurant_id, source, external_check_id)` upsert.
  - Before the column exists, a check naming a known channel would send a column the table lacks. Its upsert error would be named in `errors[]` like any failed upsert. PostgREST's refusal was not measured. No feed names a channel today.
- **An order type is not a table.** Clover's adapter now writes `tableRef: null` and `channel: null`, and the order type stays in `raw` for the owner's later mapping. Clover's registry capabilities become `CAP_NO_TABLES`.
  - This goes beyond the picked option's text (*"Nothing for now"*), so it is marked as proposed method for the founder to see.
  - No Clover house exists (its registry status is 'scaffolded'), so no figure moves. Undoing it is two lines.
  - The source is Clover's order field list (`docs.clover.com/dev/reference/ordercreateorder`), which has no table field. The order type's `customerIdMethod` (`NAME`, `TABLE`, `NAME_TABLE`) is named for the mapping PR.
- **This PR changes no reader.** The per-server and per-table exclusions and the "Booth & events" row are in PR 2.

### Fixes after the review of `9b76b2e40` (commit `3be3947ce`)

- **The record now says what the ingest does.** The old wording said an unknown channel "is stored as table service". That was false in three cases:
  - a re-send of a stored `booth_event` check, where the row stays `booth_event`;
  - a check refused for an unreadable closed_at, where no row is written;
  - a failed upsert, where no row is written.

  Every place that said it now says the check is "counted as unrecognised and not written as a channel; a check with no stored channel reads as table service". Those places are:
  - the `errors[]` line;
  - the service comments;
  - ADR 0302 method 3 and method 5, each with a bracketed correction;
  - the index row;
  - the OD-TBD row;
  - the CLAIMS row's `claim`;
  - the `pos-types.ts` docs;
  - the spec headers;
  - the migration's comments and its COMMENT ON COLUMN. Its SQL statements did not change.
- **`raw.channel` is read on `generic_webhook` and `csv_import` only**, as described above.
- **The CLAIMS verify checks the code, not only the sentence.** It is still static Python. Among other things it checks that the ingest row's only `channel` key is the spread, that `checkChannelOf` admits exactly two values, that the raw read is gated on `CANONICAL_FEEDS`, that `unrecognised` is counted and said, and that the line does not say "stored as".
- **New jest cases**, each failing on `9b76b2e40` and passing now:
  - a re-send naming "catering" leaves a stored `booth_event` in place;
  - a new check naming an unknown channel is stored with no channel;
  - a refused check or a failed check is not said to be stored;
  - a Square, Clover or Toast top-level `channel` key is not read.

### Last-call changes (commit `5024086af`, prose and list order only)

- **ADR 0302 method 1 and the migration's NO BACKFILL comment said, with no qualifier, that "no feed has ever sent a channel".** The lane never read production. `pos_checks.raw` keeps each canonical row verbatim, so a channel a feed did send would sit there unread. Both now say *no feed is known to have sent a channel*, say that this is not checked against production, and give the read-only count that would show it. The rejected "A backfill" alternative now points at method 1. Only the migration's comment lines changed.
- **`scripts/sql_outside_migrations.txt` is now a one-line addition.** The renumber commit had also moved main's `the_ledger_lists_only_the_current_menu` line. That was a needless hunk, and it caused a merge conflict with main's #627 line. The guard reads the file as a set, so restoring the order changes nothing it checks. The file now merges cleanly with main `54f833e4b`.

## Tests, guards and the local Postgres run

- **Gateway jest.**
  - `src/pos-hub` at `5024086af`: **13 suites, 227 / 227** (my run at the last call). No `.ts` file has changed since `3be3947ce`.
  - This PR adds **17 tests**: `pos-hub.channel.spec.ts` has 11, and `pos-adapters.spec.ts` has 6 more.
  - **Without the fix, they fail:**
    - On the merge-base code, the two specs score **15 failed and 13 passed**. This was the verifier's run.
    - On `9b76b2e40`, the 6 narrowing cases fail. The builder and the verifier each ran this.
    - Replacing the spread with `channel: check.channel ?? null` fails **6 of 11** channel cases, the re-send case among them. The file was restored afterwards from a snapshot.
  - **Wider suites, verifier, at `3be3947ce`:** `src/common/read-errors-are-not-silence.spec.ts`, `src/simpos`, `src/ask-readings` and `src/beverages` give **11 suites, 292 / 292**.
  - **Scratch merge with current main `54f833e4b`, at `3be3947ce`:** `src/pos-hub` gives **14 suites, 301 / 301**, and tsc is clean except for the known `@simplewebauthn/server` errors. This was run by both the builder and the verifier.
- **Typecheck and lint, at `3be3947ce`.** I did not re-run them at the last call, since no `.ts` changed.
  - `tsc -p tsconfig.spec.json` is clean except for the known `@simplewebauthn/server` worktree errors.
  - `eslint` and `prettier --check` are clean on the 6 changed gateway files.
- **Local Postgres** (`pgtest.sh lane … booth`, Docker PG 17, template = `origin/main` `28d32de36`, 5 lane migrations applied: main's 4 from `28d32de36..63ce97e62` plus this one). I re-ran it at the last call because the migration's comment changed. It is appended to `p4-scratch/sim-run/fixes/audits/booth-local-pg.txt`:
  ```
  == pgtest lane booth (PR-1 last call) at 5024086af3d095efdd183948edf8faa63c1d33c8
  applied 5 migration(s) to booth_fix
  [fix] PASS 20261222210000_a_check_carries_its_channel_test.sql
  [ctl] FAIL 20261222210000_a_check_carries_its_channel_test.sql: ERROR:  T1 FAIL pos_checks.channel is absent, expected text
  template=28d32de368d3f57df52ce6f490758908d9fa924d lane_migrations=5 tests=1
  ```
  - At `3be3947ce`, all 5 tests' `[fix]` lines PASS. The 4 other `[ctl]` failures belong to main's migrations, which the template is too old to hold.
  - The test runs six blocks in one rolled-back transaction, on synthetic fixtures:
    - T1: the column is text and nullable.
    - T2: the CHECK is validated and names both values, and the comment cites ADR 0302.
    - T3: a booth check, a `'table'` check and a check with no channel are each stored with their channel.
    - T4: a row that omits the column reads null.
    - T5: `catering`, `Booth_Event`, `booth` and `''` are each refused by `pos_checks_channel_known`.
    - T6: a re-post corrects a stored channel in place.
  - **Locks, verifier, at `3be3947ce`.** The whole file in one transaction on the control database left AccessExclusiveLock and ShareUpdateExclusiveLock on `pos_checks`, with the CHECK validated. Re-running it on the migrated database is a no-op.
- **Guards at `5024086af` (mine).** All exit 0:
  - `check_adr_numbers_unique`, `check_citation_pairing`, `check_od_ids_exist`, `check_no_conflict_markers`;
  - `check_migrations_single_home`, `check_migration_versions_unique`, `check_migration_probe_safety`;
  - `check_migration_order`: the newest migration on main is `20261222170000`, and this one sorts after it. [2026-10-06 ~04:58Z, coordinator: true at the lane's head. Main's newest is now `20261222230000` (#621), and this migration is renumbered past it to `20261223020000`; see the top note.]

  The self-tests of the 7 that have one also pass; `check_migrations_single_home` has none. `check_decision_claims.sh` holds **885 / 885**.
- **Guards at `3be3947ce` (verifier).** 20 `scripts/check_*.py` guards pass, plus `check_no_direct_stock_writes.sh` and `check_no_direct_type_attributes_access.sh`, along with 12 self-tests.
- **Gate ownership.** `ownership_between(merge-base 63ce97e62, HEAD)` returns `[]`. Compared directly against `origin/main` it lists README, only because main holds rows this branch has not merged yet. After the re-head, the README diff is a single appended row again.
- **CLAIMS mutations.** The verifier's 8 mutations of the three rows each exit 1, and the baseline exits 0. The mutations were:
  - the spread replaced by `?? null`;
  - the raw read ungated;
  - the errors push removed;
  - the tally dropped from the result;
  - the "stored as" wording put back;
  - the CHECK vocabulary widened;
  - a DEFAULT added;
  - Clover's `tableRef` restored.

  The builder ran 13 further mutations of the ingest row, plus main's copies of the files. Each exits 1.

## ADR, CLAIMS and the register

- **ADR 0302** (new), *Booth and event checks keep their own row, and the POS names the channel*. It contains:
  - both questions, verbatim, as the founder saw them, with every option text;
  - the method (items 1–8; 6 to 8 are PR 2's readers and the merge order);
  - six rejected alternatives;
  - the consequences;
  - the review trail.
- **`decisions/README.md`**: one index row (0302).
- **`claims.d/feat-a-check-carries-its-channel.jsonl`**: 3 rows. They check the column's shape, the closed vocabulary with Clover off the table slot, and the rule that the ingest writes a channel only when one is named, with the tally.
- **`OPEN-DECISIONS.md`**: one appended section, so no citations shift. It records **OD-TBD**: do take-out and delivery checks count as table service? It is filed as Resolved on the founder's answer below. Its number is assigned at merge.

## Founder answers (verbatim, binding)

- **AW24**, AskUserQuestion, 2026-10-04 00:25Z: *"Own row, POS field (Recommended)"*. The option read: *"Booth/event checks show as their own row ('Booth & events') in staff and table figures and still count in takings. The channel is read from the POS order type where the adapter has one (Clover orderType), else the check counts as table service."* This PR builds the "POS field" half. PR 2 builds the "own row" half.
- **Order types**, AskUserQuestion, 2026-10-04 20:50Z: *"Wait, then owner maps (Recommended)"*. The option read: *"Nothing for now: no Clover, Toast or Square house is connected, and the order type is kept in the raw check. Once one connects, the owner marks each order type once in Settings (about 8 files, its own PR)."* Built: no order type is mapped, and the order type is kept in `raw`.
- **Take-out and delivery**, AskUserQuestion, 2026-10-05: *"Decide via order-type map (Recommended)"*, path (D). Built as is: take-out and delivery stay table service until a Clover, Toast or Square house connects. The owner's order-type mapping then decides them. ADR 0302 and the register section record it.
- *"Merge when audited (Recommended)"*: this PR waits for its audit at this head and green CI.

## Forks deferred

- **The owner's order-type mapping.** It is answered as "later", and gets its own PR and ADR once a Clover, Toast or Square house connects.
- **For the founder to see, not a new fork.** Taking Clover's order type out of `tableRef`, and the `CAP_NO_TABLES` registry change, go beyond *"Nothing for now"*. They are proposed method (ADR 0302 method 4). No figure moves, and undoing them is two lines.
- **Optional read-only check, if the founder wants the no-backfill premise measured.** The coordinator would ask first, and nothing here writes:
  ```sql
  select source, count(*) from public.pos_checks where raw ? 'channel' group by source;
  ```
  A non-zero count on `generic_webhook` or `csv_import` would mean a feed already sent a channel. Those rows would then read as table service until they are re-posted, and a backfill question would open.

## Merge order

The plan's order is cap (#609), then netsales (#615) and tz (#616), then **this PR**, then **confirming that `pos_checks.channel` is live in production**, then booth PR 2. Postime (#603) is already merged (`af7e68990`, 2026-10-05).

- **Re-head onto current main (`54f833e4b`).** I measured it with `git merge-tree` at `5024086af`. The only conflict is `.planning/decisions/README.md`, rows 0301 and 0302: keep both, in number order. `pos-hub.service.ts` and `scripts/sql_outside_migrations.txt` auto-merge.
- **Shared files with open PRs.** No open PR touches `apps/api-gateway/src/pos-hub/`. The shared files are:
  - `.planning/decisions/README.md` with #598, #609–#617, #619–#622, #626 and #648. Each is an index-row conflict: keep both rows, by number.
  - `scripts/sql_outside_migrations.txt` with #617, #620, #621, #626 and #628. Where they conflict, it is an append conflict: keep both lines. The guard reads the file as a set.
- **PR 2 must be re-headed onto this head before it is audited.** PR 2 is the local branch `feat/booth-and-event-checks-own-row` at `31746cb70`, and it does not contain `3be3947ce` or `5024086af`. Its `tallyChannels(checks)` still has the old one-argument signature. On the re-head it must take this PR's versions of:
  - `tallyChannels(checks, providerKey)` and `CANONICAL_FEEDS`;
  - the corrected `errors[]` wording;
  - the ADR 0302 text: methods 1, 3 and 5, the rejected alternatives and the review trail.

  Otherwise the ADR and the CLAIMS text diverge between the two PRs.
- **Deploy skew is safe.** Supabase applies the migration at merge, and Railway deploys the gateway separately. This PR's gateway writes `channel` only when a feed names a known one, and no feed does yet.
- **The tables lane (#621)** must not learn a table from a `booth_event` check. Clover order types are no longer table refs.

## Not covered (shortcuts, named)

- **Tuzlu's figures do not change because of this PR, or because of PR 2 alone.** They change only after two more steps:
  - the sim's `gen.py` (`p4-scratch/sim-run/rebuild/run/gen.py:188-194`) sends `channel: 'booth_event'` on its BOOTH and EVENT checks;
  - 22 Aug, 23 Aug and 17 Sep are re-posted.

  The re-post is a production write, which is outside this lane. Until it happens, Kerem keeps $7,709.52 of booth takings and Owen keeps a $5,283.47 server row. "A re-post is stock-idempotent" is not checked against production.
- **No live feed names a channel today.** Clover, Toast and Square stay `none` until the mapping PR.
- **"No feed is known to have sent a channel" was not checked against production.** The count above would check it.
- **Some things were modelled, not measured:**
  - PostgREST's refusal of a known channel sent before the column exists;
  - PostgREST updating only the supplied columns on a single-object upsert. The jest mock models this.
- **The CHECK's scan length was not measured against production.** It is one pass over `pos_checks` under ACCESS EXCLUSIVE, with `statement_timeout` at 120 s. Reads and writes on that table block for the pass. Production's row count was not read.
- **SQL is proven only on local Docker PG 17**, on synthetic fixtures. CI does not run `supabase/tests`.
- **The Clover change goes beyond the pick** (see Forks deferred). The `customerIdMethod` sentence rests on a WebFetch summary of Clover's page.
- **8 guards need production, `.env` or a deploy URL, so they were not run:** beverage_identity_parity, beverage_kind_regression, definer_functions_closed, deployed_sha, display_name_parity, house_item_invariants, migration_ledger and web_deployed_sha.
- **The full gateway jest suite was not run.** The suites that ran are listed above.
- **The `/import/:restaurantId` membership guard** existed before this PR and was not traced.
- **No separate verifier has checked the last call's own commit, `5024086af`.** It changes prose (ADR 0302 method 1, one rejected alternative, the migration comment) and the order of the inventory lines. I re-ran these for it: the guards, the claims, the local Postgres harness and `src/pos-hub` jest. I did not re-run tsc or eslint, because no `.ts` changed.
- **Old commit text.** The body of commit `27bae89a2` still describes the earlier `NOT VALID` method, because history is not rewritten. A squash merge drops it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

