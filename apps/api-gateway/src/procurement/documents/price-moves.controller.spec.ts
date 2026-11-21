import { DocumentsController } from "./documents.controller";

/** A thenable fake db: one canned answer per table, every call chains. */
function controllerWith(results: Record<string, { data: unknown; error: unknown }>) {
  const db = {
    getClient: () => ({
      from: (table: string) => {
        const b: any = {};
        for (const m of ["select", "eq", "order", "limit", "in", "not"]) b[m] = () => b;
        b.then = (res: any, rej: any) => Promise.resolve(results[table]).then(res, rej);
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
const lot = (cost: number, at: string, good = "g1") => ({ inventory_id: good, unit_cost: cost, received_at: at });

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
});
