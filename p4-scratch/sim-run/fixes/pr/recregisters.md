**Head `5608cb36a` (last call, 2026-10-06 ~05:00Z).** It answers the BLOCK at `9d1d9fa53` with `1ee0c497e`. At `9d1d9fa53`, a stored `__proto__` rule key or urgency made the page throw at render. Head `5608cb36a` then merges origin/main `4528b9689` (#621), with no conflicts and no lane file changed. `ownership_between(origin/main, HEAD)` = `[]`. The PR has 15 files and no SQL, and the worktree is clean.

## What was wrong for the owner

The read-only analytics walk on Tuzlu Rüzgar (production, 2026-10-03) found that /recommendations filed entries by the engine's category instead of by what acting on them changes.

- **AW28 / A-054: a price change was missing from Money.**
  - The register rail promises *"What acting on an entry would change"*. Its code filed each entry by the engine's category alone: `rec-format.ts:75` mapped `efficiency → 'floor'` (at 661068ab3 and 8c673db4b).
  - The engine has only two `efficiency` rules, and both were filed under **The floor**:
    - `plowhorse_repricing`: *"Raise those prices 5–8% or renegotiate cost on the next PO"*.
    - `puzzle_activation`: *"Put one puzzle wine by-the-glass this week"*.
  - When the walk read the page, Money was pressed.
    - The rail read **All 7 / Money 3 / Stock 1 / Vendors 1 / The floor 2**.
    - The section showed **"Price it — 2 entries"**: `pairing_promotion` and `margin_target_unset`.
    - The price change `plowhorse_repricing` did not appear, because it was filed under The floor.
  - The section head printed only `{n} entries` (`RecommendationsNext.tsx:904-907` @661068ab3), so nothing said that entries with the same act were filed under another register. The rail counts were right.
  - `revenue_concentration` (*"Protect the top sellers' stock first (raise their service level to 98%)"*) was filed under **Vendors**, because its category is `risk`.
- **After this PR, on his same 7 entries.** The verifier fed the 7 entries from `raw/tab-recommendations-state.digest.json` through the real components, in a one-off page test that was then deleted. It did this again at `5608cb36a`.
  - The rail reads **All 7 / Money 4 / Stock 3 / Vendors 0 / The floor 0**.
  - With Money pressed:
    - **Price it** holds 3 entries: `plowhorse_repricing`, `pairing_promotion` and `margin_target_unset`.
    - **Brief the floor** holds 1: `sales_below_weekday_baseline`, still Money.
  - With Stock pressed:
    - **Order it** holds 2: `stockout_imminent` and `revenue_concentration`.
    - **Move stock** holds 1: `puzzle_activation`.
  - With Vendors pressed, no section shows.

## What changed and why

The change is web-only. The engine's categories are untouched, because the goal levers (`rec-daybook.ts`) and the hand's category fallback (`handOf`) read them.

- **`rec-format.ts`: the register files by rule where the rule's sentence says what it changes, otherwise by category.**
  - A new `RULE_STAKE` table has the same shape as `rec-docket.ts` `RULE_ACT`. Each row quotes the rule's own sentence:
    - `plowhorse_repricing` → Money
    - `puzzle_activation` → Stock
    - `revenue_concentration` → Stock
    - `weekday_gap` → The floor, by its leading clause
  - `efficiency` is removed from `CATEGORY_STAKE`. Both of its rules are now filed by name, so a new efficiency rule lands in Unfiled instead of repeating AW28.
  - `stakeFilingOf(ruleKey, category)` reads the rule through `readKey(...).ruleId`. A row on the Snoozed, Dismissed or History leaves can carry a composite stored key (`rule#subject#grain`, ADR 0191). Such a row now files the same way as the standing entry.
  - `stakeFilingOf` returns `{stake, why, by}`, and `stakeOf(ruleKey, category)` wraps it. The signature change is deliberate, so tsc flags every caller.
- **`useRecommendationsNextData.ts`:** `stake: stakeOf(ruleKey, category)`.
- **`RecommendationsNext.tsx`: with a register pressed, a section head names the entries of its act that are filed elsewhere**, for example `Order it · 1 entry · 1 more filed under Stock`.
  - Register names follow rail order ("Stock", "Stock and Vendors", "Stock, Vendors and The floor").
  - `actStakes` is one O(n) pass over the same day-scoped book the rail counts, so the head and the rail cannot disagree.
  - The rail note now reads *"Filed by the rule where its prescription says so, otherwise by its category; the working says which."*
- **`Entry.tsx`:** the working gains *"Why it would change {register}"* (`rc-register-why`). It shows the rule's own sentence, or the category the filing fell back on.
- **`rec-next.css`:** these rules apply only to a head that names entries filed elsewhere (`data-elsewhere`).
  - The title keeps its width, and only the count's words wrap, right-aligned.
  - Below 640px the count drops to its own line.
- **Every table keyed by a stored key reads its own rows (`ownRow`).** This was done in two rounds.
  - **First round, `00a1e616a`, the fix for audit finding B at `15ea987fb`.** It covers the filing tables: `RULE_STAKE` and `CATEGORY_STAKE` in `stakeFilingOf`, `RULE_ACT` in `actOf` (`rec-docket.ts`), and both of `handOf`'s tables.
  - **Second round, `1ee0c497e`, the fix for the BLOCK at `9d1d9fa53`.** It covers every other table on the page keyed by a stored rule key, urgency or goal metric:
    - `GOAL_REFUSAL`/`RULE_GOAL` (`rec-forward.ts` `goalOfferFor`)
    - `CUTTING_REFUSAL`/`RULE_CUTTING` (`cuttingFor`)
    - `RULE_DRAFT` (`rec-daybook.ts`)
    - `METRIC_CATEGORIES` (`leversFor`, `leverWords`; keyed by a stored goal's metric)
    - `URGENCY_LABEL` (`urgencyLabel`)
    - `URGENCY_RANK` (the book's sort)
  - **Why.** The tables are object literals, so a plain `table[key]` answered a stored key such as `constructor`, `__proto__`, `toString` or `valueOf` with a value inherited from `Object.prototype`.
    - `__proto__` reached React as `Object.prototype`, through a refusal's why or the urgency label, and the page threw: *"Objects are not valid as a React child"*.
    - A `constructor` urgency gave the sort a NaN comparator.
    - `leverWords` threw *"cats.join is not a function"*.
    - The register filed such an entry nowhere, so it fell out of every rail count.
    - This is reachable, because `setAction` rejects only an empty `ruleKey`.
  - **Now an unknown key gets each table's own default:**
    - Unfiled with a why, or its category's register when the category is known.
    - The act *Not yet filed*.
    - The hand of its category, else Reports.
    - The goal door refuses with "This page has no metric filed for the rule {key}", and the cutting door with "This page has no cutting filed for the rule {key}".
    - The day-book drafts "Follow up: {key}".
    - A goal gets no levers, and a sentence saying its metric is not mapped.
    - The urgency stamp shows the stored word.
    - The sort gives rank 3.
- **ADR 0288 corrected in place, with dated brackets.**
  - **Finding A (`00a1e616a`).** Context now names `margin_target_unset`, not `margin_to_target`, and its service line numbers are pinned to `@8c673db4b`.
  - **`1ee0c497e`.** It corrects the own-row bullet, adds a bullet for the second-round tables, corrects the *Adjacent* bullet, and updates the `rec-format.ts` header and the `ownRow` doc. The gateway's refusal of prototype names is recorded as owed.

## Tests, guards, harness

At head `5608cb36a` unless stated. The worktree was clean.

- **Web vitest, `src/pages/recommendations`:** 17 files, **381/381 pass**. The builder, the verifier and this last call each ran it.
  - The first build added 12 tests: 6 in `rec-format.test.ts`, 5 in `RecommendationsNext.test.tsx` and 1 in `useRecommendationsNextData.test.tsx`.
  - The first own-row round (`00a1e616a`) added 17: 16 unit tests and 1 page test.
  - The second round (`1ee0c497e`) added 23. Three are page tests: a `__proto__` rule key, a `__proto__` urgency, and a `constructor` urgency that must sort after Tonight. The other 20 are unit tests over `constructor`, `__proto__`, `toString` and `valueOf`.
- **Shown failing without the fix.** The builder and the verifier each ran these. Sources were snapshotted with `cp -p`, restored, and checked with `cmp`.
  - **The `1ee0c497e` tests on the `9d1d9fa53` sources:** "19 failed | 148 passed (167)" in the two files. Both `__proto__` page tests failed with "Objects are not valid as a React child". The 4 day-book tests pass on both sides, because that read never had a visible effect.
  - **Each second-round guard reverted on its own.** Failing tests per revert:

    | Guard reverted | Tests failing |
    |---|---|
    | `GOAL_REFUSAL` | 5 |
    | `RULE_GOAL` | 6 |
    | `CUTTING_REFUSAL` | 5 |
    | `RULE_CUTTING` | 6 |
    | `METRIC_CATEGORIES` in `leversFor` | 4 |
    | `METRIC_CATEGORIES` in `leverWords` | 4 |
    | `URGENCY_LABEL` | 6 |
    | `URGENCY_RANK` | 1 |
    | `RULE_DRAFT` | 0 (see *Not covered*) |

  - **First round (`00a1e616a`).** Its new tests on the old code: "16 failed | 13 passed" in `rec-format.test.ts`, plus the page test. Each guard reverted on its own failed this many: RULE_STAKE 5, CATEGORY_STAKE 3, `handOf` byRule 4, byCategory 4, RULE_ACT 4.
  - **The verifier, at `5608cb36a`:**
    - Restoring the pre-fix mapping (efficiency back to floor, the two founder-fork rows removed): 15 failures across the 3 test files.
    - Disabling the "filed elsewhere" head words: 2 page tests fail.
  - **Earlier single mutations:**
    - `weekday_gap` → money: 2 failed.
    - `revenue_concentration` → vendors: 2 failed.
    - `efficiency` put back in `CATEGORY_STAKE`: 6 failed.
- **Web tsc:** one error, `passkeys.ts` cannot find `@simplewebauthn/browser`. It predates this branch, and the file is untouched.
- **eslint `--quiet`** on the 10 lane `.ts`/`.tsx` files: exit 0. This last call re-ran it.
- **Guards:** each exits 0 on a normal run and with `--self-test`. The builder and the verifier ran all 13:
  - `check_adr_numbers_unique`, `check_citation_pairing`, `check_no_conflict_markers`, `check_od_ids_exist`
  - `check_a_count_is_recorded`, `check_read_errors_not_swallowed`, `check_web_reads_gateway_dto_keys`
  - `check_money_states_its_currency`, `check_windowed_figures`, `check_flag_readby_anchors`
  - `check_analytics_cost_honesty`, `check_no_seeded_defaults`, `check_route_exposure`

  This last call re-ran the first five.
- **Claims:** `env LC_ALL=C bash scripts/check_decision_claims.sh` reports **901 checked, 901 holding / PASS**. This last call re-ran it.
- **All 61 `scripts/check_*.py` (verifier):** 8 exit non-zero. Each needs `.env`, a deployed URL or a database, and none touches this lane's files: beverage parity, display_name parity, definer functions, deployed_sha, house_item_invariants, migration_ledger and web_deployed_sha.
- **Layout:**
  - **Builder.** It rendered the real `rec-next.css` in headless Chromium, on a static fixture with the longest words (`3 more filed under Stock, Vendors and The floor`). The h2 stayed on one line (17px) at 1280, 1000, 900, 899, 800, 700, 640, 639, 480 and 375px, and in 600, 560, 480 and 400px containers.
  - **Earlier verifier round.** It re-checked in a Browser-pane tab on a local static fixture, with no horizontal overflow. The h2 stayed on one line at 375, 639 and 640px viewports, and in 600, 560, 480, 400, 343, 330 and 300px containers.
  - The CSS has not changed since then.
- **SQL:** this lane has none. `git diff --name-only origin/main...HEAD -- supabase` is empty. The `pgtest.sh lane` record is in `p4-scratch/sim-run/fixes/audits/recregisters-local-pg.txt`.
  - The harness diffs HEAD against its template (28d32de36), not origin/main. The last run (at `9d1d9fa53`) therefore applied and tested **main's** five newer migrations, not this lane's.
  - It was not re-run at `5608cb36a`, because the lane still has no SQL. A note saying so is appended to the record.

```
applied 5 migration(s) to recregisters_fix
[fix] PASS 20261221093000_an_order_letter_is_staged_once_test.sql
[fix] PASS 20261222100000_a_pos_sale_is_dated_by_its_check_test.sql
[fix] PASS 20261222120000_the_ledger_lists_only_the_current_menu_test.sql
[fix] PASS 20261222140000_old_pos_rows_carry_their_check_date_test.sql
[fix] PASS 20261222170000_the_cellar_reads_the_tills_own_record_test.sql
[ctl] FAIL (each of the five; they are main's #591, #603, #606, #647, #627 migrations)
template=28d32de368d3f57df52ce6f490758908d9fa924d lane_migrations=5 tests=5
```

## ADR / CLAIMS touched

- **New ADR 0288,** `.planning/decisions/0288-a-recommendation-is-filed-by-what-acting-on-it-changes.md`.
  - It is Locked for the filing of the four rules.
  - These parts are marked *(Method.)*, so each can be overturned on its own:
    - the section-head words;
    - the efficiency → Unfiled fallback;
    - the composite-key reading;
    - the own-row reads;
    - the hidden-section behaviour.
  - It records the rejected options: change the engine category, derive the register from the act, re-key all 18 rules, or do nothing.
  - `check_adr_numbers_unique` passes. Across all 775 `origin` refs, only one slug carries 0288.
- **`.planning/decisions/README.md`:** one new row in the Locked table, after 0262. No existing row is edited.
- **`claims.d/fix-recommendations-file-by-what-changes.jsonl`:** one row, `ADR-0288-PRICE-AND-STOCK-FILED-BY-WHAT-THEY-CHANGE`, status resolved, with a static python verify.
  - It re-reads `recommendations.service.ts` and fails when any `rule(...)` has neither a `RULE_STAKE` row nor a mapped category.
  - It pins the four rows, the absence of `efficiency` from `CATEGORY_STAKE`, the `readKey` read and the three test ids.
- **`.planning/06-pages/recommendations.md`:** the register paragraph and the axis-table row are amended in place.
- No OD row and no tech-debt line; none existed for AW28.

## Founder answers (verbatim, quoted in ADR 0288)

- **AW28, 2026-10-04 ~00:30Z:** "Money / Stock (Recommended)". Price it (`plowhorse_repricing`) is filed under Money, and Move stock (`puzzle_activation`) under Stock.
- **Lane forks, 2026-10-04 ~02:10Z:**
  - `revenue_concentration`: "Stock (Recommended)".
  - `weekday_gap`: "The floor (Recommended)", filed by its leading clause.

All three are built as worded. They are quoted in ADR 0288, the README row, the page note and the claim row. They match memory `founder-answers-2026-10-03-analytics-fixes.md:29` and `:41`.

## Forks deferred (founder's call, not made here)

No founder fork is open. These are method choices recorded in ADR 0288, and each can be overturned on its own:

- **Hidden sections.** An act section with nothing under the pressed register stays hidden, as before. Only the rail count shows that it exists.
  - On Tuzlu's book with Money pressed, Order it and Move stock do not show, because all their entries are Stock. Only "Stock 3" on the rail says they exist.
  - A stub head such as "Order it · 2 filed under Stock" could be added later if he wants one.
- **Register names mid-sentence keep their rail capitals:** "Why it would change The floor", "filed under Stock, Vendors and The floor".

## Merge-order notes

- **Base.** The branch is at origin/main `4528b9689` (merge `5608cb36a`). No SQL is involved, so any later move of main needs only an update-branch.
- **#564** (goal writes need a manager, `eadb562df`) touches 5 of this PR's files: `Entry.tsx`, `RecommendationsNext.tsx`, `RecommendationsNext.test.tsx`, `useRecommendationsNextData.ts` and `useRecommendationsNextData.test.tsx`.
  - `git merge-tree --write-tree HEAD eadb562df` is clean, re-run at this last call.
  - The two do not interact semantically.
- **`.planning/decisions/README.md`** is the only file this PR shares with other open PRs. Twenty of the 74 open PRs touch it, measured at this last call.
  - The builder's `git merge-tree` against `5608cb36a` conflicts textually, and only in README.md, for #533, #566, #596, #598, #610, #614, #615, #616, #617, #618, #619, #620 and #626. Each appends a row. Keep every row, ordered by number.
  - #577, #589, #609, #612, #613, #622 and #648 merge clean.
- **Files no other open PR touches:** `rec-format.ts`, `rec-docket.ts`, `rec-forward.ts`, `rec-daybook.ts` and `rec-next.css`.
- **No stacking.** This lane needs no other branch's code.
- **The claim row.** A new engine rule whose category is unmapped fails CI here, on purpose.

## Not covered (CLAUDE.md §0.5)

- **The gateway still stores a prototype-named key.** `setActionAs` (`recommendation-actions.service.ts`) and its controller refuse only an empty `ruleKey`, so a key such as `__proto__` can be stored.
  - The page now reads such a key as an unknown rule.
  - Refusing it at the gateway needs the service and its spec, which would take this PR past 15 files. ADR 0288 records it as owed in a later gateway change.
- **Two gateway lookups were seen in passing and not run.** ADR 0288 records both.
  - `goals.service.ts:223` checks a new goal's metric with a plain `SUPPORTED_METRICS[input.metricKey]`, which `constructor` passes, and `analytics_goals.metric_key` has no CHECK.
  - `isDigestUrgency` (`digest-schedule.ts:65`) uses an `in` check, which a prototype name passes.
- **Two page lookups were checked and left plain.** ADR 0288 says why.
  - The `DigestPost.tsx` floor line: the gateway writes the floor only as `now`, `this_week` or `this_month` (`allowed.includes`, `recommendation-actions.service.ts:1714-1718`).
  - `Entry.tsx`'s scenario `METRICS` lookup, which is keyed by the gateway's code-held scenario catalogue.
  - The verifier and this last call swept every `X[key]` lookup in `pages/recommendations/next`. The rest are keyed by computed values or static lists.
- **No test can fail before the fix for the `RULE_DRAFT` read.** That read already fell back through `?.` and `??`, so it never had a visible effect. It goes through `ownRow` only so every such table reads the same way.
- **The shell's error boundary was not run.** The old `__proto__` throw is proven in vitest only. Whether `HouseShell.tsx`'s per-page `ErrorBoundary` would have caught it comes from reading the code, so the ADR does not claim it.
- **No live app.** The section-head layout was checked only on static fixtures with fallback fonts: by the builder in headless Chromium, and by an earlier verifier round in a Browser-pane tab. The last verifier round could not re-render it, because the Browser pane opens such files only as static snapshots. How the count words look in the running app is unconfirmed.
- **320px.** The page is 16px too wide at 320px. The overflow is in the register rail (`aside`), with or without these words. It predates this lane and is not fixed here.
- **Quote drift is not guarded.** The `RULE_STAKE` `why` strings quote the engine's sentences. No test or claim compares them with `recommendations.service.ts`.
- **The Money/Stock invariant runs over a hand-kept list.** The test "every Price it rule is Money and every Move stock rule is Stock" runs over `ENGINE_RULES` in `rec-format.test.ts`. The list has 18 rows and matches the engine at head.
  - A new rule with a mapped category whose act is Price it or Move stock is checked only once someone adds it to the list.
  - The claim row guards only that every engine rule has some register.
- **Tuzlu's book does not exercise `weekday_gap`.** He fires `sales_below_weekday_baseline`. The `weekday_gap` row is built and tested on synthetic entries only.
- **The Tuzlu replay was a one-off.** The verifier's 7-entry page test was deleted afterwards. No permanent test reads the walk digest.
- **Adjacent defects recorded in ADR 0288 *Adjacent*, not built:**
  - `actOf` and `handOf` read the raw `ruleKey`. A composite key on the leaves therefore shows as *Not yet filed*, with a hand from the category fallback.
  - `pour_size_unconfirmed` has no act row and no hand row.
- **`STAKE_BLURB.money`** still reads "money taken across the pass". The wording predates this lane and was left alone.
- **Merge commits.** The branch's merges of origin/main, `5608cb36a` included, carry git's default message and no Co-Authored-By trailer. Every lane commit carries the trailer.
- **Not re-run by this last call:** the mutation runs and the before-fix runs listed above. They are the builder's and the verifier's. This last call re-ran:
  - vitest (381/381) and eslint;
  - web tsc;
  - five guards with their self-tests;
  - the claims check (901/901);
  - the ADR-number sweep;
  - the open-PR overlap and the `#564` merge-tree.
- **Suites not run:** the repo-wide web vitest, and the gateway jest. There is no gateway change.
- **No production read and no deploy check,** per the lane rules.
- **Retire-to-write (CLAUDE.md §4):** this PR adds ADR 0288 and one claims fragment and retires nothing. They are the records that §5 and §5b require.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
