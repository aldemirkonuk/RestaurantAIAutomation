/**
 * F-712: the add-wine modal asks before a refresh or a Back drops a picked
 * wine, and keeps the pick (with what was typed about it) for this tab, per
 * person and house, until it is added.
 */
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
// The cost field shows only to a manager (F-312); this test types a cost.
vi.mock("../../hooks/useMayActForTheHouse", () => ({ useMayActForTheHouse: () => true }));

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
const KEY = "mdv:add-wine:u-1:house-a";

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  useWines.mockReturnValue({ data: [wine] });
  useStorageLocations.mockReturnValue({ locations: [] });
});

function renderModal(draftScope: string | undefined = "u-1:house-a", onAddWine = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <AddWineToInventoryModal
        isOpen
        onClose={() => {}}
        onAddWine={onAddWine}
        draftScope={draftScope}
      />
    </QueryClientProvider>,
  );
  return { ...view, onAddWine };
}

describe("AddWineToInventoryModal — work kept across a refresh or a Back (F-712)", () => {
  it("asks before a reload once a wine is picked", async () => {
    const user = userEvent.setup();
    renderModal();
    const before = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);

    await user.click(await screen.findByText("Tsantali Rapsani"));
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(true);
  });

  it("brings the picked wine and the typed cost back after a remount", async () => {
    const user = userEvent.setup();
    const first = renderModal();
    await user.click(await screen.findByText("Tsantali Rapsani"));
    await user.type(screen.getByPlaceholderText(/leave blank if unknown/i), "38.5");
    await waitFor(() =>
      expect(window.sessionStorage.getItem(KEY)).toContain("38.5"),
    );
    first.unmount();

    const { onAddWine } = renderModal();
    expect(
      ((await screen.findByPlaceholderText(/leave blank if unknown/i)) as HTMLInputElement).value,
    ).toBe("38.5");
    await user.click(screen.getByRole("button", { name: /Add to Inventory/i }));
    await waitFor(() => expect(onAddWine).toHaveBeenCalled());
    expect(onAddWine.mock.calls[0][0].id).toBe("wine-1");
    expect(onAddWine.mock.calls[0][4].costPerBottle).toBe(38.5);
    // Added: nothing is kept any more.
    await waitFor(() => expect(window.sessionStorage.getItem(KEY)).toBeNull());
  });

  it("never brings one house's pick into another", async () => {
    const user = userEvent.setup();
    const first = renderModal();
    await user.click(await screen.findByText("Tsantali Rapsani"));
    await waitFor(() => expect(window.sessionStorage.getItem(KEY)).not.toBeNull());
    first.unmount();

    renderModal("u-1:house-b");
    await screen.findByText("Tsantali Rapsani");
    expect(screen.queryByPlaceholderText(/leave blank if unknown/i)).not.toBeInTheDocument();
  });
});
