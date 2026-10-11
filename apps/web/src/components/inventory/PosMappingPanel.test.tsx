import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PosMappingPanel } from "./PosMappingPanel";

const getMatchProposals = vi.hoisted(() => vi.fn());
const getUnresolvedLines = vi.hoisted(() => vi.fn());
const getItemMappings = vi.hoisted(() => vi.fn());
const approveProposals = vi.hoisted(() => vi.fn());
const rejectProposal = vi.hoisted(() => vi.fn());
const runCatalogMatch = vi.hoisted(() => vi.fn());
const setSaleUnits = vi.hoisted(() => vi.fn());
const getTargetMargin = vi.hoisted(() => vi.fn());
const house = vi.hoisted(() => ({ country: null as string | null }));

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
vi.mock("../../hooks/useHouseGroupMark", () => ({
  useHouseCountryCode: () => house.country,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const inventory = [
  {
    id: "inv-1",
    wineName: "Alvear Solera 1927",
    bottleSizeMl: 750,
    pourSizeMl: 60,
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

const pour = (confirmed: boolean, ml: number | null) => ({
  pour: { confirmed, ml, confirmedAt: null, confirmedBy: null },
});

beforeEach(() => {
  vi.clearAllMocks();
  house.country = null;
  getTargetMargin.mockResolvedValue(pour(true, 125));
  getMatchProposals.mockResolvedValue([proposal()]);
  getUnresolvedLines.mockResolvedValue(queue());
  getItemMappings.mockResolvedValue([]);
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
    // The glass size is the house's CONFIRMED pour (125ml), not the row's
    // pour_size_ml, whose database default cannot be told from a typed value
    // (F-1384, ADR 0193 F7).
    await user.click(await screen.findByRole("button", { name: /Glass 125ml/ }));
    await user.click(screen.getByRole("button", { name: /Confirm 1/ }));

    await waitFor(() => expect(approveProposals).toHaveBeenCalled());
    expect(approveProposals).toHaveBeenCalledWith(
      [{ proposal_id: "prop-1", sale_unit: "glass", sale_volume_ml: 125 }],
      undefined,
    );
  });

  it("asks for the glass when the house has not confirmed its pour, and never sends 150 (F-1384)", async () => {
    getTargetMargin.mockResolvedValue(pour(false, 150));
    const user = userEvent.setup();
    render(
      <PosMappingPanel
        isOpen
        onClose={() => {}}
        inventory={[{ ...inventory[0], pourSizeMl: 150 }]}
      />,
    );

    await screen.findByText("ext-1");
    await user.click(screen.getByLabelText("Confirm Alvear Solera 1927"));
    await user.click(screen.getByRole("button", { name: "Glass…" }));
    expect(
      (screen.getByLabelText("Serve for Alvear Solera 1927") as HTMLSelectElement).value,
    ).toBe("glass");
    expect(screen.getByRole("button", { name: "Use this size" })).toBeDisabled();
    await user.type(screen.getByLabelText("Millilitres for Alvear Solera 1927"), "175");
    await user.click(screen.getByRole("button", { name: "Use this size" }));
    await user.click(screen.getByRole("button", { name: /Confirm 1/ }));

    await waitFor(() => expect(approveProposals).toHaveBeenCalled());
    expect(approveProposals.mock.calls[0][0]).toEqual([
      { proposal_id: "prop-1", sale_unit: "glass", sale_volume_ml: 175 },
    ]);
  });

  it("reads a serve typed in ounces and says it in both units in a US house (F-1381)", async () => {
    house.country = "US";
    const user = userEvent.setup();
    render(<PosMappingPanel isOpen onClose={() => {}} inventory={inventory} />);

    await screen.findByText("ext-1");
    await user.click(screen.getByLabelText("Confirm Alvear Solera 1927"));
    await user.click(screen.getByRole("button", { name: "Other size" }));
    await user.type(screen.getByLabelText("Millilitres for Alvear Solera 1927"), "1.5 oz");
    expect(screen.getByTestId("serve-read-as").textContent).toBe("= 44 ml (1.5 oz)");
    await user.click(screen.getByRole("button", { name: "Use this size" }));
    await user.click(screen.getByRole("button", { name: /Confirm 1/ }));

    await waitFor(() => expect(approveProposals).toHaveBeenCalled());
    expect(approveProposals.mock.calls[0][0]).toEqual([
      { proposal_id: "prop-1", sale_unit: "shot", sale_volume_ml: 44 },
    ]);
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
        /will be confirmed as the right\s+item, but their sales will keep queueing/i,
      ),
    ).toBeInTheDocument();
  });

  it("lets a bar state a shot or pint size, asked rather than guessed (F-720)", async () => {
    const user = userEvent.setup();
    render(<PosMappingPanel isOpen onClose={() => {}} inventory={inventory} />);

    await screen.findByText("ext-1");
    await user.click(screen.getByLabelText("Confirm Alvear Solera 1927"));
    await user.click(screen.getByRole("button", { name: "Other size" }));
    // No size is pre-filled, so the form cannot be used until one is typed.
    const use = screen.getByRole("button", { name: "Use this size" });
    expect(use).toBeDisabled();
    await user.selectOptions(
      screen.getByLabelText("Serve for Alvear Solera 1927"),
      "shot",
    );
    await user.type(
      screen.getByLabelText("Millilitres for Alvear Solera 1927"),
      "50",
    );
    await user.click(use);
    expect(screen.getByRole("button", { name: /shot 50ml/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Confirm 1/ }));

    await waitFor(() => expect(approveProposals).toHaveBeenCalled());
    expect(approveProposals.mock.calls[0][0]).toEqual([
      { proposal_id: "prop-1", sale_unit: "shot", sale_volume_ml: 50 },
    ]);
  });

  it("lets a queued button with no sale size be answered as a pint, with its ml (F-720)", async () => {
    getMatchProposals.mockResolvedValue([]);
    getUnresolvedLines.mockResolvedValue(
      queue({
        items: [
          {
            source: "simpos",
            external_item_id: "ext-9",
            item_name: "Efes Draft",
            reason: "no_sale_volume",
            mapped_inventory_id: "inv-1",
            occurrences: 6,
            qty_total: 6,
            revenue_total: 48,
            first_seen: null,
            last_seen: null,
            line_ids: [],
          },
        ],
      }),
    );
    getItemMappings.mockResolvedValue([
      {
        id: "map-9",
        source: "simpos",
        external_item_id: "ext-9",
        item_name: "Efes Draft",
        is_wine: true,
        inventory_id: "inv-1",
        master_wine_id: null,
        sale_unit: null,
        sale_volume_ml: null,
        updated_at: null,
      },
    ]);
    setSaleUnits.mockResolvedValue({
      results: [{ mapping_id: "map-9", ok: true }],
    });
    const user = userEvent.setup();
    render(<PosMappingPanel isOpen onClose={() => {}} inventory={inventory} />);

    await screen.findByText("Efes Draft");
    await user.click(screen.getByRole("button", { name: "Other size" }));
    const use = screen.getByRole("button", { name: "Use this size" });
    expect(use).toBeDisabled();
    await user.selectOptions(
      screen.getByLabelText("Serve for Efes Draft"),
      "pint",
    );
    await user.type(screen.getByLabelText("Millilitres for Efes Draft"), "568");
    await user.click(use);

    await waitFor(() => expect(setSaleUnits).toHaveBeenCalled());
    expect(setSaleUnits).toHaveBeenCalledWith(
      [{ mapping_id: "map-9", sale_unit: "pint", sale_volume_ml: 568 }],
      undefined,
    );
  });

  it("does not call an unmatched drink safe to ignore — only food (F-719)", async () => {
    getUnresolvedLines.mockResolvedValue(
      queue({
        items: [
          {
            source: "simpos",
            external_item_id: "ext-9",
            item_name: "Efes Draft",
            reason: "unmapped",
            occurrences: 3,
            qty_total: 3,
          },
        ],
      }),
    );
    render(<PosMappingPanel isOpen onClose={() => {}} inventory={inventory} />);

    const note = await screen.findByText(/matched nothing in inventory/i);
    expect(note.textContent).not.toMatch(/drinks that are not wine/i);
    expect(note.textContent).toMatch(/Food belongs\s+here and is safe to ignore/);
    expect(note.textContent).toMatch(/beer/);
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
