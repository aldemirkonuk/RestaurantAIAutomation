import { priceMove } from "./price-move";

const bottle = (cost: number | null) => ({ cost, unit: "bottle" });

describe("priceMove", () => {
  it.each([
    ["equal", bottle(10), bottle(10), { compared: true, moved: false, sentence: null }],
    ["below the threshold", bottle(10), bottle(10.9), { compared: true, moved: false, sentence: null }],
    ["exactly at the threshold is not over it", bottle(10), bottle(11), { compared: true, moved: false, sentence: null }],
    ["above, up", bottle(10), bottle(11.8), { compared: true, moved: true, sentence: "was 10.00, now 11.80, up 18 percent" }],
    ["above, down", bottle(10), bottle(8), { compared: true, moved: true, sentence: "was 10.00, now 8.00, down 20 percent" }],
  ])("%s", (_n, prev, next, want) => {
    expect(priceMove(prev, next)).toMatchObject(want);
  });

  it.each([
    ["no previous cost", null, bottle(11.8), "no_previous"],
    ["a previous cost that was never read", bottle(null), bottle(11.8), "no_previous"],
    ["no new price", bottle(10), bottle(null), "no_price"],
    ["a unit change (case against bottle)", bottle(10), { cost: 11.8, unit: "case" }, "unit_differs"],
    ["a unit that is not stated", { cost: 10, unit: null }, bottle(11.8), "unit_differs"],
    ["a previous cost of zero", bottle(0), bottle(5), "previous_is_zero"],
  ])("refuses to compare: %s", (_n, prev, next, reason) => {
    expect(priceMove(prev, next)).toEqual({ compared: false, reason });
  });

  it("uses the house threshold when given", () => {
    expect(priceMove(bottle(10), bottle(10.6), 5)).toMatchObject({ moved: true });
    expect(priceMove(bottle(10), bottle(10.6), 10)).toMatchObject({ moved: false });
  });

  it.each([
    [1.0, 1.1],
    [2.0, 2.2],
    [3.0, 3.3],
    [20, 22],
    [0.5, 0.45],
  ])("exactly at the threshold is not moved: %s to %s", (p, n) => {
    expect(priceMove(bottle(p), bottle(n))).toMatchObject({ compared: true, moved: false, sentence: null });
  });

  it("just past the threshold is moved", () => {
    expect(priceMove(bottle(1), bottle(1.1001))).toMatchObject({ moved: true });
  });

  it("speaks a per-unit cost to its stored precision", () => {
    const r = priceMove(bottle(0.0123), bottle(0.0150));
    expect(r).toMatchObject({ moved: true, sentence: "was 0.0123, now 0.015, up 22 percent" });
  });

  it("speaks one decimal near the threshold", () => {
    expect(priceMove(bottle(10), bottle(11.04))).toMatchObject({ sentence: "was 10.00, now 11.04, up 10.4 percent" });
  });

  it("never speaks a flagged move as exactly the threshold", () => {
    expect(priceMove(bottle(200), bottle(220.09))).toMatchObject({ moved: true, sentence: "was 200.00, now 220.09, up 10.04 percent" });
    expect(priceMove(bottle(100), bottle(110.04))).toMatchObject({ moved: true, sentence: "was 100.00, now 110.04, up 10.04 percent" });
    expect(priceMove(bottle(500), bottle(550.2))).toMatchObject({ moved: true, sentence: "was 500.00, now 550.20, up 10.04 percent" });
    expect(priceMove(bottle(100), bottle(89.96))).toMatchObject({ moved: true, sentence: "was 100.00, now 89.96, down 10.04 percent" });
  });

  it("moved agrees with integer cross-multiplication over many cent pairs", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 3000; i++) {
      const pc = 1 + Math.floor(rnd() * 5000);
      const nc = 1 + Math.floor(rnd() * 6000);
      const want = Math.abs(nc - pc) * 100 > 10 * pc;
      const r = priceMove(bottle(pc / 100), bottle(nc / 100));
      expect(r).toMatchObject({ compared: true, moved: want });
    }
  });
});

describe("perBottlePrinted + printedPriceMove (r108 g15)", () => {
  const { perBottlePrinted, printedPriceMove } = jest.requireActual("./price-move");
  it("divides the printed total by the bottles, case lines through qty x pack", () => {
    expect(perBottlePrinted({ line_total: 132, qty_bottles: 12 })).toMatchObject({ cents: 13200n, milliBottles: 12000n, value: 11 });
    expect(perBottlePrinted({ line_total: 132, qty_bottles: 0, qty: 1, pack_size: 12, uom: "case" })).toMatchObject({ value: 11 });
    expect(perBottlePrinted({ line_total: 100, qty_bottles: 3 })).toMatchObject({ value: 33.3333 });
  });
  it("says why it has no price", () => {
    expect(perBottlePrinted({ line_total: null, qty_bottles: 1 })).toBe("no_price");
    expect(perBottlePrinted({ line_total: 0, qty_bottles: 1 })).toBe("no_price");
    expect(perBottlePrinted({ line_total: 50, qty_bottles: 0, qty: 1, uom: "keg" })).toBe("unit_differs");
  });
  it("is exact at the threshold with thirds: 100.00/3 -> 110.00/3 is exactly 10 percent", () => {
    const a = perBottlePrinted({ line_total: 100, qty_bottles: 3 });
    const b = perBottlePrinted({ line_total: 110, qty_bottles: 3 });
    expect(printedPriceMove(a, b, 10)).toMatchObject({ compared: true, moved: false });
    const c = perBottlePrinted({ line_total: 110.01, qty_bottles: 3 });
    expect(printedPriceMove(a, c, 10)).toMatchObject({ moved: true });
  });
  it("stays exact past 2^53 (a 10-billion paper of 999,999 bottles)", () => {
    const a = perBottlePrinted({ line_total: 9999999999.99, qty_bottles: 999999.999 });
    const b = perBottlePrinted({ line_total: 9999999999.99, qty_bottles: 999999.999 });
    expect(printedPriceMove(a, b, 0)).toMatchObject({ moved: false });
  });
});
