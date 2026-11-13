import { amountIn } from "./goods-words";

/**
 * amountIn says a stock figure as the inventory list's fmtQty does
 * (apps/web/src/pages/inventory/next/ItemCards.tsx), so the dashboard's
 * Lately never reads "2000 g" beside a list that reads "2 kg" (r17 walk).
 */
describe("amountIn", () => {
  it.each([
    [2000, "g", "2 kg"],
    [1750, "g", "1.75 kg"],
    [1755, "g", "1.755 kg"],
    [999, "g", "999 g"],
    [1000, "g", "1 kg"],
    [1500, "ml", "1.5 l"],
    [330, "ml", "330 ml"],
    [2500, "mg", "2.5 g"],
    [12400, "G", "12.4 kg"],
    [-1500, "g", "-1.5 kg"],
    [0, "g", "0 g"],
  ])("%d %s reads %s", (n, uom, words) => {
    expect(amountIn(n, uom)).toBe(words);
  });

  it("a good kept each is a bare count, as the list shows it", () => {
    expect(amountIn(40, "each")).toBe("40");
    expect(amountIn(1, "each")).toBe("1");
  });

  it("counted goods keep their word, and a row with no unit is in bottles", () => {
    expect(amountIn(1, "bottle")).toBe("1 bottle");
    expect(amountIn(12, "bottle")).toBe("12 bottles");
    expect(amountIn(3, "pack")).toBe("3 packs");
    expect(amountIn(6, null)).toBe("6 bottles");
    expect(amountIn(1250, "bottle")).toBe("1,250 bottles");
  });

  it("a unit it does not know is said as written, never scaled", () => {
    expect(amountIn(2000, "tray")).toBe("2,000 tray");
  });
});
