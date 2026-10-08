import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddWineToInventoryModal } from "./AddWineToInventoryModal";

const useWines = vi.hoisted(() => vi.fn());
vi.mock("../../hooks/queries", () => ({ useWines }));
vi.mock("../../hooks/useStorageLocations", () => ({
  useStorageLocations: () => ({ locations: [] }),
}));
vi.mock("../../stores/restaurantSettingsStore", () => ({
  useRestaurantSettingsStore: () => ({ measurementUnit: "ml" }),
}));
vi.mock("../scanner/MenuScannerFlow", () => ({ MenuScannerFlow: () => null }));
// ADR 0271 deleted `../wines/AddWineModal`. This stands in for it, or for
// anything that comes back in its place: a reader that made out only a name
// and a producer, which is what a real one returns from a worn label.
vi.mock("../wines/AddWineModal", () => ({
  AddWineModal: ({
    isOpen,
    onSave,
  }: {
    isOpen: boolean;
    onSave: (r: unknown) => void;
  }) =>
    isOpen ? (
      <button onClick={() => onSave({ name: "Rapsani", producer: "Tsantali" })}>
        partial reading
      </button>
    ) : null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  useWines.mockReturnValue({ data: [] });
});

/**
 * ADR 0271, the second half. The modal turned a detection result into a wine
 * by filling each missing field: sweetness "dry", body and acidity "medium",
 * type "red", grape/country/region "Unknown", and alcohol 0, which reads as a
 * real 0% ABV. ABV is attributive (ADR 0163:884-889): stated, sourced or
 * absent, never inferred. The photo path is gone, so nothing in the modal can
 * build a wine; a library wine is the only thing it can add.
 */
describe("AddWineToInventoryModal — a partial reading is never completed with invented values", () => {
  it("adds no wine built from a reading", async () => {
    const onAddWine = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AddWineToInventoryModal isOpen onClose={() => {}} onAddWine={onAddWine} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Scan Wine Label/i }));

    // Every Photo-tab control except the real scanner, then the reading,
    // then "Add to Inventory" if a wine was put up for it.
    for (const b of screen.getAllByRole("button")) {
      if (/label scan|scan another/i.test(b.textContent ?? "")) await user.click(b);
    }
    const reading = screen.queryByRole("button", { name: "partial reading" });
    if (reading) await user.click(reading);
    const add = screen.queryByRole("button", { name: /Add to Inventory/i });
    if (add) await user.click(add);

    // On the old code this lists one wine: { sweetness: "dry", body: "medium",
    // acidity: "medium", type: "red", alcohol: 0, grape: "Unknown", ... }.
    expect(onAddWine.mock.calls.map(([wine]) => wine)).toEqual([]);
    expect(screen.queryByText(/AI Detected/i)).toBeNull();
  });
});
