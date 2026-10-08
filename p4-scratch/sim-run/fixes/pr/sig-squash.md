## What was wrong for the owner

These findings come from the read-only analytics walk on Tuzlu Rüzgar (production, 2026-10-03), cluster C14 line (a). On Tuzlu the planted truth is null: servers and tables were dealt uniformly, and baskets were dealt round-robin. Every staff ranking, table ranking and pairing on that house should therefore have been withheld. The generator printed one of each anyway.

- **A-003 (critical).** The staff insight read "Lucas ranks #1 of 5 by average check ($188)."
  - The lead was 1.0% (z 1.61), measured on 1,000 of 3,341 checks.
  - Over the full 90 days Lucas is 5th: Kerem $199.71 (booth checks included), Deniz $187.58, Priya $187.23, Maya $184.86, Lucas $184.18.
  - `waiter.avg_check.peer_rank` named the largest of k means as #1 whatever the gap.
  - The table ranking had the same shape. Its "After adjusting for table assignments, X actually adds the most per check" was a second ranking claim that no test stood behind.
- **A-002 (critical).** /recommendations asked the owner to print a pairing: "Athletic Brewing Co. Run Wild IPA (non-alcoholic) and Ktima Gerovassiliou Malagousia (glass) land on the same check 6.3× more than chance."
  - It rested on 3 co-occurrences.
  - The rule took the top 3 of about 7,000 pairs by lift, then the first with a χ² p under 0.1. χ² is invalid at those expected counts: p 8.8e-14 against an exact p of about 5e-4.
  - It fired on 200 of 200 shuffled copies of the house's data.
- **C14(a) stockout tie (no A-id).** The stockout insight named Jameson #1 out of an 8-way tie at 61%. It carried a hard-coded `z: 2` and `n: 30` that nothing had measured.
- **A-070 (minor).** The restock register sorts by stockout probability and cuts at 25, under the line "the 25 at the highest risk are listed".
  - Five wines shared one risk (26.84%, 22.5 days of cover) across the cut.
  - The cut kept Monkey Shoulder and Cimarrón and dropped Kulüp Rakı, Suntory Toki and Planteray 3 Stars, in whatever order the database returned them.
  - The 14 restock bars split ties the same way.
  - Nothing truly short was hidden: the three dropped wines hold 16.6 to 53.3 days of true cover.

## What changed and why

The method is recorded in **ADR 0272** (Proposed), under the locked ADR 0020: withhold what cannot be supported.

- **Ranking** (`engine/comparisons.ts` `leaderTest`). A server or table is ranked only at 30 or more checks. The leader is printed only when both of these reject at α 0.05:
  - a one-sided Welch test against the **runner-up** (the tie check);
  - a one-sided Welch test against the **pooled rest**, with p × k (Bonferroni, because the leader was picked as the maximum of k).

  Variance comes from a new `sumSq` aggregate, which is still O(N). Kerem's two $3,400 booth checks therefore widen his variance instead of crowning him. If the table-adjusted fit (`adjustedGroupEffects`) puts another eligible server on top, nothing is printed (ADR 0272's wording). The untested "actually adds the most" clause is gone. The record's `z` is the leader-vs-rest z.
- **Correlation clause.** The table and attribute correlation now also needs Fisher's z, two-sided, Bonferroni over the attributes tested. This is on top of the old |r| ≥ 0.35.
- **Pairing** (`engine/association.ts`).
  - Every pair gets an exact one-sided hypergeometric (Fisher) tail, `pUpper`.
  - It also gets `pAdjusted` = min(1, C(k,2) × pUpper), where k is the number of items on at least 5 checks.
  - The generator prints a pair only with 5 or more co-occurrences, lift ≥ 1.3 and `pAdjusted` ≤ 0.05. The pick is the smallest exact p, then count, then name.
  - χ² stays on the record as a description and is never a gate.
