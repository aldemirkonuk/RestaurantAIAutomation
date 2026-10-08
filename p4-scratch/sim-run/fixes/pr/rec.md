## What was wrong for the owner

These findings come from the read-only analytics walk on Tuzlu Rüzgar (production, 2026-10-03). /recommendations said three things its own code does not support.

- **AW01 / A-004, urgency half: "Tonight" about a day seven weeks old.**
  - On 2026-10-03 (a Saturday) the sales-dip card said "Tonight: brief the floor…" about Saturday 2026-08-15, which was 49 days old.
  - The rule restates `*.vs_same_weekday`. That comparison uses the newest day its series observed and walks back up to 90 days to find one. The rule then stamped every such entry `urgency: "now"` (`recommendations.service.ts:268-289` at 661068ab3).
  - Paging the capped read (C15, `cap` lane) would only move the card to a newer day, and it would still say "Tonight".
  - A second defect sat in the same finder. It matched the comparator name in any category, so a soft purchasing day (`overall.purchase_spend.vs_same_weekday`, category `purchasing`) could raise "brief the floor".
- **AW20 / A-022: a suggested goal stated a basis its rule does not use.**
  - The masthead offered "Saturday wine revenue back to baseline". Its basis said "The rule compares a day's wine sales…".
  - The rule actually fired on whole-check sales: `pos_checks.total`, which covers food, drink and tax. On Tuzlu, Aug 15 totalled $14,539.42 against a prior-4-Saturday mean of $17,025.97 (−14.6%).
  - The goal measures `is_wine` items, honestly. The false part was the basis sentence.
  - The next row had the same false claim: `weekly_demand_slide` said wine revenue is "the same quantity at a longer grain".
- **AW23 / A-024: the catalogue said "Nothing live for this type right now" for vendor concentration, which is live.**
  - The generator recorded `vendor.purchase_spend.concentration` under `risk`. The catalogue's `categorize()` files every vendor dimension under `purchasing`, and CatalogView asks under `purchasing`.
  - The generator filters by category before key, so the narrowed read returned n=0. The same insight under `risk` returned n=1: "Your top 1 vendors hold 38% of purchasing spend (HHI 2895)".
  - It was the only one of the 16 `this.record(` call sites that disagreed with `categorize()`, and nothing checked them.

## What changed and why

The method is recorded in **ADR 0291**, "A recommendation says when it is for and what its rule measured" (Proposed).

**AW01, gateway (`apps/api-gateway/src/analytics/recommendations.service.ts`)**
- `salesDipWhen(periodKey, now)` takes the urgency from the dip day's age, counted in whole UTC days. That is the clock `toDaily` cuts the series on.

  | Age | Urgency |
  |---|---|
  | 0–1 days | `now` |
  | 2–7 days (`SALES_DIP_WEEK_DAYS`) | `this_week` |
  | over 7 days, an unreadable key (`d:2026-02-31`, `p7:`/`t28:`, null) or a future date | `this_month` |

  An unknown age never earns `now`. The 7-day cut is the rule's own comparator: after a week the same weekday has come round again with nothing on record.
- `salesDipAdvice` keeps the old "Tonight: …" copy, word for word, for `now` only.
  - Every other band opens "Before the next <weekday>:" and names the day, its date and its age.
  - When the day is a whole number of weeks old, today is that weekday, so the opener is "Before today's <weekday> service:".
  - Tuzlu's 2026-10-03 card now reads: "Before today's Saturday service: the newest day this comparison could read is Saturday 2026-08-15, 49 days ago. Brief the floor…". Its urgency is `this_month`.
- The finder requires `i.category === "sales"`, as `weekly_demand_slide` already does. A purchasing dip raises nothing and can no longer shadow a sales dip ranked behind it.
- When a house with a till and a cellar log carries two sales dips (`overall.revenue` and `overall.bottles`), `freshestSalesDip` restates the one about the newer day. A tie, or no readable age, keeps the generator's rank. Without this a weeks-old dip ranked first would hide yesterday's.
- What stays the same: the score (3 in every band), the suppression keys (a dip always carries a weekday subject and a `d:` grain, so `withFiring` keeps them), and the rationale.
- The goal period follows the band through `periodFor`. The default digest floor (`this_week`) stops mailing a dip older than a week, and the digest row says it stood below the floor.

**AW20, web (`apps/web/src/pages/recommendations/next/rec-forward.ts`)**
- Both `RULE_GOAL` bases now say what fires:
  - the dip: whole-check sales through the till, or bottles sold from the cellar log, in any house that keeps one;
  - the weekly slide: either of those, or one wine's bottles.
