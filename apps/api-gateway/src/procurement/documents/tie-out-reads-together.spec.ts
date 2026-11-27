import { DocumentsController } from "./documents.controller";

/**
 * The list recomputes each paper's tie-out from its stored lines. Those reads
 * went one page after another; they now run in id slices together, bounded, and
 * every row's verdict stays what the serial read gave.
 */

const LINES_PER_DOC = 30;

function lineFor(docId: string, n: number) {
  return {
    document_id: docId,
    line_no: n,
    vendor_sku: `S${n}`,
    description: `Line ${n}`,
    vintage: null,
    format_ml: 750,
    qty: 2,
    uom: "BT",
    pack_size: null,
    qty_bottles: 2,
    free_goods_qty: 0,
    unit_price: 10,
    line_total: 20,
    allowance: null,
    deposit: null,
    price_base_qty: null,
    price_base_uom: null,
  };
}

/** A db whose lines table honours in/range under a 1000-row cap, counting overlap. */
function controllerWith(docIds: string[], opts: { failOnCall?: number } = {}) {
  const all = docIds.flatMap((id) => Array.from({ length: LINES_PER_DOC }, (_, i) => lineFor(id, i + 1)));
  const stats = { calls: 0, inFlight: 0, maxInFlight: 0 };
  const db = {
    getClient: () => ({
      from: () => {
        let ids: string[] = [];
        let from = 0;
        let to = 999;
        const b: any = {};
        b.select = () => b;
        b.order = () => b;
        b.in = (_c: string, v: string[]) => ((ids = v), b);
        b.range = (a: number, z: number) => ((from = a), (to = z), b);
        b.then = (res: any, rej: any) => {
          const call = ++stats.calls;
          stats.inFlight++;
          stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
          return new Promise((r) => setTimeout(r, 5))
            .then(() => {
              stats.inFlight--;
              if (opts.failOnCall === call) return { data: null, error: { message: "boom" } };
              const rows = all
                .filter((l) => ids.includes(l.document_id))
                .sort((x, y) => (x.document_id === y.document_id ? x.line_no - y.line_no : x.document_id < y.document_id ? -1 : 1));
              return { data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null };
            })
            .then(res, rej);
        };
        return b;
      },
    }),
  };
  const args = Array.from({ length: 11 }, () => ({}) as any);
  args[1] = db;
  return { controller: new (DocumentsController as any)(...args) as any, stats };
}

const rowsFor = (ids: string[]) =>
  ids.map((id) => ({ id, currency: "USD", subtotal: 600, tax: 0, total: 600, extracted: null }));

describe("tieOutsAsRuledNow reads the papers' lines together", () => {
  const ids = Array.from({ length: 100 }, (_, i) => `doc-${String(i).padStart(3, "0")}`);

  it("runs slices at once, bounded, and gives every paper its own computed total", async () => {
    const { controller, stats } = controllerWith(ids);
    const out = await controller.tieOutsAsRuledNow(rowsFor(ids));
    expect(out.size).toBe(100);
    for (const id of ids) expect(out.get(id)?.computed_lines_total).toBe(600);
    expect(stats.maxInFlight).toBeGreaterThan(1);
    expect(stats.maxInFlight).toBeLessThanOrEqual(4);
  });

  it("keeps every stored verdict when any slice cannot be read", async () => {
    const { controller } = controllerWith(ids, { failOnCall: 2 });
    const out = await controller.tieOutsAsRuledNow(rowsFor(ids));
    expect(out.size).toBe(0);
  });
});