- **Ties.** A tie is the same computed value to within 1e-9 (`sameValue`). It is not bit equality: Tuzlu's five equal risks came back as …426, …370 and …437. It is not print equality either: 26.8% and 26.9% are not tied.
  - A tied stockout #1 is withheld, its `z` is null and its `n` is the observed demand rows.
  - Restock order inside a tie is data only (`byStockoutRisk`: cover, bottles, name, id), never database order.
  - The gateway's 25-row cut (`cutKeepingTies`) and the web's 14 bars (`barsKeepingTies`) never split a tie above 0%. On Tuzlu the five tied wines are all listed, and the bars go from 14 to 18.
  - A tie at 0% is never extended. That group is every wine with no demand and nothing on hand, below a reorder point of 0. Extending through it listed all of it: 5 wines at risk plus 40 with none gave 45 rows. Those rows now fill to 25 / 14 in data order. Every risk above 0% sorts first, so no wine at risk can be hidden behind a 0% row.
- **`INSIGHT_GENERATOR_VERSION` 3 → 4.** A stored version-3 row may hold one of the withdrawn sentences, so ADR 0191's existing rule recomputes it on first read instead of serving it.
- Downstream readers inherit the gate with no code change: the recommendations `staff_spread` / `pairing_promotion`, goal suggestions, the rails and the mobile insights tab. On a null house they now get nothing to show, which is the correct result.

**Measured:**
- The code at `origin/main` fired all three rules (waiter, table, pair) on 40 of 40 seeded null houses of 1,200 checks, and on the single 3,295-check Tuzlu-shaped house.
- The new code allows at most 2 firings per rule across those 40 houses (spec). The null rates in the ADR table are 0 to 2%.
- Power: a server about 8% ahead on about 660 checks fires 42/50; a pair on 2% of checks fires 50/50. The planted entity is the one named every time.
- The verifier's independent sims agree: the pair gate fired on 0 of 200 shuffled null baskets, and the hypergeometric tail is within 2.6e-12 of exact BigInt.

