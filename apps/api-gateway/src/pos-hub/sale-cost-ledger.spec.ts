import { pickSaleCostSource, snapshotLineCost } from "./sale-cost";

// DD-r103-9 / DD-r104-10: a whole-bottle line costs what its ledger row says
// the drawn lots cost; a pour has no ledger row and stays on WAC under its own
// basis word.

const lots = [
  {
    id: "lot-a",
    qty: 3,
    unit_cost: 12,
    source_order_id: "ord-a",
    received_at: "2026-01-01",
  },
  {
    id: "lot-b",
    qty: 2,
    unit_cost: 14,
    source_order_id: "ord-b",
    received_at: "2026-02-01",
  },
];
// The recorded cost is 13 a bottle; FIFO drew 12.80.
const source = () =>
  pickSaleCostSource({ last_purchase_price: 13 }, null, lots);

describe("a whole-bottle line reads its ledger row", () => {
  const row = {
    quantity_change: -5,
    unit_cost: 12.8,
    cost_total: 64,
    unpriced_qty: 0,
  };

  it("costs 5 bottles drawn 3 at 12 and 2 at 14 at 12.80 a bottle, equal to the row", () => {
    const snap = snapshotLineCost(source(), "whole_bottle", 3750, 750, 5, row);
    expect(snap.cost_at_sale).toBe(64);
    expect(snap.cost_unit_at_sale).toBe(12.8);
    expect(snap.cost_at_sale).toBe(row.cost_total);
  });

  it("keeps its source's basis word so a verified invoice can still restate it", () => {
    const snap = snapshotLineCost(source(), "whole_bottle", 3750, 750, 5, row);
    expect(snap.cost_basis).toBe("last_purchase_price");
    expect(snap.cost_source_order_id).toBe("ord-a");
  });

  it("falls back to the recorded cost when a bottle left unpriced (never a lower number)", () => {
    const snap = snapshotLineCost(source(), "whole_bottle", 3750, 750, 5, {
      ...row,
      cost_total: 36,
      unpriced_qty: 2,
    });
    expect(snap.cost_at_sale).toBe(65);
    expect(snap.cost_unit_at_sale).toBe(13);
  });

  it("falls back when the row is for another quantity or is not a depletion", () => {
    expect(
      snapshotLineCost(source(), "whole_bottle", 3000, 750, 4, row).cost_at_sale,
    ).toBe(52);
    expect(
      snapshotLineCost(source(), "whole_bottle", 3750, 750, 5, {
        ...row,
        quantity_change: 5,
      }).cost_at_sale,
    ).toBe(65);
  });
});

describe("a pour keeps WAC under its own basis word", () => {
  it("never reads a ledger row, and a bottle's worth of pours costs the bottle", () => {
    const rowThatWouldChangeIt = {
      quantity_change: -1,
      cost_total: 99,
      unpriced_qty: 0,
    };
    const snap = snapshotLineCost(
      pickSaleCostSource({ last_purchase_price: 64 }, null, [
        { id: "l", qty: 1, unit_cost: 64, received_at: "2026-01-01" },
      ]),
      "volume",
      150,
      750,
      1,
      rowThatWouldChangeIt,
    );
    expect(snap.cost_at_sale).toBe(12.8);
  });

  it("words an invoiced-lot pour as a pour, and leaves a last-price pour restatable", () => {
    const src = (basis: any) => ({
      unitCost: 64,
      basis,
      lotId: "l",
      orderId: "o",
    });
    expect(
      snapshotLineCost(src("invoice_lot_wac"), "volume", 150, 750, 1).cost_basis,
    ).toBe("pour_lot_wac");
    expect(
      snapshotLineCost(src("invoice_lot_wac_partial"), "volume", 150, 750, 1)
        .cost_basis,
    ).toBe("pour_lot_wac_partial");
    expect(
      snapshotLineCost(src("last_purchase_price"), "volume", 150, 750, 1)
        .cost_basis,
    ).toBe("last_purchase_price");
  });
});

describe("the basis word says how the line was costed (r105)", () => {
  const wac = (basis: any) => ({ unitCost: 13, basis, lotId: "l", orderId: "o" });
  const row = { quantity_change: -3, unit_cost: 10.333333, cost_total: 31, unpriced_qty: 0 };

  it("words a line costed from its drawn lots apart from one costed at the recorded WAC", () => {
    expect(snapshotLineCost(wac("invoice_lot_wac"), "whole_bottle", 2250, 750, 3, row).cost_basis).toBe(
      "ledger_lot_draw",
    );
    expect(snapshotLineCost(wac("invoice_lot_wac_partial"), "whole_bottle", 2250, 750, 3, row).cost_basis).toBe(
      "ledger_lot_draw",
    );
    // The same line with no usable row fell back to WAC, and says so.
    expect(snapshotLineCost(wac("invoice_lot_wac"), "whole_bottle", 2250, 750, 3, null).cost_basis).toBe(
      "invoice_lot_wac",
    );
    expect(
      snapshotLineCost(wac("invoice_lot_wac"), "whole_bottle", 2250, 750, 3, { ...row, unpriced_qty: 1 }).cost_basis,
    ).toBe("invoice_lot_wac");
  });

  it("a last-price line keeps its word even when drawn, so a verified invoice can still restate it", () => {
    expect(snapshotLineCost(wac("last_purchase_price"), "whole_bottle", 2250, 750, 3, row).cost_basis).toBe(
      "last_purchase_price",
    );
  });

  it("words the fractional share of a bottle-mode line as a pour, and never reads a ledger row for it", () => {
    const snap = snapshotLineCost(wac("invoice_lot_wac"), "whole_bottle", 375, 750, 0.5, row, "fraction");
    expect(snap.cost_basis).toBe("pour_lot_wac");
    expect(snap.cost_at_sale).toBe(6.5);
    expect(
      snapshotLineCost(wac("invoice_lot_wac_partial"), "whole_bottle", 375, 750, 0.5, null, "fraction").cost_basis,
    ).toBe("pour_lot_wac_partial");
  });

  it("keeps the unit cost to six places: 31.00 over 3 bottles is 10.333333, not 10.3333", () => {
    const snap = snapshotLineCost(wac("invoice_lot_wac"), "whole_bottle", 2250, 750, 3, {
      quantity_change: -3,
      cost_total: 31,
      unpriced_qty: 0,
    });
    expect(snap.cost_unit_at_sale).toBe(10.333333);
    // The ledger's own unit cost is used when it agrees with the total.
    expect(snapshotLineCost(wac("invoice_lot_wac"), "whole_bottle", 2250, 750, 3, row).cost_unit_at_sale).toBe(
      10.333333,
    );
  });
});

