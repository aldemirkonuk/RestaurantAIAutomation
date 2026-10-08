> **[2026-10-07 20:02Z, coordinator, push] Pushed head `506247199`.** It sits on the PASS at `f6b57edae` and adds:
> - Merges of origin/main `5e6c0684e`, `b270a45b8` (#609) and `ca3582988` (#649), all clean.
> - Records in ADR 0294 only (`ee13086a1`, `1ed002e51`, `a0a27465a`, `506247199`). No code, test or claim row changed since the PASS.
>
> **The records:**
> - M1–M6 are locked, *"Keep all six (Recommended)"*. It was answered at 12:54:16Z; "12:54:27Z" is corrected in brackets.
> - The minimum-peer floor: at 13:51:58Z the founder picked *"At least two waiters (Recommended)"*.
> - The staff median: at 18:59:42Z he picked *"Only with 5+ servers (Recommended)"*.
> - The even-count median: also at 18:59:42Z, *"Textbook median (Recommended)"*.
> - **All three are built in one follow-up PR, not here.** Whether the band's quartiles move to the same interpolation was not asked.
>
> At this head:
> - Lane jest passes **55/55** and lane vitest **12/12**.
> - The six fast guards exit 0, gate ownership is `[]` and files = 13.
> - Decision claims hold **924/924** (Python 3.11).
>
> The PASS does not carry to this head; a delta re-audit against `f6b57edae` is owed before merge. The fixer's prep note follows (local head `1ed002e51`). Where it says "not pushed", read this note instead. Its stale-line replacements still apply.

> **[2026-10-07 13:11Z, fixer, local head 1ed002e51]** Merges `origin/main` `5e6c0684e` and records the founder's 2026-10-07 answer on ADR 0294's method (M1–M6), *"Keep all six (Recommended)"*. No code changed. Not pushed; the PR's live head is still `f6b57edae`. This head needs its re-head and a fresh ADR 0090 audit.

## Commits (on top of `f6b57edae`)

- **`ee8bc1254` Merge origin/main (5e6c0684e).** Brings in the six main commits the branch lacked: #644, #627, #621, #622, #651, #620. One file conflicted, `.planning/decisions/README.md`. Its single hunk set this branch's 0294 row against main's 0301, 0303 and 0304 rows; main's 0290 row merged cleanly. `merge_main.sh` resolved it by keeping both sides' rows in number order. `CLAIMS.jsonl` merged with no conflict: main changed other rows, and this lane changes only the `ADR-0215-TEAM-MONEY-IN-THE-HOUSE-CURRENCY` row (now line 531). Main changed none of the PR's other files.
- **`ee13086a1` docs(team): lock ADR 0294's method M1–M6.** ADR 0294 Status moves from "Locked for the two rulings, and Proposed for the method" to Locked for both. The old words are kept in a dated `[Was: …]` bracket, and the Method heading gets one too. A new section, "The founder's words on the method", quotes the question, the picked option with its text and the rejected option with its text, all verbatim, answered 2026-10-07 (recorded 12:54:27Z; the answer's own second was not taken). There is a review-trail row. The README 0294 row no longer says the method is Proposed. The record also says the build has no minimum-peer floor (the median is computed when one colleague is the only other server, pinned by the spec), and that the question did not ask whether to add one, so that stays open. Residuals (a)–(c) stay OPEN.
- **`1ed002e51` docs(team): ADR 0294 names the whole-page error screen.** This is the audit's merge-turn note 1. The deploy-skew consequence said an old page's `avgCheck.toLocaleString()` "throws until the page is reloaded". /team has no error boundary of its own, so the nearest one (`HouseShell.tsx:290`, keyed by route; `App.tsx:167` with the shell off) puts its error screen in place of the whole /team page. The ADR now says that, and says it was traced in code, not reproduced. Prose only.

## Results at `1ed002e51` (origin/main `5e6c0684e`, 0 behind)

- **`lanecheck.sh wt-fix-fmt2`:** `check_migration_order`, `check_migration_versions_unique`, `check_od_ids_exist`, `check_no_conflict_markers`, `check_citation_pairing` and `check_adr_numbers_unique` all gave rc=0. files=13. ownership rc=0 `[]`.
- **`check_decision_claims.sh`** (Python 3.11.0): 921 checked, 921 holding, rc=0. **`test_check_decision_claims.sh`:** 31 ok, 0 failed.
- **Also re-run:** `check_money_states_its_currency` rc=0, `check_windowed_figures` rc=0, `check_adr_numbers_unique` (0294 introduced, 1735 refs).
- **The PR's own tests, after the merge:**
  - `PerformanceCard.test.tsx` 12/12.
  - `performance.service.spec.ts` 11/11.
  - Wider: web `npx vitest run src/pages/team` gave 13 files, 195/195. Gateway `npx jest src/team src/common/read-errors-are-not-silence.spec.ts --runInBand --forceExit` gave 14 suites, 390/390.
- **Not run:**
  - `pgtest.sh`, because the PR has no migration and no SQL test. The merge brought in main's migration `the_cellar_reads_the_tills_own_record`, which is not this PR's. The template is at `42fe1252b`, and origin/main has since moved to `5e6c0684e`. It was not rebuilt.
  - Typecheck and lint, because these commits change only prose and the merge brought in code that is main's.
  - A browser render of the card.

## Stale lines in the live body, with replacements

1. Line 1, *"**[2026-10-06 ~00:33Z, coordinator] Re-headed at `f6b57edae`.** … This is a first audit pass; the merge turn re-heads and re-audits."*
   → Keep it as history, and put the bracket above this note on top of it. The live head becomes `1ed002e51` only once it is pushed.
2. *"## Tests and guards (HEAD `82d7fa080`, origin/main `1aa4dcb8c`, 0 commits behind)"*
   → "## Tests and guards (first measured at `82d7fa080` on origin/main `1aa4dcb8c`; re-run at `1ed002e51` on origin/main `5e6c0684e`, see the top note)"
3. *"`check_decision_claims.sh`: **855 checked, 855 holding**"*
   → "`check_decision_claims.sh`: **921 checked, 921 holding** at `1ed002e51`"
4. *"`check_adr_numbers_unique` (0294 introduced, 1680 refs)"*
   → "`check_adr_numbers_unique` (0294 introduced, 1735 refs at `1ed002e51`)"
5. *"**New: ADR 0294.** R1 and R2 are Locked, from the founder's picks quoted above. M1–M6 are the build's method picks and are marked **Proposed** for the founder's review."*
   → "**New: ADR 0294.** Locked. R1 and R2 are the founder's picks of 2026-10-04 quoted above. M1–M6 are his of 2026-10-07, *"Keep all six (Recommended)"* (option text: *"Locks ADR 0294 as built. No code change; the PR goes to its re-head and audit."*), quoted verbatim in the ADR."
6. Under "## Founder answers (2026-10-04), built as worded", add a bullet:
   → "- 2026-10-07, on M1–M6: *"Keep all six (Recommended)"*. *"I want to change one"* was rejected. No code changed for it."
7. *"- **ADR 0294 M1–M6 wait on the founder's review before promotion:**"* and its six sub-bullets (blended sales per cover; `median: null`; `benchmark.state`; null rather than 0; the house-currency read; the stated member window)
   → Delete them, and put in their place: "- **Minimum-peer floor (open, not asked).** The build computes the median when one colleague is the only other server in the window (`servers: 1`), so a viewer can be set against one person's figures. Whether to add a floor is the founder's call (raised by the audit of `f6b57edae`). The 2026-10-07 answer did not address it."
8. *"This lane changes only line 528, the `ADR-0215-TEAM-MONEY-IN-THE-HOUSE-CURRENCY` row. #607's hunk is at about line 594, so a clean merge is expected."*
   → "This lane changes only the `ADR-0215-TEAM-MONEY-IN-THE-HOUSE-CURRENCY` row (line 531 at `1ed002e51`). #607 has merged, and this branch contains it. Open PRs that also touch CLAIMS.jsonl: #561, #569, #626."
9. *"`.planning/decisions/README.md` is touched by nearly every open lane PR: #533, #577, #589, #596, #598, #603 and #607–#612. … #599, #600, #601, #602 and #604 are already merged, and this branch contains them."*
   → "`.planning/decisions/README.md` is also touched by open PRs #533, #566, #577, #589, #596, #598, #609–#613, #615–#619, #626 and #648. Each adds a row. If a conflict comes up, keep both sides' rows in number order. #599–#602, #604, #607, #620–#622 and #627 have merged, and this branch contains them."
10. Under "Not covered", *"It calls `avgCheck.toLocaleString()`, which throws until reload for a member none of whose last 6 services records a check."*
    → "It calls `avgCheck.toLocaleString()`, which throws in render for a member none of whose last 6 services records a check. /team has no error boundary of its own, so the nearest one (`HouseShell.tsx:290`, keyed by route; `App.tsx:167` with the shell off) shows its error screen in place of the whole /team page, not only the card. That was traced in code, not reproduced."
11. *"**`82d7fa080` was not re-verified.** It came after the verifier's last round. … No second reviewer has read it."*
    → "**`82d7fa080`** came after the verifier's last round. The ADR 0090 audit at `f6b57edae` (PASS) read the whole diff, which includes it. The audit's notes are in `p4-scratch/sim-run/fixes/audits/614-f6b57edae/report.md`."

Lines checked and still true at `1ed002e51`: the PR changes 13 files; no open PR touches the lane's code files (an open-PR file list from `gh` shows only #614); *"No migration. Slot `20261219190000` is unused."*; the residuals (a)–(c) block; the deploy-order note; the 0215 not-edited note.
**[2026-10-06 ~00:33Z, coordinator] Re-headed at `f6b57edae`.** It merges `origin/main` `63ce97e62`, bringing in everything merged since this branch last took main. The newest of that is #607 `1884dea38`, #647 `8e16fbcef` and #646 `63ce97e62`. Conflicts resolved by the coordinator: README index rows (both kept). Guards at the new head: migration order, versions unique, OD ids and conflict markers all 0. `ownership_between(origin/main, HEAD)` = `[]`. Decision claims and ADR-number uniqueness are left to CI. Lines below that name an older head describe this PR before the merge. This is a first audit pass; the merge turn re-heads and re-audits.

## What was wrong for the owner (A-048, AW18)

The analytics walk on Tuzlu Rüzgar (read-only, 2026-10-03) filed A-048 by reading the code. The card was never rendered. The /team Performance card had four problems:

- **A unitless median under dollar figures.** The house median is net sales per cover. The card printed it bare. Tuzlu's own POS figures (`raw/rp-waiters-90.json`) put each server's average check at $185.35–188.27 and revenue per cover at $69.56–72.85. Once a night is logged, the card would read *"Average check $186"* over *"a house median of 72"*. That 2.6x gap comes from the unit, not from the person.
- **A median beside nothing it could be compared with.** The member's own per-cover figure came back in the response, but the card never printed it.
- **A false empty sentence.** It said *"no other server here has enough attributed services"* in three cases where that is not the reason:
  - the benchmark read had failed;
  - no recent service recorded covers;
  - the only per-cover figures were the member's own, so the "house median" was their own number.
- **A share of sales labelled as an attach rate.** "Wine attach" was `wine_sales / net_sales`. /reports uses "wine attach" for checks with wine over checks, which is a different measure.

The two literal `$` on the card were ADR 0215 residual (f), which was waiting on the currency baseline.

The card is latent at Tuzlu today, because no sale has been logged there. The page's own *Log sales* button makes it live.

## What changed and why

**Gateway: `apps/api-gateway/src/team/performance.service.ts`**
- **The benchmark is still the house median** over the house's 200 newest `server_sales` rows, the member's own included. It now counts only services that record both covers and sales (`recordsPerCover`, the predicate the median already used).
- **New `analytic.benchmark {state, services, servers, includesMember}`.** `state` is one of `computed`, `self-only`, `no-covers` or `unreadable`.
  - `median` and `band` are computed only when the state is `computed`, so a member is never set against a median made of their own figures.
  - A failed read is never reported as "no covers" (ADR 0067).
- **New `metrics.salesPerCover` and `coverServices`.** `salesPerCover` is blended over the services that record covers with their sales.
- **Unknown is `null`, not 0** (ADR 0051). `avgCheck` is `null` when no check is recorded, and the wine share is `null` when no sales are recorded.
- **New `money {currency, country, readable}`**, read from `restaurants` the same way `listFormerStaff` reads it. A failed read is logged and marked unreadable. It is never guessed as dollars.

**Web: `PerformanceCard.tsx` and `services/api/team.ts`**
- Every money figure goes through `tm-format`'s house-currency formatters. No literal `$` is left.
- New rows: *"Sales per cover"*, and *"Wine share of sales"* in place of "Wine attach".
- The median now prints *"per cover: N services by M servers, {name}'s own included, among the restaurant's ≤200 most recent"*.
- Each benchmark state has its own sentence. The self-only state refuses the comparison.
- *"Over {name}'s last N logged services"* states the member's window.
- A response from an older gateway, with no `money` and no `benchmark`, still renders. Its money is printed as unreadable, never as dollars.

**Records**
- `scripts/money_currency_baseline.json`: two rows removed. One is `PerformanceCard.tsx`. The other is the deleted legacy `PerformancePanel.tsx`, which the guard was already reporting as fixed.

**Last-call commit `82d7fa080` (copy and prose only)**
These fix four sentences that said more than the code does:
- The card hint now says *"record covers with their sales"*, which matches the predicate.
- ADR 0294 now names both deploy-skew breaks; it previously named one.
- ADR 0294 option 4 no longer implies that Tuzlu keeps lira. No record says it does.
- The `useTeamNextData.ts` register comment, ADR residual (b) and the tech-debt entry said /team has "exactly ONE" server-side window. The register declares two (`BENCHMARK_SERVICES` and `TRAIL_ROWS`), and the member's own `limit = 6` read is a third, undeclared one. All three now say that.

## Founder answers (2026-10-04), built as worded

- Benchmark: *"House median (Recommended)"*, with only the sentence changing. The median is still over every server's recent services, the member's included. The option text was *"When this person is the only one with per-cover figures, refuse the comparison"*, and the card now prints *"the only per-cover figures in the house's recent services (the restaurant's ≤200 most recent) are {name}'s own, so there is nothing to set them against."*
- Wine label: *"Rename on the card (Recommended)"*. The card says *"Wine share of sales"*. The measure is unchanged.

## Tests and guards (HEAD `82d7fa080`, origin/main `1aa4dcb8c`, 0 commits behind)

**Coordinator commit `5be104bbe` (docs only):** restores ADR 0215 to origin/main's text and narrows two ADR 0294 sentences (see ADR 0215 below). It changes no code, so no suite was re-run for it. I re-ran `check_adr_numbers_unique`, `check_od_ids_exist` and `check_decision_claims` on it (all PASS). The branch now changes 13 files.

- **New specs fail without the fix.** `performance.service.spec.ts` has 11 tests and `PerformanceCard.test.tsx` has 12. The verifier reverted the three source files to origin/main and all 23 tests failed (11/11 and 12/12). With the fix, all 23 pass.
- **Gateway:** `npx jest src/team src/common/read-errors-are-not-silence.spec.ts --runInBand --forceExit` gives **14 suites, 390/390 passed**.
- **Web:** `npx vitest run src/pages/team` gives **13 files, 195/195 passed**. That run includes the edited hint string.
- **Typecheck:**
  - Gateway: 2 errors.
  - Web: 1 error.
  - All three are the pre-existing missing `@simplewebauthn/*` modules. None is in this lane's files.
- **Lint:** web eslint `--quiet` passes on the 4 web files. Gateway eslint shows 0 errors and 1 prettier warning, at `performance.service.ts:165` in untouched `ingestBatch` code.
- **Guards** (exit 0, and `--self-test` exit 0):
  - `check_adr_numbers_unique` (0294 introduced, 1680 refs)
  - `check_citation_pairing`, `check_od_ids_exist`, `check_no_conflict_markers`
  - `check_money_states_its_currency` (PASS; the two rows are gone)
  - `check_windowed_figures`, `check_no_seeded_defaults`
  - `check_read_errors_not_swallowed` (no new swallowed read)
  - `check_read_columns_exist`, `check_queried_tables_exist`
  - `check_web_reads_gateway_dto_keys` (4 mirrors)
  - `check_route_exposure`, `check_money_routes_are_sealed`, `check_a_count_is_recorded`, `check_analytics_cost_honesty`, `check_verified_at_is_not_a_boolean`
  - `check_test_scripts_are_real`, `check_sentry_pii_scope`, `check_no_vendored_deps`, `check_migration_versions_unique`, `check_migration_order`, `check_flag_readby_anchors`
  - `check_decision_claims.sh`: **855 checked, 855 holding**
  - `test_check_decision_claims.sh`: **31 ok, 0 failed**
- **New claims.** The 3 new verifies in `claims.d/fix-team-performance-units.jsonl` exit 0 on the branch and 1 against origin/main's copies. 13 single-change mutations each make the claim they target fail.
- **SQL proof.** This lane has no migration and no SQL test, so this run proves nothing about SQL. It only shows that the lane adds nothing to the schema. Output of `p4-scratch/sim-run/fixes/audits/fmt2-local-pg.txt`:

```
$ bash pgtest.sh lane /Users/aldemirkonuk/Projects/wt-fix-fmt2 fmt2   # lane HEAD 82d7fa080, 2026-10-04T22:12Z
applied 0 migration(s) to fmt2_fix
template=1aa4dcb8c84062bb466c4b6cff0524e6272c61da lane_migrations=0 tests=0
Read: every [fix] line must PASS; a test that also PASSES on [ctl] pins kept behaviour, not the fix.
exit=0
```

## ADR and CLAIMS touched

- **New: ADR 0294.** R1 and R2 are Locked, from the founder's picks quoted above. M1–M6 are the build's method picks and are marked **Proposed** for the founder's review.
- **ADR 0215: not edited.** The audit gate escalated the first push (82d7fa080) because ADR 0215 is gate-owned. The founder chose on 2026-10-04 to drop the bracket: *"Drop the line (Recommended)"*. ADR 0294 records that residual (f) is closed. ADR 0215's own text still lists (f) as open, and correcting it is owed to a separate PR on his word.
- **`.planning/decisions/README.md`:** one row for 0294.
- **`CLAIMS.jsonl`:** an amendment bracket on `ADR-0215-TEAM-MONEY-IN-THE-HOUSE-CURRENCY`. Its verify is unchanged.
- **New `claims.d/fix-team-performance-units.jsonl`**, with 3 claims:
  - `ADR-0294-TEAM-PERFORMANCE-CARD-PRINTS-ITS-UNITS`
  - `ADR-0294-TEAM-BENCHMARK-REFUSES-A-SELF-ONLY-MEDIAN`
  - `ADR-0294-TEAM-PERFORMANCE-LEFT-THE-MONEY-BASELINE`
- **New `tech-debt.d/2026-10-04-fix-team-performance-units.md`:** 1 FIXED entry and 3 OPEN residuals.
- **`.planning/06-pages/team.md`:** the card's row is updated.

No migration. Slot `20261219190000` is unused.

## Forks deferred (not decided here)

- **ADR 0294 M1–M6 wait on the founder's review before promotion:**
  - the blended sales per cover over services that record covers;
  - self-only refused on the wire (`median: null`);
  - the `benchmark.state` field;
  - null rather than 0;
  - the house-currency read;
  - the stated member window.
- **Residuals filed OPEN, not fixed:**
  - (a) `server_sales` stores a blank as 0. A fix needs nullable columns and a form change.
  - (b) The member read (`limit = 6`) is not declared in `TEAM_SERVER_WINDOWS`.
  - (c) `analytic.series` sends 0 for coverless services, and nothing prints it.
- **Wire key kept.** `wineAttachPct` keeps its name and carries the share of sales, documented on both sides. Renaming it is left for a change that ships both sides together.

## Merge-order notes

- **No open PR touches the lane's code files:** `performance.service.ts`, `PerformanceCard.tsx`, `useTeamNextData.ts`, `services/api/team.ts`, `money_currency_baseline.json`.
- **`.planning/decisions/README.md`** is touched by nearly every open lane PR: #533, #577, #589, #596, #598, #603 and #607–#612. Every one of them only adds a row. If a conflict comes up, keep both sides' rows in number order. #599, #600, #601, #602 and #604 are already merged, and this branch contains them.
- **`.planning/decisions/CLAIMS.jsonl`** is also touched by #561, #569, #591 and #607. This lane changes only line 528, the `ADR-0215-TEAM-MONEY-IN-THE-HOUSE-CURRENCY` row. #607's hunk is at about line 594, so a clean merge is expected. Resolve by `(id, verify)`.
- **ADR 0215** is no longer touched by this lane (see above).
- **Deploy order.** If possible, let the web deploy land before the gateway (see the first item under Not covered).

## Not covered (CLAUDE.md §0.5)

- **Deploy skew.** A page built before this change breaks against the new gateway in two cases:
  - It calls `avgCheck.toLocaleString()`, which throws until reload for a member none of whose last 6 services records a check.
  - It prints `"null%"` when those services record checks but their net sales sum to 0.

  ADR 0294 names both cases. No production read was made to count the members exposed. Tuzlu has logged no sales.
- **No browser render.** The card was never drawn in the Browser pane, by the builder, the verifier or me. Its behaviour is shown only by the jsdom tests and by the verifier's temporary repro, which fed Tuzlu-shaped gateway output into the real component. Layout and visual hierarchy are unchecked.
- **The SQL proof is trivial.** The lane has no migration and no SQL test.
- **Commit message of `a5910728a` is wrong.** It still says *"in dollars, in a lira house"*. The ADR was corrected in `82d7fa080`. The history was not rewritten, because a merge commit sits on top.
- **`82d7fa080` was not re-verified.** It came after the verifier's last round. It is copy and prose only, plus one test string. I re-ran the web suite (195/195), the gateway suite (390/390), lint and every guard above on it. No second reviewer has read it.
- **Pre-existing problems left alone.** The `@simplewebauthn` typecheck errors, the prettier warning at `performance.service.ts:165`, and the react-hooks warnings at `useTeamNextData.ts:460-461` are not from this lane and were not touched.
- **Different sources from /reports.** "Sales per cover" here divides `server_sales` net over covers. /reports divides POS checks (`table-analytics.service.ts:453`). The figures are the same idea but will not match exactly.
- **Trailer.** Commits use `Co-Authored-By: Claude Opus 5`, as CLAUDE.md §7 and the lane instructions require.

🤖 Generated with [Claude Code](https://claude.com/claude-code)


