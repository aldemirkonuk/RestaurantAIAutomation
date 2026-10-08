# PR #620 body delta for head 5e5747bf3 (lane zoneaddr, fix round 1)

**This file supersedes `zoneaddr.delta-a61c147fc.md`. Apply this one instead of it, not on top of it.** It is that delta with the founder's 2026-10-06 03:52Z answer folded in: fork 3 and the "awaits the founder" Not-covered bullet are gone, and every "Reading 5" is now his ruling.

This file feeds a `gh pr edit` against `pr/zoneaddr.md`. Text is matched by quote, not by line number. The audit's "line 20" and "line 118" are lines 21 and 119 of `pr/zoneaddr.md`, because the coordinator header shifts them by one.

## A. Insert a new first line, above the 2026-10-06 ~00:33Z coordinator line (keep that line as history)

**[2026-10-06, lane zoneaddr] Head `5e5747bf3`.** Its parent `a61c147fc` merges `origin/main` `54f833e4b` (`1612d0d22`). Two conflicts were resolved: the README index rows, where both were kept (0301 then 0304), and `scripts/sql_outside_migrations.txt`, where main's order was kept and this PR's one line added. On top sit two record-only commits. `a61c147fc` makes ADR 0304, the claims fragment and the code comments say what the PR-1 code does for a zone with no source that an audit row witnesses. `5e5747bf3` records the founder's answer to that case (by 2026-10-06 03:52Z, *"Credit the old record (Recommended)"*): ADR 0304 quotes it, and the witness rule is now his ruling, not a lane reading. No behaviour changed in either. The audit of `c2f18cf3c` found no code defect and asked only for record fixes. That head stays overturned, and this head needs its own audit.

## B. Replace (pr/zoneaddr.md:21, the audit's "line 20")

OLD:
> After this PR, Tuzlu's Time zone row reads "source not recorded · nothing records who or what chose it …", unless a `house_time_zone_changed` row whose `to` is `America/Los_Angeles` exists, in which case it names that person. Its Hours row is tagged `inferred`, so the certainty tally counts one fewer `manual`. No production read was made to check which of the two applies.

NEW:
> After this PR, what Tuzlu shows depends on its newest `house_time_zone_changed` row. **With no witness**, meaning that newest row's `to` is not `America/Los_Angeles` or no row exists, its Time zone row reads "source not recorded · nothing records who or what chose it …". Its Hours row is then tagged `inferred`, so the certainty tally counts one fewer `manual`. **With a witness**, the Time zone row reads "stated" with that row's date and names its actor when the name can be read, and the Hours row stays `manual`. That second case is the founder's ruling of 2026-10-06, *"Credit the old record (Recommended)"* (ADR 0304 Decision 4). No production read was made to check which case applies.

## C. Replace in the "What changed" table

`TimeZoneSection.tsx` row. OLD:
> `zoneProvenance()` gives one line per source: "from the address", "from the device", "stated" with or without a witness, or "source not recorded". Each line says in its own words why it has no date.

