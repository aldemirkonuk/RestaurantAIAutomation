import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddWineToInventoryModal } from "./AddWineToInventoryModal";

const useWines = vi.hoisted(() => vi.fn());
const useStorageLocations = vi.hoisted(() => vi.fn());

vi.mock("../../hooks/queries", () => ({ useWines }));
vi.mock("../../hooks/useStorageLocations", () => ({ useStorageLocations }));
vi.mock("../../stores/restaurantSettingsStore", () => ({
  useRestaurantSettingsStore: () => ({ measurementUnit: "ml" }),
}));
vi.mock("../scanner/MenuScannerFlow", () => ({ MenuScannerFlow: () => null }));

const wine = {
  id: "wine-1",
  name: "Tsantali Rapsani",
  producer: "Tsantali",
  vintage: 2019,
  type: "red",
  price: 42,
  liveStock: 0,
  threshold: 6,
};

beforeEach(() => {
  vi.clearAllMocks();
  useWines.mockReturnValue({ data: [wine] });
  useStorageLocations.mockReturnValue({ locations: [] });
});

function renderModal(onAddWine = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AddWineToInventoryModal isOpen onClose={() => {}} onAddWine={onAddWine} />
    </QueryClientProvider>,
  );
  return onAddWine;
}

/**
 * Cellar lane, 2026-09-19 (stored in menu_price_current since ADR 0193,
 * 2026-09-21 -- one bottle-price column, not two). The founder: "we're
 * going to add a per house bottle price." `menuPriceBottle` is collected here
 * the same way `menuPriceGlass` already is: mirrors its gating (shown only
 * when the sale type actually includes that unit) and its field shape.
 *
 * [2026-09-21, round 5 must_fix] It no longer mirrors menuPriceGlass's "0 if
 * left untouched" default: a blank Bottle Menu Price was being sent as
 * `menuPriceBottle: 0` on the default sale type ("bottle"), and $0.00 became
 * this house's bottle price on BottleLeaf. `menuPriceBottle` is now held as
 * `number | null` and the key is omitted unless a number was actually typed
 * (see costPerBottle's identical null handling in the same component). An
 * explicitly typed 0 still sends `menuPriceBottle: 0` — see the two new
 * tests below. `menuPriceGlass` still carries the old 0-default; that defect
 * is out of scope here.
 */
describe("AddWineToInventoryModal — this house's own bottle price", () => {
  it('shows "Bottle Menu Price" but not "Glass Menu Price" for the default sale type ("bottle")', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(await screen.findByText("Tsantali Rapsani"));

    expect(screen.getByText("Bottle Menu Price")).toBeInTheDocument();
    expect(screen.queryByText("Glass Menu Price")).not.toBeInTheDocument();
  });

  it('shows "Glass Menu Price" but not "Bottle Menu Price" for sale type "glass"', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(await screen.findByText("Tsantali Rapsani"));
    await user.click(screen.getByRole("button", { name: "Glass" }));

    expect(screen.getByText("Glass Menu Price")).toBeInTheDocument();
    expect(screen.queryByText("Bottle Menu Price")).not.toBeInTheDocument();
  });

  it('shows BOTH price fields for sale type "both"', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(await screen.findByText("Tsantali Rapsani"));
    await user.click(screen.getByRole("button", { name: "Both" }));

    expect(screen.getByText("Bottle Menu Price")).toBeInTheDocument();
    expect(screen.getByText("Glass Menu Price")).toBeInTheDocument();
  });

  it("sends the typed bottle price as menuPriceBottle on the volumeFields the caller receives", async () => {
    const user = userEvent.setup();
    const onAddWine = renderModal();
    await user.click(await screen.findByText("Tsantali Rapsani"));

    const priceInput = screen
      .getByText("Bottle Menu Price")
      .parentElement!.querySelector("input") as HTMLInputElement;
    await user.clear(priceInput);
    await user.type(priceInput, "62");
    await user.click(screen.getByRole("button", { name: /Add to Inventory/i }));

    await waitFor(() => expect(onAddWine).toHaveBeenCalled());
    const volumeFields = onAddWine.mock.calls[0][4];
    expect(volumeFields.menuPriceBottle).toBe(62);
  });

  it("never sends menuPriceBottle when the sale type is glass-only — the field was never shown", async () => {
    const user = userEvent.setup();
    const onAddWine = renderModal();
    await user.click(await screen.findByText("Tsantali Rapsani"));
    await user.click(screen.getByRole("button", { name: "Glass" }));
    await user.click(screen.getByRole("button", { name: /Add to Inventory/i }));

    await waitFor(() => expect(onAddWine).toHaveBeenCalled());
    const volumeFields = onAddWine.mock.calls[0][4];
    expect("menuPriceBottle" in volumeFields).toBe(false);
  });

  /**
   * Round-4 must_fix. Before this fix, menuPriceBottle's state started at 0
   * and line 188's `{ menuPriceBottle }` sent it unconditionally whenever
   * showBottleFields was true — which it is for the default sale type
   * ("bottle"). Pressing Add without ever touching the field sent
   * `menuPriceBottle: 0`, and $0.00 became this house's bottle price on
   * BottleLeaf instead of the em dash / "No by-the-bottle price recorded"
   * state. This is the field left BLANK, not hidden — distinct from the test
   * above, which covers the field never being shown at all.
   */
  it("never sends menuPriceBottle for the default sale type when the field is left blank", async () => {
    const user = userEvent.setup();
    const onAddWine = renderModal();
    await user.click(await screen.findByText("Tsantali Rapsani"));
    // Default saleType is "bottle" — showBottleFields is already true, and
    // the field is left untouched.
    await user.click(screen.getByRole("button", { name: /Add to Inventory/i }));

    await waitFor(() => expect(onAddWine).toHaveBeenCalled());
    const volumeFields = onAddWine.mock.calls[0][4];
    expect("menuPriceBottle" in volumeFields).toBe(false);
  });

  it("sends an explicitly typed 0 as menuPriceBottle: 0 — a real price is not the same as blank", async () => {
    const user = userEvent.setup();
    const onAddWine = renderModal();
    await user.click(await screen.findByText("Tsantali Rapsani"));

    const priceInput = screen
      .getByText("Bottle Menu Price")
      .parentElement!.querySelector("input") as HTMLInputElement;
    await user.clear(priceInput);
    await user.type(priceInput, "0");
    await user.click(screen.getByRole("button", { name: /Add to Inventory/i }));

    await waitFor(() => expect(onAddWine).toHaveBeenCalled());
    const volumeFields = onAddWine.mock.calls[0][4];
    expect(volumeFields.menuPriceBottle).toBe(0);
  });
});
