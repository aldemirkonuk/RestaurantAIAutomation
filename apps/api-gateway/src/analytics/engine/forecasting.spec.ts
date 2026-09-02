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

  it("every model reports its own warmup, and it is exact at the boundary", () => {
    // The number bounding the honesty window must live in the function that
    // determines it, not in the caller. Exactness is asserted at the boundary
    // itself — warmup-1 must still leak, warmup must not — because a warmup
    // that is merely large enough would pass a probe taken far from the edge.
    const period = 7;
    const series = weeklySeries(56, period);

    const models = [
      {
        name: "ses",
        warmup: Fc.simpleExponentialSmoothing(series, 0.4)!.warmup,
        fit: (s: number[]) => Fc.simpleExponentialSmoothing(s, 0.4)!.fitted,
      },
      {
        name: "holtLinear",
        warmup: Fc.holtLinear(series, 0.4, 0.1)!.warmup,
        fit: (s: number[]) => Fc.holtLinear(s, 0.4, 0.1)!.fitted,
      },
      {
        name: "holtWinters",
        warmup: Fc.holtWintersAdditive(series, period, {
          alpha: 0.3,
          beta: 0.05,
          gamma: 0.3,
        })!.warmup,
        fit: (s: number[]) =>
          Fc.holtWintersAdditive(s, period, {
            alpha: 0.3,
            beta: 0.05,
            gamma: 0.3,
          })!.fitted,
      },
    ];

    expect(models.map((m) => [m.name, m.warmup])).toEqual([
      ["ses", 1],
      ["holtLinear", 2],
      ["holtWinters", 14],
    ]);

    for (const m of models) {
      // First index at or past warmup is leak-free.
      expect(Math.abs(leakAt(m.fit, series, m.warmup))).toBeLessThan(1e-9);
      // The index just below it is not — so warmup is not off by one.
      expect(Math.abs(leakAt(m.fit, series, m.warmup - 1))).toBeGreaterThan(
        1e-9,
      );
    }
  });

  it("MASE scales the numerator by a benchmark from the same window", () => {
    // The numerator scores t ∈ [w, n). If the denominator is drawn from
    // [period, n) instead, it prices a different stretch of trade — and the
    // error runs in BOTH directions depending on what the excluded head did,
    // which is why "it is only the warmup, it barely matters" is wrong.
    const period = 7;
    const w = 2 * period;
    const calmTail = (n: number) =>
      Array.from({ length: n }, (_, i) => 20 + (i % period));

    // (a) Opening blitz: the head's 7-lag jumps are huge, so folding it in
    //     inflates the benchmark and FLATTERS the model.
    const blitz = [
      ...new Array(period).fill(10),
      ...new Array(period).fill(100),
      ...calmTail(42),
    ];
    // (b) POS went live late: the head is flat zeros, so folding it in
    //     deflates the benchmark and PUNISHES the model.
    const lateStart = [...new Array(w).fill(0), ...calmTail(42)];

    const directions: Array<[string, number[], "flatters" | "punishes"]> = [
      ["blitz", blitz, "flatters"],
      ["lateStart", lateStart, "punishes"],
    ];

    for (const [name, series, effect] of directions) {
      const actual = series.slice(w);
      const predicted = actual.map((v) => v + 1); // constant error of 1
      const mismatched = Fc.mase(actual, predicted, series, period); // from = 0
      const windowed = Fc.mase(actual, predicted, series, period, w);
      expect(mismatched).not.toBeNull();
      expect(windowed).not.toBeNull();

      if (effect === "flatters") {
        expect(mismatched as number).toBeLessThan(windowed as number);
      } else {
        expect(mismatched as number).toBeGreaterThan(windowed as number);
      }

      // The windowed denominator is exactly the naive MAE over [w, n).
      let err = 0;
      let count = 0;
      for (let i = w; i < series.length; i++) {
        err += Math.abs(series[i] - series[i - period]);
        count++;
      }
      const expected = (Fc.mae(actual, predicted) as number) / (err / count);
      expect({
        series: name,
        exact: Math.abs((windowed as number) - expected) < 1e-9,
      }).toEqual({ series: name, exact: true });
    }
  });

  it("MASE `from` cannot reach below one seasonal period of history", () => {
    // A seasonal-naive pair needs `period` points behind it, so a `from`
    // earlier than that must clamp rather than read off the front of the array.
    const period = 7;
    const series = weeklySeries(56, period);
    const actual = series.slice(2);
    const predicted = actual.map((v) => v + 1);
    expect(Fc.mase(actual, predicted, series, period, 0)).toEqual(
      Fc.mase(actual, predicted, series, period, 2),
    );
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
