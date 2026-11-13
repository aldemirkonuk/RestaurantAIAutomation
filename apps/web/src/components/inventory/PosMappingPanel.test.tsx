import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PosMappingPanel } from "./PosMappingPanel";
import type { PortionFacts } from "./posPortions";
import { toast } from "sonner";

const getMatchProposals = vi.hoisted(() => vi.fn());
const getUnresolvedLines = vi.hoisted(() => vi.fn());
const getItemMappings = vi.hoisted(() => vi.fn());
const approveProposals = vi.hoisted(() => vi.fn());
const rejectProposal = vi.hoisted(() => vi.fn());
const runCatalogMatch = vi.hoisted(() => vi.fn());
const setSaleUnits = vi.hoisted(() => vi.fn());
const getTargetMargin = vi.hoisted(() => vi.fn());

vi.mock("../../services/api/posHub", () => ({
  getMatchProposals,
  getUnresolvedLines,
  getItemMappings,
  approveProposals,
  rejectProposal,
  runCatalogMatch,
  setSaleUnits,
}));
vi.mock("../../services/api/pricing", () => ({ getTargetMargin }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const inventory = [
  {
    id: "inv-1",
    wineName: "Alvear Solera 1927",
    bottleSizeMl: 750,
    pourSizeMl: 60,
    portionFacts: { kind: "wine", uom: "bottle", bottleMl: 750, pourMl: 60 },
  },
];
const good = (facts: Partial<PortionFacts>) => [
  {
    id: "inv-1",
    wineName: "Good",
    portionFacts: { kind: null, uom: "bottle", bottleMl: null, pourMl: null, ...facts },
  },
];

const proposal = (o: Record<string, unknown> = {}) => ({
  id: "prop-1",
  source: "simpos",
  external_item_id: "ext-1",
  item_name: "Alvear Solera 1927",
  candidate_inventory_id: "inv-1",
  candidate_master_wine_id: "mw-1",
  confidence: 0.88,
  match_method: "trigram",
  status: "pending",
  created_at: "2026-09-03T05:00:00.000Z",
  ...o,
});

const queue = (o: Record<string, unknown> = {}) => ({
  restaurant_id: "r1",
  summary: {
    open_lines: 39,
    distinct_items: 12,
    unmapped: 38,
    no_sale_volume: 1,
    qty_total: 44,
    revenue_total: 512,
    truncated: false,
  },
  items: [],
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  getMatchProposals.mockResolvedValue([proposal()]);
  getUnresolvedLines.mockResolvedValue(queue());
  getItemMappings.mockResolvedValue([]);
  // Unconfirmed: the house's pour is the database default, not a stated one.
  getTargetMargin.mockResolvedValue({ pour: { confirmed: false, ml: 150 } });
  approveProposals.mockResolvedValue({
    requested: 1,
    approved: 1,
    failed: 0,
    results: [{ proposal_id: "prop-1", ok: true }],
  });
});

/**
 * POS lens defects 1-2. The behaviours worth locking are exactly the two the
 * lens measured going wrong: the queue must be visible at all, and an approval
 * must carry the sale size or the button still cannot deplete.
 */
describe("PosMappingPanel", () => {
  it("renders the unresolved queue in stock terms, not row counts", async () => {
    render(<PosMappingPanel isOpen onClose={() => {}} inventory={inventory} />);
    expect(await screen.findByText(/39/)).toBeInTheDocument();
    expect(screen.getByText(/no stock/i)).toBeInTheDocument();
    expect(screen.getByText(/44/)).toBeInTheDocument();
  });

  it("sends the sale unit AND volume with the approval", async () => {
    const user = userEvent.setup();
    render(<PosMappingPanel isOpen onClose={() => {}} inventory={inventory} />);

    await screen.findByText("ext-1");
    await user.click(screen.getByLabelText("Confirm Alvear Solera 1927"));
    // The glass size comes from the inventory row's own pour size (60ml), not
    // a 150ml assumption.
    await user.click(screen.getByRole("button", { name: /Glass 60ml/ }));
    await user.click(screen.getByRole("button", { name: /Confirm 1/ }));

    await waitFor(() => expect(approveProposals).toHaveBeenCalled());
    expect(approveProposals).toHaveBeenCalledWith(
      [{ proposal_id: "prop-1", sale_unit: "glass", sale_volume_ml: 60 }],
      undefined,
    );
  });

  it("a soda is offered a bottle or can at its size, never a glass (r24)", async () => {
    getTargetMargin.mockResolvedValue({ pour: { confirmed: true, ml: 150 } });
    const user = userEvent.setup();
    render(
      <PosMappingPanel isOpen onClose={() => {}} inventory={good({ kind: "soft_drink", bottleMl: 200 })} />,
    );

    await screen.findByText("ext-1");
    expect(screen.queryByRole("button", { name: /Glass/ })).toBeNull();
    await user.click(screen.getByLabelText("Confirm Alvear Solera 1927"));
    await user.click(screen.getByRole("button", { name: "Bottle or can 200ml" }));
    await user.click(screen.getByRole("button", { name: /Confirm 1/ }));

    // A whole bottle is one unit off the shelf: no volume, so a later size
    // correction cannot turn it into a part pour.
    await waitFor(() => expect(approveProposals).toHaveBeenCalled());
    expect(approveProposals.mock.calls[0][0]).toEqual([
      { proposal_id: "prop-1", sale_unit: "bottle", sale_volume_ml: null },
    ]);
    // Answered, so no "will queue" warning for a whole bottle sent without a volume.
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("an unconfirmed house pour is not a glass size (ADR 0193 F7)", async () => {
    render(<PosMappingPanel isOpen onClose={() => {}} inventory={good({ kind: "wine", bottleMl: 750 })} />);
    await screen.findByText("ext-1");
    expect(screen.queryByRole("button", { name: "Glass 150ml" })).toBeNull();
    expect(screen.getByRole("button", { name: "Glass: size not known" })).toBeDisabled();
  });

  it("an unsized wine says its size is not known and offers no 750, and its glass waits", async () => {
    const user = userEvent.setup();
    render(<PosMappingPanel isOpen onClose={() => {}} inventory={good({ kind: "wine", pourMl: 125 })} />);

    await screen.findByText("ext-1");
    expect(screen.queryByRole("button", { name: /750/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Glass: size not known" })).toBeDisabled();
    await user.click(screen.getByLabelText("Confirm Alvear Solera 1927"));
    await user.click(screen.getByRole("button", { name: "Bottle · size not known" }));
    await user.click(screen.getByRole("button", { name: /Confirm 1/ }));

    await waitFor(() => expect(approveProposals).toHaveBeenCalled());
    expect(approveProposals.mock.calls[0][0]).toEqual([
      { proposal_id: "prop-1", sale_unit: "bottle", sale_volume_ml: null },
    ]);
  });

  it("a wine's glass is the house's confirmed pour, and only once confirmed", async () => {
    getTargetMargin.mockResolvedValue({ pour: { confirmed: true, ml: 140 } });
    const user = userEvent.setup();
    render(<PosMappingPanel isOpen onClose={() => {}} inventory={good({ kind: "wine", bottleMl: 750 })} />);

    await screen.findByText("ext-1");
    await user.click(screen.getByLabelText("Confirm Alvear Solera 1927"));
    await user.click(screen.getByRole("button", { name: "Glass 140ml" }));
    await user.click(screen.getByRole("button", { name: /Confirm 1/ }));
    await waitFor(() => expect(approveProposals).toHaveBeenCalled());
    expect(approveProposals.mock.calls[0][0]).toEqual([
      { proposal_id: "prop-1", sale_unit: "glass", sale_volume_ml: 140 },
    ]);
  });

  it("a spirit is offered a shot, not a glass", async () => {
    render(
      <PosMappingPanel isOpen onClose={() => {}} inventory={good({ kind: "spirit", bottleMl: 700, pourMl: 40 })} />,
    );
    await screen.findByText("ext-1");
    expect(screen.getByRole("button", { name: "Shot 40ml" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Glass/ })).toBeNull();
  });

  it("a queued soda is answered as one unit; it has no glass answer", async () => {
    getMatchProposals.mockResolvedValue([]);
    const user = userEvent.setup();
    getUnresolvedLines.mockResolvedValue(
      queue({
        items: [
          { source: "simpos", external_item_id: "ext-9", item_name: "Gazoz", reason: "no_sale_volume", occurrences: 3, qty_total: 3 },
        ],
      }),
    );
    getItemMappings.mockResolvedValue([
      { id: "map-9", source: "simpos", external_item_id: "ext-9", item_name: "Gazoz", is_wine: true, inventory_id: "inv-1", master_wine_id: null, sale_unit: null, sale_volume_ml: null, updated_at: null },
    ]);
    setSaleUnits.mockResolvedValue({ results: [{ mapping_id: "map-9", ok: true }] });
    render(<PosMappingPanel isOpen onClose={() => {}} inventory={good({ kind: "soft_drink" })} />);

    await screen.findByText("Gazoz");
    expect(screen.queryByRole("button", { name: /One glass|Glass/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Bottle or can · size not known" }));
    await waitFor(() =>
      expect(setSaleUnits).toHaveBeenCalledWith([{ mapping_id: "map-9", sale_unit: "bottle" }], undefined),
    );
  });

  it("a queued wine's glass waits when only the house's pour is confirmed", async () => {
    getMatchProposals.mockResolvedValue([]);
    getTargetMargin.mockResolvedValue({ pour: { confirmed: true, ml: 150 } });
    getUnresolvedLines.mockResolvedValue(
      queue({
        items: [
          { source: "simpos", external_item_id: "ext-9", item_name: "Rioja", reason: "no_sale_volume", occurrences: 1, qty_total: 1 },
        ],
      }),
    );
    getItemMappings.mockResolvedValue([
      { id: "map-9", source: "simpos", external_item_id: "ext-9", item_name: "Rioja", is_wine: true, inventory_id: "inv-1", master_wine_id: null, sale_unit: null, sale_volume_ml: null, updated_at: null },
    ]);
    render(<PosMappingPanel isOpen onClose={() => {}} inventory={good({ kind: "wine", bottleMl: 750 })} />);

    await screen.findByText("Rioja");
    expect(screen.getByRole("button", { name: "Glass 150ml" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Bottle 750ml" })).toBeEnabled();
  });

  it("approves with an explicit null unit rather than defaulting to bottle", async () => {
    const user = userEvent.setup();
    render(<PosMappingPanel isOpen onClose={() => {}} inventory={inventory} />);

    await screen.findByText("ext-1");
    await user.click(screen.getByLabelText("Confirm Alvear Solera 1927"));
    await user.click(screen.getByRole("button", { name: /Confirm 1/ }));

    await waitFor(() => expect(approveProposals).toHaveBeenCalled());
    expect(approveProposals.mock.calls[0][0]).toEqual([
      { proposal_id: "prop-1", sale_unit: null, sale_volume_ml: null },
    ]);
  });

  it("warns before confirming a button whose sale size is unanswered", async () => {
    const user = userEvent.setup();
    render(<PosMappingPanel isOpen onClose={() => {}} inventory={inventory} />);

    await screen.findByText("ext-1");
    await user.click(screen.getByLabelText("Confirm Alvear Solera 1927"));

    expect(
      screen.getByText(
        /will be confirmed as the right wine, but their sales will keep queueing/i,
      ),
    ).toBeInTheDocument();
  });

  it("says the queue could not be read rather than showing it as empty (ADR 0067)", async () => {
    getUnresolvedLines.mockRejectedValue(new Error("connection reset"));
    render(<PosMappingPanel isOpen onClose={() => {}} inventory={inventory} />);

    expect(await screen.findByText(/could not be read/i)).toBeInTheDocument();
    expect(
      screen.getByText(/not a claim that the\s+queue is empty/i),
    ).toBeInTheDocument();
  });
});
