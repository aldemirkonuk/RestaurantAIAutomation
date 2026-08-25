import {
  admissiblePoints,
  analyzePricing,
  estimateElasticity,
  priceForMargin,
  PRICING_ENGINE_VERSION,
  type PricePoint,
} from "./pricing-agility";

/**
 * The assertions that matter here are the refusals.
 *
 * A pricing engine that always produces a number is easy to write and
 * impossible to trust — the failure mode is a confident recommendation
 * computed from one data point, which looks identical in the UI to one
 * computed from a year of sales. So most of these tests check that the engine
 * declines, clamps, or downgrades confidence, rather than checking arithmetic
 * that ./finance already has its own tests for.
 */

describe("admissiblePoints — endogeneity guard", () => {
  const history: PricePoint[] = [
    { price: 40, quantity: 20, source: "manual" },
    { price: 45, quantity: 16, source: "import" },
    { price: 50, quantity: 10, source: "agent_accepted" },
    { price: 38, quantity: 22, source: "backfill" },
  ];

  it("drops agent-set and backfilled points by default", () => {
    const kept = admissiblePoints(history);
    expect(kept.map((p) => p.price).sort()).toEqual([40, 45]);
  });

  it("keeps them only when explicitly asked", () => {
    expect(admissiblePoints(history, true)).toHaveLength(4);
  });

  it("drops non-positive prices and quantities regardless of source", () => {
    const kept = admissiblePoints([
      { price: 0, quantity: 5, source: "manual" },
      { price: 30, quantity: 0, source: "manual" },
      { price: 30, quantity: 5, source: "manual" },
    ]);
    expect(kept).toHaveLength(1);
  });
});

describe("estimateElasticity — estimator selection degrades honestly", () => {
  it("uses log-log regression with three or more distinct prices", () => {
    const est = estimateElasticity([
      { price: 40, quantity: 100, source: "manual" },
      { price: 50, quantity: 70, source: "manual" },
      { price: 60, quantity: 50, source: "manual" },
    ]);
    expect(est.method).toBe("loglog");
    expect(est.elasticity).toBeLessThan(0);
    expect(est.observationCount).toBe(3);
  });

  it("falls back to an arc estimate with exactly two price levels", () => {
    const est = estimateElasticity([
      { price: 40, quantity: 100, source: "manual" },
      { price: 50, quantity: 70, source: "manual" },
    ]);
    expect(est.method).toBe("midpoint");
    expect(est.confidence).toBeLessThan(0.5);
  });

  it("falls back to a category prior with a single price level, and says so", () => {
    const est = estimateElasticity([
      { price: 40, quantity: 100, source: "manual" },
      { price: 40, quantity: 96, source: "manual" },
    ]);
    expect(est.method).toBe("category_prior");
    expect(est.confidence).toBeLessThanOrEqual(0.1);
    expect(est.note).toMatch(/prior/i);
  });

  it("treats a history made entirely of agent-set prices as no history at all", () => {
    // The whole point of the guard: three distinct prices, but the model set
    // them all, so there is no exogenous variation to learn from.
    const est = estimateElasticity([
      { price: 40, quantity: 100, source: "agent_accepted" },
      { price: 50, quantity: 70, source: "agent_accepted" },
      { price: 60, quantity: 50, source: "agent_accepted" },
    ]);
    expect(est.method).toBe("category_prior");
    expect(est.observationCount).toBe(0);
  });

  it("caps confidence when three prices sit within a hair of each other", () => {
    const wide = estimateElasticity([
      { price: 30, quantity: 120, source: "manual" },
      { price: 45, quantity: 80, source: "manual" },
      { price: 60, quantity: 40, source: "manual" },
    ]);
    const narrow = estimateElasticity([
      { price: 50.0, quantity: 80, source: "manual" },
      { price: 50.2, quantity: 79, source: "manual" },
      { price: 50.4, quantity: 78, source: "manual" },
    ]);
    expect(narrow.confidence).toBeLessThan(wide.confidence);
  });
});

describe("priceForMargin", () => {
  it("solves for the price that hits a target margin", () => {
    // cost 30 at 70% margin -> 30 / 0.3 = 100
    expect(priceForMargin(30, 0.7)).toBeCloseTo(100, 6);
  });

  it("refuses impossible targets", () => {
    expect(priceForMargin(30, 1)).toBeNull();
    expect(priceForMargin(30, 1.2)).toBeNull();
    expect(priceForMargin(0, 0.7)).toBeNull();
  });
});

