import { DocumentsController } from "./documents.controller";

/**
 * r106 fz: the "last invoiced cost" is not this paper's own lot, and one newest
 * lot is read per good (never one shared page across goods).
 */
type Lot = { inventory_id: string; unit_cost: number; received_at: string; delivery_id: string | null };
function controllerWith(opts: { lots: Lot[]; own: string[]; lines: Record<string, unknown>[] }) {
  const lotQueries: { good: string; or: string | null }[] = [];
  const db = {
    getClient: () => ({
      from: (table: string) => {
        const f: Record<string, unknown> = {};
        let or: string | null = null;
        const b: any = {};
        for (const m of ["select", "order", "limit", "in", "not"]) b[m] = () => b;
        b.eq = (k: string, v: unknown) => ((f[k] = v), b);
        b.or = (v: string) => ((or = v), b);
        const answer = () => {
          if (table === "procurement_documents") return { data: { id: "d1", currency: "USD" }, error: null };
          if (table === "restaurants") return { data: { currency: "USD" }, error: null };
          if (table === "document_deliveries")
            return { data: f.document_id ? opts.own.map((delivery_id) => ({ delivery_id })) : opts.lots.map((l) => ({ document_id: "src", delivery_id: l.delivery_id })), error: null };
          if (table === "procurement_document_lines")
            return { data: f.document_id ? opts.lines : ["g1", "g2"].map((g) => ({ document_id: "src", inventory_id: g, uom: "bottle", unit_price: 1 })), error: null };
          // inventory_lots: apply the delivery exclusion the controller asked for.
          lotQueries.push({ good: String(f.inventory_id), or });
          const ex = new Set((/not\.in\.\(([^)]*)\)/.exec(or ?? "")?.[1] ?? "").split(",").filter(Boolean));
          const rows = opts.lots
            .filter((l) => l.inventory_id === f.inventory_id && !(l.delivery_id && ex.has(l.delivery_id)))
            .sort((x, y) => y.received_at.localeCompare(x.received_at))
            .slice(0, 1);
          return { data: rows, error: null };
        };
        b.maybeSingle = () => Promise.resolve(answer());
        b.then = (res: any, rej: any) => Promise.resolve(answer()).then(res, rej);
        return b;
      },
    }),
  };
  const Ctor = DocumentsController as any;
  return { c: new Ctor({}, db, ...Array.from({ length: 10 }, () => ({}))) as DocumentsController, lotQueries };
}
const user = { userId: "u1", restaurantId: "rest-1" } as any;
const line = (n: number, good: string, price: number) => ({ id: `l${n}`, line_no: n, description: good, uom: "bottle", unit_price: price, inventory_id: good });

describe("DocumentsController.priceMoves — the last cost (r106 fz)", () => {
  it("a verified paper's own lot is not its previous cost: the 18 percent jump is still said", async () => {
    const { c } = controllerWith({
      own: ["D-this"],
      lines: [line(1, "g1", 11.8)],
      lots: [
        { inventory_id: "g1", unit_cost: 11.8, received_at: "2026-11-20", delivery_id: "D-this" },
        { inventory_id: "g1", unit_cost: 10, received_at: "2026-11-01", delivery_id: "D-old" },
      ],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, moved: true, sentence: "was 10.00, now 11.80, up 18 percent" });
  });

  it("a rarely bought good is read even behind more than a thousand newer lots of other goods", async () => {
    const many: Lot[] = Array.from({ length: 1200 }, (_, i) => ({ inventory_id: "g2", unit_cost: 5, received_at: `2026-11-${String(10 + (i % 15)).padStart(2, "0")}`, delivery_id: `D${i}` }));
    const { c, lotQueries } = controllerWith({
      own: [],
      lines: [line(1, "g1", 12), line(2, "g2", 5)],
      lots: [{ inventory_id: "g1", unit_cost: 10, received_at: "2026-01-05", delivery_id: "D-old" }, ...many],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, sentence: "was 10.00, now 12.00, up 20 percent" });
    expect(lotQueries.map((q) => q.good).sort()).toEqual(["g1", "g2"]);
  });
});
