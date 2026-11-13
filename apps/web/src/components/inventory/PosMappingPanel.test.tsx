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
const confirmPourSize = vi.hoisted(() => vi.fn());
const confirmWinePour = vi.hoisted(() => vi.fn());

vi.mock("../../services/api/posHub", () => ({
  getMatchProposals,
  getUnresolvedLines,
  getItemMappings,
  approveProposals,
  rejectProposal,
  runCatalogMatch,
  setSaleUnits,
}));
vi.mock("../../services/api/pricing", () => ({ getTargetMargin, confirmPourSize, confirmWinePour }));
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

/**
 * r26 (menu-pos-mount): a glass or a shot waits for a confirmed pour, and no
 * screen confirmed one (TargetMarginSection is mounted nowhere). The pour is
 * confirmed in the panel, beside the button that waits for it.
 */
describe("PosMappingPanel — a pour is confirmed where the size waits for it", () => {
  const queuedRioja = () => {
    getMatchProposals.mockResolvedValue([]);
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
  };

  it("an owner confirms the house glass with Enter, and a wine's glass can then be picked", async () => {
    confirmPourSize.mockResolvedValue({
      readable: true,
      reason: null,
      pour: { confirmed: true, ml: 140, confirmedAt: "2026-11-13T10:00:00Z", confirmedBy: { userId: "u1", name: "Aylin" } },
    });
    const user = userEvent.setup();
    render(<PosMappingPanel isOpen onClose={() => {}} canManage inventory={good({ kind: "wine", bottleMl: 750 })} />);

    await screen.findByText("ext-1");
    expect(screen.getByTestId("house-pour")).toHaveTextContent("The house's glass of wine is not confirmed.");
    expect(screen.getByRole("button", { name: "Glass: size not known" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Confirm the house glass" }));
    const box = screen.getByLabelText("The house's glass of wine, in ml");
    // It never starts from the database's 150 default.
    expect(box).toHaveValue("");
    expect(box).toHaveFocus();
    await user.type(box, "140");
    expect(screen.getByTestId("pour-box")).toHaveTextContent("Confirm records the house's glass of wine as 140 ml.");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(confirmPourSize).toHaveBeenCalledWith(140));
    expect(await screen.findByRole("button", { name: "Glass 140ml" })).toBeEnabled();
    expect(screen.getByTestId("house-pour")).toHaveTextContent("pours the house's 140 ml, confirmed by Aylin");
    expect(screen.queryByTestId("pour-box")).toBeNull();
    // Confirming a pour picks nothing for the person.
    expect(screen.getByRole("button", { name: "Glass 140ml" })).toHaveAttribute("aria-pressed", "false");
  });

  it("staff are told who can confirm it, with no box", async () => {
    render(<PosMappingPanel isOpen onClose={() => {}} inventory={good({ kind: "wine", bottleMl: 750 })} />);
    await screen.findByText("ext-1");
    expect(screen.getByTestId("house-pour")).toHaveTextContent("Only an owner or a manager can confirm it.");
    expect(screen.queryByRole("button", { name: /Confirm the house glass|Confirm a glass size/ })).toBeNull();
  });

  it("a house pour that could not be read says so, and offers no confirm", async () => {
    getTargetMargin.mockRejectedValue(new Error("network down"));
    render(<PosMappingPanel isOpen onClose={() => {}} canManage inventory={good({ kind: "wine", bottleMl: 750 })} />);
    await screen.findByText("ext-1");
    expect(screen.getByTestId("house-pour")).toHaveTextContent("could not be read (network down)");
    expect(screen.queryByRole("button", { name: /house glass/ })).toBeNull();
  });

  it("an unreadable answer is not an unconfirmed pour", async () => {
    getTargetMargin.mockResolvedValue({ readable: false, reason: "the house row could not be read", pour: { confirmed: false, ml: null } });
    render(<PosMappingPanel isOpen onClose={() => {}} canManage inventory={good({ kind: "wine", bottleMl: 750 })} />);
    await screen.findByText("ext-1");
    expect(screen.getByTestId("house-pour")).toHaveTextContent("could not be read (the house row could not be read)");
  });

  it("a spirit's shot is confirmed on its row; the shot is then choosable, not chosen", async () => {
    confirmWinePour.mockResolvedValue({ inventoryId: "inv-1", pour: { confirmed: true, ml: 40 } });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(
      <PosMappingPanel isOpen onClose={() => {}} canManage onChanged={onChanged} inventory={good({ kind: "spirit", bottleMl: 700 })} />,
    );
    await screen.findByText("ext-1");
    expect(screen.getByRole("button", { name: "Shot: size not known" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Confirm a shot size" }));
    await user.type(screen.getByLabelText("One shot of Good, in ml"), "40");
    await user.click(screen.getByRole("button", { name: "Confirm pour" }));

    await waitFor(() => expect(confirmWinePour).toHaveBeenCalledWith("inv-1", 40));
    const shot = await screen.findByRole("button", { name: "Shot 40ml" });
    expect(shot).toBeEnabled();
    expect(shot).toHaveAttribute("aria-pressed", "false");
    expect(onChanged).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Good: one shot is now 40 ml.");
    await user.click(shot);
    expect(shot).toHaveAttribute("aria-pressed", "true");
  });

  it("a refused pour keeps the box open and says why; nothing becomes choosable", async () => {
    confirmWinePour.mockRejectedValue({ response: { status: 403, data: { message: "nope" } } });
    const user = userEvent.setup();
    render(<PosMappingPanel isOpen onClose={() => {}} canManage inventory={good({ kind: "spirit", bottleMl: 700 })} />);
    await screen.findByText("ext-1");
    await user.click(screen.getByRole("button", { name: "Confirm a shot size" }));
    await user.type(screen.getByLabelText("One shot of Good, in ml"), "40{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The pour was not confirmed: only an owner or a manager can confirm a pour. Nothing was recorded.",
    );
    expect(screen.getByTestId("pour-box")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shot: size not known" })).toBeDisabled();
  });

  it("Escape closes the box and sends nothing", async () => {
    const user = userEvent.setup();
    render(<PosMappingPanel isOpen onClose={() => {}} canManage inventory={good({ kind: "spirit", bottleMl: 700 })} />);
    await screen.findByText("ext-1");
    await user.click(screen.getByRole("button", { name: "Confirm a shot size" }));
    await user.type(screen.getByLabelText("One shot of Good, in ml"), "40{Escape}");
    expect(screen.queryByTestId("pour-box")).toBeNull();
    expect(confirmWinePour).not.toHaveBeenCalled();
  });

  it("a wine with no bottle size is not asked for a pour: its size is what is missing", async () => {
    render(<PosMappingPanel isOpen onClose={() => {}} canManage inventory={good({ kind: "wine" })} />);
    await screen.findByText("ext-1");
    expect(screen.getByRole("button", { name: "Glass: size not known" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Confirm a glass size" })).toBeNull();
  });

  it("a queued wine's glass waits for its own pour, which is confirmed on the queued row", async () => {
    queuedRioja();
    getTargetMargin.mockResolvedValue({ pour: { confirmed: true, ml: 150 } });
    confirmWinePour.mockResolvedValue({ inventoryId: "inv-1", pour: { confirmed: true, ml: 125 } });
    setSaleUnits.mockResolvedValue({ results: [{ mapping_id: "map-9", ok: true }] });
    const user = userEvent.setup();
    render(<PosMappingPanel isOpen onClose={() => {}} canManage inventory={good({ kind: "wine", bottleMl: 750 })} />);

    await screen.findByText("Rioja");
    expect(screen.getByRole("button", { name: "Glass 150ml" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Confirm a glass size" }));
    expect(screen.getByTestId("pour-box")).toHaveTextContent(/glass price advice uses the same pour|Type a pour/);
    await user.type(screen.getByLabelText("One glass of Good, in ml"), "125{Enter}");
    await waitFor(() => expect(confirmWinePour).toHaveBeenCalledWith("inv-1", 125));
    await user.click(await screen.findByRole("button", { name: "Glass 125ml" }));
    await waitFor(() =>
      expect(setSaleUnits).toHaveBeenCalledWith([{ mapping_id: "map-9", sale_unit: "glass" }], undefined),
    );
  });
});
