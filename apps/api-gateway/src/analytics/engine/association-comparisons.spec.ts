import {
  pairAssociations,
  itemFrequencies,
  hypergeometricUpperTail,
} from "./association";
import {
  groupBaseline,
  periodOverPeriod,
  peerComparison,
  contributionToChange,
  dayOfWeekProfile,
  leaderTest,
  cutKeepingTies,
  sameValue,
  byStockoutRisk,
  correlationSignificance,
  GroupMoments,
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

/** Deterministic PRNG (mulberry32) and a Box–Muller normal on top of it. */
function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () =>
    Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
  return { u, normal };
}

function momentsFrom(entity: string, xs: number[]): GroupMoments<string> {
  const n = xs.length;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1);
  return { entity, n, mean: m, variance: v };
}

const g = (entity: string, mean: number, n = 300, variance = 8100) => ({
  entity,
  n,
  mean,
  variance,
});

describe("exact pair significance (ADR 0272)", () => {
  it("computes the one-sided hypergeometric tail exactly", () => {
    // n=8 checks, A on 5, B on 5, both on 4:
    // P(X ≥ 4) = [C(5,4)C(3,1) + C(5,5)C(3,0)] / C(8,5) = (5·3 + 1) / 56.
    approx(hypergeometricUpperTail(4, 8, 5, 5), 16 / 56, 1e-12);
    // Below the mode the tail is 1 − the lower side: P(X ≥ 3) = 1 − 10/56.
    approx(hypergeometricUpperTail(3, 8, 5, 5), 1 - 10 / 56, 1e-12);
    // At or below the support's floor it is certain, above its ceiling 0.
    expect(hypergeometricUpperTail(2, 8, 5, 5)).toBe(1);
    expect(hypergeometricUpperTail(6, 8, 5, 5)).toBe(0);
  });

  it("reports pUpper, the family size C(k,2), and the Bonferroni-adjusted p", () => {
    const txns = [
      ["a", "b"],
      ["a", "b"],
      ["a", "b"],
      ["a", "b"],
      ["a", "c"],
      ["b", "c"],
      ["c", "d"],
      ["d", "e"],
    ];
    // Items on ≥ 2 checks: a(5) b(5) c(3) d(2) — e(1) is not → k = 4, C(4,2) = 6.
    const pairs = pairAssociations(txns, { minCount: 2 });
    const ab = pairs.find((p) => p.a === "a" && p.b === "b")!;
    expect(ab.count).toBe(4);
    approx(ab.pUpper, 16 / 56, 1e-12);
    expect(ab.tests).toBe(6);
    approx(ab.pAdjusted, Math.min(1, 6 * (16 / 56)), 1e-12);
  });

  it("does not call a 3-co-occurrence rare pair significant the way χ² did (A-002)", () => {
    // 1,000 checks; two items on 6 and 8 checks share 3. Lift 62.5, χ² p is
    // astronomically small — the exact tail is 6.66e-6 (Python's math.comb
    // gives 6.664395794539363e-06), and over the family of C(239, 2) = 28,441
    // pairs this data could have shown, it is nothing.
    const txns: string[][] = [];
    for (let i = 0; i < 1000; i++) txns.push([`x${i % 120}`, `y${i % 117}`]);
    for (let i = 0; i < 3; i++) txns[i].push("ipa", "malagousia");
    for (let i = 3; i < 6; i++) txns[i].push("ipa");
    for (let i = 6; i < 11; i++) txns[i].push("malagousia");
    const p = pairAssociations(txns, { minCount: 3 }).find(
      (x) => x.a === "ipa" && x.b === "malagousia",
    )!;
    expect(p.lift).toBeGreaterThan(30);
    expect(p.pValue).toBeLessThan(1e-10);
    approx(p.pUpper, 6.664395794539363e-6, 1e-15);
    expect(p.tests).toBe(28441);
    expect(p.pAdjusted).toBeGreaterThan(0.05);
  });
});

