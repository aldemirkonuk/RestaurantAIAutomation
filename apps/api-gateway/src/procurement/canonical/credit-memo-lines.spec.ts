// r102: a credit-memo line (negative quantity or negative total) is never costed.
// The r56/r57 nets left "credit-memo documents with negative lines" unaudited;
// this pins what the landed-cost path does with them: it holds the lot in words
// and shares no charge across a paper it cannot read, so a credit is never
// averaged into a bottle's cost and no bottle is made cheaper by a return.
import { perBottleLotCost } from "./lot-unit-cost";
import { landDelivery, paidBottles, PaperHeaderRow, PaperLine, PaperLineRow } from "./paper-landed-cost";

function mk(over: Partial<PaperLineRow>): PaperLine {
  const r: PaperLineRow = { document_id: "d", line_no: 1, inventory_id: "a", qty_bottles: 0, free_goods_qty: 0, unit_price: 0, uom: "bottle", pack_size: 1, line_total: null, allowance: null, deposit: null, ...over };
  return { row: r, cost: perBottleLotCost({ unit_price: r.unit_price, uom: r.uom, pack_size: r.pack_size, price_base_qty: null, price_base_uom: null, qty_bottles: paidBottles(r), line_total: r.line_total }) };
}
const head = (o: Partial<PaperHeaderRow> = {}): PaperHeaderRow => ({ id: "d", doc_number: "X", currency: "USD", ...o });
const land = (h: Partial<PaperHeaderRow>, lines: PaperLine[], booked: Record<string, number>) =>
  landDelivery({ papers: [head(h)], lines, booked: new Map(Object.entries(booked)), houseCurrency: "USD" });

describe("a credit-memo line is held, never costed (r102)", () => {
  it("a negative quantity gives no cost and says why", () => {
    const res = land({}, [mk({ qty_bottles: -2, unit_price: 10, line_total: -20 })], { a: 2 });
    expect(res.byItem.size).toBe(0);
    expect([...res.held.keys()]).toEqual(["a"]);
  });

  it("a positive quantity with a negative total gives no cost and names the line", () => {
    const res = land({}, [mk({ qty_bottles: 2, unit_price: 10, line_total: -20 })], { a: 2 });
    expect(res.byItem.size).toBe(0);
    expect(res.held.get("a")).toMatch(/Line 1 prints a figure that is negative or not a number/);
  });

  it("a bill with a credit line for the same item leaves that item provisional, not cheaper", () => {
    const res = land({}, [mk({ qty_bottles: 12, unit_price: 10, line_total: 120 }), mk({ line_no: 2, qty_bottles: -2, unit_price: 10, line_total: -20 })], { a: 10 });
    expect(res.byItem.has("a")).toBe(false);
    expect(res.held.has("a")).toBe(true);
  });

  it("a credit on one item stops freight being shared out on the paper, so no line's cost is final", () => {
    const res = land({ freight: 10 }, [mk({ qty_bottles: 12, unit_price: 10, line_total: 120 }), mk({ line_no: 2, inventory_id: "b", qty_bottles: -2, unit_price: 10, line_total: -20 })], { a: 12, b: 2 });
    expect(res.byItem.size).toBe(0);
    expect(res.held.get("a")).toMatch(/charges and discount cannot be shared out and no line's cost is final/);
  });

  it("a paper with no credit line is costed as before", () => {
    const res = land({ freight: 12 }, [mk({ qty_bottles: 12, unit_price: 10, line_total: 120 })], { a: 12 });
    expect(res.byItem.get("a")!.unitCost).toBeCloseTo(11, 6);
  });
});