13 files, +1,529 / −79. Commits from `38b5dde9f` to `2474abc54`, including one merge of `origin/main` at `c3b1a227e` (#599), which resolved a `ReportsNext.test.tsx` append conflict by keeping both blocks.

**Reviewing `engine/association.ts`:** the PR page shows it as binary. The copy on `origin/main` holds two raw NUL bytes in the pair-key separator. This branch writes the separator as `\^@`, which is the same string. Read the hunk with `git diff --text origin/main...HEAD -- apps/api-gateway/src/analytics/engine/association.ts`.

## Tests and guards

The final-say pass re-ran all of these at HEAD `2474abc54` in the clean worktree.

- **Gateway:** `npx jest src/analytics src/reports/exports --runInBand` gives **59 of 59 suites and 909 of 909 tests**. That includes the new `insight-rankings-significance.spec.ts` (7 tests), `restock-cut-keeps-ties.spec.ts` (4) and the ADR 0272 blocks added to `association-comparisons.spec.ts`.
- **Web:** `npx vitest run src/pages/reports/next/ReportsNext.test.tsx` gives **77 of 77**. Three of those are new restock-bar tests.
- **Typecheck:** the gateway (`tsc -p tsconfig.spec.json`) has 2 errors and the web has 1. All three are the `@simplewebauthn` passkeys baseline on main; none is in the diff.
- **Lint:** gateway eslint on the 7 changed files gives 0 errors. Its one warning, at `analytics.service.ts:439`, is outside the diff and already on main. Web eslint (`--quiet`, web-lint plugins) is clean.
- **Revert proof:**
  - The final-say pass dropped `!tiedAtTop` and loosened the pair gate back to `pUpper ≤ 0.1`. 3 of the 7 significance tests failed: the Tuzlu null, the 40-house calibration and the 8-way stockout tie. The file was then restored and the worktree was clean.
  - The verifier ran the base generator against the significance spec: 7 of 7 failed.
  - Reverting the restock cut fails 3 of 4 restock tests. The printed-alike control passes on both, by design.
  - Removing `extendOnlyAbove` fails the 45-row probe.
  - Reverting each web hunk fails one web test.
- **Guards, all exit 0:**
  - `check_decision_claims.sh`: 846 checked, 846 holding.
  - `test_check_decision_claims.sh`: PASS.
  - `check_adr_numbers_unique.py`: "introduced by this ref: 0272", 1,663 refs, plus `--self-test`.
  - Each of these, plus its `--self-test`: `check_citation_pairing`, `check_od_ids_exist`, `check_no_conflict_markers`, `check_windowed_figures`, `check_analytics_cost_honesty`, `check_read_errors_not_swallowed`, `check_web_reads_gateway_dto_keys`, `check_a_count_is_recorded`, `check_voice_gate_coverage`, `check_proposal_preservation`, `_claims_parse`, `_od_collisions`, `check_sentry_pii_scope`.
  - With no self-test run: `check_money_states_its_currency`, `check_flag_readby_anchors`, `check_model_calls_logged.sh`, `check_quantity_units`, `check_no_seeded_defaults`, `check_test_scripts_are_real`, `check_no_vendored_deps`.

## ADR / CLAIMS touched

- **New** `.planning/decisions/0272-a-ranking-or-a-pairing-is-printed-only-when-the-data-can-tell-it-apart.md`, status Proposed. The method, α 0.05, the 30-check floor, the 5-co-occurrence floor, the 1.3 lift floor, the 1e-9 tie tolerance and the 0% bound are **the build's picks, not founder answers**. The ADR lists ten rejected alternatives: Westfall–Young, BH, Yates, effect floor only, Mann–Whitney, "tied with N", trim-before-tie, display-precision tie, bit-equality tie and do nothing. Its line cites were re-read at HEAD.
- **Index row** in `.planning/decisions/README.md`.
- **New** `claims.d/fix-insights-significance-gates.jsonl`, with six resolved static rows:
  - `SIG-LEADER-GATED`
  - `SIG-PAIR-EXACT-BONFERRONI`
  - `SIG-STOCKOUT-NO-TIE-NO-FABRICATED-STATS`
  - `SIG-RESTOCK-CUT-KEEPS-TIES`
  - `SIG-GENERATOR-VERSION-4` (it checks for a version of 4 or more plus the 0272 history line, so it survives a later renumber)
  - `SIG-RESTOCK-ZERO-TIE-NOT-EXTENDED`

  Each fails with its hunk reverted.
- **`CLAIMS.jsonl` row `ADR-0191-ONE-SHARED-ITEM-STATE`** pinned `INSIGHT_GENERATOR_VERSION = 3;`. It is amended in place, with a dated bracket, to read a version of 3 or more.
- `v3.0-TECH-DEBT.md` has no entry for C14 or these sentences, so it is unchanged.

## Founder answers

The lane brief has **no FOUNDER ANSWERS section**, so no founder ruling targets this PR's behaviour. The session's founder-answers record bears on it in three places:
- **Merging:** *"Merge when audited (Recommended)"*. This PR merges only after the ADR 0090 three-role audit passes and CI is green, serially on strict main, with a production deploy check afterwards.
- **AW17:** *"Net sales (Recommended)"*. "Average check" becomes net. This PR still ranks on `pos_checks.total`, as the code on main does. The `netsales` lane's PR-2 moves this lane's `revenue`/`sumSq` aggregates onto net, by plan. A constant tax factor scales means and standard errors alike, so the tests' z values do not change. Tuzlu's total is subtotal × 1.1263 on every check. They move only where tax or surcharge varies from check to check.
- **Plan forks not put to him individually** "proceed on [the] plan's recommendation", per the same record (2026-10-04, about 02:10Z).
  - Fork 2 (a): stay silent when a #1 or pairing is withheld. This PR builds that.
  - Fork 1 (a): the corrected masthead sentence. It belongs to PR-2, not here.

## Forks deferred (founder's call, not made here)

- **Fork 1, A-069 per-rule naming.** Should /recommendations name the rules it could not judge? This is ADR 0160 Q4's "field next". Recommendation (a): correct the all-clear sentence now in PR-2, and build the per-rule field after the `cap` and `postime` lanes land.
- **Fork 2, the "no separable leader" copy.** Should a withheld #1 say "no server stands apart yet"? The build stays silent (the default under ADR 0020). Any wording is new copy.
- **Fork 3, 0% rows at the restock cut.** Should wines with no demand and nothing on hand be listed and drawn at all? Recommendation (b): keep them in the table and leave them out of the bars. The build ships the bounded version: no 0% tie is extended, and both cuts keep their old 25 / 14 size. This fork was raised after the plan's fork list and has not been put to the founder.

## Merge-order notes

- **`origin/main` is merged in.** The branch's merge base is `e2cbe426a` (#601). The README index conflict with #600's 0285 row was resolved by keeping both rows, and CI at the merged head `6272ff411` (which runs `check_decision_claims.sh` and the ADR-number guard) is green.
- **`cap` (`fix/analytics-reads-past-row-cap`, ADR 0292) and `rec` (`fix/recommendations-say-when-and-what`, ADR 0291).** A trial merge against each conflicts in `CLAIMS.jsonl`, `README.md` and the generator's version-history comment only.
  - All three lanes set `INSIGHT_GENERATOR_VERSION = 4`. **That constant merges silently**, because both sides wrote the same text. Whichever lane lands second must hand-bump it to 5 (the third to 6) and keep every history comment.
  - All three amend the same `ADR-0191-ONE-SHARED-ITEM-STATE` verify to "a version of 3 or more". Keep one of them.
- **`stockout` (`fix/stockout-counts-open-ml`)** is stacked on this branch at `2474abc54`. This PR merges first, and its head must not move before then.
- **`netsales` PR-2** rewrites this lane's `sumSq`/`revenue` lines onto net. This PR merges first.
- **Open PRs.** No open PR touches this PR's code files. These share only append-only doc files:
  - #598, #596, #589, #577, #566 and #533 share `decisions/README.md`;
  - #591, #569 and #561 share `CLAIMS.jsonl`. They edit other rows than the ADR-0191 one.
- **PR-2** (`fix/all-clear-over-partial-reads`, not built) shares no files with this PR.

## Not covered (CLAUDE.md §0.5)

- **A-068 and A-069 are not in this PR, and the `sig` lane is not closed until PR-2 lands.**
  - A-068: the counter prints "none waiting" over a deliveries read marked `complete:false`.
  - A-069: the /recommendations masthead says "Every source … answered, so what did not fire had nothing to say".

  The plan splits them onto `fix/all-clear-over-partial-reads` (7 files): the 15-file cap applies, and the two halves are different defect classes. That branch is unbuilt; this run was limited to this worktree.
- **"No surface receives an insignificant ranking" is not literally true yet:**
  - `table.avg_check.driver_weights` still prints a ridge fit on r² > 0.15 with no test.
  - The descriptive staff and table registers in `table-analytics.service.ts` still return an untested `rank`/`pctVsMean`. No web, mobile or export surface reads `rank`.
  - F-132, the twin finding, is its own work.
  - Multiplicity across the whole feed (many rules, one reader) is not controlled.
- **A positive tie at the restock cut is unbounded.** Its size is the number of wines that sold in the window and share the edge's exact risk. In F-129's one-day demand shape that can be many (every sold-out seller: 8 on Tuzlu, at 61%). Each such row is a wine to buy back, and the ADR discloses this.
- **The 0% fill splits its group.** When row 25 (bar 14) is a 0% wine, the 0% rows shown are the first by bottles, name and id. "The N at the highest risk are listed" then holds for every wine at risk and only orders the riskless rest. Fork 3 asks whether those rows belong at all.
- **The stockout record now scores lower.** With `z: null` and a real `n`, a 61% risk on 14 or more rows scores 2.25 where it scored 3.75. It can fall under its category cap. This is disclosed in the ADR.
- **Booth-sized outliers on a runner-up cut the waiter rule's power** (50/50 down to 15/50 in the ADR's table). The booth's own row is the `booth` lane (AW24).
- **The ADR's power table came from a throwaway spec** and cannot be re-run from the repo. The committed specs pin only the null-house silence, the calibration bound and the planted cases.
- **`welchZ` reads a non-finite standard error as "separable"** (+∞ when the gap is positive). That is unreachable from database sums, because `c.total || 0` maps NaN and null to 0. It is not hardened here.
- **Independence is assumed.** Dependence within a party or a set menu is not modelled. The exact test treats checks as independent.
- **Out of this PR:** the C15 1,000-row cap (the Lucas inversion itself; lane `cap`) and the C05/F-129 import-day dating (lane `postime`).
- **No Browser-pane visual check.** The restock page needs a signed-in gateway with house data, and this lane makes no production calls. The bar count is pinned by the `restock.view` component tests in `ReportsNext.test.tsx`.
- **Suites not run:** the full repo-wide jest and vitest suites, a full CI run, and Docker. The gateway runs covered `src/analytics` and `src/reports/exports`; the web run covered `ReportsNext.test.tsx`.
- **One stale commit body.** `ee14215d7` says two printed-alike controls passed on HEAD, but only the web one existed then. The gateway control was added and checked in `1000da9fd`, whose body records the correction. History was not rewritten.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

