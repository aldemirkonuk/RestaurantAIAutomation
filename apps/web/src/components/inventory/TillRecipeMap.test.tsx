import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TillRecipeMap } from "./TillRecipeMap";

const getHouseCocktails = vi.hoisted(() => vi.fn());
const setTillRecipe = vi.hoisted(() => vi.fn());

vi.mock("../../services/api/posHub", () => ({ getHouseCocktails, setTillRecipe }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const NEGRONI = { id: "c-neg", name: "Negroni", menu_section: "Stirred" };
const SOUR = { id: "c-sour", name: "Whiskey Sour" };

const mapping = (o: Record<string, unknown> = {}) => ({
  id: "m1",
  source: "toast",
  external_item_id: "x1",
  item_name: "House Negroni",
  is_wine: false,
  inventory_id: null,
  master_wine_id: null,
  sale_unit: null,
  sale_volume_ml: null,
  cocktail_id: null,
  updated_at: null,
  ...o,
});

const view = (over: Record<string, unknown> = {}) =>
  render(
    <TillRecipeMap
      restaurantId="r1"
      mappings={[mapping()]}
      mappingsError={null}
      seen={[]}
      shelfName={(id) => (id === "inv-1" ? "Campari 1L" : null)}
      {...over}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  getHouseCocktails.mockImplementation(async (_r: string, term?: string) => {
    const all = [NEGRONI, SOUR];
    const rows = term ? all.filter((c) => c.name.toLowerCase().includes(term.toLowerCase())) : all;
    return { rows, truncated: false };
  });
  setTillRecipe.mockResolvedValue(mapping());
});

describe("TillRecipeMap", () => {
  it("lists a button and what it draws today", async () => {
    view({ mappings: [mapping({ cocktail_id: "c-neg" })] });
    expect(await screen.findByText("Draws the recipe Negroni")).toBeInTheDocument();
    expect(screen.getByText("House Negroni")).toBeInTheDocument();
  });

  it("lists a button that rang up and matched nothing", async () => {
    view({
      mappings: [],
      seen: [
        {
          source: "toast",
          external_item_id: "x9",
          item_name: "Espresso Martini",
          reason: "unmapped",
          mapped_inventory_id: null,
          occurrences: 3,
          qty_total: 3,
          revenue_total: 30,
          first_seen: null,
          last_seen: null,
          line_ids: [],
        },
      ],
    });
    expect(await screen.findByText("Espresso Martini")).toBeInTheDocument();
    expect(screen.getByText("Draws nothing yet")).toBeInTheDocument();
  });

  it("searches the house's recipes and saves the one picked", async () => {
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole("button", { name: "Pick a recipe" }));
    await user.type(screen.getByLabelText("Search the house's recipes"), "sour");
    const hit = await screen.findByRole("button", { name: /Whiskey Sour/ });
    expect(screen.queryByRole("button", { name: /Negroni$/ })).toBeNull();
    await user.click(hit);
    await waitFor(() => expect(setTillRecipe).toHaveBeenCalledTimes(1));
    expect(setTillRecipe.mock.calls[0][0]).toMatchObject({
      source: "toast",
      external_item_id: "x1",
      item_name: "House Negroni",
      cocktail_id: "c-sour",
      replace_shelf_link: false,
    });
    expect(setTillRecipe.mock.calls[0][1]).toBe("r1");
  });

  it("asks before moving a button off its shelf item", async () => {
    const user = userEvent.setup();
    view({ mappings: [mapping({ inventory_id: "inv-1" })] });
    expect(await screen.findByText("Draws the shelf item Campari 1L")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pick a recipe" }));
    await user.click(await screen.findByRole("button", { name: /Negroni/ }));
    expect(setTillRecipe).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Move it to the recipe" }));
    await waitFor(() => expect(setTillRecipe).toHaveBeenCalledTimes(1));
    expect(setTillRecipe.mock.calls[0][0]).toMatchObject({
      cocktail_id: "c-neg",
      replace_shelf_link: true,
    });
  });

  it("takes a recipe off with a null id", async () => {
    const user = userEvent.setup();
    view({ mappings: [mapping({ cocktail_id: "c-neg" })] });
    await user.click(await screen.findByRole("button", { name: "Take the recipe off" }));
    await waitFor(() => expect(setTillRecipe).toHaveBeenCalledTimes(1));
    expect(setTillRecipe.mock.calls[0][0]).toMatchObject({ cocktail_id: null });
  });

  it("says a failed button read failed, not that there are none", async () => {
    view({ mappings: null, mappingsError: "boom" });
    expect(await screen.findByText(/could not be read \(boom\)/)).toBeInTheDocument();
    expect(screen.queryByText(/No till buttons have been read/)).toBeNull();
  });

  it("says a failed recipe read failed, not that the house has no recipes", async () => {
    const user = userEvent.setup();
    getHouseCocktails.mockRejectedValue(new Error("recipes down"));
    view();
    await user.click(await screen.findByRole("button", { name: "Pick a recipe" }));
    expect(await screen.findAllByText(/could not be read \(recipes down\)/)).not.toHaveLength(0);
    expect(screen.queryByText("The house has no drink recipes yet.")).toBeNull();
  });

  it("says an unreachable gateway in words, never the transport's \"Network Error\"", async () => {
    const user = userEvent.setup();
    getHouseCocktails.mockRejectedValue(Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }));
    view();
    await user.click(await screen.findByRole("button", { name: "Pick a recipe" }));
    expect((await screen.findAllByText(/could not be read \(Mudavym could not be reached just now\.\)/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Network Error/)).toBeNull();
  });

  it("says a failed recipe search failed, not that nothing matched", async () => {
    const user = userEvent.setup();
    getHouseCocktails.mockReset();
    getHouseCocktails.mockResolvedValueOnce({ rows: [NEGRONI], truncated: false });
    getHouseCocktails.mockRejectedValue(new Error("search down"));
    view();
    await user.click(await screen.findByRole("button", { name: "Pick a recipe" }));
    expect(await screen.findByText(/The recipes could not be read \(search down\)/)).toBeInTheDocument();
    expect(screen.queryByText("The house has no drink recipes yet.")).toBeNull();
  });

  it("says plainly that a dish cannot be linked", async () => {
    view();
    expect(await screen.findByText(/Dishes cannot be linked to a button yet/)).toBeInTheDocument();
  });

  it("reports a failed save and keeps the picker open", async () => {
    const user = userEvent.setup();
    const { toast } = await import("sonner");
    setTillRecipe.mockRejectedValue(new Error("refused"));
    view();
    await user.click(await screen.findByRole("button", { name: "Pick a recipe" }));
    await user.click(await screen.findByRole("button", { name: /Negroni/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String((toast.error as any).mock.calls[0][0])).toContain("refused");
    expect(screen.getByLabelText("Search the house's recipes")).toBeInTheDocument();
  });
});