describe("leaderTest (ADR 0272)", () => {
  it("does not separate a leader among equal groups", () => {
    const r = leaderTest([g("a", 185), g("b", 185), g("c", 185)]);
    expect(r.separable).toBe(false);
    expect(r.reason).toBe("tied_with_runner_up");
  });

  it("separates a planted +10% leader at n = 300", () => {
    const r = leaderTest([
      g("lead", 203.5),
      g("b", 185),
      g("c", 186),
      g("d", 184),
      g("e", 185.5),
    ]);
    expect(r.separable).toBe(true);
    expect(r.leader).toBe("lead");
    expect(r.runnerUp).toBe("c");
    expect(r.pVsRunnerUp!).toBeLessThan(0.05);
    expect(r.pVsRestAdjusted!).toBeLessThan(0.05);
    // The Bonferroni factor is the number of eligible groups.
    approx(r.pVsRestAdjusted, Math.min(1, 5 * r.pVsRest!), 1e-12);
  });

  it("refuses two co-leaders — the tie check", () => {
    const r = leaderTest([
      g("a", 205),
      g("b", 205.2),
      g("c", 185),
      g("d", 184),
      g("e", 186),
    ]);
    expect(r.separable).toBe(false);
    expect(r.reason).toBe("tied_with_runner_up");
  });

  it("does not crown a server for two $3,400 booth checks (Kerem's shape)", () => {
    const { normal } = rng(7);
    const draw = (k: number) =>
      Array.from({ length: k }, () => Math.max(20, 185 + 90 * normal()));
    const groups = ["deniz", "priya", "maya", "lucas"].map((e) =>
      momentsFrom(e, draw(600)),
    );
    const kerem = momentsFrom("kerem", [...draw(600), 3400, 3400]);
    const r = leaderTest([kerem, ...groups]);
    // He leads on the mean, by the booth alone…
    expect(r.leader).toBe("kerem");
    // …and the booth's variance is what keeps him from being printed #1.
    expect(r.separable).toBe(false);
  });

  it("does not rank a group under minN, and needs minGroups eligible", () => {
    const r = leaderTest([g("tiny", 900, 29), g("a", 200), g("b", 185)]);
    expect(r.ranked.map((x) => x.entity)).toEqual(["a", "b"]);
    expect(r.leader).toBe("a");
    const r3 = leaderTest([g("tiny", 900, 29), g("a", 200), g("b", 185)], {
      minGroups: 3,
    });
    expect(r3.separable).toBe(false);
    expect(r3.reason).toBe("too_few_groups");
  });

  it("holds its error rate on null data: < 5% of 400 seeded null rankings fire", () => {
    let fired = 0;
    for (let s = 1; s <= 400; s++) {
      const { normal } = rng(1000 + s);
      const groups = ["a", "b", "c", "d", "e"].map((e) =>
        momentsFrom(
          e,
          Array.from({ length: 120 }, () => Math.max(20, 185 + 90 * normal())),
        ),
      );
      if (leaderTest(groups).separable) fired++;
    }
    expect(fired).toBeLessThan(20);
  });
});

describe("ties and cuts (ADR 0272)", () => {
  it("calls floating-point noise a tie and printed-alike values not one", () => {
    // Measured on Tuzlu's shape: one stockout risk, three bit patterns.
    expect(sameValue(0.26844096449466426, 0.2684409644946637)).toBe(true);
    expect(sameValue(0.26844096449466426, 0.26844096449466437)).toBe(true);
    // 26.84% and 26.89% both print "27%" — they are not tied.
    expect(sameValue(0.2684, 0.2689)).toBe(false);
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue(null, 0)).toBe(false);
  });

  it("extends a cut through a tie group straddling it, and only then", () => {
    const rows = [
      ...Array.from({ length: 22 }, (_, i) => ({ p: 0.9 - i * 0.01 })),
      { p: 0.26844096449466426 },
      { p: 0.2684409644946637 },
      { p: 0.26844096449466437 },
      { p: 0.26844096449466415 },
      { p: 0.26844096449466381 },
      { p: 0.2 },
      { p: 0.1 },
    ];
    expect(cutKeepingTies(rows, 25, (r) => r.p)).toHaveLength(27);
    // No tie at the edge: a plain cut.
    expect(cutKeepingTies(rows, 22, (r) => r.p)).toHaveLength(22);
    // Printed-alike is not tied: 0.2689 after 0.2684 is not pulled in.
    const near = [{ p: 0.3 }, { p: 0.2689 }, { p: 0.2684 }];
    expect(cutKeepingTies(near, 2, (r) => r.p)).toHaveLength(2);
    expect(cutKeepingTies(rows, 0, (r) => r.p)).toHaveLength(0);
  });

  it("orders a stockout tie by the data, never by input order", () => {
    const rows = [
      {
        id: "3",
        name: "Suntory Toki",
        stockoutProbability: 0.2684,
        daysOfCover: 22.5,
        onHand: 0.93,
      },
      {
        id: "1",
        name: "Kulüp Rakı",
        stockoutProbability: 0.26840000000000003,
        daysOfCover: 22.5,
        onHand: 3.91,
      },
      {
        id: "2",
        name: "Cimarrón",
        stockoutProbability: 0.2684,
        daysOfCover: 22.5,
        onHand: 0.93,
      },
      {
        id: "4",
        name: "Beylerbeyi",
        stockoutProbability: 0.509,
        daysOfCover: 6.43,
        onHand: 2,
      },
      {
        id: "5",
        name: "Unmeasured",
        stockoutProbability: 0.2684,
        daysOfCover: null,
        onHand: 0,
      },
    ];
    const order = (xs: typeof rows) =>
      [...xs].sort(byStockoutRisk).map((r) => r.name);
    const expected = [
      "Beylerbeyi",
      "Cimarrón",
      "Suntory Toki",
      "Kulüp Rakı",
      "Unmeasured",
    ];
    expect(order(rows)).toEqual(expected);
    expect(order([...rows].reverse())).toEqual(expected);
  });
});

describe("correlationSignificance (ADR 0272)", () => {
  it("uses Fisher's z and corrects for the attributes looked at", () => {
    const one = correlationSignificance(0.45, 24, 1)!;
    approx(one.z, Math.atanh(0.45) * Math.sqrt(21), 1e-9);
    expect(one.p).toBeLessThan(0.05);
    // The strongest of four looked at: r = 0.45 over 24 tables no longer clears.
    const four = correlationSignificance(0.45, 24, 4)!;
    expect(four.pAdjusted).toBeGreaterThan(0.05);
    expect(correlationSignificance(0.9, 3)).toBeNull();
  });
});
