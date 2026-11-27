import { DocumentsController } from "./documents.controller";

/** A thenable fake db: one canned answer per table, every call chains. */
const HOUSE = { procurement_documents: { data: { id: "d1", currency: "USD" }, error: null }, restaurants: { data: { currency: "USD" }, error: null }, document_deliveries: { data: [], error: null } };
function controllerWith(results: Record<string, { data: unknown; error: unknown }>) {
  results = { ...HOUSE, ...results };
  const db = {
    getClient: () => ({
      from: (table: string) => {
        const b: any = {};
        for (const m of ["select", "eq", "order", "limit", "in", "not"]) b[m] = () => b;
        b.maybeSingle = () => Promise.resolve(results[table]);
        b.then = (res: any, rej: any) => Promise.resolve(results[table]).then(res, rej);
        return b;
      },
    }),
  };
  const Ctor = DocumentsController as any;
  return new Ctor({}, db, ...Array.from({ length: 10 }, () => ({}))) as DocumentsController;
}

const user = { userId: "u1", restaurantId: "rest-1", role: "owner" } as any;
const line = (over: Record<string, unknown>) => ({
  id: "l1",
  line_no: 1,
  description: "Albariño 2022",
  uom: "bottle",
  unit_price: 11.8,
  inventory_id: "g1",
  ...over,
});
const lot = (cost: number, at: string, good = "g1", delivery_id: string | null = null) => ({ inventory_id: good, unit_cost: cost, received_at: at, delivery_id });

describe("DocumentsController.priceMoves — a cost that jumped with no PO to catch it (r104 g4)", () => {
  it("says what moved, against the good's NEWEST invoiced lot", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({})], error: null },
      inventory_lots: { data: [lot(10, "2026-11-01"), lot(7, "2026-06-01")], error: null },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, moved: true, sentence: "was 10.00, now 11.80, up 18 percent" });
  });

  it("has no sentence when the good has no previous cost", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({})], error: null },
      inventory_lots: { data: [], error: null },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toEqual(expect.objectContaining({ compared: false, reason: "no_previous" }));
    expect((out.lines[0] as any).sentence).toBeUndefined();
  });
  it("carries both currency codes so the page can say why nothing was compared (r106)", async () => {
    const c = controllerWith({
      procurement_documents: { data: { id: "d1", currency: "TRY" }, error: null },
      procurement_document_lines: { data: [line({})], error: null },
      inventory_lots: { data: [], error: null },
    });
    expect(await c.priceMoves("d1", user)).toMatchObject({ paperCurrency: "TRY", houseCurrency: "USD" });
  });

  it("does not compare a line priced per case against a bottle cost", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({ uom: "case" })], error: null },
      inventory_lots: { data: [lot(10, "2026-11-01")], error: null },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toEqual(expect.objectContaining({ compared: false, reason: "unit_differs" }));
  });

  it("never reads a failed lot read as 'nothing moved'", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({})], error: null },
      inventory_lots: { data: null, error: { message: "boom" } },
    });
    await expect(c.priceMoves("d1", user)).rejects.toMatchObject({ status: 500 });
  });

  it("takes a house threshold", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({})], error: null },
      inventory_lots: { data: [lot(10, "2026-11-01")], error: null },
    });
    const out = await c.priceMoves("d1", user, "25");
    expect(out.lines[0]).toMatchObject({ compared: true, moved: false });
  });

  it("does not compare a TRY paper's price with a USD lot cost", async () => {
    const c = controllerWith({
      procurement_documents: { data: { id: "d1", currency: "TRY" }, error: null },
      procurement_document_lines: { data: [line({ unit_price: 12.5 })], error: null },
      inventory_lots: { data: [lot(10, "2026-11-01")], error: null },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toEqual(expect.objectContaining({ compared: false, reason: "currency_differs" }));
    expect((out.lines[0] as any).sentence).toBeUndefined();
  });

  it("compares nothing when a currency is unknown, and says so", async () => {
    const c = controllerWith({
      procurement_documents: { data: { id: "d1", currency: null }, error: null },
      procurement_document_lines: { data: [line({})], error: null },
      inventory_lots: { data: [lot(10, "2026-11-01")], error: null },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toEqual(expect.objectContaining({ compared: false, reason: "currency_unknown" }));
  });

  it("answers 404 in words for a paper that is not this house's", async () => {
    const c = controllerWith({
      procurement_documents: { data: null, error: null },
      procurement_document_lines: { data: [line({})], error: null },
    });
    await expect(c.priceMoves("foreign", user)).rejects.toMatchObject({ status: 404 });
    await expect(c.priceMoves("foreign", user)).rejects.toThrow(/not one of this house's/);
  });

  it("a failed house-currency read says it failed", async () => {
    const c = controllerWith({
      restaurants: { data: null, error: { message: "boom" } },
      procurement_document_lines: { data: [line({})], error: null },
    });
    await expect(c.priceMoves("d1", user)).rejects.toMatchObject({ status: 500 });
  });
});

describe("DocumentsController.priceMoves at the exact threshold, through the lot read (r108, DD-r108-23)", () => {
  // The lot cost arrives from numeric(14,6) as a number or, from some drivers,
  // as its decimal string; both must land on the same exact verdict.
  it.each([
    [1, "1.1"],
    [2, "2.2"],
    [3, "3.3"],
    [20, "22"],
    ["1.000000", 1.1],
    ["3.000000", 3.3],
  ])("a lot at %s and a line at %s is not moved (exactly 10 percent)", async (cost, price) => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({ unit_price: price })], error: null },
      inventory_lots: { data: [lot(cost as number, "2026-11-01")], error: null },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, moved: false });
    expect((out.lines[0] as any).sentence ?? null).toBeNull();
  });

  it.each([
    [1, 1.11, "was 1.00, now 1.11, up 11 percent"],
    [20, 22.01, "was 20.00, now 22.01, up 10.1 percent"],
    [3, 2.69, "was 3.00, now 2.69, down 10.3 percent"],
  ])("a lot at %s and a line at %s is moved: %s", async (cost, price, sentence) => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({ unit_price: price })], error: null },
      inventory_lots: { data: [lot(cost, "2026-11-01")], error: null },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, moved: true, sentence });
  });
});

