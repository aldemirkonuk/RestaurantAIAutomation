import * as F from "./finance";

const approx = (a: number | null, b: number, tol = 1e-4) => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as number) - b)).toBeLessThan(tol);
};

describe("finance engine", () => {
  it("pctChange & cagr", () => {
    approx(F.pctChange(100, 125), 0.25);
    expect(F.pctChange(0, 5)).toBeNull();
    approx(F.cagr(100, 200, 2), Math.sqrt(2) - 1);
    expect(F.cagr(-1, 2, 2)).toBeNull();
  });

  it("compoundGrowthRate geometric", () => {
    approx(F.compoundGrowthRate([100, 110, 121]), 0.1);
  });

  it("presentValue / futureValue inverse", () => {
    approx(F.presentValue(110, 0.1, 1), 100);
    approx(F.futureValue(100, 0.1, 1), 110);
  });

  it("npv basic", () => {
    // -100 now, +110 next period at 10% → NPV 0
    approx(F.npv(0.1, [-100, 110]), 0);
  });

  it("irr recovers known rate", () => {
    approx(F.irr([-100, 110]), 0.1, 1e-5);
    approx(F.irr([-1000, 500, 500, 500]), 0.2337, 1e-3);
    expect(F.irr([100, 200])).toBeNull(); // no sign change
  });

  it("xirr with dated flows", () => {
    const r = F.xirr([
      { amount: -1000, date: new Date("2024-01-01") },
      { amount: 1100, date: new Date("2025-01-01") },
    ]);
    approx(r, 0.1, 1e-3);
  });

  it("paybackPeriod interpolates", () => {
    approx(F.paybackPeriod(100, [40, 40, 40]), 2.5);
    expect(F.paybackPeriod(100, [10, 10])).toBeNull();
  });

  it("markup / margin conversions", () => {
    approx(F.markup(10, 30), 2); // 200% markup
    approx(F.grossMargin(10, 30), 2 / 3);
    approx(F.markupToMargin(2), 2 / 3);
    approx(F.marginToMarkup(2 / 3), 2);
  });

  it("cogs / prime cost ratios", () => {
    approx(F.cogsRatio(30, 100), 0.3);
    approx(F.primeCostRatio(30, 32, 100), 0.62);
  });

  it("contribution margin & break-even", () => {
    approx(F.contributionMargin(30, 10), 20);
    approx(F.contributionMarginRatio(30, 10), 2 / 3);
    approx(F.breakEvenUnits(1000, 30, 10), 50);
    approx(F.breakEvenRevenue(1000, 30, 10), 1500);
    expect(F.breakEvenUnits(1000, 10, 10)).toBeNull();
  });

  it("landedCost sums components", () => {
    approx(
      F.landedCost({ invoice: 10, freight: 1, duty: 0.5, storage: 0.25 }),
      11.75,
    );
  });

  it("working capital: DPO, CCC, early-pay APR", () => {
    approx(F.daysPayableOutstanding(50, 365, 365), 50);
    approx(F.cashConversionCycle(40, 0, 50), -10);
    // 2/10 net 30 → ~37.2% APR
    approx(F.earlyPaymentDiscountApr(0.02, 20), 0.3724, 1e-3);
  });

  it("price elasticity arc & log-log", () => {
    // price 10→12 (+~18%), qty 100→80 (-~22%): elastic, negative
    const e = F.priceElasticityArc(10, 100, 12, 80);
    expect(e).not.toBeNull();
    expect(e as number).toBeLessThan(0);
    // constant elasticity data: Q = 1000 * P^-2
    const prices = [10, 20, 40];
    const qty = prices.map((p) => 1000 * Math.pow(p, -2));
    approx(F.priceElasticityLogLog(prices, qty), -2, 1e-6);
  });

  it("optimalPriceFromElasticity (Lerner)", () => {
    // E=-2, MC=10 → P* = 10 * (-2/-1) = 20
    approx(F.optimalPriceFromElasticity(10, -2), 20);
    expect(F.optimalPriceFromElasticity(10, -0.5)).toBeNull();
  });

  it("priceChangeImpact projects revenue", () => {
    const r = F.priceChangeImpact(10, 100, 11, -0.5);
    expect(r).not.toBeNull();
    // Q1 = 100*(1.1)^-0.5 ≈ 95.35
    approx(r!.q1, 95.346, 1e-2);
    expect(r!.revenue1).toBeGreaterThan(r!.revenue0); // inelastic → revenue up
  });

  it("HHI, effective count, concentration ratio", () => {
    approx(F.herfindahlIndex([25, 25, 25, 25]), 0.25);
    approx(F.effectiveCount([25, 25, 25, 25]), 4);
    approx(F.herfindahlIndex([100]), 1); // monopoly
    approx(F.concentrationRatio([50, 30, 15, 5], 2), 0.8);
  });

  it("weightedAverageCost & fifoValuation", () => {
    approx(
      F.weightedAverageCost([
        { qty: 10, unitCost: 5 },
        { qty: 30, unitCost: 9 },
      ]),
      8,
    );
    // lots 10@5 then 30@9, consume 15 → remaining 25 all @9 = 225
    const fifo = F.fifoValuation(
      [
        { qty: 10, unitCost: 5 },
        { qty: 30, unitCost: 9 },
      ],
      15,
    );
    expect(fifo.remainingQty).toBe(25);
    approx(fifo.value, 225);
  });
});
