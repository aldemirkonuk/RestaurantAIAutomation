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

vi.mock("../../services/api/posHub", () => ({
  getMatchProposals,
  getUnresolvedLines,
  getItemMappings,
  approveProposals,
  rejectProposal,
  runCatalogMatch,
  setSaleUnits,
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

beforeEach(() => {
  vi.clearAllMocks();
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
