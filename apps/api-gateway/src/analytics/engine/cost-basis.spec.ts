import {
  costBasis,
  costDrift,
  latestLotCost,
  liveLots,
  weightedAverageCostBasis,
  type CostLot,
} from "./cost-basis";

/**
 * The interesting cases are all about missing data.
 *
 * A cost-basis function that returns a number no matter what is the direct
 * cause of a green margin badge on an item nobody has costed: absent cost
 * silently becomes zero, margin computes as 100%, and the item that most needs
 * attention looks like the healthiest on the list. Every test below that
 * expects `null` is guarding that path.
 */

const lot = (over: Partial<CostLot> = {}): CostLot => ({
  unitCost: 10,
  qty: 5,
  receivedAt: "2026-01-01T00:00:00Z",
  status: "open",
  ...over,
});

describe("liveLots", () => {
  it("keeps lots with no status — absent is not the same as depleted", () => {
    expect(liveLots([lot({ status: null })])).toHaveLength(1);
  });

  it("drops depleted and zero-quantity lots", () => {
    const lots = [
      lot({ status: "depleted" }),
      lot({ qty: 0 }),
      lot({ qty: null }),
      lot(),
    ];
    expect(liveLots(lots)).toHaveLength(1);
  });
});

describe("latestLotCost — replacement cost", () => {
  it("takes the most recently received costed lot", () => {
    const r = latestLotCost([
      lot({ unitCost: 10, receivedAt: "2026-01-01T00:00:00Z" }),
      lot({ unitCost: 18, receivedAt: "2026-06-01T00:00:00Z" }),
      lot({ unitCost: 14, receivedAt: "2026-03-01T00:00:00Z" }),
    ]);
    expect(r.cost).toBe(18);
    expect(r.method).toBe("latest_lot");
  });

  it("skips uncosted lots rather than treating them as free", () => {
    // The newest lot has no cost. Falling through to the next costed lot is
    // right; returning 0 or null here would either invent a 100% margin or
    // lose a cost basis that plainly exists.
    const r = latestLotCost([
      lot({ unitCost: 12, receivedAt: "2026-01-01T00:00:00Z" }),
      lot({ unitCost: null, receivedAt: "2026-06-01T00:00:00Z" }),
    ]);
    expect(r.cost).toBe(12);
    expect(r.note).toMatch(/no cost recorded/i);
  });

  it("returns null when nothing on hand has a cost", () => {
    const r = latestLotCost([lot({ unitCost: null }), lot({ unitCost: null })]);
    expect(r.cost).toBeNull();
    expect(r.coverage).toBe(0);
  });

  it("returns null with no live lots at all", () => {
    const r = latestLotCost([lot({ status: "depleted" })]);
    expect(r.cost).toBeNull();
    expect(r.lotsTotal).toBe(0);
    expect(r.coverage).toBeNull();
  });

  it("ignores a zero or negative unit cost", () => {
    const r = latestLotCost([
      lot({ unitCost: 15, receivedAt: "2026-01-01T00:00:00Z" }),
      lot({ unitCost: 0, receivedAt: "2026-06-01T00:00:00Z" }),
      lot({ unitCost: -3, receivedAt: "2026-07-01T00:00:00Z" }),
    ]);
    expect(r.cost).toBe(15);
  });
});

describe("weightedAverageCostBasis — COGS-aligned", () => {
  it("weights by quantity, not by lot count", () => {
    // 1 unit at 30 and 9 units at 10 averages to 12, not 20.
    const r = weightedAverageCostBasis([
      lot({ unitCost: 30, qty: 1 }),
      lot({ unitCost: 10, qty: 9 }),
    ]);
    expect(r.cost).toBeCloseTo(12, 6);
    expect(r.lotsUsed).toBe(2);
  });

  it("reports partial coverage instead of quietly averaging a subset", () => {
    const r = weightedAverageCostBasis([
      lot({ unitCost: 10, qty: 5 }),
      lot({ unitCost: null, qty: 15 }),
    ]);
    expect(r.cost).toBe(10);
    expect(r.coverage).toBeCloseTo(0.25, 6);
    expect(r.note).toMatch(/25% of units/);
    expect(r.note).toMatch(/not assumed free/i);
  });

  it("returns null when no live lot carries a cost", () => {
    const r = weightedAverageCostBasis([lot({ unitCost: null })]);
    expect(r.cost).toBeNull();
  });
});

describe("costBasis dispatch", () => {
  const lots = [
    lot({ unitCost: 10, qty: 9, receivedAt: "2026-01-01T00:00:00Z" }),
    lot({ unitCost: 30, qty: 1, receivedAt: "2026-06-01T00:00:00Z" }),
  ];

  it("returns different numbers for the two methods, as intended", () => {
    const latest = costBasis(lots, "latest_lot").cost;
    const wavg = costBasis(lots, "weighted_average").cost;
    expect(latest).toBe(30);
    expect(wavg).toBeCloseTo(12, 6);
    expect(latest).not.toBe(wavg);
  });
});

describe("costDrift — the gap is the signal", () => {
  it("reports replacement cost above the held average", () => {
    const d = costDrift([
      lot({ unitCost: 10, qty: 9, receivedAt: "2026-01-01T00:00:00Z" }),
      lot({ unitCost: 30, qty: 1, receivedAt: "2026-06-01T00:00:00Z" }),
    ]);
    expect(d.latest).toBe(30);
    expect(d.weightedAverage).toBeCloseTo(12, 6);
    expect(d.absolute).toBeCloseTo(18, 6);
    expect(d.relative).toBeCloseTo(1.5, 6);
    expect(d.note).toMatch(/thinner than the reported figure/i);
  });

  it("reports replacement cost below the held average", () => {
    const d = costDrift([
      lot({ unitCost: 30, qty: 9, receivedAt: "2026-01-01T00:00:00Z" }),
      lot({ unitCost: 10, qty: 1, receivedAt: "2026-06-01T00:00:00Z" }),
    ]);
    expect(d.relative!).toBeLessThan(0);
    expect(d.note).toMatch(/better than reported/i);
  });

  it("says so plainly when the two bases agree", () => {
    const d = costDrift([
      lot({ unitCost: 20, qty: 4, receivedAt: "2026-01-01T00:00:00Z" }),
      lot({ unitCost: 20, qty: 6, receivedAt: "2026-06-01T00:00:00Z" }),
    ]);
    expect(d.absolute).toBeCloseTo(0, 6);
    expect(d.note).toMatch(/matches the average/i);
  });

  it("refuses to compute a drift it cannot support", () => {
    const d = costDrift([lot({ unitCost: null })]);
    expect(d.absolute).toBeNull();
    expect(d.relative).toBeNull();
    expect(d.note).toMatch(/not enough cost data/i);
  });
});
