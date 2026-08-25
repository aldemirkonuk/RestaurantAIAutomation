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
