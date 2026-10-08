# PR #620 body delta for head a61c147fc (lane zoneaddr rework)

This file feeds a `gh pr edit` against `pr/zoneaddr.md`. Text is matched by quote, not by line number. The audit's "line 20" and "line 118" are lines 21 and 119 of `pr/zoneaddr.md`, because the coordinator header shifts them by one.

## A. Insert a new first line, above the 2026-10-06 ~00:33Z coordinator line (keep that line as history)

**[2026-10-06, lane zoneaddr rework] Head `a61c147fc`.** It merges `origin/main` `54f833e4b` (`1612d0d22`). Two conflicts were resolved: the README index rows, where both were kept (0301 then 0304), and `scripts/sql_outside_migrations.txt`, where main's order was kept and this PR's one line added. On top sits one record-only commit, `a61c147fc`. In it, ADR 0304, the claims fragment and the code comments now say what the PR-1 code does for a zone with no source that an audit row witnesses. No behaviour changed. The audit of `c2f18cf3c` found no code defect and asked only for record fixes. That head stays overturned, and this head needs its own audit.

## B. Replace (pr/zoneaddr.md:21, the audit's "line 20")

OLD:
> After this PR, Tuzlu's Time zone row reads "source not recorded · nothing records who or what chose it …", unless a `house_time_zone_changed` row whose `to` is `America/Los_Angeles` exists, in which case it names that person. Its Hours row is tagged `inferred`, so the certainty tally counts one fewer `manual`. No production read was made to check which of the two applies.

NEW:
> After this PR, what Tuzlu shows depends on its newest `house_time_zone_changed` row. **With no witness**, meaning that newest row's `to` is not `America/Los_Angeles` or no row exists, its Time zone row reads "source not recorded · nothing records who or what chose it …". Its Hours row is then tagged `inferred`, so the certainty tally counts one fewer `manual`. **With a witness**, the Time zone row reads "stated" with that row's date and names its actor when the name can be read, and the Hours row stays `manual`. That second case is ADR 0304 Reading 5, the lane's reading, which awaits the founder (fork 3). No production read was made to check which case applies.

## C. Replace in the "What changed" table

`TimeZoneSection.tsx` row. OLD:
> `zoneProvenance()` gives one line per source: "from the address", "from the device", "stated" with or without a witness, or "source not recorded". Each line says in its own words why it has no date.

NEW:
> `zoneProvenance()` gives one line per source: "from the address", "from the device", or "stated" with or without a witness. A zone with no recorded source reads "stated" when the newest audit row names that exact zone (ADR 0304 Reading 5), and "source not recorded" otherwise. Each line says in its own words why it has no date.

`certaintyTally.ts` row. OLD:
> … and shows a bound `stated` source or a witness for a zone saved before sources were recorded. Any other present zone is `inferred`. No zone is `unstated`.

NEW:
> … and shows either a bound `stated` source, or no bound source together with a newest audit row that names that exact zone (Reading 5). Any other present zone is `inferred`. A house with no zone is `unstated`.

## D. Replace the size line

OLD: `15 files, +989 / −48, one commit (`5ccd34a25`) on origin/main `28d32de36`.`

NEW: `15 files, +1012 / −48 against origin/main `54f833e4b`. Commits: `5ccd34a25` (the build), `c2f18cf3c` (the migration renumber), `a61c147fc` (the record), plus the two main merges `3f7031825` and `1612d0d22`.`

## E. Add at the top of "Tests, guards and the local Postgres run"

