import * as I from "./inventory-science";

const approx = (a: number | null, b: number, tol = 1e-3) => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as number) - b)).toBeLessThan(tol);
};

describe("inventory-science engine", () => {
  it("turnover, DIO, GMROI", () => {
    approx(I.inventoryTurnover(1000, 250), 4);
    approx(I.daysInventoryOutstanding(1000, 250, 365), 91.25);
    approx(I.gmroi(500, 250), 2);
    expect(I.inventoryTurnover(1000, 0)).toBeNull();
  });

  it("sell-through & carrying cost", () => {
    approx(I.sellThroughRate(30, 40), 0.75);
    approx(I.carryingCost(100, 0.26, 365), 26);
    approx(I.carryingCost(100, 0.26, 182.5), 13);
  });

  it("EOQ (Wilson) known value", () => {
    // D=1000, S=10, H=2 → Q* = sqrt(2*1000*10/2)=100
    const r = I.eoq(1000, 10, 2);
    approx(r!.eoq, 100);
    approx(r!.ordersPerPeriod, 10);
    // total cost at EOQ = ordering + holding, both = 100 → 200
    approx(r!.totalCost, 200);
    expect(I.eoq(0, 10, 2)).toBeNull();
  });

  it("safety stock: demand-only vs with lead-time variance", () => {
    // z(0.95)=1.6449, LT=4, sigma_d=10 → SS = 1.6449*sqrt(4)*10 = 32.897
    approx(
      I.safetyStock({
        serviceLevel: 0.95,
        avgDemandPerPeriod: 20,
        demandStdev: 10,
        avgLeadTime: 4,
      }),
      32.897,
      1e-2,
    );
    // adding lead-time variance increases SS
    const withLt = I.safetyStock({
      serviceLevel: 0.95,
      avgDemandPerPeriod: 20,
      demandStdev: 10,
      avgLeadTime: 4,
      leadTimeStdev: 1,
    });
    expect(withLt as number).toBeGreaterThan(32.897);
  });

  it("reorderPoint = lead-time demand + safety stock", () => {
    const r = I.reorderPoint({
      serviceLevel: 0.95,
      avgDemandPerPeriod: 20,
      demandStdev: 10,
      avgLeadTime: 4,
    });
    approx(r!.leadTimeDemand, 80);
    approx(r!.reorderPoint, 80 + (r!.safetyStock as number));
  });

  it("demandProfile computes mean/stdev/cv", () => {
    const p = I.demandProfile([2, 4, 4, 4, 5, 5, 7, 9]);
    approx(p!.mean, 5);
    approx(p!.cv, Math.sqrt(32 / 7) / 5, 1e-6);
  });

  it("stockoutProbability decreases with more on-hand", () => {
    const low = I.stockoutProbability({
      onHand: 80,
      avgDemandPerPeriod: 20,
      demandStdev: 10,
      leadTime: 4,
    });
    // onHand == mean lead-time demand (80) → P ≈ 0.5
    approx(low, 0.5, 1e-2);
    const high = I.stockoutProbability({
      onHand: 120,
      avgDemandPerPeriod: 20,
      demandStdev: 10,
      leadTime: 4,
    });
    expect(high as number).toBeLessThan(low as number);
  });

  it("daysOfCover", () => {
    approx(I.daysOfCover(100, 5), 20);
    expect(I.daysOfCover(100, 0)).toBeNull();
  });

  it("fillRate is a probability in [0,1]", () => {
    const fr = I.fillRate({
      reorderPoint: 100,
      avgLeadTimeDemand: 80,
      leadTimeDemandStdev: 20,
      demandPerCycle: 80,
    });
    expect(fr).not.toBeNull();
    expect(fr as number).toBeGreaterThan(0.9);
    expect(fr as number).toBeLessThanOrEqual(1);
  });

  it("newsvendorOrder critical fractile", () => {
    // price 50, cost 20, salvage 5 → Cu=30, Co=15, CR=30/45=0.667
    const r = I.newsvendorOrder({
      price: 50,
      cost: 20,
      salvage: 5,
      demandMean: 100,
      demandStdev: 20,
    });
    approx(r!.criticalRatio, 2 / 3);
    expect(r!.z).toBeGreaterThan(0); // CR>0.5 → order above mean
    expect(r!.optimalQuantity).toBeGreaterThan(100);
  });

  it("abcClassify buckets by cumulative value", () => {
    const res = I.abcClassify([
      { item: "a", value: 80 },
      { item: "b", value: 15 },
      { item: "c", value: 5 },
    ]);
    // sorted desc; cumulative 0.8→A, 0.95→B, 1.0→C
    const cls = Object.fromEntries(res.map((r) => [r.item, r.class]));
    expect(cls.a).toBe("A");
    expect(cls.b).toBe("B");
    expect(cls.c).toBe("C");
  });

  it("xyzClassify by CV", () => {
    expect(I.xyzClassify(0.3)).toBe("X");
    expect(I.xyzClassify(0.8)).toBe("Y");
    expect(I.xyzClassify(1.5)).toBe("Z");
    expect(I.xyzClassify(null)).toBe("unknown");
  });
});
