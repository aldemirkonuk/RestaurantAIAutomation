import { DocumentsController } from "./documents.controller";

/** A thenable fake db: one canned answer per table, every call chains. */
const PAPER_AT = "2026-11-10T00:00:00Z";
const HOUSE = {
  procurement_documents: { data: { id: "d1", currency: "USD", created_at: PAPER_AT }, error: null },
  restaurants: { data: { currency: "USD" }, error: null },
  document_deliveries: { data: [], error: null },
};
function controllerWith(results: Record<string, { data: unknown; error: unknown }>) {
  results = { ...HOUSE, ...results };
  const db = {
    getClient: () => ({
      from: (table: string) => {
        const b: any = {};
        // The fake applies the filters the controller asks for, so a lot that the
        // real query would not return is not returned here either.
        const f: { good?: string; before?: string; skip?: Set<string>; limit?: number } = {};
        for (const m of ["select", "order", "in", "not"]) b[m] = () => b;
        b.eq = (col: string, v: string) => ((f.good = col === "inventory_id" ? v : f.good), b);
        b.lt = (_c: string, v: string) => ((f.before = v), b);
        b.or = (expr: string) => ((f.skip = new Set((/not\.in\.\(([^)]*)\)/.exec(expr)?.[1] ?? "").split(",").filter(Boolean))), b);
        b.limit = (n: number) => ((f.limit = n), b);
        const answer = () => {
          const r = results[table];
          if (table !== "inventory_lots" || !Array.isArray(r.data)) return r;
          let rows = (r.data as any[]).filter(
            (x) =>
              (!f.good || x.inventory_id === f.good) &&
              (!f.before || x.received_at < f.before) &&
              !(f.skip && x.delivery_id && f.skip.has(x.delivery_id)),
          );
          rows = [...rows].sort((a, c) => (a.received_at < c.received_at ? 1 : -1));
          return { ...r, data: f.limit ? rows.slice(0, f.limit) : rows };
        };
        b.maybeSingle = () => Promise.resolve(results[table]);
        b.then = (res: any, rej: any) => Promise.resolve(answer()).then(res, rej);
        return b;
      },
    }),
  };
  const Ctor = DocumentsController as any;
  return new Ctor({}, db, ...Array.from({ length: 10 }, () => ({}))) as DocumentsController;
}

const user = { userId: "u1", restaurantId: "rest-1" } as any;
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
      procurement_documents: { data: { id: "d1", currency: "TRY", created_at: PAPER_AT }, error: null },
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
      procurement_documents: { data: { id: "d1", currency: "TRY", created_at: PAPER_AT }, error: null },
      procurement_document_lines: { data: [line({ unit_price: 12.5 })], error: null },
      inventory_lots: { data: [lot(10, "2026-11-01")], error: null },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toEqual(expect.objectContaining({ compared: false, reason: "currency_differs" }));
    expect((out.lines[0] as any).sentence).toBeUndefined();
  });

  it("compares nothing when a currency is unknown, and says so", async () => {
    const c = controllerWith({
      procurement_documents: { data: { id: "d1", currency: null, created_at: PAPER_AT }, error: null },
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

  it("ignores the paper's own lot and a later delivery's lot: 'was' is the cost known before this paper (r105)", async () => {
    // Verify wrote this paper's own 11.80 onto its delivery's lot (newest), and a
    // later delivery bought at 13.00. Neither is the cost before the paper.
    const c = controllerWith({
      procurement_document_lines: { data: [line({})], error: null },
      document_deliveries: { data: [{ delivery_id: "dv-own" }], error: null },
      inventory_lots: {
        data: [
          lot(13, "2026-12-01T00:00:00Z", "g1", "dv-later"),
          lot(11.8, "2026-11-11T00:00:00Z", "g1", "dv-own"),
          lot(10, "2026-11-01T00:00:00Z", "g1", "dv-old"),
        ],
        error: null,
      },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, moved: true, sentence: "was 10.00, now 11.80, up 18 percent" });
  });

  it("keeps a lot with no delivery on it (a PO receipt) as a cost known before the paper", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({})], error: null },
      document_deliveries: { data: [{ delivery_id: "dv-own" }], error: null },
      inventory_lots: { data: [lot(10, "2026-11-01T00:00:00Z", "g1", null)], error: null },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, sentence: "was 10.00, now 11.80, up 18 percent" });
  });

  it("a failed delivery read says it failed, never 'no earlier cost'", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({})], error: null },
      document_deliveries: { data: null, error: { message: "boom" } },
      inventory_lots: { data: [lot(10, "2026-11-01T00:00:00Z")], error: null },
    });
    await expect(c.priceMoves("d1", user)).rejects.toMatchObject({ status: 500 });
  });

  it("finds a good bought once a year behind 1,000 newer lots of other goods (r105)", async () => {
    const busy = Array.from({ length: 1005 }, (_, i) => lot(5, `2026-10-${String((i % 28) + 1).padStart(2, "0")}T12:00:00Z`, "g2"));
    const c = controllerWith({
      procurement_document_lines: { data: [line({ inventory_id: "g1" }), line({ id: "l2", line_no: 2, inventory_id: "g2", unit_price: 5 })], error: null },
      inventory_lots: { data: [...busy, lot(10, "2025-11-01T00:00:00Z", "g1")], error: null },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, moved: true, sentence: "was 10.00, now 11.80, up 18 percent" });
  });
});