**Rework at `a61c147fc`. Only the record and code comments changed.**
- `npx vitest run` on `certaintyTally.test.ts`, `TimeZoneAndMailReading.test.tsx` and `HoursSection.test.tsx`: 47/47 pass.
- Both ways: I changed the code to match the old ADR wording, with the null-source witness term dropped from `hoursTimezoneCert` and the default branch of `zoneProvenance` ignoring the witness. Three tests then fail: `hoursTimezoneCert: manual only for a stated or witnessed zone`, `names a recorded zone and who stated it`, and `a zone stated before its source was recorded still names its witness`. The files were restored and are `cmp`-identical.
- Gateway: `npx jest src/settings/house-time-zone-and-tone-switch.spec.ts --runInBand --forceExit` gives 20/20. The X→X row is pinned by its test "re-stating a zone whose source was never recorded files one row that moves the source …".
- `tsc`: web shows only the known `passkeys.ts` / `@simplewebauthn/browser` error. Gateway (`tsconfig.spec.json`) shows none apart from `@simplewebauthn`.
- eslint on the 4 changed code files: clean.
- New claim `ADR-0304-WITNESSED-NO-SOURCE-READS-STATED`: it exits 1 against `c2f18cf3c`'s ADR and code, and 0 here. Each of 4 mutations turns it red: dropping the witnessed term, making the default branch ignore the witness, deleting Reading 5, and restoring the old ADR sentence.
- `env LC_ALL=C bash scripts/check_decision_claims.sh`: 899 checked, 899 holding.
- Every `scripts/check_*.py` passes with rc 0, except two groups. The first could not run here and none of them reads a file this PR touches: `check_definer_functions_closed`, `check_house_item_invariants` and `check_migration_ledger` need a database, and `check_beverage_identity_parity`, `check_beverage_kind_regression` and `check_display_name_parity` need `.env`. The second was skipped because those checks read production: `check_deployed_sha`, `check_web_deployed_sha` and `check_deploy_own_pushes`.
- `check_migration_order --event pull_request --base-ref main`: OK. Only `20261222220000` was added since `54f833e4b`, and main's newest is `20261222170000`.
- `check_adr_numbers_unique`: OK across 1729 refs.
- `--self-test` passes on adr_numbers_unique, citation_pairing, no_conflict_markers, migration_versions_unique, migration_order, od_ids_exist, read_columns_exist, web_reads_gateway_dto_keys and read_errors_not_swallowed.
- Local Postgres was re-run at `a61c147fc`, even though the SQL is unchanged:
```
applied 6 migration(s) to zoneaddr_fix
[fix] PASS 20261222220000_a_house_zone_says_where_it_came_from_test.sql
[ctl] FAIL 20261222220000_a_house_zone_says_where_it_came_from_test.sql: ERROR:  T0 FAIL restaurants.timezone_source is absent, expected text
template=28d32de368d3f57df52ce6f490758908d9fa924d lane_migrations=6 tests=1
```
  The output is appended to `p4-scratch/sim-run/fixes/audits/zoneaddr-local-pg.txt`. The template is still `28d32de36`, and the 5 other lane migrations are main's since then.

## F. Replace in "ADR and CLAIMS"

- "three readings the founder may overrule" → "five readings the founder may overrule (Reading 5, the witnessed zone with no source, is built and awaits him)".
- "**CLAIMS:** 5 new `resolved` rows" → "**CLAIMS:** 6 new `resolved` rows". Add `ADR-0304-WITNESSED-NO-SOURCE-READS-STATED` to the list. After "Each was mutated twice by the verifier, and all 10 mutations turned it red." add: "The sixth was mutated 4 ways at `a61c147fc`, all red. `SOURCE-BOUND-TO-ZONE` and `HOURS-ROW-NOT-STALE` were re-worded there with the same verify. The first said a blind rewrite turns the label into 'source not recorded'. The second said 'never for any present zone'."
- Add a bullet: "**ADR 0304 at `a61c147fc`:** the 'How a derived zone squares' paragraph now covers only a zone with no source and **no witness**, and states the witnessed exception as Reading 5. Decision 3 now says a blind rewrite unbinds the source, and a rewrite back binds it again. Decision 4 lists the witnessed case. Decision 5 records the X→X row. Decision 6 says the person named stated this zone value at some time, not necessarily last. The witness rule moved to Reading 4."

## G. Replace (pr/zoneaddr.md:119, the audit's "line 118")

OLD: `- **F4's "a zone of unknown origin is never overwritten by the machine".** PR-1 writes no machine zone, and it reads every existing zone as "source not recorded".`

NEW: `- **F4's "a zone of unknown origin is never overwritten by the machine".** PR-1 writes no machine zone. It reads every existing zone with no witness as "source not recorded". An existing zone whose newest audit row names that exact zone reads "stated" (Reading 5, fork 3).`

