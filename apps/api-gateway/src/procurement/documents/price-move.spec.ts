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
});
