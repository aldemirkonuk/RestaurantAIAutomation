import { solve, matMul, transpose } from "./linalg";
import {
  multipleRegression,
  partialCorrelation,
  adjustedGroupEffects,
} from "./regression";

const approx = (a: number | null | undefined, b: number, tol = 1e-4) => {
  expect(a).not.toBeNull();
  expect(a).not.toBeUndefined();
  expect(Math.abs((a as number) - b)).toBeLessThan(tol);
};

describe("linalg", () => {
  it("solve recovers x for A·x=b", () => {
    // 2x + y = 5; x + 3y = 10 → x=1, y=3
    const x = solve(
      [
        [2, 1],
        [1, 3],
      ],
      [5, 10],
    );
    approx(x![0], 1);
    approx(x![1], 3);
  });

  it("solve returns null for singular matrix", () => {
    expect(
      solve(
        [
          [1, 2],
          [2, 4],
        ],
        [3, 6],
      ),
    ).toBeNull();
  });

  it("matMul and transpose", () => {
    const A = [
      [1, 2],
      [3, 4],
    ];
    expect(transpose(A)).toEqual([
      [1, 3],
      [2, 4],
    ]);
    expect(matMul(A, [[1], [1]])).toEqual([[3], [7]]);
  });
});

describe("multipleRegression", () => {
  it("recovers exact coefficients on noiseless data", () => {
    // y = 3 + 2·x1 - 1·x2
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 20; i++) {
      const x1 = i;
      const x2 = (i * 7) % 5;
      X.push([x1, x2]);
      y.push(3 + 2 * x1 - x2);
    }
    const r = multipleRegression(X, y);
    approx(r!.coefficients[0], 2);
    approx(r!.coefficients[1], -1);
    approx(r!.intercept, 3);
    approx(r!.r2, 1);
    approx(r!.predict([10, 2]), 3 + 20 - 2);
  });

  it("ridge shrinks coefficients but stays close on clean data", () => {
    const X = [[0], [1], [2], [3], [4]];
    const y = [1, 3, 5, 7, 9]; // slope 2
    const ols = multipleRegression(X, y)!;
    const ridge = multipleRegression(X, y, { ridgeLambda: 5 })!;
    approx(ols.coefficients[0], 2);
    expect(Math.abs(ridge.coefficients[0])).toBeLessThan(2); // shrunk
    expect(ridge.coefficients[0]).toBeGreaterThan(1); // but not destroyed
  });

  it("handles collinear dummies with ridge (no crash)", () => {
    // two dummy columns that always sum to 1 — singular under OLS
    const X = [
      [1, 0],
      [0, 1],
      [1, 0],
      [0, 1],
    ];
    const y = [10, 20, 12, 18];
    expect(multipleRegression(X, y)).toBeNull(); // OLS singular → null
    const ridge = multipleRegression(X, y, { ridgeLambda: 0.01 });
    expect(ridge).not.toBeNull(); // ridge solves it
    // group B effect should exceed group A effect
    expect(ridge!.coefficients[1]).toBeGreaterThan(ridge!.coefficients[0]);
  });

  it("standardizedBetas rank importance regardless of units", () => {
    // y driven by x1 (small unit) much more than x2 (big unit)
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 30; i++) {
      const x1 = i % 7; // 0..6
      const x2 = i * 100; // huge scale, tiny true effect
      X.push([x1, x2]);
      y.push(50 * x1 + 0.001 * x2);
    }
    const r = multipleRegression(X, y)!;
    expect(Math.abs(r.standardizedBetas[0])).toBeGreaterThan(
      Math.abs(r.standardizedBetas[1]),
    );
  });
});

describe("partialCorrelation", () => {
  it("kills a spurious correlation driven by a confounder", () => {
    // z drives both x and y; x has no direct effect on y.
    const x: number[] = [];
    const y: number[] = [];
    const z: number[] = [];
    for (let i = 0; i < 60; i++) {
      const zi = i;
      const noise = ((i * 37) % 11) - 5; // deterministic pseudo-noise
      z.push(zi);
      x.push(2 * zi + noise);
      y.push(3 * zi - noise);
    }
    const partial = partialCorrelation(x, y, [z]);
    expect(partial).not.toBeNull();
    // raw correlation is ~1; partial should collapse far toward -1/0 range
    expect(Math.abs(partial as number)).toBeLessThan(1);
  });
});

describe("adjustedGroupEffects", () => {
  it("separates waiter skill from table quality", () => {
    // Table T1 adds +20 to checks, T2 adds 0.
    // Waiter A adds +10, waiter B adds 0.
    // A works T2 mostly (bad table), B works T1 mostly (good table).
    const y: number[] = [];
    const waiter: string[] = [];
    const table: string[] = [];
    const rows: Array<[string, string, number]> = [
      ["A", "T2", 60], // 50 base + 10 skill
      ["A", "T2", 60],
      ["A", "T2", 60],
      ["A", "T1", 80], // base + table 20 + skill 10
      ["B", "T1", 70], // base + table 20
      ["B", "T1", 70],
      ["B", "T1", 70],
      ["B", "T2", 50],
    ];
    for (const [w, t, v] of rows) {
      waiter.push(w);
      table.push(t);
      y.push(v);
    }
    // Raw means: A = 65, B = 65 → look equal!
    const res = adjustedGroupEffects({
      y,
      target: waiter,
      controls: [table],
      ridgeLambda: 0.001,
    });
    expect(res).not.toBeNull();
    const a = res!.effects.find((e) => e.group === "A")!;
    const b = res!.effects.find((e) => e.group === "B")!;
    approx(a.rawMean, 65);
    approx(b.rawMean, 65);
    // adjusted: A's effect must exceed B's once table is controlled
    expect(a.effect).toBeGreaterThan(b.effect + 3);
  });
});
