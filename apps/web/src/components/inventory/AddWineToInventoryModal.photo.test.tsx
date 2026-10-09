import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, within } from "@testing-library/react";
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
// The real scanner pulls in the orchestrator client. Stubbed to a marker, so
// "it opened" is observable and it brings no file input of its own.
vi.mock("../scanner/MenuScannerFlow", () => ({
  MenuScannerFlow: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="real-scanner" /> : null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  useWines.mockReturnValue({ data: [] });
  useStorageLocations.mockReturnValue({ locations: [] });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
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

async function openPhotoTab() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.click(screen.getByRole("button", { name: /Scan Wine Label/i }));
  return user;
}

/**
 * ADR 0314. The Photo tab's "Single Wine Label Scan" opened AddWineModal,
 * which had no detection backend: after a fake three-second wait, ANY photo
 * came back as Château Latour 2010 at "94%" confidence, with a Pauillac
 * appellation, a taste profile, 13.5% ABV, a marketing paragraph and a
 * $1,200 price. "Save" then built a wine from it, filling every missing
 * field with "dry", "medium", "red", "Unknown" or 0% ABV, and badged it
 * "AI Detected". The founder ruled it deleted, not labelled (ADR 0020).
 */
describe("AddWineToInventoryModal — a photo never yields a wine nobody read", () => {
  it("offers the real scanner as the Photo tab's only action", async () => {
    renderModal();
    await openPhotoTab();

    const real = screen.getByRole("button", {
      name: /Open Camera \/ Upload Image/i,
    });
    // The two buttons sat side by side in one column; the fake one is gone.
    expect(within(real.parentElement as HTMLElement).getAllByRole("button")).toEqual([
      real,
    ]);
    expect(
      screen.queryByRole("button", { name: /Single Wine Label Scan/i }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Scan Another Wine/i })).toBeNull();
  });

  it("opens the real scanner from that action", async () => {
    renderModal();
    const user = await openPhotoTab();
    await user.click(
      screen.getByRole("button", { name: /Open Camera \/ Upload Image/i }),
    );
    expect(screen.getByTestId("real-scanner")).toBeInTheDocument();
  });

  it("selects no wine after a photo is uploaded through any control in the Photo tab", async () => {
    const onAddWine = renderModal();
    const user = await openPhotoTab();
    const real = screen.getByRole("button", {
      name: /Open Camera \/ Upload Image/i,
    });

    // Press every other button the Photo tab offers, then feed a photo to
    // every file input that appears. Whatever path exists, a label nobody
    // read must not come back as a wine.
    const panel = real.closest("div.text-center") as HTMLElement;
    for (const b of within(panel).getAllByRole("button")) {
      if (b !== real) await user.click(b);
    }
    const photo = new File(["not a label"], "label.png", { type: "image/png" });
    const inputs = Array.from(
      document.body.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    );
    for (const input of inputs) await user.upload(input, photo);
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(document.body.textContent).not.toMatch(/Latour|Pauillac/);
    expect(screen.queryByText(/AI Detected/i)).toBeNull();
    expect(screen.queryByText(/Wine Detected Successfully/i)).toBeNull();
    expect(screen.queryByText(/Confidence:/i)).toBeNull();
    // No wine is selected, so there is nothing to add.
    expect(screen.queryByText("Configure Inventory")).toBeNull();
    expect(onAddWine).not.toHaveBeenCalled();
  });
});
