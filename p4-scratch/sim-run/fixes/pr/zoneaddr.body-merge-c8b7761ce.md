> **[2026-10-07 12:17Z, coordinator, at merge] Merging head `c8b7761ce`.** The ADR 0090 delta re-audit PASSED at this head: plan READY, both reviews APPROVE WITH NOTES, and the final HOLDS (comment 6037724003). The final found the founder's F1 call and answer word for word in the session transcript. Required CI is green and the branch is up to date with main `42fe1252b`.
>
> **Where this body is stale (read ADR 0304, not these lines):**
> - "from the device" is not a reading he may overrule, and it is not an open fork. The founder ruled it on 2026-10-07 at 04:15:17Z ("Reading 3" in ADR 0304).
> - "The real tenant still reads 'time zone not set'" means Meyhouse Palo Alto. That house's missing zone is inferred from the 2026-08-26 read, not re-read.
>
> **Owed in PR-2's brackets. None blocks this merge:**
> - The ADR's Status line and the "Readings" heading still say all three readings are the lane's. The Reading 3 bracket points at "The founder's words", but the quote sits under "How a derived zone squares…". Narrow both to Readings 1 and 2, and fix the pointer.
> - The index row for 0304 stops at the 2026-10-06 answers.
> - The PR-5 row should repeat Decision 7's audit-action duty.
> - F2 (confirm Readings 1 and 2) has not been asked. It binds PR-2 only.
>
> **Not done:** no production read. Meyhouse's zone, Tuzlu's audit trail, and RLS and grants on `restaurants` are not re-read.

