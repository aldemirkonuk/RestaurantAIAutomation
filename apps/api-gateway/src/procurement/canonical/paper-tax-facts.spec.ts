/**
 * ADR 0359 C3, lane 3.5a: a paper's lines get the tax facts the paper itself
 * proves, and the landed cost of a house that answered follows them.
 *
 * Fixtures are SYNTHETIC. Worked numbers are in each test's name.
 */
import { landDelivery, PaperHeaderRow, PaperLine } from "./paper-landed-cost";
import { paperTaxFacts, PaperTaxLine } from "./paper-tax-facts";
import { HouseTax } from "../landed-cost";
import { DatabaseService } from "../../database/database.service";
import { makeMockDb } from "./delivery-mock";
import { DeliveryStockService } from "./delivery-stock.service";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const value = (total: number, qty = 10): PaperTaxLine => ({
  kind: "value",
  printedTotal: total,
  input: {
    line_no: 1,
    allowance: null,
    deposit: null,
    price_tax_basis: null,
    vat_rate_percent: null,
    item_key: A,
    qty,
    uom: "bottle",
    pack_size: 1,
    price_base_qty: 1,
    unit_price: total / qty,
    line_total: total,
    listed_bottles: qty,
    stocked: true,
  },
});

describe("paperTaxFacts — the basis", () => {
  it("an e-Fatura file prices every line before tax, whatever its sums", () => {
    const f = paperTaxFacts({ einvoice: { kind: "e-fatura" } }, [value(1000)]);
    expect(f.basis).toBe("excludes_tax");
    expect(f.said).toMatch(/read from its e-Fatura file, which states every line before tax/);
    expect(paperTaxFacts({ einvoice: { kind: "e-arsiv" } }, [value(1000)]).basis).toBe("excludes_tax");
  });

  it("an e-İrsaliye (a despatch note) proves nothing about prices", () => {
    expect(paperTaxFacts({ einvoice: { kind: "e-irsaliye" } }, [value(1000)]).basis).toBeNull();
  });

  it("lines 1000 + tax 200 = total 1200: before tax", () => {
    const f = paperTaxFacts({ tax: 200, total: 1200 }, [value(600), value(400)]);
    expect(f.basis).toBe("excludes_tax");
    expect(f.said).toMatch(/its lines of 1000.00 and its tax of 200.00 add up to its total of 1200.00/);
  });

  it("freight 50 and discount 30 count on the before-tax side: 1000 + 50 − 30 + 204 = 1224", () => {
    expect(paperTaxFacts({ tax: 204, total: 1224, freight: 50, discount_total: 30 }, [value(1000)]).basis).toBe(
      "excludes_tax",
    );
  });

  it("lines 1100 = total 1100 with a printed base of 1000 under tax 100: tax inside", () => {
    const f = paperTaxFacts(
      { tax: 100, total: 1100, tax_breakdown: [{ rate: 10, taxableBase: 1000, amount: 100 }] },
      [value(1100)],
    );
    expect(f.basis).toBe("includes_tax");
    expect(f.said).toMatch(/read as including tax, since its lines add up to its total of 1100.00/);
  });

  it("lines = total with NO printed base is never read as tax inside: the total could be the pre-tax one", () => {
    const f = paperTaxFacts({ tax: 100, total: 1100 }, [value(1100)]);
    expect(f.basis).toBeNull();
    expect(f.said).toMatch(/it prints no base for its tax, so its total could be before tax/);
  });

  it("a pre-tax total read into the total box (lines 1000 = total 1000, base 1000, tax 200) is not tax inside", () => {
    const f = paperTaxFacts(
      { tax: 200, total: 1000, tax_breakdown: [{ rate: 20, taxableBase: 1000, amount: 200 }] },
      [value(1000)],
    );
    expect(f.basis).toBeNull();
  });

  it("says nothing when the sums do not add up either way, a line has no total, there is a deposit, or the tax is nil", () => {
    expect(paperTaxFacts({ tax: 200, total: 1300 }, [value(1000)]).basis).toBeNull();
    expect(paperTaxFacts({ tax: 200, total: 1200 }, [{ ...value(1000), printedTotal: null }]).basis).toBeNull();
    expect(paperTaxFacts({ tax: 200, total: 1230, deposit_total: 30 }, [value(1000)]).basis).toBeNull();
    expect(paperTaxFacts({ tax: 0, total: 1000 }, [value(1000)]).basis).toBeNull();
    expect(paperTaxFacts({ total: 1000 }, [value(1000)]).basis).toBeNull();
    expect(paperTaxFacts({ tax: 200, total: 1200 }, []).basis).toBeNull();
  });
});

