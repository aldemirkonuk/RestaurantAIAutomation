// Cost-math lane 1.4: the pure half of "VERIFIED posts the landed cost".
// Every fixture is SYNTHETIC; the gatekeeper (perBottleLotCost) builds each
// line's per-bottle input exactly as the service does.
import { perBottleLotCost } from "./lot-unit-cost";
import {
  houseTaxForLotCost,
  landDelivery,
  paidBottles,
  PaperHeaderRow,
  PaperLine,
  PaperLineRow,
} from "./paper-landed-cost";

const A = "item-a";
const B = "item-b";

function row(over: Partial<PaperLineRow> = {}): PaperLineRow {
  return {
    document_id: "inv-1",
    line_no: 1,
    inventory_id: A,
    qty_bottles: 10,
    free_goods_qty: 0,
    unit_price: 60,
    uom: "bottle",
    pack_size: 1,
    line_total: 600,
    allowance: null,
    deposit: null,
    ...over,
  };
}
function line(over: Partial<PaperLineRow> = {}): PaperLine {
  const r = row(over);
  return {
    row: r,
    cost: perBottleLotCost({
      unit_price: r.unit_price,
      uom: r.uom,
      pack_size: r.pack_size,
      price_base_qty: null,
      price_base_uom: null,
      qty_bottles: paidBottles(r),
      line_total: r.line_total,
    }),
  };
}
const head = (over: Partial<PaperHeaderRow> = {}): PaperHeaderRow => ({
  id: "inv-1",
  doc_number: "A-1",
  ...over,
});
const run = (
  h: Partial<PaperHeaderRow>,
  lines: PaperLine[],
  booked: Record<string, number>,
) =>
  landDelivery({
    papers: [head(h)],
    lines,
    booked: new Map(Object.entries(booked)),
  });
const cost = (r: ReturnType<typeof run>, id: string) =>
  r.byItem.get(id)?.unitCost;
const two = () => [
  line(),
  line({ line_no: 2, inventory_id: B, unit_price: 40, line_total: 400 }),
];

describe("houseTaxForLotCost (ADR 0359 C2, lane 3.5a)", () => {
  it("is unset until the house says, so nothing is reclaimed or added", () => {
    expect(houseTaxForLotCost()).toEqual({
      tax_basis: "unset",
      reclaims_input_tax: null,
    });
  });
});

describe("paidBottles", () => {
  it("takes the free goods, in the line's unit, out of the bottles", () => {
    expect(
      paidBottles(
        row({ qty_bottles: 24, free_goods_qty: 1, uom: "case", pack_size: 12 }),
      ),
    ).toBe(12);
    expect(paidBottles(row({ qty_bottles: 12, free_goods_qty: 1 }))).toBe(11);
    expect(paidBottles(row({ qty_bottles: null }))).toBeNull();
  });
});

