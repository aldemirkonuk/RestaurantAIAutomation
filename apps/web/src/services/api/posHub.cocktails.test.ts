import { describe, it, expect, vi, beforeEach } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("./client", () => ({
  apiClient: { get },
  getActiveRestaurantId: () => "r1",
}));

import { listHouseCocktails } from "./posHub";

/**
 * F-1507: the cocktail list carries how many recipe lines name a stock row,
 * so a till link can say when its sales will take nothing.
 */
describe("listHouseCocktails: linked recipe lines (F-1507)", () => {
  beforeEach(() => get.mockReset());

  it("carries each cocktail's linked line count, and none for no recipe", async () => {
    get.mockResolvedValue({
      data: {
        rows: [
          { id: "a", name: "Negroni", serve: { linked: 2 } },
          { id: "b", name: "Spritz", serve: { linked: 0 } },
          { id: "c", name: "House sour", serve: null },
        ],
        costsUnread: null,
      },
    });
    const rows = await listHouseCocktails("r1");
    expect(rows.map((r) => r.linkedLines)).toEqual([2, 0, 0]);
  });

  it("says nothing about linked lines when the recipes could not be read", async () => {
    get.mockResolvedValue({
      data: {
        rows: [{ id: "a", name: "Negroni", serve: null }],
        costsUnread: "the recipes could not be read (timeout)",
      },
    });
    const rows = await listHouseCocktails("r1");
    expect(rows[0].linkedLines).toBeNull();
  });
});