- They also say why the goal still sits on wine revenue: a goal cannot be held on whole-check sales, and the prescription moves wine revenue. They add that the goal records part of what fell, not all of it.
- The default names no longer claim wine revenue fell. They are now "<day> wine revenue, after a soft <day>" and "Wine revenue, after a soft week".
- This is the pairing locked ADR 0120's scenario book already makes.

**AW23, gateway (`insights/insight-generator.service.ts`)**
- The vendor-concentration `record()` now files under `purchasing`, the catalogue's category.
- Reordering `categorize()` was rejected because it would move 10 of the 573 catalogue types. Deriving the category inside `record()` was rejected because it would re-file stored rows silently, with no version bump.
- `INSIGHT_GENERATOR_VERSION` goes from 4 to 5, with a history line. #602 (ADR 0272) reached main first with 4, and a row stamped 4 by main's code still files vendor concentration under `risk`, so this change needs its own number: 5. (It was drafted as 3 to 4; no ADR 0291 row was ever written at 4.) Stored version-4 and older rows are refused and recomputed on the hourly sweep, so the old `risk` row does not show twice on the purchasing+risk rails.
- Visible effect: vendor concentration now appears in the catalogue's narrowed read. It leaves the Inventory rail (`ContextualInsights.tsx:62`, categories inventory/risk/forecast) and stays on the Orders and Providers rails (purchasing/risk). No goal metric reads `risk` without `purchasing` (`goals.service.ts:85-136`).
- **Guard:** `insight-implementations.spec.ts` adds "every record() files its type under the catalogue's category".
  - It parses every `this.record(` call, resolving the time-series helper's `category` through each call site's literal.
  - It throws on any call shape it cannot read, and it checks that the set of keys it read equals the set of emitted types.

