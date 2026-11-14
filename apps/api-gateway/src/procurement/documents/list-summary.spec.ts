import { DocumentsController } from "./documents.controller";
import { gzipSync } from "node:zlib";

/**
 * r41 invoices audit, gap 2: `view=summary` leaves the parsed paper and the
 * EDI text off each listed row, after the row's derived fields were computed
 * from them; without it the row is the full row, as before.
 */

/** A list() controller over a thenable fake db, one canned result per table. */
function listControllerWith(results: Record<string, { data: unknown; error: unknown }>) {
  const builder = () => {
    const b: any = {};
    for (const m of ["select", "eq", "order", "limit", "in", "range", "maybeSingle"]) b[m] = jest.fn(() => b);
    return b;
  };
  const db = {
    getClient: () => ({
      from: (table: string) => {
        const b = builder();
        b.then = (res: any, rej: any) => Promise.resolve(results[table]).then(res, rej);
        return b;
      },
    }),
  };
  const args = Array.from({ length: 11 }, () => ({}) as any);
  args[1] = db;
  return new (DocumentsController as any)(...args) as DocumentsController;
}

/** A 30-line invoice as the reader parses it, and the EDI 810 it came as. */
function syntheticPaper(id: string) {
  // Varied per paper, so a gzip figure is not flattered by identical rows.
  const seed = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const pick = (i: number) => ((seed ^ (i * 2654435761)) >>> 0).toString(36);
  const lines = Array.from({ length: 30 }, (_, i) => ({
    lineNo: i + 1,
    vendorSku: `SYN-${pick(i).slice(0, 6).toUpperCase()}`,
    description: `SYNTHETIC ${pick(i + 97).toUpperCase()} ${pick(i + 31).slice(0, 5)} 750ML 12/CS`,
    vintage: 2019 + (i % 4),
    formatMl: 750,
    qty: 2,
    uom: "CS",
    packSize: 12,
    qtyBottles: 24,
    freeGoodsQty: 0,
    unitPrice: 144.5,
    lineTotal: 289,
    allowance: null,
    deposit: null,
    asPrinted: { qty: "2", unitPrice: "144.50", lineTotal: "289.00" },
  }));
  const extracted = {
    vendorName: "SYNTHETIC DISTRIBUTOR CO.",
    docNumber: `INV-${id}`,
    lines,
    totals: { subtotal: 8670, tax: 0, total: 8670 },
    taxBreakdown: [],
    notes: ["synthetic"],
  };
  const raw_payload = [
    "ISA*00*          *00*          *ZZ*SYNDIST        *ZZ*SYNHOUSE       *261114*0800*U*00401*000000001*0*P*>~",
    "GS*IN*SYNDIST*SYNHOUSE*20261114*0800*1*X*004010~",
    "ST*810*0001~",
    `BIG*20261114*INV-${id}~`,
    ...lines.map(
      (l) => `IT1*${l.lineNo}*${l.qty}*CA*${l.unitPrice}**VN*${l.vendorSku}~PID*F****${l.description}~`,
    ),
    "TDS*867000~",
    "SE*36*0001~",
    "GE*1*1~",
    "IEA*1*000000001~",
  ].join("\n");
  return {
    id,
    restaurant_id: "rest-1",
    provider_id: null,
    doc_type: "invoice",
    status: "needs_review",
    currency: "USD",
    subtotal: 8670,
    tax: 0,
    total: 8670,
    ties_out: false,
    tie_out_delta: 1,
    computed_lines_total: 8669,
    extracted,
    raw_payload,
  };
}

const docLines = (id: string) =>
  Array.from({ length: 30 }, (_, i) => ({
    document_id: id,
    line_no: i + 1,
    description: `SYNTHETIC WINE ${i + 1}`,
    qty: 2,
    uom: "case",
    pack_size: 12,
    qty_bottles: 24,
    unit_price: 144.5,
    line_total: 289,
  }));

const user = { userId: "u1", restaurantId: "rest-1" } as any;

describe("DocumentsController.list — view=summary (r41 invoices gap 2)", () => {
  it("leaves the parsed paper and the EDI text off each row", async () => {
    const controller = listControllerWith({
      procurement_documents: { data: [syntheticPaper("d1"), syntheticPaper("d2")], error: null },
      procurement_document_lines: { data: [...docLines("d1"), ...docLines("d2")], error: null },
    });
    const out = await controller.list(user, "needs_review", undefined, undefined, "100", "summary");
    for (const item of out.items as Record<string, unknown>[]) {
      expect(item).not.toHaveProperty("extracted");
      expect(item).not.toHaveProperty("raw_payload");
      expect(item.total).toBe(8670);
      expect(item.currency).toBe("USD");
    }
  });

  it("derives the row's fields from the paper before leaving it out: the same verdict, vendor and money state", async () => {
    const results = {
      procurement_documents: { data: [syntheticPaper("d1")], error: null },
      procurement_document_lines: { data: docLines("d1"), error: null },
    };
    const full = (await listControllerWith(results).list(user, "needs_review"))
      .items[0] as Record<string, unknown>;
    const summary = (
      await listControllerWith({
        procurement_documents: { data: [syntheticPaper("d1")], error: null },
        procurement_document_lines: { data: docLines("d1"), error: null },
      }).list(user, "needs_review", undefined, undefined, undefined, "summary")
    ).items[0] as Record<string, unknown>;
    // The paper's name comes from `extracted` and survives its removal.
    expect(summary.vendorName).toBe("SYNTHETIC DISTRIBUTOR CO.");
    // The stored verdict said "off by 1"; the lines tie out, as the full row says.
    expect(summary.ties_out).toBe(true);
    expect(summary.tie_out_delta).toBe(full.tie_out_delta);
    expect(summary.moneyState).toEqual(full.moneyState);
    const { extracted: _e, raw_payload: _r, ...rest } = full;
    expect(summary).toEqual(rest);
  });

  it("keeps the full row when the caller does not ask for the summary", async () => {
    for (const view of [undefined, "", "full", "SUMMARY"]) {
      const out = await listControllerWith({
        procurement_documents: { data: [syntheticPaper("d1")], error: null },
        procurement_document_lines: { data: docLines("d1"), error: null },
      }).list(user, "needs_review", undefined, undefined, undefined, view);
      const item = out.items[0] as Record<string, unknown>;
      expect(item).toHaveProperty("extracted");
      expect(item).toHaveProperty("raw_payload");
    }
  });

  it("measures the list: 100 synthetic 30-line papers, full vs summary bytes", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => syntheticPaper(`d${i}`));
    // The fake db ignores `range`, so the line read answers once, empty: the
    // bytes measured are the documents' own.
    const lines: unknown[] = [];
    const read = (view?: string) =>
      listControllerWith({
        procurement_documents: { data: rows.map((r) => ({ ...r })), error: null },
        procurement_document_lines: { data: lines, error: null },
      }).list(user, "needs_review", undefined, undefined, "100", view);
    const full = JSON.stringify(await read());
    const summary = JSON.stringify(await read("summary"));
    const kb = (s: string) => Math.round(Buffer.byteLength(s) / 1024);
    const gz = (s: string) => Math.round(gzipSync(s).length / 1024);
    // Printed for the PR; the assertion only pins the direction and scale.
    // eslint-disable-next-line no-console
    console.log(
      `list of 100: full ${kb(full)} KB (${gz(full)} KB gz), summary ${kb(summary)} KB (${gz(summary)} KB gz)`,
    );
    expect(Buffer.byteLength(summary) * 10).toBeLessThan(Buffer.byteLength(full));
  });
});
