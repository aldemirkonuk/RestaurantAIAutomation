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
// The scanner flow pulls in the orchestrator client; this test never opens it.
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
      <AddWineToInventoryModal
        isOpen
        onClose={() => {}}
        onAddWine={onAddWine}
      />
    </QueryClientProvider>,
  );
  return onAddWine;
}

/**
 * POS lens defect 6. The modal pre-filled the shared library's reference price
 * and turned a cleared field into `0`, which the API then labelled `'manual'` —
 * a price nobody typed, wearing a provenance that says a human typed it.
 * Measured: the 2 wines added here carry lots at `0.0 / 'manual'`, while the 50
 * added through the bulk door carry the honest `NULL / 'estimated'`. The true
 * value was unreachable from the UI.
 */
describe("AddWineToInventoryModal — an unknown cost is expressible", () => {
  it("does not pre-fill the library reference price", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(await screen.findByText("Tsantali Rapsani"));

    const cost = screen.getByPlaceholderText(
      /leave blank if unknown/i,
    ) as HTMLInputElement;
    expect(cost.value).toBe("");
    // JSX wraps this copy across lines, so match on the normalised text.
    expect(
      screen.getByText(
        (_t, el) =>
          /Cost unknown/i.test(el?.textContent ?? "") &&
          /not as \$0/i.test(el?.textContent ?? "") &&
          el?.tagName === "P",
      ),
    ).toBeInTheDocument();
  });

  it("omits costPerBottle entirely when the field is left blank", async () => {
    const user = userEvent.setup();
    const onAddWine = renderModal();
    await user.click(await screen.findByText("Tsantali Rapsani"));
    await user.click(screen.getByRole("button", { name: /Add to Inventory/i }));

    await waitFor(() => expect(onAddWine).toHaveBeenCalled());
    const volumeFields = onAddWine.mock.calls[0][4];
    expect(
      "costPerBottle" in volumeFields ? volumeFields.costPerBottle : null,
    ).toBeNull();
  });

  it("sends the number when one is typed", async () => {
    const user = userEvent.setup();
    const onAddWine = renderModal();
    await user.click(await screen.findByText("Tsantali Rapsani"));
    await user.type(
      screen.getByPlaceholderText(/leave blank if unknown/i),
      "38.5",
    );
    await user.click(screen.getByRole("button", { name: /Add to Inventory/i }));

    await waitFor(() => expect(onAddWine).toHaveBeenCalled());
    expect(onAddWine.mock.calls[0][4].costPerBottle).toBe(38.5);
  });

  it("keeps a deliberate $0 visible and warns that it is a real cost", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(await screen.findByText("Tsantali Rapsani"));
    const cost = screen.getByPlaceholderText(
      /leave blank if unknown/i,
    ) as HTMLInputElement;
    await user.type(cost, "0");

    // `|| ''` would have blanked the field back out and lost the answer.
    expect(cost.value).toBe("0");
    expect(screen.getByText(/\$0\.00 is a real cost/i)).toBeInTheDocument();
  });

  it("offers the library reference as something to accept, not as a default", async () => {
    const user = userEvent.setup();
    const onAddWine = renderModal();
    await user.click(await screen.findByText("Tsantali Rapsani"));
    await user.click(
      screen.getByRole("button", { name: /Use library reference \$42\.00/i }),
    );
    await user.click(screen.getByRole("button", { name: /Add to Inventory/i }));

    await waitFor(() => expect(onAddWine).toHaveBeenCalled());
    expect(onAddWine.mock.calls[0][4].costPerBottle).toBe(42);
  });
});
