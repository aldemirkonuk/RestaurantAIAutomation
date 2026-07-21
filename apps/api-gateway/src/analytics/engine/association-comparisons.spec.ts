import { pairAssociations, itemFrequencies } from "./association";
import {
  groupBaseline,
  periodOverPeriod,
  peerComparison,
  contributionToChange,
  dayOfWeekProfile,
} from "./comparisons";

const approx = (a: number | null | undefined, b: number, tol = 1e-6) => {
  expect(a).not.toBeNull();
  expect(a).not.toBeUndefined();
  expect(Math.abs((a as number) - b)).toBeLessThan(tol);
};

describe("association (market basket)", () => {
  it("itemFrequencies dedupes within a transaction", () => {
    const f = itemFrequencies([["malbec", "malbec", "ribeye"], ["malbec"]]);
    expect(f.get("malbec")).toBe(2);
    expect(f.get("ribeye")).toBe(1);
  });

  it("finds a strong pair with lift > 1", () => {
    // ribeye+malbec co-occur 4/8; malbec alone 1, ribeye alone 1, others 2
    const txns = [
      ["ribeye", "malbec"],
      ["ribeye", "malbec"],
      ["ribeye", "malbec"],
      ["ribeye", "malbec"],
      ["malbec"],
      ["ribeye"],
      ["salmon", "chablis"],
      ["salmon", "chablis"],
    ];
    const pairs = pairAssociations(txns, { minCount: 2 });
    const rm = pairs.find(
      (p) =>
        (p.a === "malbec" && p.b === "ribeye") ||
        (p.a === "ribeye" && p.b === "malbec"),
    )!;
    expect(rm).toBeDefined();
    approx(rm.support, 0.5);
    // P(malbec)=5/8, P(ribeye)=5/8, lift = .5/(0.625*0.625)=1.28
    approx(rm.lift, 0.5 / (0.625 * 0.625), 1e-6);
    expect(rm.lift).toBeGreaterThan(1);
    // confidence: of 5 malbec checks, 4 had ribeye
    approx(Math.max(rm.confidenceAtoB, rm.confidenceBtoA), 0.8);
    // chablis+salmon: perfect affinity, lift = .25/(.25*.25)=4
    const sc = pairs.find((p) => p.a === "chablis" || p.b === "chablis")!;
    approx(sc.lift, 4);
  });

  it("prunes below minCount", () => {
    const pairs = pairAssociations(
      [
        ["a", "b"],
        ["c", "d"],
      ],
      { minCount: 2 },
    );
    expect(pairs.length).toBe(0);
  });
});

describe("comparisons framework", () => {
  it("groupBaseline: 12% below average Tuesdays", () => {
    // avg of history = 100; value 88 → -12%
    const r = groupBaseline(88, [95, 100, 105, 100]);
    approx(r!.baselineMean, 100);
    approx(r!.deltaPct, -0.12);
    expect(r!.direction).toBe("below");
    expect(groupBaseline(100, [98, 102])!.direction).toBe("in_line");
  });

  it("periodOverPeriod detects direction", () => {
    const series = [10, 10, 10, 10, 12, 12, 12, 12];
    const r = periodOverPeriod(series, 4);
    approx(r!.current, 48);
    approx(r!.previous, 40);
    approx(r!.deltaPct, 0.2);
    expect(r!.direction).toBe("up");
    expect(periodOverPeriod([1, 2], 4)).toBeNull();
  });

  it("peerComparison ranks and computes percentile", () => {
    const r = peerComparison([
      { entity: "t1", value: 100 },
      { entity: "t2", value: 300 },
      { entity: "t3", value: 200 },
    ]);
    expect(r[0].entity).toBe("t2");
    expect(r[0].rank).toBe(1);
    approx(r[0].percentile, 1);
    approx(r[0].pctVsMean, 0.5); // 300 vs mean 200
    expect(r[2].entity).toBe("t1");
  });

  it("contributionToChange attributes the delta", () => {
    const prev = new Map([
      ["barolo", 1000],
      ["chianti", 500],
    ]);
    const curr = new Map([
      ["barolo", 400], // -600
      ["chianti", 550], // +50
    ]);
    const r = contributionToChange(prev, curr);
    approx(r.totalDelta, -550);
    expect(r.contributions[0].key).toBe("barolo");
    approx(r.contributions[0].shareOfChange, 600 / 650);
  });

  it("dayOfWeekProfile finds best and worst days", () => {
    // 2026-07-13 is a Monday; 2026-07-17 is a Friday
    const dates = [
      "2026-07-13", // Mon
      "2026-07-17", // Fri
      "2026-07-20", // Mon
      "2026-07-24", // Fri
    ];
    const values = [50, 200, 60, 220];
    const r = dayOfWeekProfile(dates, values);
    expect(r.best!.weekday).toBe(5); // Friday
    approx(r.best!.mean, 210);
    expect(r.worst!.weekday).toBe(1); // Monday
    approx(r.worst!.mean, 55);
  });
});
