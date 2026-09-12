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

**Which window each number describes.** Both post-fix figures are scored over
`t ∈ [warmup, n)` — 106 of 120 days. That qualifier is load-bearing for MASE
specifically, because MASE is a *ratio* of two error series and they must be
measured over the same stretch of trade. The first cut of this fix moved the
numerator to the scored window and left the denominator on the full series, so
0.889's benchmark silently included days 7–13 that its numerator refused to
score. `mase` now takes a `from` bound and the caller passes `warmup`; the
seasonal-naive denominator is the naive MAE over exactly `t ∈ [max(warmup,
period), n)`.

That mismatch is not a rounding error, and it runs in **both** directions
depending on what the excluded head did. Measured over 400 simulated series of
each shape:

| head shape | effect of the mismatch on MASE | beats-naive verdict flips |
|---|---|---|
| opening blitz (busy first fortnight, then settled) | flatters, mean 4.5%, worst 13.9% | 22 / 400 |
| POS went live on day 20 (leading zeros) | punishes, mean 6.6% | 143 / 400 |

Both shapes are ones `toDailySeries` produces directly — it zero-fills to
exactly `sinceDays` points, so a mid-window POS rollout *is* a leading-zero
series. An independent adversarial pass measured the same two effects on its
own generator at different magnitudes (14.8% / 31.3% worst, 128/400 flips);
the direction and the order of magnitude reproduce, the exact figures do not
transfer between generators and are not copied here.

**Second-order finding: the recursion is not the only leak path.** Holt-Winters
seeds `level`, `trend` and `seasonals` from the first two seasons. Those fitted
values are in-sample no matter how the loop is written — verified: after the fix
∂fitted[3]/∂series[3] is still non-zero while ∂fitted[k]/∂series[k] is zero for
k ∈ {14, 21, 33, 55}. Fixing the loop alone would have left a smaller version of
the same dishonesty at the head of every series.

**Third-order finding: the no-data series certified itself.** `toDailySeries`
zero-fills, so a restaurant or `masterWineId` with no consumption yields 120
zeros — not a short series. Holt-Winters therefore never returns null, and
MAE and RMSE over the scored window both evaluate to **0**: a perfect forecast,
reported over a series holding no observation. `mape` and `mase` already
refused (both divide by zero); `mae` and `rmse` answered. The zeros predate
this ADR, but the `scoredPoints` and `basis` fields it introduced made them
*worse* — they turned an unqualified zero into a zero backed by a stated
evidence count of 106. The claim got more confident while staying equally
empty. Per [[0051-rebuilt-pages-show-live-data-only]], an unknown is an em
dash and never a zero, so all four metrics now return null with
`basis: "no_observations_in_scored_window"` and `scoredPoints: 0`.

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
one-step-ahead prediction of `series[i]` from `series[0..i-1]` only, and **every
model returns its own `warmup`** (SES 1, Holt 2, Holt-Winters 2·period) so the
seeding window can be excluded rather than merely regretted.

What carried it: the repo was checked for who actually consumes `fitted`, and
the answer decided the question. `fitted` **never leaves the API** —
`getDemandForecast` returns `history`, `forecast`, `totalForecastDemand` and
`accuracy`, never `fitted` (`analytics.service.ts:801-816`); it has zero hits in
`apps/web`, `apps/mobile`, `services/` and `packages/`. The two `holtLinear`
callers read only `.forecast` — `advanced-analytics.service.ts:485`
(`holt?.forecast.map(...)`) and `goals.service.ts:211`
(`holt.forecast[holt.forecast.length - 1]`); neither touches `.trend`, `.level`
or `.fitted`. So the *only* consumer of `fitted` anywhere is the accuracy block
being corrected. Option 2's entire benefit — not breaking other callers — is
worth nothing, and its cost (a correctly-named leaky array) is real.

Option 1 is also the standard meaning: `fittedvalues` in statsmodels' ETS is the
one-step-ahead in-sample prediction. This is not a redefinition so much as
making Holt-Winters agree with SES, which was right all along.

The `warmup` boundary is what makes the fix non-cosmetic. Without it the head of
every series stays in-sample through the seed, and a 120-point series would
report 120 scored points when only 106 are honest. Each model returns its own
rather than the caller hardcoding them: the number that bounds the honesty
window is determined by the seeding code, so it belongs beside it — a caller
holding a literal `2` is a second source of truth that goes stale the moment
seeding changes. The spec pins all three at the boundary itself (`warmup − 1`
must still leak, `warmup` must not), so a value that is merely *large enough*
does not pass.

## Consequences

- **Easier:** an accuracy number from `getDemandForecast` now means what a
  manager would assume it means. `accuracy` carries `basis` and `scoredPoints`
  so the claim is self-describing and the ADR 0048 Lane A work can build on it.
  Note the trap those two fields set on the way in — a stated evidence count
  makes an *empty* claim read as a well-grounded one, which is why the no-data
  refusal above had to land in the same change rather than after it. A field
  that qualifies a number is only an honesty feature while the number exists.
- **Easier:** the leak is now guarded, not just fixed. `forecasting.spec.ts`
  asserts ∂fitted[k]/∂series[k] = 0 for all three models as one object, so a
  regression names every model that broke rather than short-circuiting on the
  first, and pins each model's `warmup` at its exact boundary.
- **Harder / given up:** every forecast accuracy figure gets visibly worse. On
  the simulated series MAPE roughly doubles and MASE moves 0.40 → 0.89. Nothing
  regressed; the old figure was wrong. Anyone who saw a pre-fix number should
  discard it.
- **Harder:** `mase` grew a fifth parameter. It defaults to `0`, so every
  existing call keeps its old behaviour — which means the mismatched-window
  bug is *reachable* by anyone who omits it. Accepted over a required
  parameter because `mase` is a general metric with legitimate whole-series
  uses; the guard is that the one production caller passes `warmup` and a spec
  asserts the two windows agree.
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
| 2026-09-02 | Independent adversarial pass | **Confirmed the core, found two real defects.** Rebuilt every check on its own harness: 300 Holt-Winters configurations (5 periods × 5 α/β/γ corners × 3 zero-densities × 4 lengths) with **zero** leak violations, warmups exact rather than off by one, `fitted.length === series.length` structural, and the impact table if anything understating the leak. Rider analysis held — `holtLinear` outputs bit-identical old vs new, 0 sign flips on the insight path. **Defect A:** MASE's numerator and denominator spanned different windows (see the window table above) — closed by `mase(…, from)`. **Defect B:** the all-zero no-data series reported MAE 0 / RMSE 0 over 106 scored points — closed by the null refusal. Both re-verified on an independent harness here before fixing; 4 of the 6 added cases proven failing against the pre-adversary commit. Post-fix: full suite 129 suites / 1592 tests passing, `tsc --noEmit` clean, no expectation moved |