NEW:
> `zoneProvenance()` gives one line per source: "from the address", "from the device", or "stated" with or without a witness. A zone with no recorded source reads "stated" when the newest audit row names that exact zone (ADR 0304 Decision 4, the founder's 2026-10-06 ruling), and "source not recorded" otherwise. Each line says in its own words why it has no date.

`certaintyTally.ts` row. OLD:
> … and shows a bound `stated` source or a witness for a zone saved before sources were recorded. Any other present zone is `inferred`. No zone is `unstated`.

NEW:
> … and shows either a bound `stated` source, or no bound source together with a newest audit row that names that exact zone (ADR 0304 Decision 4). Any other present zone is `inferred`. A house with no zone is `unstated`.

## D. Replace the size line

OLD: `15 files, +989 / −48, one commit (`5ccd34a25`) on origin/main `28d32de36`.`

NEW: `15 files, +1020 / −48 against origin/main `54f833e4b`. Commits: `5ccd34a25` (the build), `c2f18cf3c` (the migration renumber), `a61c147fc` and `5e5747bf3` (the record), plus the two main merges `3f7031825` and `1612d0d22`. Those two merges carry git's default message, with no body and no Co-Authored-By trailer; history is not rewritten, so this is disclosed instead.`

## E. Add at the top of "Tests, guards and the local Postgres run"

**Fix round 1 at `5e5747bf3`. Only the record and code comments changed.**
- `npx vitest run` on `certaintyTally.test.ts`, `TimeZoneAndMailReading.test.tsx` and `HoursSection.test.tsx`: 47/47 pass. Web `tsc` shows only the known `passkeys.ts` / `@simplewebauthn/browser` error; eslint on `TimeZoneSection.tsx` and `certaintyTally.ts` is clean.
- Claim `ADR-0304-WITNESSED-NO-SOURCE-READS-STATED` was rewritten. It now also checks that ADR 0304 quotes the answer, states the exception as the founder's ruling, and that neither the ADR above its review trail nor the two code comments says "awaiting the founder". It exits 1 against `a61c147fc`'s three files and 0 here. Each of 7 mutations turns it red: dropping the witnessed term, making the default branch ignore the witness, deleting the quoted answer, restoring Decision 4's "Reading 5, the lane's, awaiting the founder", restoring either code comment, and dropping "no witness" from the ADR 0116 paragraph. The files were restored and are `cmp`-identical. `ADR-0304-HOURS-ROW-NOT-STALE` changed its text only.
- `env LC_ALL=C bash scripts/check_decision_claims.sh`: 899 checked, 899 holding. `check_adr_numbers_unique`, `check_citation_pairing`, `check_no_conflict_markers`, `check_od_ids_exist`, `check_a_count_is_recorded`, `check_web_reads_gateway_dto_keys` and `check_read_errors_not_swallowed` pass, each with its `--self-test`.
- Not re-run at `5e5747bf3`, because nothing they read changed: the gateway jest spec (no gateway file changed since `a61c147fc`) and the local Postgres harness (the migration and its test are unchanged since `c2f18cf3c`). The `a61c147fc` results below still stand for them.

**Rework at `a61c147fc`. Only the record and code comments changed.**
- `npx vitest run` on `certaintyTally.test.ts`, `TimeZoneAndMailReading.test.tsx` and `HoursSection.test.tsx`: 47/47 pass.
- Both ways: I changed the code to match the old ADR wording, with the null-source witness term dropped from `hoursTimezoneCert` and the default branch of `zoneProvenance` ignoring the witness. Three tests then fail: `hoursTimezoneCert: manual only for a stated or witnessed zone`, `names a recorded zone and who stated it`, and `a zone stated before its source was recorded still names its witness`. The files were restored and are `cmp`-identical.
- Gateway: `npx jest src/settings/house-time-zone-and-tone-switch.spec.ts --runInBand --forceExit` gives 20/20. The X→X row is pinned by its test "re-stating a zone whose source was never recorded files one row that moves the source …".
- `tsc`: web shows only the known `passkeys.ts` / `@simplewebauthn/browser` error. Gateway (`tsconfig.spec.json`) shows none apart from `@simplewebauthn`.
- eslint on the 4 changed code files: clean.
- New claim `ADR-0304-WITNESSED-NO-SOURCE-READS-STATED`: it exits 1 against `c2f18cf3c`'s ADR and code, and 0 here. Each of 4 mutations turned it red at that head: dropping the witnessed term, making the default branch ignore the witness, deleting Reading 5, and restoring the old ADR sentence. (Superseded at `5e5747bf3`, above.)
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

- "three readings the founder may overrule" stays "three readings", but they are now territories, device "UTC", and "from the device". Add: "The witness rule (Decisions 4 and 6) is the founder's ruling of 2026-10-06, *"Credit the old record (Recommended)"*, quoted in the ADR."
- Add to "Founder answers (verbatim; quoted in ADR 0304)", after the F1-F4 block:

  Asked 2026-10-06 ~03:50Z, answered by 03:52Z, on a zone set in Settings before sources were recorded:
  - **Question:** *"#620 (zone from the address): some houses had their time zone set in Settings before zones recorded where they came from. If an old Settings change record shows who set that exact zone, does Settings say 'stated by {name}' (and Hours count it as stated), or 'source not recorded' (counted as inferred until someone saves it again)?"*
  - **Answer:** **"Credit the old record (Recommended)"**. Rejected: *"Say 'source not recorded'"*.
- "**CLAIMS:** 5 new `resolved` rows" → "**CLAIMS:** 6 new `resolved` rows". Add `ADR-0304-WITNESSED-NO-SOURCE-READS-STATED` to the list. After "Each was mutated twice by the verifier, and all 10 mutations turned it red." add: "The sixth was mutated 7 ways at `5e5747bf3`, all red. `SOURCE-BOUND-TO-ZONE` and `HOURS-ROW-NOT-STALE` were re-worded there with the same verify. The first said a blind rewrite turns the label into 'source not recorded'. The second said 'never for any present zone'."
- Add a bullet: "**ADR 0304 at `a61c147fc`:** the 'How a derived zone squares' paragraph now covers only a zone with no source and **no witness**, and states the witnessed exception. Decision 3 now says a blind rewrite unbinds the source, and a rewrite back binds it again. Decision 4 lists the witnessed case. Decision 5 records the X→X row. Decision 6 says the person named stated this zone value at some time, not necessarily last. **At `5e5747bf3`:** the founder's answer is quoted verbatim, the witness rule and the witnessed exception are his ruling in the Status line, Decisions 4 and 6 and the ADR 0116 paragraph (no longer Readings 4 and 5), and the rejected answer is option 28."

## G. Replace (pr/zoneaddr.md:119, the audit's "line 118")

OLD: `- **F4's "a zone of unknown origin is never overwritten by the machine".** PR-1 writes no machine zone, and it reads every existing zone as "source not recorded".`

NEW: `- **F4's "a zone of unknown origin is never overwritten by the machine".** PR-1 writes no machine zone. It reads every existing zone with no witness as "source not recorded". An existing zone whose newest audit row names that exact zone reads "stated" (the founder's 2026-10-06 ruling, ADR 0304 Decision 4).`

## H. "Forks deferred": re-word fork 2 (no fork 3)

Fork 2's lead. OLD: "**The lane's three readings, recorded in ADR 0304 as readings and not as rulings.** All three bind only once PR-2 derives zones." NEW: "**The lane's Readings 1 and 2 in ADR 0304, recorded as readings and not as rulings.** Both bind only once PR-2 derives zones. Reading 3 is fork 1."

Fork 2's list. Delete the bullet "The witness rule: a person is named only by an audit row whose `to` is the current zone." It is the founder's ruling of 2026-10-06 (*"Credit the old record (Recommended)"*), not a fork. Change "**Recommendation:** confirm all three." to "**Recommendation:** confirm both."

There is no fork 3: the witnessed zone with no source was answered by 2026-10-06 03:52Z.

## I. "Not covered": replace two bullets and add two

- Replace the X→X bullet ("When only the source moves, the audit row carries …") with: "**When only the source moves, the audit row carries `timezone {from: Z, to: Z}`.** This is now recorded in ADR 0304 Decision 5, against `settings-audit.service.ts:293`. Settings' Record cannot file it (Record is disabled when the choice equals the zone), so only a direct PUT does. The Settings ledger prints "timezone Z → Z" beside the source move."
- Replace the "ADR 0304 Decision 3 says a blind rewrite 'never leaves a stale one'" bullet with: "**A blind rewrite back to the zone a source vouched for binds that source again**, as Decision 3 now says. The label then names the zone its source gave."
- Add: "**Two failed audit writes can credit an earlier person** with a zone someone else set again since (ADR 0304 Decision 6, now stated there). The named person did state that zone value at some time."

## J. Replace "Merge-order notes"

- **Overlap with open PRs (72 open checked at `a61c147fc`; `5e5747bf3` touches no new file).** Only two files are shared, both index tails:
  - `.planning/decisions/README.md`: one new index row, 0304, after 0301. It is shared with #533, #566, #577, #589, #596, #598, #609-#619, #621, #622, #626 and #648. Keep both rows by number.
  - `scripts/sql_outside_migrations.txt`: one line, after `20261221093000`. It is shared with #617, #618, #621, #626 and #628.
  - No other file in this PR is touched by an open PR.
- **Stacking:** none, as before.
- **Migration version `20261222220000`.** It sorts after main's newest (`20261222170000`) and after every open PR's migration except #621's `20261222230000`. It is unique, so it is re-checked at merge (ADR 0212, ADR 0235) and cited by slug in prose.

## K. Add to "Not covered"

- "**The Swagger summary of `GET /settings/time-zone`** (`settings.controller.ts:359-368`) still reads "The house's time zone, and who last stated it", and does not mention the new `source` field. The code names a person only as the witness of the zone kept now. Fixing it would be a 16th file, so it is owed in PR-2. It is documentation drift only."
- "**While the Time zone register is loading, has failed or is unreadable, a present Hours zone is tagged `inferred`.** A stated zone can flash `inferred` on the Hours row, and if the time-zone GET fails while hours loads, the tally counts it as `inferred`. This is by design (`hoursTimezoneCert` cannot show a person behind a zone it could not read; pinned in `certaintyTally.test.ts`'s 'hoursTimezoneCert: manual only for a stated or witnessed zone', at its case 'Not loaded, unreadable, or describing another zone')."
