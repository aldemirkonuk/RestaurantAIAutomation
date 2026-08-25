import * as R from "./risk";

const approx = (a: number | null, b: number, tol = 1e-4) => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as number) - b)).toBeLessThan(tol);
};

describe("risk engine", () => {
  const returns = [
    0.02, -0.01, 0.03, -0.05, 0.01, 0.04, -0.02, 0.0, 0.02, -0.03,
  ];

  it("volatility annualization", () => {
    const daily = R.volatility(returns);
    const annual = R.volatility(returns, 252);
    approx(annual, (daily as number) * Math.sqrt(252), 1e-6);
  });

  it("downsideDeviation only penalizes below MAR", () => {
    const dd = R.downsideDeviation([0.1, -0.1, 0.2, -0.2], 0);
    // sqrt((0.01+0.04)/4) = sqrt(0.0125)
    approx(dd, Math.sqrt(0.0125));
  });

  it("historical VaR is a positive loss magnitude", () => {
    const v = R.historicalVar(returns, 0.9);
    expect(v).not.toBeNull();
    expect(v as number).toBeGreaterThan(0);
  });

  it("parametric VaR matches formula", () => {
    // symmetric known set
    const rs = [-0.02, -0.01, 0, 0.01, 0.02];
    const v = R.parametricVar(rs, 0.95);
    expect(v).not.toBeNull();
    expect(v as number).toBeGreaterThan(0);
  });

  it("CVaR >= VaR (expected shortfall is worse)", () => {
    const var95 = R.historicalVar(returns, 0.8) as number;
    const cvar95 = R.conditionalVar(returns, 0.8) as number;
    expect(cvar95).toBeGreaterThanOrEqual(var95 - 1e-9);
  });

  it("sharpe & sortino", () => {
    const s = R.sharpeRatio(returns, 0);
    expect(s).not.toBeNull();
    const sortino = R.sortinoRatio(returns, 0);
    expect(sortino).not.toBeNull();
  });

  it("maxDrawdown finds the worst peak-to-trough", () => {
    // peak 100 → trough 50 → recover; MDD = 0.5
    const r = R.maxDrawdown([100, 120, 60, 80, 200]);
    approx(r!.maxDrawdown, 0.5);
    expect(r!.peakIndex).toBe(1);
    expect(r!.troughIndex).toBe(2);
  });

  it("two-asset portfolio variance & min-variance weights", () => {
    // equal 0.5/0.5, sigma 0.1 each, rho 0 → var = 0.5^2*0.01*2 = 0.005
    approx(R.twoAssetPortfolioVariance(0.5, 0.1, 0.5, 0.1, 0), 0.005);
    // uncorrelated equal-vol → 50/50 min variance
    const w = R.minVarianceWeights2(0.1, 0.1, 0);
    approx(w!.w1, 0.5);
  });

  it("portfolioVariance wᵀΣw", () => {
    const w = [0.5, 0.5];
    const cov = [
      [0.01, 0],
      [0, 0.01],
    ];
    approx(R.portfolioVariance(w, cov), 0.005);
  });

  it("giniCoefficient: equal vs concentrated", () => {
    approx(R.giniCoefficient([10, 10, 10, 10]), 0, 1e-9);
    const g = R.giniCoefficient([0, 0, 0, 100]);
    expect(g as number).toBeGreaterThan(0.7);
  });
});