**Head `2854a2152`.** 15 files, +882 / −59, eleven commits from `9dc518115` to `2854a2152`, including three merges of `origin/main`: `fb862aa57` (#600) and `e2cbe426a` (#601), both without conflicts, and `f5f658934` (#602), resolved as described under Merge-order notes. The only change in `rec-docket.ts` is a comment.

## Tests and guards

**Re-run at head `2854a2152`, after merging #602** (clean worktree, merged tree):
- **Gateway jest** `npx jest src/analytics --runInBand --forceExit`: **55 of 55 suites, 842 of 842 tests**.
- **Gateway typecheck** `npx tsc --noEmit -p tsconfig.spec.json`: 2 errors, both the known `@simplewebauthn/server` passkeys baseline, outside the diff.
- **Web vitest** on the two test files this PR touches (`RecommendationsNext.test.tsx`, `rec-forward.test.ts`): **2 of 2 files, 122 of 122 tests**. The wider `src/pages/recommendations` run below was not repeated.
- **Guards:** `check_adr_numbers_unique.py` PASS ("introduced by this ref: 0291", 1,675 refs); `check_od_ids_exist.py` PASS; `check_decision_claims.sh` **852 checked, 852 holding**.
- **New claim mutation-tested:** `AW23-2026-10-04-GENERATOR-VERSION-5` is red on version 4, on a lost ADR 0291 history line and on a lost ADR 0272 one, and green on 6.

The final-say pass re-ran these earlier, at `e07c565ec` (before the #601 and #602 merges):
- **Gateway jest** (`--runInBand --forceExit`) over `recommendation-sales-dip-when`, `digest/recommendation-digest.service`, `insight-implementations`, `insight-narrowed-read`, `insight-cache-version`, `insight-shared-state`, `recommendation-suppression`, `recommendation-round3` and `goal-source-rule`: **9 of 9 suites, 190 of 190 tests**.
- **Web vitest** `src/pages/recommendations`: **17 of 17 files, 329 of 329 tests**.
- **Revert proofs** (each file was snapshotted with `cp -p` and restored, and the tree was clean afterwards):
  - Vendor category back to `risk`: 3 tests red across `insight-implementations` and `insight-narrowed-read`.
  - Dip urgency back to a literal `"now"`: 4 tests red across the new spec and the digest spec.
  - `rec-forward.ts` swapped for origin/main's copy: 4 tests red across `rec-forward.test.ts` and `RecommendationsNext.test.tsx`.
- **Lint:** gateway eslint on the 6 gateway files gives 0 errors. Its 83 prettier warnings were checked line by line against the diff, and none falls on an added line. Web eslint (`--quiet`, web-lint plugins) gives rc 0.
- **Guards:**
  - `check_decision_claims.sh`: 844 checked, 844 holding.
  - `check_adr_numbers_unique.py`: "introduced by this ref: 0291", 1,670 refs.
  - The 3 lane claims exit 0 here and 1 against origin/main's copies of the 4 files they read.

The verifier's last round (PASS, 5 minor notes) also ran the following:
- Gateway `npx jest src/analytics`: 53 suites, 817 tests.
- `src/mcp-server`, `src/reports/exports` and `src/simpos`: 10 suites, 166 tests.
- Gateway typecheck: 2 errors. Web typecheck: 1 error. All three are the `@simplewebauthn` passkeys baseline on main, outside the diff.
- Every `scripts/check_*.py` in ci.yml, with and without `--self-test`: 77 runs, all rc 0. `check_migration_order` was skipped because the lane has no migration.
- `test_check_decision_claims.sh`: 31 ok.
- `check_no_direct_stock_writes.sh`, `check_no_direct_type_attributes_access.sh`, `check_model_calls_logged.sh` and `check_platform_operator_routes.cjs`: all pass.
- Twelve mutations, M1 to M9 plus variants, each red and then restored. The one green mutation was M3b, which put the version back to 3: no test pins the number. Since `2854a2152` the claim `AW23-2026-10-04-GENERATOR-VERSION-5` turns a version below 5 red.

**SQL proof:** the lane has no SQL, so there are no `[fix]` lines. `pgtest.sh lane` output (`p4-scratch/sim-run/fixes/audits/rec-local-pg.txt`):

```
applied 0 migration(s) to rec_fix
template=fb862aa574f710d4e1faf06df0ea50f1a5ce18cf lane_migrations=0 tests=0
```

## ADR / CLAIMS touched

- **New** `.planning/decisions/0291-a-recommendation-says-when-and-what-it-measured.md`, status **Proposed**.
  - The 7-day band, the copy, the newest-dip pick (5b) and the generator following `categorize()` are the build's readings, **not founder answers**.
  - It lists the rejected alternatives: paging alone, a clock seam from the digest, pinning the rule to `overall.revenue`, the first-ranked dip, refusing the goal, an eighth metric now, reordering `categorize()`, and deriving the category inside `record()`.
- **Index row** in `.planning/decisions/README.md`.
- **New** `claims.d/fix-recommendations-say-when-and-what.jsonl`, with 4 resolved static rows:
  - `AW01-2026-10-03-SALES-DIP-URGENCY-FROM-AGE`
  - `AW20-2026-10-03-SALES-RULE-GOAL-BASIS-TRUE`
  - `AW23-2026-10-03-VENDOR-CONCENTRATION-ONE-CATEGORY`
  - `AW23-2026-10-04-GENERATOR-VERSION-5`: the version is 5 or more, and the history keeps both the ADR 0291 line (5) and the ADR 0272 line (4).
- **`CLAIMS.jsonl` row `ADR-0191-ONE-SHARED-ITEM-STATE`** pinned `INSIGHT_GENERATOR_VERSION = 3;`. #602 widened it on main to a version of 3 or more, as this lane had. The merge keeps **one** row: main's verify, main's note, and a 2026-10-04 bracket saying the generator is now at 5. This PR's diff on `CLAIMS.jsonl` is that one bracket.
- **`.planning/06-pages/recommendations.md`:** the two false rule-to-goal rows are bracket-corrected in place.
- `v3.0-TECH-DEBT.md` and `OPEN-DECISIONS.md` hold no entry for AW01, AW20 or AW23, so neither changes.

## Founder answers

The lane brief (`fixes/briefs/rec.md`) has **no FOUNDER ANSWERS section**, so no ruling targets this PR's behaviour directly. The session's founder-answers record bears on it in three ways:
- **Plan forks not put to him one by one:** "Every other plan fork proceeds on its plan's recommendation" (2026-10-04, about 02:10Z). This lane's plan recommends (a) for both F1 and F2, and (a) is what is built. The ADR stays Proposed and still names F1 and F2 for him to lock or overturn.
- **Merging:** *"Merge when audited (Recommended)"*. This PR merges only after the ADR 0090 three-role audit passes and CI is green, serially on strict main, with a production deploy check afterwards.
- **AW17:** *"Net sales (Recommended)"*. This settles the basis that F2(c), a sales goal metric, was waiting on. The ADR text still describes AW17 as about to decide, because it was written when the basis was open. F2(c) is a later operation, after the `netsales` lane lands. This PR does not build it.

## Forks deferred (founder's call, not made here)

- **F1: does a dip older than a week fire at all?** (a) It fires as `this_month` with its date and age; this is built. (b) It does not fire past N days. (c) The page says the sales read is stale instead, which goes with C15 and A-069.
- **F2: what goal does a sales dip suggest?** (a) Wine revenue with the honest basis; this is built. (b) No goal for these two rules. (c) A whole-check or net sales goal metric, now that AW17 is answered, on its own branch after `netsales`.

## Merge-order notes

- **`origin/main` at `f5f658934` (#602, `sig`, ADR 0272) is merged in** at `2854a2152`. Two files conflicted:
  - `insight-generator.service.ts`: only the version-history comment. Both sides' code merged cleanly (main's tie and significance gates, this lane's `purchasing` record). Main's version-4 line is kept verbatim (its claim `SIG-GENERATOR-VERSION-4` greps it); this lane's line is renumbered to 5 and the constant is 5.
  - `CLAIMS.jsonl`: both sides rewrote the same `ADR-0191-ONE-SHARED-ITEM-STATE` row to read a version of 3 or more. Compared by (id, verify): same id, same subject, two equivalent verifies that both pass on the merged tree, so it is a correction and one row is kept. Every other (id, verify) on either side survives; the row count is 746 on base, both sides and the merge.
  - `README.md` merged cleanly, with the 0272 and 0291 rows in number order.
- **`cap`** (`fix/analytics-reads-past-row-cap`, ADR 0292) also sets the version and widens the same claim. Whichever of `cap` and this PR lands second takes the next number (this PR at 5 means `cap` takes 6), keeping every history line, and conflicts in `README.md`.
- **#564** (goal writes need a manager) edits `RecommendationsNext.test.tsx` in other hunks. This PR changes only the two goal-name assertions, so whichever merges second rebases.
- `postime`, `events` and `glasspour` share no files with this PR.

## Not covered (CLAUDE.md §0.5)

- **No rendered check.** /recommendations, the masthead goal, the catalogue's vendor-concentration panel and the rails were never opened in the Browser pane. CLAUDE.md §9 asks for that. The behaviour is proven by specs, RTL renders and mutations only.
- `scripts/check_gateway_boots.sh` was not run, because it needs a built gateway.
- **Tuzlu's 38% / HHI 2,895 is still the wrong figure.** This PR makes vendor concentration findable. It does not fix what the insight prints, which leaves out PARTIALLY_RECEIVED keg orders (C14/F-130(c)). The truth is about 33.0% on agreed prices, about 34.3% billed.
- **The age is counted in UTC days**, on the real clock, not the digest's sweep instant and not the house's business day. This waits on C02 / the `tz` lane. Which day the capped read picks, Aug 15 versus a newer day, is the `cap` lane's (A-004's figure half, C15).
- **ADR 0291's Consequences section does not record the Inventory-rail removal** described above. The plan named it and the code does it. The ADR should gain that line when the founder locks it.
- **Stale wording in history:**
  - The bodies of `426658e36` ("only the cellar log") and `9dc518115` ("15 record() calls") are superseded, and the ADR review trail corrects both.
  - `437f97e54`'s body describes only "Before the next <weekday>", without the later whole-weeks opener, and the trail does not mention that.
  - History is not rewritten. Use this body, not the commit bodies, for the squash message.
- The lane claims' prose says they exit 1 "against origin/main 8c673db4b". They were re-measured and also exit 1 at `fb862aa57` and at `e2cbe426a`'s copies of the same files, so the sentence is true but names an old base.
- No jest or vitest test pins `INSIGHT_GENERATOR_VERSION`; specs read the constant. The number is held by the ADR, the claims (`AW23-2026-10-04-GENERATOR-VERSION-5`, `SIG-GENERATOR-VERSION-4`) and the history comment.
- The new specs build their day keys from the real clock. A run that crosses UTC midnight mid-test could flip a 1-day case; the window is negligible.
- The SQL template is `fb862aa57`, while origin/main is now `f5f658934`. Neither #601 nor #602 adds a migration, and this lane has no SQL.
- The PR is exactly 15 files, which is the limit.

> **[2026-10-05, coordinator, at merge]** The merged head is `aa1c00479` (a merge of main `155960b59`; the branch is current with main). CI at that head: 40 success, 1 skipped (Supabase Preview). The first run had one red web test outside this PR's diff (`ReceivingNext.test.tsx` F9, "≥$900" not found); it passed 51/51 locally in this worktree and main was green, so the failed jobs were re-run and passed. The ADR 0090 audit at `aa1c00479` returned **PASS** (both reviewers APPROVE WITH NOTES; final HOLDS; report on this PR). Owed, non-blocking, on a later branch: correct ADR 0291's drifted citations (`goal-scenarios.ts:324` and the line numbers that moved after #602); record under the ADR's Consequences that vendor concentration leaves the Inventory rail; say the weekday is a UTC weekday; add a test that pins `SALES_DIP_WEEK_DAYS` to 7. The PR Audit Gate check went red twice without a verdict (first because upstream CI was red when it ran, then cancelled at 15 minutes with no runner during GitHub's Actions outage of 2026-10-05 ~20:47–21:55Z); its re-run after the outage passed, and all 41 non-skipped checks are green at `aa1c00479`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