describe("paperTaxFacts — the rate", () => {
  it("one printed rate of 20 that makes the tax (1000 × 20 % = 200) is every line's", () => {
    const f = paperTaxFacts({ tax: 200, total: 1200, tax_breakdown: [{ rate: 20 }] }, [value(600), value(400)]);
    expect(f).toMatchObject({ basis: "excludes_tax", ratePercent: 20 });
    expect(f.said).toMatch(/Every line is at 20 %, the one rate it prints, which makes its tax of 200.00/);
  });

  it("tax inside at 10 %: 1100 holds 100 of tax", () => {
    const f = paperTaxFacts(
      { tax: 100, total: 1100, tax_breakdown: [{ rate: 10, taxableBase: 1000, amount: 100 }] },
      [value(1100)],
    );
    expect(f).toMatchObject({ basis: "includes_tax", ratePercent: 10 });
  });

  it("two printed rates give no line a rate, and say why", () => {
    const f = paperTaxFacts(
      { tax: 120, total: 1120, tax_breakdown: [{ rate: 10 }, { rate: 1 }] },
      [value(600), value(400)],
    );
    expect(f).toMatchObject({ basis: "excludes_tax", ratePercent: null });
    expect(f.said).toMatch(/It prints 2 tax rates and not which line carries which/);
  });

  it("one rate that does not make the tax (20 % of 1000 is not 100) is given to no line", () => {
    const f = paperTaxFacts({ tax: 100, total: 1100, tax_breakdown: [{ rate: 20 }] }, [value(1000)]);
    expect(f).toMatchObject({ basis: "excludes_tax", ratePercent: null });
    expect(f.said).toMatch(/Its one printed rate of 20 % does not make its tax of 100.00/);
  });

  it("a deposit or unpriced line on the paper keeps the rate off every line", () => {
    const deposit: PaperTaxLine = { ...value(0), kind: "not_stocked" };
    expect(
      paperTaxFacts({ einvoice: { kind: "e-fatura" }, tax: 200, tax_breakdown: [{ rate: 20 }] }, [value(1000), deposit])
        .ratePercent,
    ).toBeNull();
    const open: PaperTaxLine = { ...value(1000), kind: "open" };
    expect(paperTaxFacts({ tax: 200, total: 1200, tax_breakdown: [{ rate: 20 }] }, [open]).ratePercent).toBeNull();
  });

  it("a rate that is not a rate is given to no line", () => {
    expect(
      paperTaxFacts({ einvoice: { kind: "e-fatura" }, tax: 200, tax_breakdown: [{ rate: 120 }] }, [value(1000)]).ratePercent,
    ).toBeNull();
  });
});

describe("landDelivery — a house that answered is costed by what its paper proves", () => {
  const reclaims: HouseTax = { tax_basis: "prices_include_tax", reclaims_input_tax: true };
  const keeps: HouseTax = { tax_basis: "prices_include_tax", reclaims_input_tax: false };
  const line = (over: Record<string, unknown> = {}): PaperLine => ({
    row: { document_id: "inv-1", line_no: 1, inventory_id: A, qty_bottles: 10, unit_price: 110, uom: "bottle", pack_size: 1, line_total: 1100, ...over } as never,
    cost: { ok: true, unitCost: Number(over.unit_price ?? 110), basis: "SYNTHETIC per bottle" } as never,
  });
  const run = (paper: Partial<PaperHeaderRow>, house: HouseTax, lines: PaperLine[] = [line()], booked: Record<string, number> = { [A]: 10 }) =>
    landDelivery({
      papers: [{ id: "inv-1", doc_number: "SYN-1", currency: "TRY", ...paper }],
      lines,
      booked: new Map(Object.entries(booked)),
      houseCurrency: "TRY",
      houseTax: house,
    });
  const fis = { tax: 100, total: 1100, tax_breakdown: [{ rate: 10, taxableBase: 1000, amount: 100 }] };

  it("a market receipt 10 × 110 with KDV 10 % inside costs a reclaiming house 100 a bottle, stamped net", () => {
    const p = run(fis, reclaims).byItem.get(A);
    expect(p?.unitCost).toBe(100);
    expect(p?.costTaxBasis).toBe("net");
    expect(p?.taxSaid).toMatch(/read as including tax/);
  });

  it("the same receipt costs a house that does not reclaim 110 a bottle, stamped gross_cost", () => {
    const p = run(fis, keeps).byItem.get(A);
    expect(p?.unitCost).toBe(110);
    expect(p?.costTaxBasis).toBe("gross_cost");
  });

  it("an e-Fatura 10 × 100 + KDV 20 % costs a reclaiming house 100 (net) and one that does not 120 (gross_cost)", () => {
    const paper = { einvoice: { kind: "e-fatura" }, tax: 200, total: 1200, tax_breakdown: [{ rate: 20, taxableBase: 1000, amount: 200 }] };
    const l = [line({ unit_price: 100, line_total: 1000 })];
    expect(run(paper, reclaims, l).byItem.get(A)).toMatchObject({ unitCost: 100, costTaxBasis: "net" });
    expect(run(paper, keeps, l).byItem.get(A)).toMatchObject({ unitCost: 120, costTaxBasis: "gross_cost" });
  });

  it("an invoice at two rates, before tax, still costs a reclaiming house net, and a keeping one as printed", () => {
    const paper = { tax: 120, total: 1120, tax_breakdown: [{ rate: 20 }, { rate: 1 }] };
    const l = [line({ unit_price: 60, line_total: 600 }), line({ line_no: 2, inventory_id: B, unit_price: 40, line_total: 400 })];
    const booked = { [A]: 10, [B]: 10 };
    const r = run(paper, reclaims, l, booked);
    expect(r.byItem.get(A)).toMatchObject({ unitCost: 60, costTaxBasis: "net" });
    const k = run(paper, keeps, l, booked);
    expect(k.byItem.get(A)).toMatchObject({ unitCost: 60, costTaxBasis: null });
    expect(k.byItem.get(A)?.taxSaid).toMatch(/It prints 2 tax rates and not which line carries which/);
  });

  it("a paper that proves nothing is costed as printed, unstamped, as before", () => {
    const p = run({ tax: 100, total: 1100 }, reclaims).byItem.get(A);
    expect(p).toMatchObject({ unitCost: 110, costTaxBasis: null });
  });

  it("freight 55 on a receipt with KDV 10 % inside is shared before tax too: (1100 + 55) / 1.1 / 10 = 105", () => {
    const paper = { tax: 105, total: 1155, freight: 55, tax_breakdown: [{ rate: 10, taxableBase: 1050, amount: 105 }] };
    expect(run(paper, reclaims).byItem.get(A)).toMatchObject({ unitCost: 105, costTaxBasis: "net" });
  });
});

