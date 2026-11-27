import { HttpException } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";

/**
 * WHO READS A LINE'S PRICE MOVE (r109, DD-r109-8a). Both prices and the percent
 * are the house's money, so /price-moves follows the vendor-prices rule: owner
 * and manager get the answer, staff (or no role) a 403 in words before any
 * read, and a paper of another house is a 404, never another house's figures.
 */
type Row = Record<string, any>;
const TABLES: Record<string, Row[]> = {
  procurement_documents: [
    { id: "d1", restaurant_id: "rest-1", currency: "USD" },
    { id: "d9", restaurant_id: "rest-2", currency: "USD" },
  ],
  restaurants: [
    { id: "rest-1", currency: "USD" },
    { id: "rest-2", currency: "USD" },
  ],
  procurement_document_lines: [
    { id: "l1", document_id: "d1", restaurant_id: "rest-1", line_no: 1, description: "House Red", uom: "bottle", unit_price: 7, inventory_id: null, line_total: 7, qty: 1, pack_size: 1, qty_bottles: 1, format_ml: 750 },
    { id: "l9", document_id: "d9", restaurant_id: "rest-2", line_no: 1, description: "Other house", uom: "bottle", unit_price: 9, inventory_id: null, line_total: 9, qty: 1, pack_size: 1, qty_bottles: 1, format_ml: 750 },
  ],
};

function controller() {
  const reads: string[] = [];
  const db = {
    getClient: () => ({
      from: (table: string) => {
        reads.push(table);
        const f: [string, unknown][] = [];
        const rows = () => (TABLES[table] ?? []).filter((r) => f.every(([c, v]) => r[c] === v));
        const b: any = {};
        b.select = () => b;
        b.order = () => b;
        b.limit = () => b;
        b.eq = (c: string, v: unknown) => (f.push([c, v]), b);
        for (const op of ["neq", "ilike", "in", "gt", "not"]) b[op] = () => b;
        b.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
        b.then = (res: any, rej: any) => Promise.resolve({ data: rows(), error: null }).then(res, rej);
        return b;
      },
    }),
  };
  const Ctor = DocumentsController as any;
  const c = new Ctor({}, db, ...Array.from({ length: 10 }, () => ({}))) as DocumentsController;
  return { c, reads };
}
const as = (role: string | null, restaurantId = "rest-1") => ({ userId: "u1", restaurantId, role }) as any;
async function refusal(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as HttpException;
  }
  throw new Error("expected a refusal");
}

describe("GET /procurement/documents/:id/price-moves, who may read it (r109)", () => {
  it.each(["owner", "manager"])("%s reads this house's paper (200)", async (role) => {
    const { c } = controller();
    const out = await c.priceMoves("d1", as(role));
    expect(out.lines.map((l: any) => l.lineId)).toEqual(["l1"]);
  });

  it.each(["staff", null])("%s is refused in words before anything is read (403)", async (role) => {
    const { c, reads } = controller();
    const e = await refusal(c.priceMoves("d1", as(role)));
    expect(e.getStatus()).toBe(403);
    expect(e.message).toBe("A line's price moves are shown to the owner and managers of the house.");
    expect(reads).toEqual([]);
  });

  it("an owner asking for another house's paper gets 404 and none of its lines", async () => {
    const { c, reads } = controller();
    const e = await refusal(c.priceMoves("d9", as("owner")));
    expect(e.getStatus()).toBe(404);
    expect(e.message).toBe("This paper is not one of this house's, so no price was compared.");
    expect(reads).not.toContain("procurement_document_lines");
  });
});
