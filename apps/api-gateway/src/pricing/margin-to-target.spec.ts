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

  it("price 50 (60 % margin), band 2 %: raise to 57.14, and the gap is said as a percent", () => {
    const a = adviseToTarget({ ...base, price: 50, bandPct: 2 });
    expect(a.state).toBe("raise");
    expect(a.advisedPrice).toBe(57.14);
    expect(a.currentMarginPct).toBeCloseTo(60, 6);
    // (50 - 57.142857) / 57.142857 = -12.5 %
    expect(a.gapPct).toBeCloseTo(-12.5, 6);
    expect(a.sentence).toMatch(/^Raise the bottle to 57\.14 \(now 50\.00, 12\.5% below it\)/);
  });

  it("price 100 (80 % margin), band 2: lower to 57.14 -- the target, not the engine's 86.67", () => {
    const a = adviseToTarget({ ...base, price: 100, bandPct: 2 });
    expect(a.state).toBe("lower");
    expect(a.advisedPrice).toBe(57.14);
  });

  it("price 60 is 5 % above 57.14: on target with a 5 % band; lower to 57.14 with a 0 % band -- never 'raise to 69'", () => {
    // "Close enough" is a PERCENT OF THE ADVISED PRICE (founder, 2026-09-21):
    // (60 - 57.142857) / 57.142857 = +5.0 %, so a 5 % band holds it.
    const hold = adviseToTarget({ ...base, price: 60, bandPct: 5 });
    expect(hold.state).toBe("on_target");
    expect(hold.advisedPrice).toBeNull();
    expect(hold.gapPct).toBeCloseTo(5, 6);
    expect(hold.sentence).toMatch(/^On target: 60\.00 is 5% above the advised 57\.14, within your 5%/);

    // The SAME wine the old margin-points band held with 2 (66.7 vs 65 is
    // 1.7 points) is advised under a 2 % band: the unit is the price now.
    expect(adviseToTarget({ ...base, price: 60, bandPct: 2 }).state).toBe("lower");

    const exact = adviseToTarget({ ...base, price: 60, bandPct: 0 });
    expect(exact.state).toBe("lower");
    expect(exact.advisedPrice).toBe(57.14);
  });

  it("differs from the dark profit-maximising engine on exactly the case that ruled it out", () => {
    // The engine, as it is, on the same wine: with no price history it assumes
    // elasticity -1.3 and aims at ~77 % margin, so it says RAISE.
    const engine = analyzePricing({ currentPrice: 60, unitCost: 20, marginFloorPct: 0.65 });
    expect(engine.recommendedPrice).not.toBeNull();
    expect(engine.recommendedPrice as number).toBeGreaterThan(60);
    const rule = adviseToTarget({ ...base, price: 60, bandPct: 0 });
    expect(rule.advisedPrice).toBeLessThan(60);
  });

  it("no target set: says so, never advises against a default", () => {
    const a = adviseToTarget({ ...base, price: 50, targetPct: null, bandPct: null });
    expect(a.state).toBe("no_target");
    expect(a.advisedPrice).toBeNull();
    expect(a.sentence).toMatch(/No target margin is set/);
  });

  it("a target without a band is not a target to advise against (no invented 'close enough')", () => {
    const a = adviseToTarget({ ...base, price: 50, bandPct: null });
    expect(a.state).toBe("no_target");
  });

  it("no recorded cost: 'cannot advise', never a healthy margin", () => {
    const a = adviseToTarget({ ...base, price: 50, unitCost: null, bandPct: 2 });
    expect(a.state).toBe("no_cost");
    expect(a.currentMarginPct).toBeNull();
    expect(a.advisedPrice).toBeNull();
    expect(a.sentence).toMatch(/Cannot advise: no recorded cost/);
  });

  it("a recorded cost of 0 is not priced to a margin (a free bottle has no target price)", () => {
    const a = adviseToTarget({ ...base, price: 50, unitCost: 0, bandPct: 2 });
    expect(a.state).toBe("no_cost");
  });

  it("no price: 'cannot advise'", () => {
    expect(adviseToTarget({ ...base, price: null, bandPct: 2 }).state).toBe("no_price");
    expect(adviseToTarget({ ...base, price: 0, bandPct: 2 }).state).toBe("no_price");
  });

  it("a band edge, in percent of the advised price: 5.41 % holds, 5.40 % advises", () => {
    // cost 37, target 65 %: advised = 37 / 0.35 = 105.714; price 100 is
    // (100 - 105.714) / 105.714 = -5.405 % from it.
    expect(adviseToTarget({ kind: "bottle", price: 100, unitCost: 37, targetPct: 65, bandPct: 5.41 }).state).toBe("on_target");
    expect(adviseToTarget({ kind: "bottle", price: 100, unitCost: 37, targetPct: 65, bandPct: 5.4 }).state).toBe("raise");
  });

  it("a glass waits for the house's pour: pour_unconfirmed, no price, no margin claimed", () => {
    const a = adviseToTarget({ kind: "glass", price: 18, unitCost: 6, targetPct: 75, bandPct: 1, pourConfirmed: false });
    expect(a.state).toBe("pour_unconfirmed");
    expect(a.advisedPrice).toBeNull();
    expect(a.currentMarginPct).toBeNull();
    expect(a.sentence).toMatch(/waits until the house confirms its pour size/);
  });

  it("the pour gate is glass-only: a bottle with pourConfirmed false is still advised", () => {
    const a = adviseToTarget({ ...base, price: 50, bandPct: 2, pourConfirmed: false });
    expect(a.state).toBe("raise");
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
      bandPct: 1,
    });
    expect(a.state).toBe("raise");
    expect(a.advisedPrice).toBe(24);
  });
});