describe("DeliveryStockService at VERIFIED — the paper's tax reaches the posted cost", () => {
  const REST = "11111111-1111-1111-1111-111111111111";
  const DEL = "dddddddd-dddd-dddd-dddd-dddddddddddd";

  it("asks for the paper's total, rates and e-invoice mark, and posts a market receipt at 100 net for a reclaiming house", async () => {
    const db = makeMockDb();
    db.reset();
    const asked: string[] = [];
    const real = db.client.getClient;
    db.client.getClient = () => {
      const c = real();
      return {
        ...c,
        from: (t: string) => {
          const chain = c.from(t) as { select: (...a: unknown[]) => unknown };
          if (t !== "procurement_documents") return chain;
          const select = chain.select;
          chain.select = (...a: unknown[]) => {
            asked.push(String(a[0]));
            return select(...a);
          };
          return chain;
        },
      };
    };
    db.answers.deliveries = { data: { id: DEL, state: "VERIFIED", order_id: null }, error: null };
    db.answers.document_deliveries = { data: [{ document_id: "inv-1", role: "invoice" }], error: null };
    db.answers.procurement_documents = {
      data: [{ id: "inv-1", doc_number: "SYN-1", currency: "TRY", tax: 100, total: 1100, tax_breakdown: [{ rate: 10, taxableBase: 1000, amount: 100 }] }],
      error: null,
    };
    db.answers.procurement_document_lines = {
      data: [{ document_id: "inv-1", line_no: 1, inventory_id: A, qty_bottles: 10, uom: "bottle", pack_size: 1, unit_price: 110, line_total: 1100 }],
      error: null,
    };
    db.answers.inventory_transactions = { data: [{ inventory_id: A, quantity_change: 10 }], error: null };
    db.answers.delivery_proposals = { data: [], error: null };
    db.answers.restaurants = { data: { currency: "TRY", tax_basis: "prices_include_tax", reclaims_input_tax: true }, error: null };
    const service = new DeliveryStockService(db.client as unknown as DatabaseService);
    const r = await service.finaliseAtVerified(REST, DEL, "u1");
    expect(asked[0]).toContain("total, extracted_lines:extracted->lines, tax_breakdown:extracted->taxBreakdown, einvoice:extracted->einvoice");
    const calls = db.rpcCalls.filter((c) => c.fn !== "apply_stock_movement");
    expect(calls.map((c) => [c.fn, c.args.p_unit_cost, c.args.p_cost_tax_basis])).toEqual([
      ["finalise_delivery_cost", 100, undefined],
      ["stamp_delivery_cost_tax_basis", 100, "net"],
    ]);
    expect(r.ok && r.value.finalised[0].costTaxBasis).toBe("net");
  });
});
