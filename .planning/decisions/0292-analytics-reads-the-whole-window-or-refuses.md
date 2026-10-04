# 0292 — Analytics reads the whole window, page by page, or refuses

- **Status:** Proposed (forks 1–4 are built as the plan's recommendations; none is founder-ratified, see Open forks)
- **Date:** 2026-10-03
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** F-131, C15, A-004, A-005, A-006, A-031, A-032, A-033, max_rows, PostgREST cap, 1000 rows, pos_checks, wine_consumption_log, keyset paging, exact count, WholeReadError, readWholeWindow, row ceiling, analytics, till, who served it, menu engineering, seasonality, calendar
- **Links:** [[0020-no-fabricated-answers]] (the rule this enforces), [[0067-a-failed-read-is-never-an-empty-one]], [[0207-a-vendor-is-scored-on-what-it-did-from-the-houses-own-records]] (`:38`, "refuses to score a register larger than it can read whole"), [[0191-the-recommendations-catalogue-is-actionable-not-a-read-only-leaf]] (`:693`, `:809`), ADR 0269 "/orders reads the whole order book, page by page" (the page-check idiom; PR #598, not on main at 8c673db4b); `apps/api-gateway/src/providers/vendor-menu-supply.ts` `readAll` / `TooManyRowsError` (the refusal shape) [path corrected 2026-10-04, verify round 2: it first said `src/procurement/`, which does not exist]; branch `fix/analytics-reads-past-row-cap`; claims in `claims.d/fix-analytics-reads-past-row-cap.jsonl`; residuals in `tech-debt.d/2026-10-03-fix-analytics-reads-past-row-cap.md`

## Context

PostgREST stops every response at `max_rows = 1000` (`supabase/config.toml:18`) and says nothing: the answer is a 200 holding a thousand rows. Every unranged `.select()` over `pos_checks` or `wine_consumption_log` whose window held more than 1,000 rows was therefore a sample named as a total. The owner-quarter sim (F-131, register cluster C15) measured it on the one real house at origin/main 8c673db4b:

- **A-005.** The 90-day till on /reports counted 1,000 of 3,313 checks: $187,474 against $625,944, with no day after Aug 15 and no notice.
- **A-006.** "Who served it" ranked the floor on 1,000 of 3,341 checks (29.6% of takings) and put Maya first, though she was last.
- **A-004.** The /recommendations "Tonight" card read a 97% fall; the truth was about 14.6%. Both figures were leftovers of a 1,000-check read.
- **A-032 / A-033.** Menu engineering saw 752 of about 8,445 units. Seasonality, Wine 360, the till list and the dashboard sales chart read one capped slice of consumption.
- **A-031.** A /calendar month reads at most 1,000 of its 1,910 (Jul) or 2,121 (Aug) checks, so about half of each month would read "covers not recorded".

Nothing threw and nothing logged. This is ADR 0020's fault in its plainest form: a smaller number here is not a smaller truth, it is a wrong one.

Volume, measured on the same house: about 58 checks and 131 consumption lines a day. So the 365-day ribbon reads about 21.5k checks, and a year of consumption about 48k lines.

## Options considered

1. **Raise `max_rows`.** Rejected. It is a production config change that only moves the cliff, and every window that outgrows the new number fails the same silent way.
2. **Offset `.range()` paging by `opened_at`.** Rejected. A check landing or voided mid-read shifts every later offset, so rows are skipped or read twice, and nothing in the response says so.
3. **SQL / RPC aggregates.** Deferred (fork 2). They duplicate the TypeScript metric definitions that `sale-record` and `goal-reached` mirror. A set-returning RPC is capped by `max_rows` too unless it returns jsonb. They need a migration, and they do not fit one PR.
4. **A labelled partial prefix** (ADR 0269's `capped`). Rejected for sums. A list can say "the first 1,000 of 3,313"; a till total from part of a window is not a smaller figure, it is a wrong one, and every consumer would have to carry the label to the page.
5. **Keyset paging on `id` with an exact count, page checks, one re-read and a ceiling that refuses.** Chosen.
6. **Do nothing.** Every figure above stays wrong with no notice, and it grows worse as the house trades.

## Decision

The reads of `pos_checks` and `wine_consumption_log` named in the readers table below return the whole window, or refuse with a typed `WholeReadError`; none of them answers from a prefix. Two of them turn a refusal into a documented degrade rather than an error (fork 3): `analytics.service.ts` `loadConsumption` returns `[]` with a loud log, and the insight bundle leaves the refused family silent. Seven other reads of these tables are still capped and are not made whole here: the guard below holds them in a shrink-only baseline, and the tech-debt note lists them. [Narrowed 2026-10-04, verify round 2: this first said every analytics read returns the whole window and never a prefix, which is broader than the code.]

**The helper**, `apps/api-gateway/src/common/read-whole-window.ts`:

- **Signature and paging.**
  - `readWholeWindow<T>(what, build, { pageSize?, ceiling? })`. `build()` is a factory, because a supabase-js builder is a single-use thenable.
  - Page 0 is `order("id").limit(1000)`; each later page adds `.gt("id", <last id>)`.
- **The count proves the read whole.**
  - Page 0's `{ count: "exact" }` is the window's size.
  - **Correction to the plan:** a later page's exact count is what lies *past its cursor*, not the window's total, so "the count agrees across pages" is checked as `count === total − rows read so far`.
  - At the end, the distinct ids must equal the size.
  - On disagreement it re-reads once from the top, then refuses with `unstable`.
- **Page checks** (the ADR 0269 idiom). No page longer than asked. No id twice (`cursor_stalled`). No empty page while rows are still counted (`cursor_stalled`). Rows carry ids (`malformed_page`).
- **Other refusals.**
  - A Supabase error on any page refuses with `read_failed`, never answering from the pages in hand.
  - A short page 0 under a larger count means the server's cap is below ours, and its size is adopted.
- **Ceiling (fork 1).** A count above `WHOLE_READ_CEILING = 100,000` refuses with `row_ceiling` before page 1 is asked for. That is about 4.6 times the check year and twice the consumption year.
- **The error.** `WholeReadError extends ServiceUnavailableException`, so a route that lets it through answers 503 with the sentence.

**The readers**, and what each does with a refusal:

| Reader | Refusal |
|---|---|
| `goals.service.ts` `computeMetricWithSeries`: `bottles_sold`, and every check metric. The check select drops `items` unless the metric is `wine_revenue` or `wine_attach_rate` | Rethrown past the metric's catch. The till route errors instead of reporting $187k as the 90 days. `getGoalProgress` writes no `current_value`. `createGoal` stores no baseline. `listGoalsWithProgress` and the goal producers already say "could not be read" for a thrown progress |
| `table-analytics.service.ts` `loadChecks` | `ServiceUnavailableException`, with lane fmt's sentence |
| `advanced-analytics.service.ts` `loadConsumption` | Propagates. Menu engineering, seasonality and Wine 360 error; the overview's `allSettled` makes that one lens null |
| `analytics.service.ts` `getPosConsumptionBreakdown` | Propagates, as a failed read already did |
| `analytics.service.ts` `loadConsumption` | The documented loud degrade to `[]` (fork 3) |
| `insight-generator.service.ts` `loadBundle`, both window reads | The documented degrade: logged as rejected, and that family stays silent rather than wrong (fork 3) |
| `dashboard.service.ts` `getSalesChart` | The rejected slice is rethrown instead of drawing glasses = 0 |
| `calendar/recorded-days.service.ts` `windowFor` | The existing refusal path, with "…could not be read whole, so no day is drawn from part of it" |

**The guard**, `scripts/check_window_reads_are_whole.py`, wired beside the price-register steps in `ci.yml`, with `--self-test`.

**It ships in its own PR**, stacked on this one: branch `fix/analytics-window-reads-guard`. ADR 0231 caps a PR at 15 files. The helper, its spec, the seven reader files, the generator bump and the records already fill 15. Until the guard's PR merges, nothing in CI stops a new unranged read of these tables. [Split out 2026-10-04, after verify round 2's major: the branch stood at 17 files.]

What the guard checks:

- **What passes.** A read passes when it is one of these:
  - **Whole:** inside `readWholeWindow`'s factory, with a bare `id` and `count: "exact"` in its select, and no `order`, `limit` or `range` of its own. A reader's own order would sort ahead of `id`, and the cursor would skip rows.
  - **Bounded:** at or under the cap, by `limit`, `range`, `single`, `maybeSingle` or `head: true`. The limit is resolved from a literal or a same-file constant, optionally plus k. A limit *above* the cap fails.
  - **Allowlisted** by file, with a pinned text and an exact read count. These are `reading-sources.ts`, whose session pages whole by itself; `logs-timeline.service.ts`, whose limit is at most 201 and is applied in the next statement; and `scenario-verify.service.ts`, whose chunked reader refuses any chunk that lands on the cap.
  - **Baselined:** a shrink-only count per file and table, where one fewer fails as stale. The PR that removes or wraps a baselined read deletes or lowers its row (fork 4).
- **Exit 2** when the helper, the cap in `config.toml` or the shared comment stripper is missing, or nothing is scanned.

**Why it carried.** This is precedent, not a new product choice. ADR 0207 refuses to score a register it cannot read whole. ADR 0191 refuses in the same shape. `vendor-menu-supply.ts` throws `TooManyRowsError`. ADR 0269 pages the order book with the same checks.

**What the guard does not catch.**

- A table name held in a map, such as `dev-truth.service.ts`'s `.from(table)`.
- A bound applied in a later statement. This is not credited, so it falls the safe way.
- Reads outside the gateway. There were none on 2026-10-03.
- In the helper: with no count reported, a short page ends the read. Only test doubles do that, because the guard forces the literal. So a lowered `max_rows` combined with a dropped count would pass unseen.

## Consequences

- **Easier.** The figures the readers above feed on /reports, /calendar, /recommendations and the dashboard sales chart are drawn from the whole window or say they could not be read, with the fork 3 exceptions: when `analytics.service.ts` `loadConsumption` is refused, the financial summary, risk, inventory science and the 120-day forecast see no consumption, and a refused insight-bundle read leaves its family silent. The seven baselined reads are still capped. Once the guard's own PR lands, the next reader of these tables cannot go back to the unranged select without CI saying so. [Narrowed 2026-10-04, verify round 2: this first said every figure on those pages was whole or refused.]
- **Harder.**
  - A long window can now error where it used to under-report. That is the point, but a slow page or a statement timeout on page 17 of a 365-day read now shows as a refusal.
  - Latency was estimated, not measured: for 365 days, about 22 check pages and 48 consumption pages at about 60 ms each, roughly 4 s in sequence (fork 2).
  - **The overview fans out.** `GET /analytics/overview` (`advanced-analytics.service.ts` `getOverview`) runs five lenses that each read their own 90-day consumption window: financial summary, risk and inventory science (`analytics.service.ts` `loadConsumption`), menu engineering and seasonality (`advanced-analytics.service.ts` `loadConsumption`). At about 131 lines a day that is five whole reads of about 12 pages each, each page with an exact count: about 60 requests in five parallel chains of 12, where it used to be five capped requests. Nothing is shared between the lenses. It is bounded (no N+1, the ceiling still refuses), and it was not measured. Sharing one read across the lenses is a cache with a lifetime, which is a decision of its own and not this ADR's.
  - **/recommendations fans out further.** `RecommendationsService` (`recommendations.service.ts:187`, one `Promise.allSettled`) runs the same five lenses and a live `generate()`, whose bundle reads its own 90-day consumption and check windows. That is six whole consumption reads of about 12 pages each and one check read of about 4 to 6 pages: roughly 78 page requests in seven parallel chains, the longest about 12 pages. Its latency is not measured either; no local or production timing was taken for either route. [Added 2026-10-04, verify round 2.]
- **Stored insights are recomputed once.** `INSIGHT_GENERATOR_VERSION` goes from 3 to 4, because a version-3 `analytics_insights` row may hold a sentence computed from a 1,000-row slice (A-004's "97% lower"). Without the bump those rows stay `source: "stored"` for every reader that prefers the cache (`GET /analytics/insights/:id`, the overview, goal suggestions, the report exports' `report-cutting-reader.service.ts`, the MCP tool reader) until their category's cadence comes round: a day at daily, a week at weekly, never at manual. With it, every reader refuses them at once and the hourly sweep's stale-version scan replaces them. Until that sweep runs, the overview's insight strip is empty, since `getOverview` does not fall through to a fresh compute. /recommendations was never affected: it calls `generate()` live. Lanes rec (ADR 0291) and sig (ADR 0272) also bump to 4 on their own branches; whichever lands later takes the next number.
- **Two claims corrected in place.** `ADR-0191-ONE-SHARED-ITEM-STATE` (`CLAIMS.jsonl:597`) pinned the literal `INSIGHT_GENERATOR_VERSION = 3;`. It now holds the version at 3 or above, with the same verify ADR 0291's branch wrote. `REPORTS-2026-10-03-POS-CHECK-READ-FAILURE-IS-NOT-EMPTY` (`claims.d/fix-reports-fractions-and-empty-register.jsonl`, #599) read `loadChecks`'s old `if (error) {` branch; it now reads the `WholeReadError` catch that throws the same 503. Both were mutation-tested in scratch trees: each fails when its throw or its version is taken away.
- **Figures that move because the window is whole.** [Moved out of the claim-corrections list 2026-10-04, verify round 2.]
  - Booth checks were already in server stats through the old 1,000-row sample (AW24). What is new is the booth checks past the cap, which the whole window now includes. AW24 itself is lane booth's, not fixed here. [Corrected 2026-10-04, last call: this first said booth checks "now" enter server stats, as if the old sample held none.]
  - The Tonight card moves to the true last day and stays urgent (AW01, lane rec).
- **Guard's discoveries.**
  - The guard's census found one read the plan's grep census missed: grep reads `pos-mapping-review.service.ts` as binary. Its `limit(checkLimit)` takes a DTO value of up to 2,000, above the cap, and it is baselined.
  - Two baselined limits sit above the cap. `sale-record.producer.ts`'s `CHECK_CAP = 2000` is latent: it reads one day, which holds far under 1,000 checks today, so its `truncated` branch cannot fire yet. The `checkLimit` above is reachable now: a caller asking for 1,001 to 2,000 checks gets the latest 1,000. Its `checks_scanned` says 1,000 (`pos-mapping-review.service.ts:448`), so the count is honest, but nothing says the request was clipped. [Corrected 2026-10-04, verify round 2: this first called both limits unreachable at current volume.]
- **Revisit when:**
  - the 365-day ribbon's measured latency passes about 3 s (move that window to an RPC that returns jsonb);
  - a window passes 50k rows (half the ceiling);
  - `max_rows` changes, which the guard turns into exit 2;
  - a baselined read is touched.

## Open forks

The lane brief carries no founder answer, so each fork below is built as the plan's recommendation and waits on the founder's word before this ADR is Accepted. Fork 3 matters most, because it decides what a page shows when a read is refused.

1. **Past the ceiling** (100,000 rows): refuse with `row_ceiling` (built), or return a labelled partial prefix.
2. **Long windows:** keep keyset paging and measure the latency (built), or build jsonb RPC aggregates now.
3. **A refused read in `analytics.service.ts` `loadConsumption` and the insight bundle:** keep the documented degrade, `[]` with a loud log and a silent family (built), or let the refusal fail the whole surface.
4. **A stale baseline row:** fail CI, so the PR that removes a baselined read deletes its row (built, in the guard's PR), or warn only.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-03 | — | Created (lane `cap`, Proposed; forks 1–4 recorded as the plan's recommendations, not as rulings) |
| 2026-10-04 | lane settle round (no independent verify finished) | No decision changed; still Proposed, and the lane brief carries no founder answer for forks 1–4. `getSalesChart` now tests `status !== "fulfilled"`, because `check_order_status_literals.py` read the `"rejected"` literal as an order status and failed CI. The tech-debt line on the /reports refusal state is corrected: the page prints axios's status line, not this ADR's sentence. Lane fmt's `loadChecks` (branch `fix/reports-fractions-and-empty-register` at f74f156f2) throws the same 503 sentence as this branch, so the two merge on wording [corrected 2026-10-04, verify round 1: they do not. #599 landed lane fmt's `loadChecks` on main as c3b1a227e, and the two hunks conflict textually though the 503 sentence is the same; see the next row] |
| 2026-10-04 | independent lane verifier, round 1 | One major, two minors; no decision changed, still Proposed. **Major:** the bundle's sentences change, so `INSIGHT_GENERATOR_VERSION` goes to 4 (Consequences). **Minor:** origin/main moved to c3b1a227e (#599); merged into the branch (not rebased), taking this branch's `loadChecks` and main's `feedStatus`, and #599's `loadChecks` claim re-pointed at the new catch. The verifier's own resolution passed the guard and the specs but not `check_decision_claims.sh`, which caught that claim. **Minor:** the overview's five-way consumption fan-out is now stated (Consequences). The bump and the two claim corrections take the PR from 15 files to 17 |
| 2026-10-04 | independent lane verifier, round 2 | One major, six minors; no decision changed, still Proposed. **Major, not acted on here:** the PR is 17 files against the 15-file cap. The two over are the `CLAIMS.jsonl` row (forced by the generator bump) and #599's claims file (forced by the merge). Whether to split the bump and its row into a follow-up PR, or take main's row if lane rec or sig lands the same bump first, is the coordinator's pick, so this branch still carries both. **Minors fixed:** the Decision and Consequences sentences narrowed to the readers named here, the fork 3 degrades and the shrink-only baseline; `checkLimit` called reachable now; the `vendor-menu-supply.ts` path corrected to `src/providers/`; two stale cites in the tech-debt note re-pinned; the two AW bullets moved out of the claim-corrections list; the /recommendations fan-out stated as unmeasured. **Minor, open:** forks 1–4 have no founder answer (see Open forks). origin/main fb862aa57 (#600) merged, both README rows kept |
| 2026-10-04 | lane settle round 2 (after the interrupted fix round 2) | No decision changed; still Proposed. **Verify round 2's major is fixed by a split.** The branch was 17 files against ADR 0231's 15-file cap. Moving the generator bump out would leave 16, because #599's claims file and the seven readers stay. So the guard moved instead: its script, its `ci.yml` steps and its `TD-2026-10-03-WHOLE-READ-GUARD-WIRED` claim now sit on the stacked branch `fix/analytics-window-reads-guard`, which is one commit on top of this branch. This PR is 15 files. The helper's comment no longer says the guard checks this tree. Fix round 2's uncommitted cite corrections were each re-checked and committed. The tech-debt note's opening sentence is narrowed to the readers named here |
| 2026-10-04 | final reviewer (last call), HOLD at fbf2ba916 | No decision changed; still Proposed. Three fixes. **Claim narrowed:** `TD-2026-10-03-ANALYTICS-READS-WHOLE-WINDOW` said every analytics reader of the two tables that read an unranged window now reads through `readWholeWindow`, but `dev-truth.service.ts` `asOf` still makes two unranged `pos_checks` reads; it now names the readers table and says the other reads are not claimed, with its verify unchanged. **Test added:** `analytics.service.ts` `loadConsumption` had no committed case; `read-whole-window.spec.ts` now pins its 1,500 lines in 2 requests, the forecast's history and the refused page 2 degrading to `[]` with a loud log, all three red against origin/main e2cbe426a's copy of that file (1,000 lines read). **"Now" corrected:** the AW24 bullet here and in the tech-debt note said booth checks now enter server stats; they were already in the old sample, and what is new is the ones past the cap |
