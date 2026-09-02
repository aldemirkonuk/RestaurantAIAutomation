import * as Fc from "./forecasting";

const approx = (a: number | null, b: number, tol = 1e-3) => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as number) - b)).toBeLessThan(tol);
};

describe("forecasting engine", () => {
  it("SES converges to level of a flat series", () => {
    const r = Fc.simpleExponentialSmoothing([10, 10, 10, 10], 0.5, 3);
    expect(r).not.toBeNull();
    r!.forecast.forEach((f) => approx(f, 10, 1e-6));
  });

  it("Holt linear projects a trend", () => {
    // perfectly linear series 1,2,3,4,5 → forecast should keep rising
    const r = Fc.holtLinear([1, 2, 3, 4, 5], 0.8, 0.5, 3);
    expect(r).not.toBeNull();
    approx(r!.trend, 1, 0.3);
    expect(r!.forecast[2]).toBeGreaterThan(r!.forecast[0]);
  });

  it("Holt-Winters needs two full seasons, then forecasts seasonally", () => {
    const period = 4;
    const base = [10, 20, 30, 40];
    const series = [...base, ...base, ...base]; // 3 seasons
    const r = Fc.holtWintersAdditive(
      series,
      period,
      { alpha: 0.3, beta: 0.1, gamma: 0.3 },
      period,
    );
    expect(r).not.toBeNull();
    expect(r!.forecast.length).toBe(period);
    // seasonal shape preserved: last quarter of season > first
    expect(r!.forecast[3]).toBeGreaterThan(r!.forecast[0]);
    // too-short series rejected
    expect(
      Fc.holtWintersAdditive([1, 2, 3], period, {
        alpha: 0.3,
        beta: 0.1,
        gamma: 0.3,
      }),
    ).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Look-ahead (in-sample leak) guards — ADR 0064.
  //
  // `fitted[i]` is contracted to be the ONE-STEP-AHEAD prediction for index i:
  // a function of series[0..i-1] only. The mechanical proof is a partial
  // derivative — perturb series[k] alone and fitted[k] must not move. Before
  // the ADR 0064 fix this measured α+βα+γ(1-α) = 0.525 for Holt-Winters and
  // βα = 0.04 for Holt linear; only SES was clean.
  // -------------------------------------------------------------------------

  /** d fitted[k] / d series[k]. Must be 0 for a genuine one-step-ahead. */
  const leakAt = (
    fit: (s: number[]) => number[],
    series: number[],
    k: number,
    delta = 1000,
  ): number => {
    const perturbed = series.slice();
    perturbed[k] += delta;
    return (fit(perturbed)[k] - fit(series)[k]) / delta;
  };

  /** Weekly-seasonal series with a mild upward trend; 8 full periods. */
  const weeklySeries = (n = 56, period = 7): number[] =>
    Array.from(
      { length: n },
      (_, i) =>
        100 + 10 * Math.sin((2 * Math.PI * (i % period)) / period) + 0.5 * i,
    );

  it("fitted is one-step-ahead: no model leaks series[k] into fitted[k]", () => {
    const series = weeklySeries();
    // k is past the 2-season seeding window, so only the recursion is in play.
    const k = 40;

    const sesLeak = leakAt(
      (s) => Fc.simpleExponentialSmoothing(s, 0.4)!.fitted,
      series,
      k,
    );
    const holtLeak = leakAt(
      (s) => Fc.holtLinear(s, 0.4, 0.1)!.fitted,
      series,
      k,
    );
    const hwLeak = leakAt(
      (s) =>
        Fc.holtWintersAdditive(s, 7, { alpha: 0.3, beta: 0.05, gamma: 0.3 })!
          .fitted,
      series,
      k,
    );

    // Asserted as one object so a regression reports every model at once
    // rather than short-circuiting on the first.
    const clean = (x: number) => Math.abs(x) < 1e-9;
    expect({
      ses: clean(sesLeak),
      holtLinear: clean(holtLeak),
      holtWinters: clean(hwLeak),
    }).toEqual({ ses: true, holtLinear: true, holtWinters: true });
  });

  it("fitted past the seeding window is unaffected by its own observation", () => {
    // Seeding reads series[0 .. 2*period-1], so the first two seasons are
    // structurally in-sample no matter how the recursion is written. `warmup`
    // marks that boundary; accuracy must be scored past it.
    const period = 7;
    const series = weeklySeries(56, period);
    const fit = (s: number[]) =>
      Fc.holtWintersAdditive(s, period, {
        alpha: 0.3,
        beta: 0.05,
        gamma: 0.3,
      })!.fitted;

    const r = Fc.holtWintersAdditive(series, period, {
      alpha: 0.3,
      beta: 0.05,
      gamma: 0.3,
    });
    expect(r!.warmup).toBe(2 * period);

    // Inside the warmup the seed still carries the observation...
    expect(Math.abs(leakAt(fit, series, 3))).toBeGreaterThan(1e-9);
    // ...past it, nothing does.
    for (const k of [14, 21, 33, 55]) {
      expect(Math.abs(leakAt(fit, series, k))).toBeLessThan(1e-9);
    }
  });

  it("fitted cannot track an unforeseeable spike", () => {
    // A one-step-ahead prediction has not seen the spike, so it must miss it
    // by most of the spike's size. A leaked fit tracks it closely.
    const series = weeklySeries();
    const k = 40;
    const spiked = series.slice();
    spiked[k] = series[k] * 5;

    const hw = Fc.holtWintersAdditive(spiked, 7, {
      alpha: 0.3,
      beta: 0.05,
      gamma: 0.3,
    });
    expect(hw).not.toBeNull();
    const relErr = Math.abs(hw!.fitted[k] - spiked[k]) / spiked[k];
    // Leaked implementation scored 0.38 here; an honest one cannot beat ~0.75.
    expect(relErr).toBeGreaterThan(0.6);
  });

  it("fitted stays a valid Holt-Winters fit on a clean seasonal series", () => {
    // Regression guard: making fitted honest must not make it useless. On a
    // noiseless repeating series the one-step-ahead error should stay small
    // once past the seeding window.
    const period = 7;
    const base = [12, 9, 11, 14, 22, 30, 18];
    const series: number[] = [];
    for (let c = 0; c < 8; c++) series.push(...base);
    const r = Fc.holtWintersAdditive(series, period, {
      alpha: 0.3,
      beta: 0.05,
      gamma: 0.3,
    });
    expect(r).not.toBeNull();
    const tail = series.slice(4 * period);
    const tailFit = r!.fitted.slice(4 * period);
    expect(r!.fitted.length).toBe(series.length);
    const err = Fc.mape(tail, tailFit);
    expect(err).not.toBeNull();
    expect(err as number).toBeLessThan(20);
  });

  it("seasonalNaive repeats last season", () => {
    const r = Fc.seasonalNaive([1, 2, 3, 4, 5, 6], 3, 3);
    expect(r).toEqual([4, 5, 6]);
  });

  it("seasonalDecompose splits trend+seasonal+residual", () => {
    const period = 4;
    const seasonal = [-5, 0, 5, 0];
    const series: number[] = [];
    for (let i = 0; i < 16; i++)
      series.push(10 + i * 0.5 + seasonal[i % period]);
    const d = Fc.seasonalDecompose(series, period);
    expect(d).not.toBeNull();
    // seasonal factors should roughly recover the pattern (sum ~0)
    const sSum = d!.seasonal
      .slice(0, period)
      .reduce((a: number, b: number) => a + b, 0);
    approx(sSum, 0, 1e-6);
  });

  it("error metrics: perfect prediction is zero error", () => {
    approx(Fc.mae([1, 2, 3], [1, 2, 3]), 0);
    approx(Fc.rmse([1, 2, 3], [1, 2, 3]), 0);
    approx(Fc.mape([1, 2, 3], [1, 2, 3]), 0);
    // MAE with constant error 1
    approx(Fc.mae([1, 2, 3], [2, 3, 4]), 1);
    approx(Fc.mape([10, 10], [11, 9]), 10); // 10% each
  });

  it("MASE < 1 when beating seasonal naive", () => {
    // training series where seasonal-naive has non-zero error
    const train = [10, 22, 12, 24, 14, 26];
    // near-perfect forecast vs actual → small MASE
    const actual = [16, 28];
    const pred = [16.1, 27.9];
    const m = Fc.mase(actual, pred, train, 2);
    expect(m).not.toBeNull();
    expect(m as number).toBeLessThan(1);
  });
});
