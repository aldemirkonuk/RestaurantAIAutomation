import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddWineToInventoryModal } from "./AddWineToInventoryModal";
import { AddWineSelectionModal } from "../wines/AddWineSelectionModal";

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

function renderModal(onAddWine: (...args: unknown[]) => unknown, onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AddWineToInventoryModal isOpen onClose={onClose} onAddWine={onAddWine as never} />
    </QueryClientProvider>,
  );
  return onClose;
}

function refused(status: number, message: string) {
  return Object.assign(new Error(message), { response: { status, data: { message } } });
}

/**
 * F-205: the sheet called onAddWine without waiting and closed at once, so a
 * 409 (already in the cellar) or a 403 (a priced add by staff) said nothing.
 */
describe("Add Wine — the sheet waits for the write and says a refusal", () => {
  it("stays open and says the wine is already in the cellar on a 409", async () => {
    const user = userEvent.setup();
    const onClose = renderModal(vi.fn().mockRejectedValue(refused(409, "This wine already exists in inventory.")));
    await user.click(await screen.findByText("Tsantali Rapsani"));
    await user.click(screen.getByRole("button", { name: /Add to Inventory/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tsantali Rapsani is already in the cellar, so nothing was added.",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Configure Inventory")).toBeInTheDocument();
  });

  it("says a 403 in the owner's words, not the gateway's", async () => {
    const user = userEvent.setup();
    renderModal(vi.fn().mockRejectedValue(refused(403, "Forbidden resource")));
    await user.click(await screen.findByText("Tsantali Rapsani"));
    await user.click(screen.getByRole("button", { name: /Add to Inventory/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/may not add a wine with a price/);
    expect(alert).not.toHaveTextContent(/Forbidden resource/);
  });

  it("never says nothing was added when the answer was lost", async () => {
    const user = userEvent.setup();
    renderModal(vi.fn().mockRejectedValue(refused(502, "Bad gateway")));
    await user.click(await screen.findByText("Tsantali Rapsani"));
    await user.click(screen.getByRole("button", { name: /Add to Inventory/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not confirm/);
    expect(alert).not.toHaveTextContent(/nothing was/i);
  });

  it("closes only after the write landed", async () => {
    const user = userEvent.setup();
    let land: () => void = () => {};
    const onAddWine = vi.fn(() => new Promise<void>((resolve) => { land = resolve; }));
    const onClose = renderModal(onAddWine);
    await user.click(await screen.findByText("Tsantali Rapsani"));
    await user.click(screen.getByRole("button", { name: /Add to Inventory/i }));

    expect(await screen.findByRole("button", { name: /Adding/ })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    land();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("stacks the configure panel under the list below md (F-208)", async () => {
    const user = userEvent.setup();
    renderModal(vi.fn());
    await user.click(await screen.findByText("Tsantali Rapsani"));
    const panel = screen.getByText("Configure Inventory").closest("div.bg-gray-50") as HTMLElement;
    expect(panel.className).toMatch(/(^| )w-full( |$)/);
    expect(panel.className).toMatch(/md:w-96/);
    expect(panel.className).not.toMatch(/(^| )w-96( |$)/);
  });
});

/** F-208: four stacked cards ran off a phone with no scroll, and Escape did nothing. */
describe("Add Wine chooser — usable on a phone", () => {
  it("scrolls inside the screen and closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <AddWineSelectionModal
        isOpen
        onClose={onClose}
        onSelectSingle={vi.fn()}
        onSelectMenu={vi.fn()}
        onSelectReceipt={vi.fn()}
        onSelectAuction={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toMatch(/max-h-\[90dvh\]/);
    expect(dialog.className).toMatch(/overflow-y-auto/);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
