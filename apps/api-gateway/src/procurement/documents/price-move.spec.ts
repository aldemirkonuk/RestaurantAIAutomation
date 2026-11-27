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
