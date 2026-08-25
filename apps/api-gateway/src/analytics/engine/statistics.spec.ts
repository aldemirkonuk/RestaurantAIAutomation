import * as S from "./statistics";

const approx = (a: number | null, b: number, tol = 1e-6) => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as number) - b)).toBeLessThan(tol);
};

describe("statistics engine", () => {
  it("clean drops non-finite values", () => {
    expect(S.clean([1, null, 2, undefined, NaN, Infinity, 3])).toEqual([
      1, 2, 3,
    ]);
  });

  it("mean / median / sum", () => {
    approx(S.mean([1, 2, 3, 4]), 2.5);
    approx(S.median([1, 2, 3, 4]), 2.5);
    approx(S.median([1, 2, 3]), 2);
    expect(S.sum([1, 2, 3])).toBe(6);
    expect(S.mean([])).toBeNull();
  });

  it("weightedMean", () => {
    approx(S.weightedMean([2, 4], [1, 3]), 3.5);
    expect(S.weightedMean([1], [0])).toBeNull();
  });

  it("percentile (type-7)", () => {
    // NumPy default: percentile([1,2,3,4], 25) === 1.75
    approx(S.percentile([1, 2, 3, 4], 25), 1.75);
    approx(S.percentile([1, 2, 3, 4], 50), 2.5);
    approx(S.percentile([1, 2, 3, 4], 100), 4);
    approx(S.iqr([1, 2, 3, 4]), 1.5);
  });

  it("sample vs population variance", () => {
    // data 2,4,4,4,5,5,7,9 → pop var 4, sample var 32/7≈4.5714
    const d = [2, 4, 4, 4, 5, 5, 7, 9];
    approx(S.variance(d, false), 4);
    approx(S.variance(d, true), 32 / 7);
    approx(S.stdev(d, false), 2);
    expect(S.variance([1], true)).toBeNull();
  });

  it("coefficient of variation", () => {
    approx(S.coefficientOfVariation([2, 4, 4, 4, 5, 5, 7, 9], false), 2 / 5);
  });

  it("z-score and robust z-score", () => {
    approx(S.zScore(9, [2, 4, 4, 4, 5, 5, 7, 9], false), 2);
    // robust: median 4.5, MAD of |x-4.5|... value 9 should be positive/large
    const rz = S.robustZScore(9, [2, 4, 4, 4, 5, 5, 7, 9]);
    expect(rz).not.toBeNull();
    expect(rz as number).toBeGreaterThan(0);
  });

  it("pearson correlation: perfect positive & negative", () => {
    approx(S.pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1);
    approx(S.pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1);
  });

  it("spearman handles monotonic non-linear", () => {
    approx(S.spearman([1, 2, 3, 4], [1, 4, 9, 16]), 1);
  });

  it("linearRegression recovers slope/intercept", () => {
    const r = S.linearRegression([0, 1, 2, 3], [1, 3, 5, 7]);
    approx(r!.slope, 2);
    approx(r!.intercept, 1);
    approx(r!.r2, 1);
    approx(r!.predict(4), 9);
  });

  it("movingAverage and ewma", () => {
    expect(S.movingAverage([1, 2, 3, 4], 2)).toEqual([1, 1.5, 2.5, 3.5]);
    const e = S.ewma([1, 2, 3], 0.5);
    approx(e[0], 1);
    approx(e[1], 1.5);
    approx(e[2], 2.25);
  });

  it("skewness ~0 for symmetric, kurtosis defined", () => {
    approx(S.skewness([1, 2, 3, 4, 5]), 0, 1e-9);
    expect(S.kurtosis([1, 2, 3, 4, 5])).not.toBeNull();
  });

  it("normalCdf / normalInv round-trip", () => {
    approx(S.normalCdf(0), 0.5, 1e-6);
    approx(S.normalCdf(1.959964), 0.975, 1e-4);
    approx(S.normalInv(0.975), 1.959964, 1e-4);
    approx(S.serviceLevelZ(0.95), 1.644854, 1e-4);
    expect(S.normalInv(0)).toBeNull();
  });

  it("confidenceIntervalMean brackets the mean", () => {
    const ci = S.confidenceIntervalMean([10, 12, 14, 16, 18], 0.95);
    expect(ci).not.toBeNull();
    approx(ci!.mean, 14);
    expect(ci!.lower).toBeLessThan(14);
    expect(ci!.upper).toBeGreaterThan(14);
  });

  it("cusum flags a sustained upward shift", () => {
    const stable = Array.from({ length: 20 }, () => 10);
    const shifted = [...stable, ...Array.from({ length: 20 }, () => 20)];
    const res = S.cusum(shifted, { target: 10, k: 0.5, h: 5 });
    expect(res.alarmIndex).not.toBeNull();
    expect(res.alarmIndex as number).toBeGreaterThanOrEqual(20);
  });

  it("shannonEntropy: uniform vs concentrated", () => {
    approx(S.shannonEntropy([1, 1, 1, 1]), 2); // log2(4)
    approx(S.shannonEntropy([1, 0, 0, 0]), 0);
  });
});
