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
        leadTimeStdev: null,
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

  // THE PROPERTY THE WIRING EXISTS FOR. `leadTimeStdev` was optional and every
  // caller omitted it, so this relation held vacuously: every σ_LT produced
  // the same answer, because none of them were passed.
  it("safety stock is strictly monotone increasing in lead-time variance", () => {
    const base = {
      serviceLevel: 0.95,
      avgDemandPerPeriod: 20,
      demandStdev: 10,
      avgLeadTime: 4,
    };
    const sigmas = [0, 0.5, 1, 2, 4, 8];
    const ss = sigmas.map(
      (leadTimeStdev) => I.safetyStock({ ...base, leadTimeStdev })!,
    );
    for (const s of ss) expect(s).not.toBeNull();
    for (let k = 1; k < ss.length; k++)
      expect(ss[k]).toBeGreaterThan(ss[k - 1]);
    // σ_LT = 0 (measured as perfectly reliable) and σ_LT = null (never
    // measured) give the same NUMBER — which is exactly why the number alone
    // is not an answer, and why reorderPoint reports which one it was.
    approx(ss[0], I.safetyStock({ ...base, leadTimeStdev: null })!, 1e-12);
    expect(
      I.reorderPoint({ ...base, leadTimeStdev: 0 })!.leadTimeVarianceIncluded,
    ).toBe(true);
    expect(
      I.reorderPoint({ ...base, leadTimeStdev: null })!
        .leadTimeVarianceIncluded,
    ).toBe(false);
  });

  it("reorderPoint = lead-time demand + safety stock", () => {
    const r = I.reorderPoint({
      serviceLevel: 0.95,
      avgDemandPerPeriod: 20,
      demandStdev: 10,
      avgLeadTime: 4,
      leadTimeStdev: null,
    });
    approx(r!.leadTimeDemand, 80);
    approx(r!.reorderPoint, 80 + (r!.safetyStock as number));
  });

  // The regime the hardcoded 0.95 made unreachable: it pinned z at +1.645, so
  // safety stock could never go negative. A derived ratio can be below 0.5.
  describe("service level below 0.5 — z goes negative", () => {
    const demand = {
      avgDemandPerPeriod: 0.02,
      demandStdev: 0.02,
      avgLeadTime: 7,
      leadTimeStdev: 1,
    };

    it("returns a negative safety stock rather than flooring it", () => {
      const ss = I.safetyStock({ serviceLevel: 0.251, ...demand });
      expect(ss).not.toBeNull();
      expect(ss as number).toBeLessThan(0);
    });

    it("reorderPoint flags the regime instead of leaving a bare negative", () => {
      const r = I.reorderPoint({ serviceLevel: 0.251, ...demand })!;
      expect(r.z).toBeLessThan(0);
      expect(r.understockOptimal).toBe(true);
      expect(r.safetyStock).toBeLessThan(0);
      // Here |SS| < lead-time demand, so the reorder point survives positive.
      // The flag is what tells the caller which regime produced it.
      expect(r.reorderPoint).toBeGreaterThan(0);
    });

    it("the reorder point itself goes negative once |SS| exceeds lead-time demand", () => {
      // Erratic demand (CV 5) on the same thin-margin wine.
      const r = I.reorderPoint({
        serviceLevel: 0.251,
        avgDemandPerPeriod: 0.02,
        demandStdev: 0.1,
        avgLeadTime: 7,
        leadTimeStdev: 1,
      })!;
      expect(r.safetyStock).toBeLessThan(0);
      expect(r.reorderPoint).toBeLessThan(0);
      // `qty <= negativeReorderPoint` is false for every real on-hand
      // quantity — which is exactly how a SKU drops off a reorder list with
      // nothing on the row saying why. `understockOptimal` is that why.
      expect(0 <= r.reorderPoint).toBe(false);
      expect(5 <= r.reorderPoint).toBe(false);
      expect(r.understockOptimal).toBe(true);
    });

    it("z is positive and the flag is false above 0.5", () => {
      const r = I.reorderPoint({ serviceLevel: 0.95, ...demand })!;
      expect(r.z).toBeGreaterThan(0);
      expect(r.understockOptimal).toBe(false);
      expect(r.safetyStock).toBeGreaterThan(0);
    });

    it("the flag flips exactly at 0.5", () => {
      expect(
        I.reorderPoint({ serviceLevel: 0.499, ...demand })!.understockOptimal,
      ).toBe(true);
      expect(
        I.reorderPoint({ serviceLevel: 0.501, ...demand })!.understockOptimal,
      ).toBe(false);
    });

    it("the whole wired chain reaches it from real costs", () => {
      // $22 menu on a $20 bottle, moving 0.02/day, ordering cost $25.
      const annualDemand = 0.02 * 365;
      const eoq = I.eoq(annualDemand, 25, 20 * 0.26)!;
      const sl = I.serviceLevelFromCosts({
        unitPrice: 22,
        unitCost: 20,
        annualHoldingRate: 0.26,
        cycleDays: eoq.cycleTime * 365,
      });
      expect(sl.ok).toBe(true);
      if (!sl.ok) return;
      expect(sl.serviceLevel).toBeLessThan(0.5);
      const r = I.reorderPoint({ serviceLevel: sl.serviceLevel, ...demand })!;
      expect(r.understockOptimal).toBe(true);
    });
  });

  describe("input validation is symmetric", () => {
    const base = {
      serviceLevel: 0.95,
      avgDemandPerPeriod: 20,
      demandStdev: 10,
      avgLeadTime: 4,
      leadTimeStdev: 1,
    };

    it("rejects a negative demand stdev, as it always did for lead-time stdev", () => {
      // The formula squares it, so -1 used to sail through and return a
      // number. A negative standard deviation is a caller that has lost
      // track of its units, not a small input error.
      expect(I.safetyStock({ ...base, demandStdev: -1 })).toBeNull();
      expect(I.safetyStock({ ...base, leadTimeStdev: -1 })).toBeNull();
      expect(I.reorderPoint({ ...base, demandStdev: -1 })).toBeNull();
    });

    it("rejects negative demand and negative lead time", () => {
      expect(I.safetyStock({ ...base, avgDemandPerPeriod: -5 })).toBeNull();
      expect(I.safetyStock({ ...base, avgLeadTime: -3 })).toBeNull();
    });

    it("rejects NaN in any position", () => {
      for (const k of [
        "avgDemandPerPeriod",
        "demandStdev",
        "avgLeadTime",
        "leadTimeStdev",
      ] as const) {
        expect(I.safetyStock({ ...base, [k]: NaN })).toBeNull();
      }
    });

    it("still accepts a legitimate zero", () => {
      expect(I.safetyStock({ ...base, demandStdev: 0 })).not.toBeNull();
      expect(I.safetyStock({ ...base, leadTimeStdev: 0 })).not.toBeNull();
    });
  });

  describe("leadTimeProfile", () => {
    it("mean and sample stdev from observed durations", () => {
      const p = I.leadTimeProfile([2, 4, 4, 4, 5, 5, 7, 9]);
      approx(p!.meanDays, 5);
      approx(p!.stdevDays, Math.sqrt(32 / 7), 1e-9);
      expect(p!.n).toBe(8);
    });

    it("one observation gives a mean but NO stdev — null, not zero", () => {
      const p = I.leadTimeProfile([6]);
      approx(p!.meanDays, 6);
      expect(p!.stdevDays).toBeNull();
      expect(p!.n).toBe(1);
      expect(p!.stdevRelativeStandardError).toBeNull();
    });

    it("reports the sampling noise in its own stdev, and it shrinks with n", () => {
      // SE(sigma-hat)/sigma = 1/sqrt(2(n-1)).
      approx(I.leadTimeProfile([5, 9])!.stdevRelativeStandardError, 0.70711);
      approx(I.leadTimeProfile([5, 9, 7])!.stdevRelativeStandardError, 0.5);
      const errs = [2, 3, 5, 11, 51].map(
        (n) =>
          I.leadTimeProfile(Array.from({ length: n }, (_, k) => 5 + (k % 3)))!
            .stdevRelativeStandardError!,
      );
      for (let k = 1; k < errs.length; k++)
        expect(errs[k]).toBeLessThan(errs[k - 1]);
      // n = 2 is the only gate, and it is a definition, not a policy: a
      // sample stdev needs two points. Any cutoff above it is an unchosen
      // number, so the uncertainty is reported instead.
      approx(errs[3], 1 / Math.sqrt(2 * 10));
    });

    it("no observations is null, and junk is filtered out", () => {
      expect(I.leadTimeProfile([])).toBeNull();
      expect(I.leadTimeProfile([NaN, -3])).toBeNull();
      expect(I.leadTimeProfile([NaN, -3, 5, 7])!.n).toBe(2);
    });
  });

  describe("serviceLevelFromCosts — the critical ratio", () => {
    const base = {
      unitPrice: 60,
      unitCost: 20,
      annualHoldingRate: 0.26,
      cycleDays: 30,
    };

    it("computes Cu/(Cu+Co) from real costs", () => {
      const r = I.serviceLevelFromCosts(base);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // Cu = 60 - 20 = 40. Co = 20 * 0.26 * 30/365 = 0.427397...
      approx(r.underageCost, 40, 1e-9);
      approx(r.overageCost, (20 * 0.26 * 30) / 365, 1e-12);
      approx(r.serviceLevel, 40 / (40 + (20 * 0.26 * 30) / 365), 1e-12);
      // And it is emphatically NOT 0.95 — this SKU's real ratio is ~0.9894,
      // which is the whole point: 0.95 asserted Cu/Co = 19; the truth is ~94.
      expect(r.serviceLevel).toBeGreaterThan(0.98);
      approx(r.underageCost / r.overageCost, 93.6, 0.2);
    });

    it("a thin-margin, slow-turning SKU lands BELOW 0.95", () => {
      // Cu = $1.50, and a 400-day cycle on a $40 bottle → Co = $11.40.
      const r = I.serviceLevelFromCosts({
        unitPrice: 41.5,
        unitCost: 40,
        annualHoldingRate: 0.26,
        cycleDays: 400,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.serviceLevel).toBeLessThan(0.2);
    });

    it("rises with margin and falls with holding cost", () => {
      const cheapToHold = I.serviceLevelFromCosts({ ...base, cycleDays: 7 });
      const dearToHold = I.serviceLevelFromCosts({ ...base, cycleDays: 200 });
      const fatMargin = I.serviceLevelFromCosts({ ...base, unitPrice: 200 });
      expect(cheapToHold.ok && dearToHold.ok && fatMargin.ok).toBe(true);
      if (!cheapToHold.ok || !dearToHold.ok || !fatMargin.ok) return;
      expect(cheapToHold.serviceLevel).toBeGreaterThan(dearToHold.serviceLevel);
      expect(fatMargin.serviceLevel).toBeGreaterThan(
        (I.serviceLevelFromCosts(base) as I.ServiceLevelFromCosts).serviceLevel,
      );
    });

    it("refuses, with a reason, instead of substituting a constant", () => {
      const reason = (p: Partial<typeof base>) => {
        const r = I.serviceLevelFromCosts({ ...base, ...p });
        return r.ok ? null : r.reason;
      };
      expect(reason({ unitCost: null })).toBe("unit_cost_unknown");
      expect(reason({ unitPrice: null })).toBe("unit_price_unknown");
      // `menu_price_current` is coerced with `|| 0` upstream: 0 is absent.
      expect(reason({ unitPrice: 0 })).toBe("unit_price_unknown");
      expect(reason({ cycleDays: null })).toBe("cycle_length_unknown");
      // Price at or below cost — the newsvendor says order nothing.
      expect(reason({ unitPrice: 20 })).toBe("underage_not_positive");
      expect(reason({ unitPrice: 12 })).toBe("underage_not_positive");
      // A sample bottle is invoiced at exactly 0 (see inventory-cost.ts), so
      // Co = 0, CR = 1 and z = +infinity. Refused, not clamped.
      expect(reason({ unitCost: 0 })).toBe("overage_not_positive");
    });

    it("the derived ratio always yields a finite z", () => {
      for (const unitPrice of [21, 25, 60, 500, 10000]) {
        for (const cycleDays of [1, 30, 365, 3650]) {
          const r = I.serviceLevelFromCosts({ ...base, unitPrice, cycleDays });
          if (!r.ok) continue;
          expect(r.serviceLevel).toBeGreaterThan(0);
          expect(r.serviceLevel).toBeLessThan(1);
          const ss = I.safetyStock({
            serviceLevel: r.serviceLevel,
            avgDemandPerPeriod: 20,
            demandStdev: 10,
            avgLeadTime: 4,
            leadTimeStdev: 1,
          });
          expect(Number.isFinite(ss as number)).toBe(true);
        }
      }
    });

    it("the derived level moves safety stock off the 0.95 answer", () => {
      const demand = {
        avgDemandPerPeriod: 20,
        demandStdev: 10,
        avgLeadTime: 4,
        leadTimeStdev: 1.5,
      };
      const derived = I.serviceLevelFromCosts(base);
      expect(derived.ok).toBe(true);
      if (!derived.ok) return;
      const hardcoded = I.safetyStock({ serviceLevel: 0.95, ...demand })!;
      const real = I.safetyStock({
        serviceLevel: derived.serviceLevel,
        ...demand,
      })!;
      expect(real).not.toBeCloseTo(hardcoded, 3);
      // ~0.9894 > 0.95, so this SKU was being UNDER-protected.
      expect(real).toBeGreaterThan(hardcoded);
    });
  });

  describe("roundUpToPack", () => {
    it("rounds up to whole packs and reports the overshoot", () => {
      const r = I.roundUpToPack(17, 12);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.packs).toBe(2);
      expect(r.units).toBe(24);
      expect(r.overshoot).toBe(7);
      // 1.4 cases is 2 cases.
      const exact = I.roundUpToPack(24, 12);
      expect(exact.ok && exact.overshoot).toBe(0);
    });

    it("refuses an unknown pack size rather than assuming 1 or 12", () => {
      for (const bad of [null, 0, -3, 1.5, NaN]) {
        const r = I.roundUpToPack(17, bad as number | null);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe("pack_size_unknown");
      }
      const q = I.roundUpToPack(-1, 12);
      expect(q.ok).toBe(false);
      if (!q.ok) expect(q.reason).toBe("bad_quantity");
    });
  });

  describe("shelfLifeCap", () => {
    it("caps at what sells before it spoils", () => {
      const r = I.shelfLifeCap({
        proposedUnits: 100,
        avgDailyDemand: 2,
        shelfLifeDays: 30,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.cappedUnits).toBe(60);
      expect(r.capped).toBe(true);
    });

    it("leaves the quantity alone when it all sells in time", () => {
      const r = I.shelfLifeCap({
        proposedUnits: 40,
        avgDailyDemand: 2,
        shelfLifeDays: 30,
      });
      expect(r.ok && r.cappedUnits).toBe(40);
      expect(r.ok && r.capped).toBe(false);
    });

    it("refuses when shelf life is unknown — which is every row today", () => {
      const r = I.shelfLifeCap({
        proposedUnits: 100,
        avgDailyDemand: 2,
        shelfLifeDays: null,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("shelf_life_unknown");
    });
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