## H. "Forks deferred": re-word fork 2's lead, and add fork 3

Fork 2's lead. OLD: "**The lane's three readings, recorded in ADR 0304 as readings and not as rulings.**" NEW: "**The lane's Readings 1, 2 and 4 in ADR 0304, recorded as readings and not as rulings.** Reading 3 is fork 1, and Reading 5 is fork 3."

Add fork 3:

3. **A zone saved before sources were recorded, where an older audit row shows who set that exact zone: does Settings call it stated by that person (manual, as built) or inferred?**
   - **What the code does now (ADR 0304 Reading 5):** a zone with no recorded source reads "stated" with the row's date when the newest `house_time_zone_changed` row says `to` = that exact zone. It names the row's actor when the name can be read, and the Hours row is tagged `manual`. The same holds for a zone whose source a blind writer unbound. PR-1 builds this, and `certaintyTally.test.ts` and `TimeZoneAndMailReading.test.tsx` pin it.
   - **Options:**
     - (a) **Stated, manual (as built).** The audit row is the person's own act through Settings since ADR 0207 round 3, so the zone is attributable (ADR 0116). Cost: if a later audit write failed, the person named may not be the last to set that zone (ADR 0304 Decision 6). A zone a blind writer set back to an earlier stated value is credited to the earlier person.
     - (b) **Inferred, "source not recorded".** Only a source recorded on the row counts. Cost: every pre-ADR zone that a person really chose drops to `inferred` until someone re-states it. Settings disables Record when the choice equals the current zone, so re-stating means picking another zone and back, until PR-4's Settings offer exists. The change is the default branch of `zoneProvenance` and one term of `hoursTimezoneCert`, plus three tests.
     - (c) **Inferred, but name the person as history**, for example "set by {name} on {date}; source not recorded". This is honest about both facts. Cost: a new copy line and a third state for the row. It needs one more web change, and the gateway already returns the witness.
   - **Recommendation:** (a). The row is the person's own audited act, the gateway names someone only when the row's `to` equals the current zone, and Decision 6 discloses the failed-audit residual case. If the founder wants the failed-audit case ruled out entirely, (c) is the honest fallback.

## I. "Not covered": replace two bullets and add one

- Replace the X→X bullet ("When only the source moves, the audit row carries …") with: "**When only the source moves, the audit row carries `timezone {from: Z, to: Z}`.** This is now recorded in ADR 0304 Decision 5, against `settings-audit.service.ts:293`. Settings' Record cannot file it (Record is disabled when the choice equals the zone), so only a direct PUT does. The Settings ledger prints "timezone Z → Z" beside the source move."
- Replace the "ADR 0304 Decision 3 says a blind rewrite 'never leaves a stale one'" bullet with: "**A blind rewrite back to the zone a source vouched for binds that source again**, as Decision 3 now says. The label then names the zone its source gave."
- Add: "**The witnessed zone with no source (Reading 5) is built and awaits the founder (fork 3).** No OPEN-DECISIONS row was added; the coordinator asks."
- Add: "**Two failed audit writes can credit an earlier person** with a zone someone else set again since (ADR 0304 Decision 6, now stated there). The named person did state that zone value at some time."

## J. Replace "Merge-order notes"

- **Overlap with open PRs (72 open checked at `a61c147fc`).** Only two files are shared, both index tails:
  - `.planning/decisions/README.md`: one new index row, 0304, after 0301. It is shared with #533, #566, #577, #589, #596, #598, #609-#619, #621, #622, #626 and #648. Keep both rows by number.
  - `scripts/sql_outside_migrations.txt`: one line, after `20261221093000`. It is shared with #617, #618, #621, #626 and #628.
  - No other file in this PR is touched by an open PR.
- **Stacking:** none, as before.
- **Migration version `20261222220000`.** It sorts after main's newest (`20261222170000`) and after every open PR's migration except #621's `20261222230000`. It is unique, so it is re-checked at merge (ADR 0212, ADR 0235) and cited by slug in prose.