describe("landDelivery", () => {
  it("(a) shares freight by value: 66 and 44", () => {
    const r = run({ freight: 100 }, two(), { [A]: 10, [B]: 10 });
    expect([cost(r, A), cost(r, B)]).toEqual([66, 44]);
    expect(r.byItem.get(A)?.landed).toMatchObject({
      netLineValue: 600,
      chargeShare: 60,
      landedCostPerBottle: 66,
    });
  });

  it("(d) pools two lines of one item by value: 11.00", () => {
    const r = run(
      {},
      [
        line({ qty_bottles: 12, unit_price: 10, line_total: 120 }),
        line({ line_no: 2, qty_bottles: 6, unit_price: 13, line_total: 78 }),
      ],
      { [A]: 18 },
    );
    expect(cost(r, A)).toBe(11);
    expect(r.refused.size).toBe(0);
  });

  it("(e) a free line dilutes: 120 / 13 = 9.23, the same on every run", () => {
    const lines = [
      line({ qty_bottles: 12, unit_price: 10, line_total: 120 }),
      line({ line_no: 2, qty_bottles: 1, unit_price: 0, line_total: 0 }),
    ];
    expect(cost(run({}, lines, { [A]: 13 }), A)).toBe(9.23);
    expect(cost(run({}, lines, { [A]: 13 }), A)).toBe(9.23);
  });

  it("(g) short bottles stay out of cost: 12 listed @ 22, 10 booked → 22.00", () => {
    const r = run(
      {},
      [line({ qty_bottles: 12, unit_price: 22, line_total: 264 })],
      { [A]: 10 },
    );
    expect(cost(r, A)).toBe(22);
    expect(r.byItem.get(A)?.landed.acceptedBottles).toBe(10);
  });

  it("(g2) extra bottles take the same cost and are named", () => {
    const r = run(
      {},
      [line({ qty_bottles: 12, unit_price: 22, line_total: 264 })],
      { [A]: 14 },
    );
    expect(cost(r, A)).toBe(22);
    expect(r.byItem.get(A)?.basis).toMatch(
      /2 bottles more than the invoice lists/,
    );
  });

  it("(h) short across two lines holds, with the sentence", () => {
    const r = run(
      {},
      [
        line({ qty_bottles: 12, unit_price: 10, line_total: 120 }),
        line({ line_no: 2, qty_bottles: 6, unit_price: 13, line_total: 78 }),
      ],
      { [A]: 15 },
    );
    expect(r.byItem.has(A)).toBe(false);
    expect(r.held.get(A)).toMatch(/which line was short is not known/);
  });

  it("(i) the cost tax basis is null and says why", () => {
    const p = run({ tax: 18 }, two(), { [A]: 10, [B]: 10 }).byItem.get(A);
    expect(p?.costTaxBasis).toBeNull();
    expect(p?.taxSaid).toMatch(/the house has not set its tax basis/);
    expect(p?.basis).toMatch(/cost tax basis: none/);
  });

  it("(j) pairs the single unattached line with the single booked item", () => {
    const r = run(
      { freight: 12 },
      [
        line({
          inventory_id: null,
          qty_bottles: 12,
          unit_price: 10,
          line_total: 120,
        }),
      ],
      { [A]: 12 },
    );
    expect(cost(r, A)).toBe(11);
    expect(r.paired.get("inv-1:1")).toBe(A);
  });

  it("does not pair when two unattached lines could be the item", () => {
    const r = run(
      {},
      [line({ inventory_id: null }), line({ line_no: 2, inventory_id: null })],
      { [A]: 20 },
    );
    expect(r.paired.size).toBe(0);
    expect(r.byItem.size).toBe(0);
  });

  it("a refused line with freight on the paper holds every item on it", () => {
    const r = run(
      { freight: 100 },
      [line({ uom: "case", pack_size: 1, unit_price: 264 }), two()[1]],
      { [A]: 10, [B]: 10 },
    );
    expect(r.byItem.size).toBe(0);
    expect(r.refused.has(A)).toBe(true);
    expect(r.held.get(B)).toMatch(/cannot be shared out/);
  });

  it("a discount larger than stock and charges is unresolved", () => {
    const r = run({ discount_total: 2000 }, two(), { [A]: 10, [B]: 10 });
    expect(r.byItem.size).toBe(0);
    expect(r.held.get(A)).toMatch(/more than/);
  });

  it("a negative charge is unresolved", () => {
    const r = run({ freight: -10 }, two(), { [A]: 10, [B]: 10 });
    expect(r.byItem.size).toBe(0);
    expect(r.held.get(A)).toMatch(/negative/);
  });

  it("an invoice line whose header is missing holds its item", () => {
    const r = landDelivery({
      papers: [],
      lines: two(),
      booked: new Map([
        [A, 10],
        [B, 10],
      ]),
    });
    expect(r.byItem.size).toBe(0);
    expect(r.held.get(A)).toMatch(
      /totals of the invoice .* could not be found/,
    );
  });

  it("pools one item across two invoices by value", () => {
    const r = landDelivery({
      papers: [head({ freight: 10 }), head({ id: "inv-2", doc_number: "B-2" })],
      lines: [
        line({ qty_bottles: 10, unit_price: 10, line_total: 100 }),
        line({
          document_id: "inv-2",
          qty_bottles: 10,
          unit_price: 12,
          line_total: 120,
        }),
      ],
      booked: new Map([[A, 20]]),
    });
    // (100 + 10 + 120) / 20 = 11.50
    expect(cost(r, A)).toBe(11.5);
    expect(r.papers.map((p) => p.docNumber)).toEqual(["A-1", "B-2"]);
  });
});
