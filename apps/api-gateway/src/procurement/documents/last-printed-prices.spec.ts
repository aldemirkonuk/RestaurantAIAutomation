/**
 * The shared "last other paper's price" read keeps the rules the paper's page
 * grew before it moved into this module (invoices integration, break 7):
 *
 *  - #2370: "last" is last BEFORE this paper (checked before it, dated on or
 *    before it), never the newest of all, and papers order by doc_date first.
 *  - #2269: an `other` vendor read leaves this vendor's papers out and papers
 *    checked before a day, and says whose paper and which day each price is.
 *
 * Taken whole from the controller's older body, the module dropped both. This
 * spec runs the module against a client that APPLIES the filters.
 */
import { readLastPrintedPrices } from "./last-printed-prices";

type Row = Record<string, any>;

function client(papers: Row[]) {
  const calls: { op: string; col: string; val: any }[][] = [];
  const hit = (r: Row, op: string, col: string, v: any): boolean => {
    const x = r[col];
    switch (op) {
      case "eq": return x === v;
      case "neq": return x !== null && x !== undefined && x !== v;
      case "ilike": return String(x).toLowerCase() === String(v).toLowerCase();
      case "gte": return x != null && x >= v;
      case "lt": return x != null && x < v;
      case "notin": return !v.includes(x);
      case "or": {
        // "doc_date.is.null,doc_date.lte.2026-11-26"
        return String(v).split(",").some((term) => {
          const [c, o, ...rest] = term.split(".");
          const val = rest.join(".");
          return o === "is" ? r[c] == null : o === "lte" ? r[c] != null && r[c] <= val : false;
        });
      }
      default: return true;
    }
  };
  return {
    calls,
    from() {
      const f: { op: string; col: string; val: any }[] = [];
      calls.push(f);
      let limit = Infinity;
      const order: [string, boolean][] = [];
      const b: any = {};
      const add = (op: string) => (col: string, val: any) => (f.push({ op, col, val }), b);
      b.select = () => b;
      for (const op of ["eq", "neq", "ilike", "gte", "lt", "gt", "in"]) b[op] = add(op);
      b.not = (col: string, _op: string, v: string) => (f.push({ op: "notin", col, val: v.replace(/[()]/g, "").split(",") }), b);
      b.or = (expr: string) => (f.push({ op: "or", col: "", val: expr }), b);
      b.order = (col: string, o: { ascending: boolean }) => (order.push([col, o.ascending]), b);
      b.limit = (n: number) => ((limit = n), b);
      b.then = (res: any, rej: any) => {
        const own = f.filter((x) => !x.col.startsWith("procurement_document_lines."));
        const lineF = f.filter((x) => x.col.startsWith("procurement_document_lines."));
        const rows = papers
          .filter((p) => own.every((x) => hit(p, x.op, x.col, x.val)))
          .map((p) => ({
            ...p,
            procurement_document_lines: p.procurement_document_lines.filter((l: Row) =>
              lineF.every((x) => {
                const c = x.col.slice("procurement_document_lines.".length);
                return x.op === "in" ? x.val.includes(l[c]) : x.op === "gt" ? Number(l[c]) > Number(x.val) : l[c] === x.val;
              }),
            ),
          }))
          .filter((p) => p.procurement_document_lines.length > 0)
          .sort((a, c) => {
            for (const [col, asc] of order) {
              const av = a[col] ?? "";
              const cv = c[col] ?? "";
              if (av !== cv) return (av < cv ? -1 : 1) * (asc ? 1 : -1);
            }
            return 0;
          })
          .slice(0, limit);
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      };
      return b;
    },
  };
}

const paper = (id: string, total: number, over: Row = {}): Row => ({
  id,
  restaurant_id: "r1",
  status: "verified",
  currency: "USD",
  doc_type: "invoice",
  doc_date: null,
  verified_at: "2026-10-02T09:00:00Z",
  provider_id: "vendor-a",
  procurement_document_lines: [
    { inventory_id: "g1", restaurant_id: "r1", line_total: total, qty_bottles: 12, format_ml: 750 },
  ],
  ...over,
});

const read = (papers: Row[], extra: { paper?: Row; other?: { providerId: string; sinceIso: string } } = {}) =>
  readLastPrintedPrices(client(papers), "this", "USD", ["g1"], "r1", extra.paper, extra.other);

describe("readLastPrintedPrices keeps the bound and the other-vendor read", () => {
  // 5.00 a bottle (60 for 12), checked 10-02; and a late-filed older paper at 10.00 a bottle,
  // dated 10-15 but only checked on 11-27, after the paper being compared was checked.
  const early = paper("early", 60, { doc_date: "2026-10-01", verified_at: "2026-10-02T09:00:00Z" });
  const late = paper("late", 120, { doc_date: "2026-10-15", verified_at: "2026-11-27T10:00:00Z" });
  const compared = { status: "verified", doc_date: "2026-11-26", verified_at: "2026-11-27T09:00:00Z" };

  it("a paper with no bound compares with the newest paper of all", async () => {
    const last = await read([early, late]);
    expect(last.get("g1")!.price.value).toBe(10);
  });

  it("a verified paper compares only with papers checked before it, never with a later-checked one", async () => {
    const last = await read([early, late], { paper: compared });
    expect(last.get("g1")!.price.value).toBe(5);
  });

  it("a paper dated before an earlier-checked paper does not take its price either", async () => {
    // checked before this paper, but dated after it: "last" must not look forward in time
    const future = paper("future", 240, { doc_date: "2026-12-30", verified_at: "2026-11-01T09:00:00Z" });
    const last = await read([early, future], { paper: compared });
    expect(last.get("g1")!.price.value).toBe(5);
  });

  it("another vendor's read leaves this vendor's papers and papers before the day out, and names the paper", async () => {
    const mine = paper("mine", 24, { provider_id: "vendor-a", verified_at: "2026-11-20T09:00:00Z" });
    const theirs = paper("theirs", 84, { provider_id: "vendor-b", doc_date: "2026-11-10", verified_at: "2026-11-20T09:00:00Z" });
    const old = paper("old", 36, { provider_id: "vendor-c", verified_at: "2026-01-02T09:00:00Z" });
    const last = await read([mine, theirs, old], {
      other: { providerId: "vendor-a", sinceIso: "2026-06-01T00:00:00Z" },
    });
    expect(last.get("g1")).toMatchObject({ providerId: "vendor-b", on: "2026-11-10" });
    expect(last.get("g1")!.price.value).toBe(7);
  });
});
