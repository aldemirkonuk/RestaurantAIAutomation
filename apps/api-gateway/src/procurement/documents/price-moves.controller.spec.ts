import { DocumentsController } from "./documents.controller";

/** A thenable fake db: one canned answer per table, every call chains. */
const PAPER_AT = "2099-01-01T00:00:00Z";
const HOUSE = { procurement_documents: { data: { id: "d1", currency: "USD", created_at: PAPER_AT }, error: null }, restaurants: { data: { currency: "USD" }, error: null }, document_deliveries: { data: [], error: null } };
type Call = { table: string; method: string; args: unknown[] };
function controllerWith(results: Record<string, { data: unknown; error: unknown }>, calls: Call[] = []) {
  results = { ...HOUSE, ...results };
  const db = {
    getClient: () => ({
      from: (table: string) => {
        const b: any = {};
        // A list answer is FILTERED, ORDERED and LIMITED as the real read would
        // be, so a test cannot pass on a fixture that happens to be pre-sorted
        // or pre-cut. A filter on a column the fixture rows do not carry is
        // ignored (the call is still recorded and asserted separately).
        const eqs: [string, unknown][] = [];
        const ins: [string, unknown[]][] = [];
        const lts: [string, string][] = [];
        let ord: { col: string; asc: boolean } | null = null;
        let cap: number | null = null;
        const answer = () => {
          const r = results[table];
          if (!Array.isArray(r?.data)) return r;
          let rows = (r.data as Record<string, any>[]).filter(
            (row) =>
              eqs.every(([c, v]) => c === "__skip__" ? !(row.delivery_id && (v as Set<string>).has(row.delivery_id)) : !(c in row) || row[c] === v) &&
              ins.every(([c, vs]) => c in row && vs.includes(row[c])) &&
              lts.every(([c, v]) => !(c in row) || String(row[c]) < v),
          );
          if (ord) {
            const { col, asc } = ord;
            rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
          }
          return { ...r, data: cap == null ? rows : rows.slice(0, cap) };
        };
        const rec = (m: string, args: unknown[]) => calls.push({ table, method: m, args });
        for (const m of ["select", "not"]) b[m] = (...args: unknown[]) => (rec(m, args), b);
        b.in = (...args: unknown[]) => (rec("in", args), ins.push([args[0] as string, args[1] as unknown[]]), b);
        b.eq = (...args: unknown[]) => (rec("eq", args), eqs.push([args[0] as string, args[1]]), b);
        b.lt = (...args: unknown[]) => (rec("lt", args), lts.push([args[0] as string, String(args[1])]), b);
        b.order = (...args: unknown[]) => (rec("order", args), (ord = { col: args[0] as string, asc: (args[1] as any)?.ascending !== false }), b);
        b.limit = (...args: unknown[]) => (rec("limit", args), (cap = args[0] as number), b);
        // r105 (#2462): the paper's own deliveries are left out with an or().
        b.or = (...args: unknown[]) => {
          rec("or", args);
          const skip = new Set((/not\.in\.\(([^)]*)\)/.exec(String(args[0]))?.[1] ?? "").split(",").filter(Boolean));
          eqs.push(["__skip__", skip]);
          return b;
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

  it("asks the lot table for this house's INVOICED lots, newest first (the fixture alone cannot prove it)", async () => {
    const calls: Call[] = [];
    const c = controllerWith(
      {
        procurement_document_lines: { data: [line({})], error: null },
        inventory_lots: { data: [lot(10, "2026-11-01")], error: null },
      },
      calls,
    );
    await c.priceMoves("d1", user);
    const lots = calls.filter((x) => x.table === "inventory_lots");
    expect(lots).toContainEqual({ table: "inventory_lots", method: "eq", args: ["restaurant_id", "rest-1"] });
    expect(lots).toContainEqual({ table: "inventory_lots", method: "eq", args: ["cost_provenance", "invoice"] });
    expect(lots).toContainEqual({ table: "inventory_lots", method: "order", args: ["received_at", { ascending: false }] });
  });

  it("finds the last cost of EVERY good, however many newer lots the others have (no shared row cap)", async () => {
    // 1,200 invoiced lots of the busy good, all newer than the one lot the rare
    // good has. One read capped at 1,000 rows across both goods never reaches it.
    const busy = Array.from({ length: 1200 }, (_, i) => lot(10, `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00Z`, "g1"));
    const c = controllerWith({
      procurement_document_lines: {
        data: [line({}), line({ id: "l2", line_no: 2, inventory_id: "g2", unit_price: 20 })],
        error: null,
      },
      inventory_lots: { data: [...busy, lot(16, "2026-01-05T00:00:00Z", "g2")], error: null },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true });
    expect(out.lines[1]).toMatchObject({ compared: true, moved: true, sentence: "was 16.00, now 20.00, up 25 percent" });
  });

  describe("a verified paper is not compared with its own lot, nor with later deliveries", () => {
    const owned = (cost: number, at: string, delivery: string, good = "g1") => ({ ...lot(cost, at, good), delivery_id: delivery });
    // The paper's own delivery is dOwn: at VERIFIED its door lot was finalised
    // with this paper's own unit price and invoice provenance.
    const own = { document_deliveries: { data: [{ delivery_id: "dOwn" }], error: null } };

    it("compares the newest verified paper with the delivery before it, not with itself", async () => {
      const c = controllerWith({
        ...own,
        procurement_document_lines: { data: [line({ unit_price: 11.8 })], error: null },
        inventory_lots: { data: [owned(11.8, "2026-11-01T00:00:00Z", "dOwn"), owned(10, "2026-10-01T00:00:00Z", "dEarlier")], error: null },
      });
      const out = await c.priceMoves("d1", user);
      expect(out.lines[0]).toMatchObject({ compared: true, moved: true, sentence: "was 10.00, now 11.80, up 18 percent" });
    });

    it("compares an OLDER verified paper with what came before it, never with a later delivery", async () => {
      const c = controllerWith({
        ...own,
        procurement_document_lines: { data: [line({ unit_price: 11.8 })], error: null },
        inventory_lots: {
          data: [owned(15, "2026-11-20T00:00:00Z", "dLater"), owned(11.8, "2026-11-01T00:00:00Z", "dOwn"), owned(10, "2026-10-01T00:00:00Z", "dEarlier")],
          error: null,
        },
      });
      const out = await c.priceMoves("d1", user);
      // Inverted before: "was 15.00, now 11.80, down 21 percent".
      expect(out.lines[0]).toMatchObject({ sentence: "was 10.00, now 11.80, up 18 percent" });
    });

    it("a paper with no lot of its own yet is compared with the newest lot, as before", async () => {
      const c = controllerWith({
        procurement_document_lines: { data: [line({})], error: null },
        inventory_lots: { data: [owned(10, "2026-11-01T00:00:00Z", "dEarlier")], error: null },
      });
      expect((await c.priceMoves("d1", user)).lines[0]).toMatchObject({ compared: true, moved: true });
    });

    it("says it failed when the paper's deliveries cannot be read", async () => {
      const c = controllerWith({
        procurement_document_lines: { data: [line({})], error: null },
        document_deliveries: { data: null, error: { message: "boom" } },
      });
      await expect(c.priceMoves("d1", user)).rejects.toMatchObject({ status: 500 });
    });
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
  // r105 (#2462) cases, on the paper dated 2026-11-10.
  it("ignores the paper's own lot and a later delivery's lot: 'was' is the cost known before this paper (r105)", async () => {
    // Verify wrote this paper's own 11.80 onto its delivery's lot (newest), and a
    // later delivery bought at 13.00. Neither is the cost before the paper.
    const c = controllerWith({ procurement_documents: { data: { id: "d1", currency: "USD", created_at: "2026-11-10T00:00:00Z" }, error: null },
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
    const c = controllerWith({ procurement_documents: { data: { id: "d1", currency: "USD", created_at: "2026-11-10T00:00:00Z" }, error: null },
      procurement_document_lines: { data: [line({})], error: null },
      document_deliveries: { data: [{ delivery_id: "dv-own" }], error: null },
      inventory_lots: { data: [lot(10, "2026-11-01T00:00:00Z", "g1", null)], error: null },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, sentence: "was 10.00, now 11.80, up 18 percent" });
  });

  it("a failed delivery read says it failed, never 'no earlier cost'", async () => {
    const c = controllerWith({ procurement_documents: { data: { id: "d1", currency: "USD", created_at: "2026-11-10T00:00:00Z" }, error: null },
      procurement_document_lines: { data: [line({})], error: null },
      document_deliveries: { data: null, error: { message: "boom" } },
      inventory_lots: { data: [lot(10, "2026-11-01T00:00:00Z")], error: null },
    });
    await expect(c.priceMoves("d1", user)).rejects.toMatchObject({ status: 500 });
  });

  it("finds a good bought once a year behind 1,000 newer lots of other goods (r105)", async () => {
    const busy = Array.from({ length: 1005 }, (_, i) => lot(5, `2026-10-${String((i % 28) + 1).padStart(2, "0")}T12:00:00Z`, "g2"));
    const c = controllerWith({ procurement_documents: { data: { id: "d1", currency: "USD", created_at: "2026-11-10T00:00:00Z" }, error: null },
      procurement_document_lines: { data: [line({ inventory_id: "g1" }), line({ id: "l2", line_no: 2, inventory_id: "g2", unit_price: 5 })], error: null },
      inventory_lots: { data: [...busy, lot(10, "2025-11-01T00:00:00Z", "g1")], error: null },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, moved: true, sentence: "was 10.00, now 11.80, up 18 percent" });
  });
});
