/**
 * F-1351: the library search folds Turkish letters and accents, so GET /wines
 * answers "kavaklidere" with "Kavaklıdere". The modal then filtered that answer
 * again with a bare toLowerCase and threw the match away.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
vi.mock("../../hooks/useMayActForTheHouse", () => ({ useMayActForTheHouse: () => true }));

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  useWines.mockReturnValue({
    data: [
      { id: "w-1", name: "Öküzgözü", producer: "Kavaklıdere", vintage: 2020, type: "red", price: 30 },
      { id: "w-2", name: "Tsantali Rapsani", producer: "Tsantali", vintage: 2019, type: "red", price: 42 },
    ],
  });
  useStorageLocations.mockReturnValue({ locations: [] });
});

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AddWineToInventoryModal isOpen onClose={() => {}} onAddWine={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("AddWineToInventoryModal — the search keeps what the library found (F-1351)", () => {
  it.each(["kavaklidere", "okuzgozu", "KAVAKLIDERE"])("%s keeps the Kavaklıdere wine", async (typed) => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByPlaceholderText(/search wines, producers/i), typed);
    expect(await screen.findByText("Öküzgözü")).toBeInTheDocument();
    expect(screen.queryByText("Tsantali Rapsani")).not.toBeInTheDocument();
  });
});
