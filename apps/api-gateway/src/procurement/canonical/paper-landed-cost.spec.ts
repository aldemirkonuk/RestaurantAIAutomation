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

  it("(e) a free line dilutes: 120 / 13 = 9.230769 to six places, the same on every run", () => {
    const lines = [
      line({ qty_bottles: 12, unit_price: 10, line_total: 120 }),
      line({ line_no: 2, qty_bottles: 1, unit_price: 0, line_total: 0 }),
    ];
    expect(cost(run({}, lines, { [A]: 13 }), A)).toBe(9.230769);
    expect(cost(run({}, lines, { [A]: 13 }), A)).toBe(9.230769);
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

describe("cents add back to the invoice (QA round 15, finding 3)", () => {
  const C = "item-c";
  // What the lots hold once posted: bottles x cost per bottle, to the cent.
  const lotValue = (r: ReturnType<typeof run>, id: string, bottles: number) =>
    Math.round((cost(r, id) as number) * bottles * 100) / 100;

  it("three items of 3 @ 10 with 1.00 freight post lots worth 91.00, not 90.99", () => {
    const r = run(
      { freight: 1 },
      [
        line({ qty_bottles: 3, unit_price: 10, line_total: 30 }),
        line({ line_no: 2, inventory_id: B, qty_bottles: 3, unit_price: 10, line_total: 30 }),
        line({ line_no: 3, inventory_id: C, qty_bottles: 3, unit_price: 10, line_total: 30 }),
      ],
      { [A]: 3, [B]: 3, [C]: 3 },
    );
    const shares = [A, B, C].map((id) => r.byItem.get(id)?.landed.chargeShare);
    expect(shares).toEqual([0.34, 0.33, 0.33]);
    expect(cost(r, A)).toBe(10.113333);
    expect(cost(r, B)).toBe(10.11);
    const total = [A, B, C].reduce((s, id) => s + lotValue(r, id, 3), 0);
    expect(Math.round(total * 100) / 100).toBe(91);
  });

  it("4.90 freight over 1000 bottles at 10 posts 10.0049 a bottle and does not vanish", () => {
    const r = run(
      { freight: 4.9 },
      [line({ qty_bottles: 1000, unit_price: 10, line_total: 10000 })],
      { [A]: 1000 },
    );
    expect(cost(r, A)).toBe(10.0049);
    expect(lotValue(r, A, 1000)).toBe(10004.9);
    expect(r.byItem.get(A)?.basis).toMatch(/posted as 10\.0049 a bottle, which adds back to 10004\.90/);
  });

  it("a 2.00 discount over three equal lines takes 0.67, 0.67, 0.66 and adds back exactly", () => {
    const r = run(
      { discount_total: 2 },
      [
        line({ qty_bottles: 3, unit_price: 10, line_total: 30 }),
        line({ line_no: 2, inventory_id: B, qty_bottles: 3, unit_price: 10, line_total: 30 }),
        line({ line_no: 3, inventory_id: C, qty_bottles: 3, unit_price: 10, line_total: 30 }),
      ],
      { [A]: 3, [B]: 3, [C]: 3 },
    );
    const d = [A, B, C].map((id) => r.byItem.get(id)?.landed.discountShare);
    expect(d).toEqual([-0.67, -0.67, -0.66]);
    const total = [A, B, C].reduce((s, id) => s + lotValue(r, id, 3), 0);
    expect(Math.round(total * 100) / 100).toBe(88);
  });

  it("more bottles than six places can carry to the cent stay provisional, by name", () => {
    const r = run(
      { freight: 0.01 },
      [line({ qty_bottles: 30000, unit_price: 1, line_total: 30000 })],
      { [A]: 30000 },
    );
    expect(cost(r, A)).toBeUndefined();
    expect(r.held.get(A)).toMatch(/too many for a cost per bottle to six places/);
  });
});

describe("a paper not in the house's money is never costed as the house's (QA round 15, finding 5)", () => {
  const land = (papers: Partial<PaperHeaderRow>[], lines: PaperLine[], house: string | null, a = 10) =>
    landDelivery({ papers: papers.map((p) => head(p)), lines, booked: new Map([[A, a], [B, 10]]), houseCurrency: house });

  it.each([
    ["EUR", "TRY", /its invoice is in EUR and this house keeps its costs in TRY; no exchange rate is recorded/],
    [null, "USD", /does not say what currency it is in, and this house keeps its costs in USD/],
    ["lira", "TRY", /gives its currency as "lira", which is not a currency code/],
  ])("a %s paper in a %s house holds every item by name, with no fallback", (paper, house, why) => {
    const r = land([{ currency: paper, freight: 10 }], two(), house);
    expect(r.byItem.size).toBe(0);
    expect(r.held.get(A)).toMatch(why);
    expect(r.held.get(B)).toMatch(/The lot stays provisional\.$/);
    expect([...r.foreign].sort()).toEqual([A, B]);
    expect(r.papers[0].leftOut).toMatch(/^Nothing on it was costed: /);
  });

  it("a paper in the house's money, any case, costs as before", () => {
    const r = land([{ currency: "try", freight: 10 }], two(), "TRY");
    expect([cost(r, A), cost(r, B), r.foreign.size]).toEqual([60.6, 40.4, 0]);
  });

  it("an item on a USD and a EUR paper is held: currencies are never added", () => {
    const r = land([{ currency: "USD" }, { id: "inv-2", currency: "EUR" }], [line(), line({ document_id: "inv-2" })], null, 20);
    expect(cost(r, A)).toBeUndefined();
    expect(r.held.get(A)).toMatch(/its invoices are in USD and EUR, and costs in different currencies are never added together/);
  });

  it("a house with no currency named costs the paper in the paper's money, and says so", () => {
    const r = land([{ currency: "EUR" }], [line()], null);
    expect(cost(r, A)).toBe(60);
    expect(r.byItem.get(A)?.basis).toMatch(/Costed in EUR, the invoice's currency: this house has not named the currency it keeps its costs in\./);
  });
});