describe("DocumentsController.priceMoves — who may read a landed cost, and which lot is 'before' (r107)", () => {
  it("refuses a staff session in words: the previous cost is the house's landed cost", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({})], error: null },
      inventory_lots: { data: [lot(10, "2026-11-01")], error: null },
    });
    await expect(c.priceMoves("d1", { ...user, role: "staff" })).rejects.toMatchObject({ status: 403 });
    await expect(c.priceMoves("d1", { ...user, role: "staff" })).rejects.toThrow(/owner's or a manager's/);
    await expect(c.priceMoves("d1", { ...user, role: undefined })).rejects.toMatchObject({ status: 403 });
    await expect(c.priceMoves("d1", { ...user, role: "manager" })).resolves.toBeDefined();
  });

  it("does not compare a paper with the lot its own delivery landed, nor a later one", async () => {
    // Freight alone moved the landed lot to 10.00; the paper's own price is 11.20.
    const c = controllerWith({
      document_deliveries: { data: [{ delivery_id: "del-1" }], error: null },
      procurement_document_lines: { data: [line({ unit_price: 11.2 })], error: null },
      inventory_lots: {
        data: [
          lot(13, "2026-12-01", "g1", "del-later"), // received after this paper
          lot(10, "2026-11-10", "g1", "del-1"), // this paper's own landed lot
          lot(11.2, "2026-10-01", "g1", "del-0"), // what came before it
        ],
        error: null,
      },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, moved: false });
  });

  it("an unread delivery list is a 500 in words, never an unbounded comparison", async () => {
    const c = controllerWith({
      document_deliveries: { data: null, error: { message: "boom" } },
      procurement_document_lines: { data: [line({})], error: null },
      inventory_lots: { data: [lot(10, "2026-11-01")], error: null },
    });
    await expect(c.priceMoves("d1", user)).rejects.toMatchObject({ status: 500 });
  });
});