describe("analyzePricing — margin health", () => {
  it("flags critical when margin is below the floor", () => {
    // cost 60, price 100 -> 40% margin, floor 65%
    const out = analyzePricing({
      currentPrice: 100,
      unitCost: 60,
      marginFloorPct: 0.65,
    });
    expect(out.marginFlagged).toBe(true);
    expect(out.flagSeverity).toBe("critical");
    expect(out.currentMarginPct).toBeCloseTo(0.4, 6);
  });

  it("flags warning inside the band above the floor", () => {
    // cost 33, price 100 -> 67% margin, floor 65% -> within 5pt band
    const out = analyzePricing({
      currentPrice: 100,
      unitCost: 33,
      marginFloorPct: 0.65,
    });
    expect(out.marginFlagged).toBe(true);
    expect(out.flagSeverity).toBe("warning");
  });

  it("does not flag a comfortably healthy margin", () => {
    const out = analyzePricing({
      currentPrice: 100,
      unitCost: 20,
      marginFloorPct: 0.65,
    });
    expect(out.marginFlagged).toBe(false);
    expect(out.flagSeverity).toBeNull();
  });

  it("refuses to analyse without both price and cost, and does not report health", () => {
    // The dangerous alternative is treating missing cost as zero cost, which
    // renders a 100% margin and a green badge on an item nobody has costed.
    const out = analyzePricing({
      currentPrice: 100,
      unitCost: 0,
      marginFloorPct: 0.65,
    });
    expect(out.currentMarginPct).toBeNull();
    expect(out.marginFlagged).toBe(false);
    expect(out.recommendedPrice).toBeNull();
    expect(out.notes.join(" ")).toMatch(/positive menu price and unit cost/i);
  });
});

describe("analyzePricing — recommendation discipline", () => {
  const elasticHistory: PricePoint[] = [
    { price: 80, quantity: 100, source: "manual" },
    { price: 90, quantity: 70, source: "manual" },
    { price: 100, quantity: 45, source: "manual" },
  ];

  it("never recommends a price below the margin floor", () => {
    const out = analyzePricing({
      currentPrice: 100,
      unitCost: 50,
      history: elasticHistory,
      marginFloorPct: 0.65,
      maxMovePct: 1, // disable the step clamp so the floor is the binding one
    });
    if (out.recommendedPrice !== null) {
      const floor = priceForMargin(50, 0.65)!;
      expect(out.recommendedPrice).toBeGreaterThanOrEqual(floor - 0.01);
    }
  });

  it("clamps a single step to maxMovePct and says it clamped", () => {
    const out = analyzePricing({
      currentPrice: 100,
      unitCost: 90, // forces a large upward correction to clear the floor
      history: elasticHistory,
      marginFloorPct: 0.65,
      maxMovePct: 0.1,
    });
    expect(out.recommendedPrice).not.toBeNull();
    expect(out.recommendedPrice!).toBeLessThanOrEqual(110.01);
    expect(out.notes.join(" ")).toMatch(/limited to 10%/i);
  });

  it("returns no recommendation when demand is inelastic and margin already clears the floor", () => {
    // Inelastic prior means the Lerner optimum is unbounded; with a healthy
    // margin there is nothing defensible to say.
    const out = analyzePricing({
      currentPrice: 100,
      unitCost: 20,
      marginFloorPct: 0.65,
      categoryPriorElasticity: -0.5,
    });
    expect(out.recommendedPrice).toBeNull();
    expect(out.notes.join(" ")).toMatch(/no price change recommended/i);
  });

  it("still recommends a floor-clearing price when demand is inelastic but margin is broken", () => {
    const out = analyzePricing({
      currentPrice: 100,
      unitCost: 80,
      marginFloorPct: 0.65,
      categoryPriorElasticity: -0.5,
      maxMovePct: 5,
    });
    expect(out.recommendedPrice).not.toBeNull();
    expect(out.notes.join(" ")).toMatch(/margin floor/i);
    expect(out.projectedMarginPct!).toBeGreaterThanOrEqual(0.649);
  });

  it("reports which points it excluded and why", () => {
    const out = analyzePricing({
      currentPrice: 100,
      unitCost: 50,
      history: [
        ...elasticHistory,
        { price: 105, quantity: 30, source: "agent_accepted" },
      ],
      marginFloorPct: 0.65,
    });
    expect(out.notes.join(" ")).toMatch(/excluded from estimation/i);
    expect(out.notes.join(" ")).toMatch(/its own decisions/i);
  });

  it("does not recommend a change when already at the recommended level", () => {
    const out = analyzePricing({
      currentPrice: 100,
      unitCost: 20,
      marginFloorPct: 0.65,
      categoryPriorElasticity: -0.5,
    });
    expect(out.recommendedPrice).toBeNull();
  });

  it("projects a revenue impact whenever it recommends a move", () => {
    const out = analyzePricing({
      currentPrice: 100,
      unitCost: 90,
      history: elasticHistory,
      marginFloorPct: 0.65,
      maxMovePct: 0.15,
    });
    expect(out.recommendedPrice).not.toBeNull();
    expect(out.projectedRevenuePct).not.toBeNull();
    expect(Number.isFinite(out.projectedRevenuePct!)).toBe(true);
  });

  it("stamps the engine version so a stored analysis stays interpretable", () => {
    const out = analyzePricing({
      currentPrice: 100,
      unitCost: 50,
      marginFloorPct: 0.65,
    });
    expect(out.engineVersion).toBe(PRICING_ENGINE_VERSION);
  });

  it("always explains itself — notes are never empty", () => {
    const out = analyzePricing({
      currentPrice: 100,
      unitCost: 50,
      marginFloorPct: 0.65,
    });
    expect(out.notes.length).toBeGreaterThan(0);
  });
});
