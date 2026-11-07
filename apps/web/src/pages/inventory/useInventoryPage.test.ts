/**
 * The inventory price and margin sorts rank only figures the house set.
 *
 * Before 2026-11-07 a wine with no menu price was given one -- three times
 * its cost, from a local helper -- and ranked on the margin that produced, so
 * an unpriced bottle with a high cost sat in the middle of a margin sort as
 * if it earned ~67%. A wine with no price has no margin: it sorts last in
 * both directions (ADR 0020: an unknown stays null; ADR 0104: no invented
 * figure on a screen). The house's price is `menuPriceBottle` (ADR 0193),
 * never the library's figure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const rows: Record<string, unknown>[] = [];
const wines: Record<string, unknown>[] = [];

vi.mock("../../hooks/useInventoryData", () => ({
  useInventoryData: () => ({
    inventory: rows,
    summary: null,
    lowStockItems: [],
    isLoading: false,
    error: null,
    summaryError: null,
    lowStockError: null,
    isPending: false,
    refetch: vi.fn(),
    updateItem: vi.fn(),
  }),
}));

vi.mock("../../hooks/queries", () => ({
  useWinesByIds: () => ({ data: wines }),
}));

// The library rows are handed over already in UI shape.
vi.mock("../../lib/wine-library", () => ({
  mapApiWinesToUiWines: (w: unknown[]) => w,
}));

import { useInventoryPage, type SortField } from "./useInventoryPage";

function wine(id: string, name: string, cost: number, libraryMenuPrice?: number) {
  return {
    id,
    name,
    producer: "P",
    grape: "",
    type: "red",
    price: cost,
    menuPrice: libraryMenuPrice,
    threshold: 1,
    bottleSizeMl: 750,
  };
}

function row(id: string, wineId: string, houseBottlePrice?: number) {
  return {
    id,
    wineId,
    wineName: wineId,
    stockLive: 5,
    thresholdMin: 1,
    isActive: true,
    menuPriceBottle: houseBottlePrice,
  };
}

function seed() {
  rows.length = 0;
  wines.length = 0;
  // Unpriced and costly FIRST, so a tie would leave it first, never last.
  wines.push(wine("w-unpriced", "Unpriced", 100));
  // Cost 10, sold at 50: 80% margin.
  wines.push(wine("w-high", "High", 10, 50));
  // Cost 30, sold at 40: 25% margin.
  wines.push(wine("w-low", "Low", 30, 40));
  rows.push(row("r-unpriced", "w-unpriced"));
  rows.push(row("r-high", "w-high", 50));
  rows.push(row("r-low", "w-low", 40));
}

function order(field: SortField) {
  const { result } = renderHook(() => useInventoryPage());
  act(() => result.current.toggleSort(field));
  const asc = result.current.filteredInventory.map((i) => i.name);
  act(() => result.current.toggleSort(field));
  const desc = result.current.filteredInventory.map((i) => i.name);
  return { asc, desc };
}

describe("useInventoryPage sort: no invented menu price", () => {
  beforeEach(seed);

  it("ranks margin on real prices only; an unpriced wine is last both ways", () => {
    // origin/main gave Unpriced 100*3 = 300 and a 66.7% margin, between the
    // two real ones: asc Low, Unpriced, High / desc High, Unpriced, Low.
    const { asc, desc } = order("margin");
    expect(asc).toEqual(["Low", "High", "Unpriced"]);
    expect(desc).toEqual(["High", "Low", "Unpriced"]);
  });

  it("ranks menu price on real prices only; an unpriced wine is last both ways", () => {
    // origin/main gave Unpriced a 300 menu price, the highest of the three.
    const { asc, desc } = order("menuPrice");
    expect(asc).toEqual(["Low", "High", "Unpriced"]);
    expect(desc).toEqual(["High", "Low", "Unpriced"]);
  });

  it("does not rank on the library's menu figure when the house set none", () => {
    // The library carries a menuPrice the house never set (ADR 0193).
    wines[0] = wine("w-unpriced", "Unpriced", 100, 500);
    const { asc, desc } = order("margin");
    expect(asc[2]).toBe("Unpriced");
    expect(desc[2]).toBe("Unpriced");
  });

  it("keeps unpriced wines in their own order and an unknown cost has no margin", () => {
    // A second unpriced wine, and a priced wine whose cost is unknown (0, the
    // unresolved-row fallback) -- neither may rank as a 100% margin.
    wines.push(wine("w-unpriced-2", "Unpriced 2", 5));
    rows.push(row("r-unpriced-2", "w-unpriced-2"));
    wines.push(wine("w-nocost", "No cost", 0, 60));
    rows.push(row("r-nocost", "w-nocost", 60));
    const { asc, desc } = order("margin");
    expect(asc).toEqual(["Low", "High", "Unpriced", "Unpriced 2", "No cost"]);
    expect(desc).toEqual(["High", "Low", "Unpriced", "Unpriced 2", "No cost"]);
  });
});