> **[2026-10-07 04:20Z, coordinator, push]** Pushed head **`c8b7761ce`**. It builds on the audited PASS head `64e967fc4` with these commits:
> - `39fd1b98c` merges origin/main `5c07cfb23` (#622). The merge was clean (`git merge-tree` exit 0).
> - `b0b15893d` writes the records the PASS at `64e967fc4` said were owed. ADR 0304's Context and option 27 now name the real tenant (Meyhouse Palo Alto) and say its missing zone is inferred, not re-read. Decision 7 now says PR-5 must file the address move under its own audit action, or the witness rule (Decision 6) filters on the source the row records. Docs only.
> - `0779feb2e` merges origin/main `42fe1252b` (#651). The merge was clean.
> - `c8b7761ce` quotes the founder's F1 answer (below) in ADR 0304 and confirms Reading 3. Docs only.
>
> Across this PR's 15 files, only ADR 0304 and the ADR index README differ from `64e967fc4`, and the README change is main's own row. No code, migration or test changed.
>
> At this head:
> - The fast guards all exit 0: migration order and uniqueness, OD ids, conflict markers, citation pairing, ADR numbers.
> - The branch is 15 files against origin/main `42fe1252b`.
> - Gate ownership is `[]`.
> - Decision claims PASS, 918 of 918 holding. They were run with Python 3.11, because `/usr/bin/python3` here is 3.9 and cannot run ADR 0224's host check.
>
> This head is not audited. A delta re-audit against the PASS at `64e967fc4` is owed before merge.
>
> **Founder answer on F1, 2026-10-07 04:15:17Z (AskUserQuestion), for PR-2's device-derived zone:** verbatim pick *`"from the device" (Recommended)`*. Settings names the device the house was created on. *`"from your device"`* and *`"from {name}'s device"`* are rejected; ADR 0304 records them as options 29 and 30. **F2** (confirm Readings 1 and 2) has not been asked yet. It binds only PR-2.

**[2026-10-06 ~04:58Z, coordinator, at `64e967fc4`]**
- **This is the head to audit.** The lane's last call said SHIP at `269869c4e`. The coordinator then renumbered the migration from `20261222220000` to **`20261223030000`**, past main's newest, `20261222230000` (#621). The migration and its test were moved, and the line in `scripts/sql_outside_migrations.txt` updated. The SQL is unchanged, and no other file names the version.
  - Versions in flight: #650 serve-size `20261223000000`, #617 proxies `20261223010000`, #618 booth `20261223020000`, #620 zoneaddr `20261223030000`. No remote ref, local branch or worktree held a `20261223*` migration before these.
  - Re-check at merge: if another migration lands first, move this one again.
- **Guards at `64e967fc4`:** migration order 0, versions unique 0, OD ids 0, conflict markers 0, citation pairing 0. Ownership `[]`. 15 files against origin/main `4528b9689`.
- **Merge order:** #616 (tz) merges before this PR.
- **Local Postgres, re-run at `64e967fc4`.** The migration now applies after #621's, where the lane's run applied it before. Template `28d32de36`, 7 lane migrations:
  - 7 of 7 [fix] PASS, including `20261223030000_a_house_zone_says_where_it_came_from_test.sql` and #621's `tables_learned_from_the_pos_test.sql`.
  - 7 of 7 [ctl] FAIL. This PR's test fails on [ctl] as in the lane's run.
  - Output: `audits/zoneaddr-local-pg-64e967fc4.txt`.
- Sentences below that say the renumber is owed, or that name `20261222220000`, describe the lane's head `269869c4e`. The renumber is done.

**[2026-10-06 ~04:50Z, lane zoneaddr, last call] Head `269869c4e`.** It merges `origin/main` `4528b9689` (#621, tables learned from the POS) into `5e5747bf3`. Two conflicts were resolved by keeping both sides: the README index rows (0303 then 0304), and `scripts/sql_outside_migrations.txt` (#621's line, then this PR's). No file of this PR changed in the merge. **Verdict: SHIP, once the migration is renumbered at merge (see Merge-order notes).** Earlier heads, for history: `c2f18cf3c` (coordinator re-head and first renumber), `a61c147fc` (record fixes after the audit of `c2f18cf3c`), and `5e5747bf3` (the founder's 2026-10-06 witness ruling quoted). The audit of `c2f18cf3c` found no code defect and asked only for record fixes. That head stays overturned, and this head needs its own audit.

## Summary

**This is PR-1 of 5 in lane `zoneaddr` (ADR 0304), not the whole lane.** It adds the record and the label: a house's time zone is kept with its source, and Settings → Time zone shows that source. It **derives no zone**. Working a zone out from the address or the owner's device is PR-2. The dry run that fills the existing house's zone is PR-3. Until those land, a house with no zone still reads "time zone not set" on every windowed figure once #616 merges, and sign-up still saves the browser's zone with no source.

- Migration `a_house_zone_says_where_it_came_from` adds two nullable columns with no default, `restaurants.timezone_source` (`address` | `device` | `stated`) and `restaurants.timezone_source_zone`, plus CHECK `restaurants_timezone_source_known`. **It changes no existing row.**
- `PUT /settings/time-zone` now records the person's zone as `stated`, bound to the zone it writes. It audits a move of the source as well as of the zone.
- `GET /settings/time-zone` returns `source`, which is read only while the source vouches for the zone the row holds now. It names a person only as the witness of **this** zone.
- Settings → Time zone says where the zone came from. The Hours tab's "Which clock does it keep?" row no longer says "no editor exists", which has been false since ADR 0207 round 3. It now points at Time zone, and its certainty tag is `manual` only when a person stands behind the zone.

## What was wrong for the owner

The lane has no A-id of its own. The founder ordered it on 2026-10-04 while ruling on #616 (tz lane, ADR 0296). #616 files every sale on the house's own day, so a house with no `restaurants.timezone` states no figure ("time zone not set") for the /reports till, its export and every windowed goal. The real tenant has no zone: migration `a_default_is_not_an_answer` cleared every `America/Los_Angeles` value (its :189) because a value equal to a default cannot be attributed (ADR 0116).

The founder's fix is a zone worked out from the address, else the owner's device. That only squares with ADR 0116 if every zone carries a source a reader can see. Before this PR, nothing recorded where a zone came from, and Settings showed it this way:

- **Tuzlu Rüzgar** keeps `America/Los_Angeles`, and nothing recorded who or what wrote it. Its Time zone row said "stated" whatever had written it. Its Hours row was tagged `manual`, as if a named person had typed it, and said "no editor exists".
- **Settings → Time zone** named "stated by · {name}" from the newest `house_time_zone_changed` row, **even when that row was about a different zone**. Audit writes can fail (`recorded: false`), so a person could be credited with a zone they never chose.

After this PR, what Tuzlu shows depends on its newest `house_time_zone_changed` row.
- **With no witness** (that row's `to` is not `America/Los_Angeles`, or there is no row), its Time zone row reads "source not recorded · nothing records who or what chose it …". Its Hours row is then tagged `inferred`, so the certainty tally counts one fewer `manual`.
- **With a witness**, the Time zone row reads "stated" with that row's date and names its actor when the name can be read. The Hours row stays `manual`. That case is the founder's ruling of 2026-10-06, *"Credit the old record (Recommended)"* (ADR 0304 Decision 4).

No production read was made to check which case applies.

## What changed, and why

| File | Change |
|---|---|
| `supabase/migrations/…_a_house_zone_says_where_it_came_from.sql` | Two columns and the CHECK `((timezone_source IS NULL) = (timezone_source_zone IS NULL)) AND (timezone_source IS NULL OR timezone_source IN ('address','device','stated'))`. The equality form is deliberate: the tempting or-form admits a zone with a NULL source, because `NULL IN (…)` is NULL and a NULL CHECK passes. The pair is **not** tied to `timezone`, so two writers that rewrite `timezone` alone still work: the sim seed RPC and `scripts/synth/seed.py`. The gateway reads the source only while `timezone_source_zone = timezone`, so after such a rewrite the source is unbound. The migration is re-runnable and ends with a catalog-only self-check. |
| `apps/api-gateway/src/settings/house-time-zone.service.ts` | `boundSource()` reads the source only while it vouches for the current zone. The PUT writes `{timezone, timezone_source: 'stated', timezone_source_zone}` and files an audit row when the zone **or** its effective source moves. Re-stating a zone that is already `stated` files nothing. `lastStated` reads `changes` and names the newest row's actor only when `fields.timezone.to` equals the current zone. A zone bound to `address` or `device` names nobody. The header's rule 1 becomes "attributable, never silent", and rule 5 (the witness rule) is new. |
| `apps/web/src/pages/settings/next/TimeZoneSection.tsx` | `zoneProvenance()` gives one line per source: "from the address", "from the device", or "stated" with or without a witness. A zone with no recorded source reads "stated" when the newest audit row names that exact zone (ADR 0304 Decision 4, the founder's 2026-10-06 ruling), and "source not recorded" otherwise. Each line says in its own words why it has no date. |
| `HoursSection.tsx` | Two false lines are replaced by a "set in Time zone" link to `#st-section-time-zone`: "no editor exists" and "no route under the gateway writes `restaurants.timezone` (grepped 2026-09-17)". The link target is rendered above Hours in the same house group. |
| `certaintyTally.ts` | `hoursTimezoneCert(hours, houseTimeZone)` returns `manual` only when the Time zone register has loaded and matches the Hours zone. The register must also show either a bound `stated` source, or no bound source together with a newest audit row that names that exact zone. Any other present zone is `inferred`. A house with no zone is `unstated`. |
| `useSettingsNextData.ts` | `HouseTimeZoneRegister.source` is optional on the wire while an older gateway answers. Saving a zone also reloads hours, so the two rows agree right after a save. |
| Tests | `house-time-zone-and-tone-switch.spec.ts`, `TimeZoneAndMailReading.test.tsx`, `HoursSection.test.tsx`, `certaintyTally.test.ts`, and the SQL test of the migration's slug. |
| Records | ADR 0304, its index row in `.planning/decisions/README.md`, `claims.d/feat-zone-from-the-address.jsonl`, and the `scripts/sql_outside_migrations.txt` inventory line for the new SQL test. |

**Size:** 15 files, +1020 / −48 against origin/main `4528b9689`.

**Commits:**
- `5ccd34a25`: the build.
- `c2f18cf3c`: the migration renumber.
- `a61c147fc` and `5e5747bf3`: the record.
- `3f7031825`, `1612d0d22` and `269869c4e`: three main merges. They carry git's default message, with no body and no Co-Authored-By trailer. History is not rewritten, so this is disclosed instead.

## Tests, guards and the local Postgres run

**Last call at `269869c4e`, after the merge of #621:**

*Gateway*
- `npx jest src/settings/house-time-zone-and-tone-switch.spec.ts --runInBand --forceExit`: 20/20 pass.
- `npx jest src/settings src/settings-audit --runInBand --forceExit`: 14 suites, 207/207 pass.
- `tsc --noEmit -p tsconfig.spec.json`: nothing besides the known `@simplewebauthn` errors.
- eslint on both gateway files: clean.

*Web*
- `npx vitest run` on `certaintyTally.test.ts`, `TimeZoneAndMailReading.test.tsx` and `HoursSection.test.tsx`: 47/47 pass.
- `npx vitest run src/pages/settings`: 12 files, 190/190 pass. This run includes #621's new test.
- `npx tsc --noEmit`: the only error is the known `passkeys.ts` / `@simplewebauthn/browser` one, in a file this branch does not touch.
- eslint `--quiet` on the 7 changed web files: clean.

*Claims and guards*
- `env LC_ALL=C bash scripts/check_decision_claims.sh`: 906 checked, 906 holding.
- These guards return rc 0, and so does each one's `--self-test`:
  - check_adr_numbers_unique (0304 unique across 1729 refs)
  - check_migration_versions_unique (origin/main + 71 open PRs)
  - check_citation_pairing, check_od_ids_exist, check_no_conflict_markers
  - check_migration_probe_safety, check_read_columns_exist, check_read_errors_not_swallowed
  - check_web_reads_gateway_dto_keys, check_a_count_is_recorded, check_no_seeded_defaults
  - check_windowed_figures, check_fk_targets_exist, check_new_tables_are_locked_down
  - check_money_states_its_currency, check_flag_readby_anchors, check_route_exposure
  - check_verified_at_is_not_a_boolean, check_fk_repoint_by_referenced_column, check_queried_tables_exist
- `check_migrations_single_home` returns rc 0. It has no `--self-test`.
- **`check_migration_order --event pull_request --base-ref main` FAILS at this head:** "OUT OF ORDER … BEHIND the newest version already on origin/main". #621 put `tables_learned_from_the_pos` on main, and it sorts after this PR's migration. The lane was told not to change the version, so the renumber is the merge step's (see Merge-order notes). The guard's `--self-test` is OK.

*SQL, on local Docker Postgres only (template `28d32de36`; the harness applies main's later migrations and this lane's)*
```
=== 2026-10-06T04:47:59Z last call at 269869c4e812fa1c9fbddbff19773bf87e8a0722 (merges origin/main 4528b9689, #621; SQL unchanged since c2f18cf3c) ===
applied 7 migration(s) to zoneaddr_fix
[fix] PASS 20261222220000_a_house_zone_says_where_it_came_from_test.sql
[ctl] FAIL 20261222220000_a_house_zone_says_where_it_came_from_test.sql: ERROR:  T0 FAIL restaurants.timezone_source is absent, expected text
template=28d32de368d3f57df52ce6f490758908d9fa924d lane_migrations=7 tests=1
```
- The output is appended to `p4-scratch/sim-run/fixes/audits/zoneaddr-local-pg.txt`. Its `exit=` line is blank because of how my wrapper captured the status; the file notes this.
- The same `[fix] PASS` / `[ctl] FAIL (T0)` result was also seen four times before:
  - at `5ccd34a25`, by the builder, the verifier and the first last call;
  - at `a61c147fc`, with 6 migrations applied.
- The test covers:
  - T0: the columns, their types, no default, and a validated CHECK.
  - T1: an unknown source is refused.
  - T2: a source with no zone is refused.
  - T3: a zone with no source is refused (the NULL-IN trap).
  - T4: each of the three sources is admitted.
  - T5: null/null is admitted, and a bare insert reads null/null.
  - T6: a blind rewrite of `timezone` still succeeds.
- Scratch mutation, run by both the builder and the verifier: rewriting the CHECK in the or-form makes T3 fail ("a zone with no source was ADMITTED").
- The verifier re-applied the migration to `zoneaddr_fix`. It ran clean, and exactly one constraint remained, in the equality form.

**Proof from earlier heads (the code under test is unchanged since):**
- **Gateway, against base.** With origin/main's `house-time-zone.service.ts` swapped in (restored and checked with `cmp`), 7 of 20 tests fail. They are exactly the 7 new ADR 0304 cases. Four builder mutations each turn a test red:
  - (M1) drop `timezone_source` from the update;
  - (M2) drop the `to === zone` witness check;
  - (M3) drop the source-to-zone binding;
  - (M4) let address and device zones read the trail.
- **Web, against base.** With the four base sources restored (`TimeZoneSection`, `certaintyTally`, `HoursSection`, `useSettingsNextData`), the 8 new tests fail. Two more mutations were tried:
  - The tally mutation (`manual` for any zone) fails 3 tests.
  - Matching the code to the old ADR wording fails 3 tests: `hoursTimezoneCert: manual only for a stated or witnessed zone`, `names a recorded zone and who stated it`, and `a zone stated before its source was recorded still names its witness`.
- **Claims.** Each of the first 5 claims rows was mutated twice by the verifier, and all 10 mutations turned it red. `ADR-0304-WITNESSED-NO-SOURCE-READS-STATED` exits 1 against `a61c147fc`'s files and 0 at `5e5747bf3`. Each of 7 mutations turns it red:
  1. drop the witnessed term;
  2. make the default branch ignore the witness;
  3. delete the quoted answer;
  4. restore "awaiting the founder";
  5. and 6. restore either code comment;
  7. drop "no witness" from the ADR 0116 paragraph.
- **Verifier at `5e5747bf3`.** Mutating the PUT's `timezone_source: "stated"` line turned `ADR-0304-PUT-WRITES-STATED` red. Mutating `hoursTimezoneCert` to a bare `'manual'` turned `ADR-0304-HOURS-ROW-NOT-STALE` and `ADR-0304-WITNESSED-NO-SOURCE-READS-STATED` red.
- **Ownership.** `pr_audit_gate.ownership_between(origin/main, HEAD)`, run locally at `5ccd34a25`, returned `[]`.

## ADR and CLAIMS

- **ADR 0304** `0304-a-house-zone-comes-from-its-address.md`.
  - **Status:** the ruling is Locked (the founder's words, including the 2026-10-06 witness ruling); the method is Proposed until PR-2 merges.
  - **Contents:**
    - the order (address → device → none);
    - the two columns;
    - the witness rule (Decisions 4 and 6, the founder's ruling);
    - the PR-by-PR build table;
    - how a derived zone squares with ADR 0116;
    - three lane readings the founder may overrule: territories, a device "UTC", and "from the device";
    - 28 rejected options. Option 28 is the founder's rejected answer, "Say 'source not recorded'".
  - **Amends:**
    - ADR 0207 round 3: the PUT now writes `stated`. Built here.
    - ADR 0207 q10, ADR 0213 item 62 and row 9, and ADR 0296's rejected option 2. These are bracketed in the PRs that build them (PR-2 to PR-4), not here.
- **README index:** one new row, 0304. No existing row is edited.
- **CLAIMS:** 6 new `resolved` rows in `claims.d/feat-zone-from-the-address.jsonl`, all static python:
  - `ADR-0304-ZONE-SOURCE-PAIR`
  - `ADR-0304-PUT-WRITES-STATED`
  - `ADR-0304-SOURCE-BOUND-TO-ZONE`
  - `ADR-0304-NO-PERSON-WITHOUT-MATCH`
  - `ADR-0304-HOURS-ROW-NOT-STALE`
  - `ADR-0304-WITNESSED-NO-SOURCE-READS-STATED`

  None names a migration version: the pair row finds the file by its slug.

## Founder answers (verbatim; quoted in ADR 0304)

Asked 2026-10-04 ~22:35Z:
- **Q1** (how #616 lands): *"When a house signs up, when, whenever it adds a restaurant or anything else, when they type in their addresses, that also shows which time zone they are in. Unless they are want to change."*
- **Q2** (purchase spend / bottles sold goals for a no-zone house): *"we can ask for the location and use it for that if the time zone is not set i mean it's not possible since it's if it's an e restaurant otherwise all restaurants need a re other address right or we're just going to use system time zone that work"*
- **Follow-up, which system zone:** **"The owner's device (Recommended)"**. Option text: *the zone of the phone or computer the owner signs up on is saved as the house's zone, labelled 'from your device', and the owner can change it.*
- **Follow-up, #616 timing:** **"Merge #616 first (Recommended)"**. Option text: *#616 merges after audit; the real house reads 'time zone not set' only until the address lane lands and fills its zone in, after a dry run and your yes.*

Asked 2026-10-05T01:17Z, on the plan's forks:
- **F1** one-clock countries (DE, AR, CY, KZ, MY, MH, UZ): **"Name the capital's zone (Recommended)"**.
- **F2** where the owner changes the zone: **"Show it; change in Settings (Recommended)"**.
- **F3** State field on GetStarted: **"Show State for US (Recommended)"**.
- **F4** address move into another zone: **"Follow unless set by hand (Recommended)"**.

Asked 2026-10-06 ~03:50Z, answered by 03:52Z, on a zone set in Settings before sources were recorded:
- **Question:** *"#620 (zone from the address): some houses had their time zone set in Settings before zones recorded where they came from. If an old Settings change record shows who set that exact zone, does Settings say 'stated by {name}' (and Hours count it as stated), or 'source not recorded' (counted as inferred until someone saves it again)?"*
- **Answer:** **"Credit the old record (Recommended)"**. Rejected: *"Say 'source not recorded'"*.

**What PR-1 builds of these:**
- **F2.** The override is the existing Settings PUT, now recorded as `stated`.
- **The label the device follow-up asks for.** The source is stored and shown; Settings has a "from the device" line (see fork 1 for the wording).
- **F4's "a zone of unknown origin is never overwritten by the machine".** PR-1 writes no machine zone. It reads every existing zone with no witness as "source not recorded".
- **The 2026-10-06 witness ruling, in full.** An existing zone with no source whose newest audit row names that exact zone reads "stated" with that row's date, and names the row's actor. Hours counts it `manual`. A zone from the address or the device never names anyone.

**What PR-1 does not build:**
- PR-2: the derivation in Q1, Q2 and the device follow-up, and F1's capital zones.
- PR-3: the back-fill dry run.
- PR-4: F3.
- PR-5: F4's re-derivation when an address moves.

"Merge #616 first" is not touched. PR-1 neither needs #616 nor blocks it.

## Forks deferred (the founder's call; not decided here)

1. **"from the device" vs "from your device" in Settings** (ADR 0304 Reading 3). The follow-up's option text says *'from your device'*. But every owner and manager of the house reads Settings, and the device was the creator's. The builder therefore wrote "from the device", with "the device the house was created on". The sign-up preview in PR-2 would say "from this device". PR-1 writes no `device` row, so no user can see this label yet.
   - **Options:**
     - (a) Keep "from the device" in Settings.
     - (b) Use "from your device" verbatim. This is wrong for every reader who is not the creator.
     - (c) Name the creator: "from {name}'s device". This needs the creator's id stored with the source, which is a schema addition.
   - **Recommendation:** (a).
2. **ADR 0304's Readings 1 and 2, recorded as readings, not rulings.** Both bind only once PR-2 derives zones. (Reading 3 is fork 1.)
   - The territory rule: a device inside a territory addressed under its parent country wins over the parent's zone.
   - A device "UTC" or `Etc/*` zone is not saved as an answer.
   - **Recommendation:** confirm both.

## Production and deploy

- **The migration writes no row.** Adding two nullable columns with no default is catalog-only. The CHECK then makes one validating scan of `restaurants` under ACCESS EXCLUSIVE. Every row passes, because both new columns are null. `statement_timeout` is 120s.
- **No production dry run is needed for this PR**, since no existing row changes. The back-fill that will change rows is PR-3: a dry run, then the founder's yes.
- **Read-only checks for after the merge.** These have never been run against production here.
  - `select column_name, data_type from information_schema.columns where table_schema='public' and table_name='restaurants' and column_name in ('timezone_source','timezone_source_zone');` should return 2 rows.
  - `select count(*) from public.restaurants where timezone_source is not null;` should return 0.
- **Deploy window.** If Railway deploys the gateway before the migration applies, `GET` and `PUT /settings/time-zone` fail until the columns exist. That lasts minutes, and nothing is written during it. No other route reads the new columns in PR-1; `HouseTimeZoneService` is used only by `settings.controller.ts`.

## Merge-order notes

- **Renumber the migration at merge. This is required now.** #621 merged `tables_learned_from_the_pos`, which sorts after this PR's `a_house_zone_says_where_it_came_from`, so `check_migration_order` fails and the `migration-versions-unique` CI job will be red until the file moves. The rename is a 100% rename of three paths, past origin/main's newest version and every open PR's slot:
  - the migration;
  - its `supabase/tests` file;
  - their line in `scripts/sql_outside_migrations.txt`.

  No other file names the version: the ADR, the claims and this body cite the slug. This follows the standing founder rule that migrations are numbered at merge (ADR 0235, ADR 0212).
- **Overlap with open PRs.** I checked 43 open non-dependabot PRs at this head. Only two files are shared, both index tails:
  - `.planning/decisions/README.md`: one new index row, 0304, after 0303. Shared with #566, #577, #589, #598, #609-#619, #622, #626 and #648; an earlier round also measured #533 and #596. Keep both rows by number.
  - `scripts/sql_outside_migrations.txt`: one line. Shared with #617, #618, #626 and #628. Keep both lines.
  - No other file in this PR is touched by an open PR.
- **Stacking: none.** This PR is independent of #613 and #616.
  - PR-2 builds on this PR after #613 merges, because it imports #613's `resolveHouseCountry`.
  - PR-3's ADR 0296 bracket needs #616 on main. The founder ruled that #616 merges first.

## Not covered (shortcuts, CLAUDE.md §0.5)

- **This PR is a slice; it gives no house a zone.** PR-2 to PR-5 are not built. None of the following exists yet:
  - address or device derivation on the three create routes;
  - the sign-up and AddLocation previews;
  - F1's capital zones;
  - the back-fill dry run;
  - the Settings offer and `addressAgrees`;
  - F3's State field;
  - F4's `updateLocation`;
  - mobile.

  The real tenant still reads "time zone not set" once #616 merges, until PR-3's dry run and the founder's yes. The 5-PR split is the coordinator-approved plan (`cont/zoneaddr-plan.json`), not a cut made at the end.
- **The migration's version is behind main** and must be renumbered at merge (above). I did not renumber it, because the lane rule says not to change it.
- **Three merge commits** (`3f7031825`, `1612d0d22`, `269869c4e`) carry git's default message, with no body and no trailer. History is not rewritten.
- **No Browser-pane visual check** of Settings → Time zone or Hours (CLAUDE.md §9), by the builder, the verifier or the last call. Rendering is proven only by vitest/jsdom. The link target `#st-section-time-zone` exists (`SettingsNext.tsx:399`).
- **`hours.reload()` after a save has no test pinning it.**
- **While the Time zone register is loading, has failed or is unreadable, a present Hours zone is tagged `inferred`.** So a stated zone can flash `inferred`, and if the time-zone GET fails the tally counts one fewer `manual`. This is by design: no person can be shown behind a zone that could not be read. It is pinned in `certaintyTally.test.ts`, case 'Not loaded, unreadable, or describing another zone'.
- **A failed read of the audit trail is logged and treated as "no witness".** The old row behaved the same way. The new copy states the absence more strongly, though: "nothing records who or what chose it". The fix would be a `witnessReadable` flag, which is not built.
- **When only the source moves, the audit row carries `timezone {from: Z, to: Z}`.** This is recorded in ADR 0304 Decision 5, against `settings-audit.service.ts:293` ("only the fields that actually moved"). Settings' Record button cannot file it, because Record is disabled when the choice equals the zone; only a direct PUT does. The Settings ledger prints "timezone Z → Z" beside the source move.
- **A blind rewrite back to the zone a source vouched for binds that source again**, as Decision 3 says. The label then names the zone its source gave.
- **Two failed audit writes can credit an earlier person** with a zone that someone else has set again since (Decision 6). The person named did state that zone value at some time.
- **A person cannot re-confirm the zone already shown as their own**, because Record is disabled when the choice equals the zone. A "source not recorded" zone stays that way until someone picks a zone. PR-4's Settings offer is the place for that.
- **Prose left as it is, to keep this PR at 15 files:**
  - `settings.controller.ts:359-368`: the summary of `GET /settings/time-zone` still says "who last stated it", and the description does not mention `source`. This is documentation drift only, and it is owed in PR-2.
  - `SectionKit.tsx`'s `Certainty` note still says `inferred` is "computed on read, never written". PR-1 widens that meaning for the Hours zone row; the widening is documented on `hoursTimezoneCert` and in ADR 0304's Consequences. It is owed in PR-4.
- **External facts in ADR 0304's rejected options were not re-verified** by the verifier or the last call: the `geo-tz` size, the `tz-lookup` miss rate, Places pricing and the Maps Platform terms. They are rationale for rejected options, not code. The readings of the terms are not legal advice.
- **No production read of any kind.** Neither Tuzlu's audit trail for its current zone nor the real tenant's state or country was read.
- **Not run:**
  - `check_gateway_boots.sh`. The service's constructor and DI graph are unchanged.
  - The guards that need a database or `.env`: `check_definer_functions_closed`, `check_house_item_invariants`, `check_migration_ledger`, and the beverage and display-name parity checks.
  - The guards that read production: the deployed-sha checks.
  - At the last call: the mutation runs, which were not repeated. The code they exercise is unchanged since `5e5747bf3`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

