import { adviseToTarget, glassCostFrom } from "./margin-to-target";
import { analyzePricing } from "../analytics/engine/pricing-agility";

/**
 * ADR 0193 -- the founder picked "Advise to target margin". The judge's three
 * worked cases (price-judge.md K1): cost 20, target 65 %, so the target price
 * is 20 / 0.35 = 57.142857 -> 57.14. The profit-maximising engine
 * (`analyzePricing`) answers 69 / 57.50 / 86.67 for the same three wines; the
 * founder's rule answers 57.14 every time, and the first of those three is the
 * reason the engine was not wired: it tells a manager to RAISE a wine that
 * already meets his target.
 */
describe("adviseToTarget — price = cost / (1 - target), the house's own target", () => {
  const base = { kind: "bottle" as const, unitCost: 20, targetPct: 65 };

  it("price 50 (60 % margin), band 2: raise to 57.14", () => {
    const a = adviseToTarget({ ...base, price: 50, bandPts: 2 });
    expect(a.state).toBe("raise");
    expect(a.advisedPrice).toBe(57.14);
    expect(a.currentMarginPct).toBeCloseTo(60, 6);
    expect(a.sentence).toMatch(/^Raise the bottle to 57\.14 \(now 50\.00\)/);
  });

  it("price 100 (80 % margin), band 2: lower to 57.14 -- the target, not the engine's 86.67", () => {
    const a = adviseToTarget({ ...base, price: 100, bandPts: 2 });
    expect(a.state).toBe("lower");
    expect(a.advisedPrice).toBe(57.14);
  });

  it("price 60 (66.7 % margin): on target with a 2-point band; lower to 57.14 with a 0-point band -- never 'raise to 69'", () => {
    const hold = adviseToTarget({ ...base, price: 60, bandPts: 2 });
    expect(hold.state).toBe("on_target");
    expect(hold.advisedPrice).toBeNull();

    const exact = adviseToTarget({ ...base, price: 60, bandPts: 0 });
    expect(exact.state).toBe("lower");
    expect(exact.advisedPrice).toBe(57.14);
  });

  it("differs from the dark profit-maximising engine on exactly the case that ruled it out", () => {
    // The engine, as it is, on the same wine: with no price history it assumes
    // elasticity -1.3 and aims at ~77 % margin, so it says RAISE.
    const engine = analyzePricing({ currentPrice: 60, unitCost: 20, marginFloorPct: 0.65 });
    expect(engine.recommendedPrice).not.toBeNull();
    expect(engine.recommendedPrice as number).toBeGreaterThan(60);
    const rule = adviseToTarget({ ...base, price: 60, bandPts: 0 });
    expect(rule.advisedPrice).toBeLessThan(60);
  });

  it("no target set: says so, never advises against a default", () => {
    const a = adviseToTarget({ ...base, price: 50, targetPct: null, bandPts: null });
    expect(a.state).toBe("no_target");
    expect(a.advisedPrice).toBeNull();
    expect(a.sentence).toMatch(/No target margin is set/);
  });

  it("a target without a band is not a target to advise against (no invented 'close enough')", () => {
    const a = adviseToTarget({ ...base, price: 50, bandPts: null });
    expect(a.state).toBe("no_target");
  });

  it("no recorded cost: 'cannot advise', never a healthy margin", () => {
    const a = adviseToTarget({ ...base, price: 50, unitCost: null, bandPts: 2 });
    expect(a.state).toBe("no_cost");
    expect(a.currentMarginPct).toBeNull();
    expect(a.advisedPrice).toBeNull();
    expect(a.sentence).toMatch(/Cannot advise: no recorded cost/);
  });

  it("a recorded cost of 0 is not priced to a margin (a free bottle has no target price)", () => {
    const a = adviseToTarget({ ...base, price: 50, unitCost: 0, bandPts: 2 });
    expect(a.state).toBe("no_cost");
  });

  it("no price: 'cannot advise'", () => {
    expect(adviseToTarget({ ...base, price: null, bandPts: 2 }).state).toBe("no_price");
    expect(adviseToTarget({ ...base, price: 0, bandPts: 2 }).state).toBe("no_price");
  });

  it("a band edge: 63 % against 65 % with a 2-point band holds; with 1.99 it advises", () => {
    // cost 37 at price 100 = 63 % margin.
    expect(adviseToTarget({ kind: "bottle", price: 100, unitCost: 37, targetPct: 65, bandPts: 2 }).state).toBe("on_target");
    expect(adviseToTarget({ kind: "bottle", price: 100, unitCost: 37, targetPct: 65, bandPts: 1.99 }).state).toBe("raise");
  });
});

describe("glassCostFrom — a pour's share of the bottle", () => {
  it("bottle cost x pour ml / bottle ml", () => {
    expect(glassCostFrom(30, 150, 750)).toBeCloseTo(6, 10);
  });
  it("unknown when any of the three is missing or not positive", () => {
    expect(glassCostFrom(null, 150, 750)).toBeNull();
    expect(glassCostFrom(30, null, 750)).toBeNull();
    expect(glassCostFrom(30, 150, null)).toBeNull();
    expect(glassCostFrom(30, 0, 750)).toBeNull();
    expect(glassCostFrom(30, 150, 0)).toBeNull();
  });
  it("a glass advice uses the pour's cost: 6.00 at a 75 % target is 24.00", () => {
    const a = adviseToTarget({
      kind: "glass",
      price: 18,
      unitCost: glassCostFrom(30, 150, 750),
      targetPct: 75,
      bandPts: 1,
    });
    expect(a.state).toBe("raise");
    expect(a.advisedPrice).toBe(24);
  });
});
