# 0064 — A fitted value is a prediction, not a memory

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** forecasting, holt-winters, holt-linear, look-ahead, leakage, in-sample, out-of-sample, backtest, MAPE, MASE, accuracy, honesty
- **Links:** [[0048-domain-quant-under-research-math]], [[0020-no-fabricated-answers]], [[0053-analytics-cost-unknown-not-invented]], [[v3.0-TECH-DEBT]] defect 3, [[S10-stockout-risk-before-a-busy-night]], [[DELIVERY-AUDIT]]

## Context

`engine/forecasting.ts` exposes a `fitted` array on every smoother, and
`analytics.service.ts` scored forecast accuracy against it under the comment
*"Backtest accuracy on the fitted series."* It was not a backtest. In
`holtWintersAdditive` the push happened **after** level, trend and the seasonal
factor had each absorbed `series[i]`, so `fitted[i]` was a function of the very
value it was about to be compared against.

The leak is measurable as a partial derivative — perturb `series[k]` alone and
watch `fitted[k]` move. Measured on a 56-point weekly-seasonal series at k=40,
against the pre-fix code:

| model | ∂fitted[k]/∂series[k] | closed form | verdict |
|---|---|---|---|
| `simpleExponentialSmoothing` | 0.000000 | 0 | clean |
| `holtLinear` | 0.040000 | α·β | **leaked** |
| `holtWintersAdditive` | 0.525000 | α + βα + γ(1−α) | **leaked** |

Two corrections to the brief that opened this work, both material:

1. **`holtLinear` leaked too.** It was reported as correct because line 78 read
   `fitted.push(prevLevel + trend)` — pre-update *level*, but **post-update
   trend**. `trend` had already been recomputed from a `level` carrying `α·y_i`,
   so the prediction saw its own answer with weight α·β. It was neither the
   in-sample fit nor the one-step-ahead: a hybrid of both. `v3.0-TECH-DEBT.md:928`
   had this right and the brief did not; only SES was ever clean.
2. **`insight-generator.service.ts` was never a leaked consumer.** Its comment
   said "Holt-Winters fitted vs actual", but the code
   (`insight-generator.service.ts:488-500`) trains on `values.slice(0, -7)` and
   scores `hw.forecast` against the held-out last week. That is a genuine
   out-of-sample holdout. The defect there was the comment, not the arithmetic.

So there was exactly **one** leaked consumer in the repo, and it was the one
labelled "backtest".

**Why this matters beyond one function.** The product's promise in this area is
that a manager can trust a number because the machine will say when it cannot
support one — ADR 0020, and ADR 0053's "unknown is not zero". An accuracy metric
is the load-bearing case: it is the number that licenses every *other* forecast
number. A MASE of 0.40 is a claim that we beat the seasonal-naive benchmark by
2.5×, and MASE is precisely the metric [[S10-stockout-risk-before-a-busy-night]]
(`:135`) nominates as "the honest benchmark should win". Scoring it in-sample
does not make the forecast slightly better than it is; it makes the *claim about
the forecast* unfalsifiable, because a smoother that has seen the answer will
always look like it beat the benchmark.

Measured impact on a simulated 120-day daily-consumption series (weekly
seasonality, trend, multiplicative noise; the same shape `toDailySeries` produces):

| metric | before (leaked, whole series) | after (one-step-ahead, past warmup) |
|---|---|---|
| MAE | 1.606 | 3.550 |
| RMSE | 2.106 | 4.546 |
| MAPE | 6.945 % | 15.313 % |
| MASE vs seasonal-naive | 0.402 | 0.889 |
| points scored | 120 | 106 |

The honest model still beats the naive benchmark, but by 11%, not by 2.5×. The
reported error was **less than half** the real one.

**Second-order finding: the recursion is not the only leak path.** Holt-Winters
seeds `level`, `trend` and `seasonals` from the first two seasons. Those fitted
values are in-sample no matter how the loop is written — verified: after the fix
∂fitted[3]/∂series[3] is still non-zero while ∂fitted[k]/∂series[k] is zero for
k ∈ {14, 21, 33, 55}. Fixing the loop alone would have left a smaller version of
the same dishonesty at the head of every series.

## Options considered

1. **Redefine `fitted` as the one-step-ahead prediction; every caller's numbers
   change.** One array, one meaning, no way to reach the leaky series. Costs: the
   reported accuracy of every forecast gets worse (see table), and any consumer
   wanting a smoothed in-sample series loses it.
