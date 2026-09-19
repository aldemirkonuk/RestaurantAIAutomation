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
 * Cellar lane, 2026-09-19 — migration 20260919160000. The founder: "we're
 * going to add a per house bottle price." `menuPriceBottle` is collected here
 * the same way `menuPriceGlass` already is: mirrors its gating (shown only
 * when the sale type actually includes that unit), its field shape, and — not
 * yet fixed, and not this task's to fix — its "0 if left untouched" default,
 * which `menuPriceGlass` has carried since before this pass touched the file.
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
});