2. **Keep `fitted` as-is and add `oneStepAhead: number[]`, repointing the
   accuracy call sites.** Non-breaking. Costs: the leaky array stays reachable
   and correctly-named, so the next person to reach for "fitted" re-commits the
   defect — this is the failure mode being fixed, preserved behind a new name. It
   also makes Holt-Winters the only model with two arrays, and makes its `fitted`
   mean something different from SES's `fitted`, which is already one-step-ahead.
3. **Fix Holt-Winters only, leave `holtLinear`.** Smaller diff, matches the brief
   as written. Costs: leaves a measured α·β leak in a function two live services
   call, and leaves the file internally inconsistent for the second time.
4. **Do nothing; document that the number is optimistic.** Zero risk to existing
   behaviour. Costs: `v3.0-TECH-DEBT.md` has *already* done this since 2026-08-31
   and the number is still wrong. A documented lie is still the number the UI
   renders once forecasting is wired up (ADR 0048 Lane A).

## Decision

**Option 1, extended to `holtLinear`, plus an explicit `warmup` boundary.**
`fitted[i]` on every model in `forecasting.ts` is now contracted to be the
one-step-ahead prediction of `series[i]` from `series[0..i-1]` only, and
`holtWintersAdditive` additionally returns `warmup = 2·period` so the seeding
window can be excluded rather than merely regretted.

What carried it: the repo was checked for who actually consumes `fitted`, and
the answer decided the question. `fitted` **never leaves the API** —
`getDemandForecast` returns `history`, `forecast`, `totalForecastDemand` and
`accuracy`, never `fitted` (`analytics.service.ts:801-816`); it has zero hits in
`apps/web`, `apps/mobile`, `services/` and `packages/`. The two `holtLinear`
callers (`advanced-analytics.service.ts:465`, `goals.service.ts:210`) read only
`.forecast` and `.trend`. So the *only* consumer of `fitted` anywhere is the
accuracy block being corrected. Option 2's entire benefit — not breaking other
callers — is worth nothing, and its cost (a correctly-named leaky array) is real.

Option 1 is also the standard meaning: `fittedvalues` in statsmodels' ETS is the
one-step-ahead in-sample prediction. This is not a redefinition so much as
making Holt-Winters agree with SES, which was right all along.

The `warmup` boundary is what makes the fix non-cosmetic. Without it the head of
every series stays in-sample through the seed, and a 120-point series would
report 120 scored points when only 106 are honest.

## Consequences

- **Easier:** an accuracy number from `getDemandForecast` now means what a
  manager would assume it means. `accuracy` carries `basis:
  "rolling_one_step_ahead"` and `scoredPoints` so the claim is self-describing
  and the ADR 0048 Lane A work can build on it.
- **Easier:** the leak is now guarded, not just fixed. `forecasting.spec.ts`
  asserts ∂fitted[k]/∂series[k] = 0 for all three models as one object, so a
  regression names every model that broke rather than short-circuiting on the
  first.
- **Harder / given up:** every forecast accuracy figure gets visibly worse. On
  the simulated series MAPE roughly doubles and MASE moves 0.40 → 0.89. Nothing
  regressed; the old figure was wrong. Anyone who saw a pre-fix number should
  discard it.
- **Given up:** the smoothed in-sample series is no longer available from these
  functions. Nothing used it; `seasonalDecompose` remains for that purpose.
- **Behaviour change beyond `fitted`:** Holt-Winters now absorbs `series[0]`
  (the old loop `continue`d past the update at i=0, so the first observation was
  never learned from). `forecast` therefore shifts slightly. This is a bug fix
  riding along, and it is named here rather than buried.
- **Revisit when:** a real POS-backed demand series exists and `warmup = 2·period`
  proves too short — the honest seeding window for a series with yearly as well
  as weekly structure is longer. Signal: `scoredPoints` accuracy that is stable
  under `alpha/beta/gamma` changes but jumps when the series start date moves.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | — | Created. Leak re-derived by perturbation *before* any code change. Evidence: 3 of the 4 new spec cases proven failing against the pristine `origin/main` engine (engine reverted, suite re-run — not projected); 11/11 green post-fix; full api-gateway suite 128 suites / 1585 tests passing, `tsc --noEmit` clean. Next-free ADR number confirmed as 0064 by `scripts/check_adr_numbers_unique.py` across 437 refs |
