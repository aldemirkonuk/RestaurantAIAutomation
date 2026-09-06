import { Test, TestingModule } from "@nestjs/testing";
import { DatabaseService } from "../../database/database.service";
import { CanonicalDocumentService } from "./canonical-document.service";
import { canonicalForRow, runCorpus } from "./cli";

/**
 * TWO MAPPING PATHS MUST NOT DRIFT.
 *
 * `GET /procurement/documents/:id/canonical` goes through
 * `CanonicalDocumentService`; `scripts/canonical_corpus_run.py` goes through
 * `canonical/cli.ts`. Measured 2026-09-05: the runner named
 * `vat_breakdown_present` as FAILING on `b1e02edf` and `5c7d4801` — two
 * documents whose page rendered the VAT breakdown row perfectly — because the
 * CLI had a second row-to-`ParsedDocument` mapping that never opened
 * `extracted`. Same rows, two answers, and the report graded the wrong one.
 *
 * A document that passes on the page and fails in the runner tells a reader
 * nothing about the product, which is the CLI's own stated reason for existing.
 * These assertions are that contract.
 *
 * EVERY NAME, ID AND NUMBER BELOW IS SYNTHETIC.
 */

const DOCUMENT: Record<string, unknown> = {
  id: "doc-parity",
  restaurant_id: "rest-parity",
  provider_id: null,
  doc_type: "invoice",
  doc_number: "SYN-P-1",
  doc_date: "2026-08-14",
  references_doc_number: null,
  source_channel: "email",
  direction: "issued_by_vendor",
  jurisdiction: "TR",
  currency: "TRY",
  subtotal: 1704,
  freight: null,
  fuel_surcharge: null,
  split_case_fee: null,
  delivery_fee: null,
  deposit_total: 180,
  tax: 340.8,
  other_charges: null,
  discount_total: null,
  total: 2224.8,
  extraction_confidence: 0.8,
  extraction_model: "synthetic-model",
  notes: null,
  printed: { subtotal: "1.704,00", total: "2.224,80" },
  // The four facts with no column of their own.
  extracted: {
    vendorName: "SYNTHETIC Üzüm Bağcılık A.Ş.",
    deliveredDate: "2026-08-12",
    taxBreakdown: [
      { rate: 20, taxableBase: 1704, amount: 340.8, category: "S" },
    ],
    lines: [
      { lineNo: 1, lineKind: "goods" },
      { lineNo: 2, lineKind: "deposit" },
    ],
  },
};

const LINES: Record<string, unknown>[] = [
  {
    line_no: 1,
    vendor_sku: "SYN-1",
    description: "SYNTHETIC Öküzgözü",
    vintage: 2021,
    format_ml: 750,
    qty: "12",
    uom: "bottle",
    pack_size: 12,
    qty_bottles: "12",
    free_goods_qty: "0",
    unit_price: "142.0000",
    line_total: "1704.00",
    allowance: null,
    deposit: null,
    order_line_id: null,
    match_method: null,
    match_confidence: null,
    price_base_qty: null,
    price_base_uom: null,
    printed: { unitPrice: "142,00", lineTotal: "1.704,00" },
  },
  {
    line_no: 2,
    vendor_sku: null,
    description: "Depozito · iade edilebilir kasa",
    vintage: null,
    format_ml: null,
    qty: "2",
    uom: "each",
    pack_size: 1,
    qty_bottles: "0",
    free_goods_qty: "0",
    unit_price: "90.0000",
    line_total: "180.00",
    allowance: null,
    deposit: null,
    order_line_id: null,
    match_method: null,
    match_confidence: null,
    price_base_qty: null,
    price_base_uom: null,
    printed: null,
  },
];

async function throughTheRoute() {
  let table = "";
  const answers: Record<string, unknown> = {
    procurement_documents: DOCUMENT,
    procurement_document_lines: LINES,
    procurement_order_items: [],
    restaurants: { id: "rest-parity", name: "SYNTHETIC Meyhane" },
  };
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const verb of ["select", "eq", "in", "order", "limit"])
      c[verb] = () => c;
    c.maybeSingle = () => {
      const d = answers[table];
      return Promise.resolve({
        data: Array.isArray(d) ? (d[0] ?? null) : (d ?? null),
        error: null,
      });
    };
    (c as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: answers[table] ?? null, error: null }).then(
        resolve,
      );
    return c;
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CanonicalDocumentService,
      {
        provide: DatabaseService,
        useValue: {
          getClient: () => ({
            from: (t: string) => {
              table = t;
              return chain();
            },
          }),
        },
      },
    ],
  }).compile();
  const res = await module
    .get(CanonicalDocumentService)
    .buildFromDocumentId("rest-parity", "doc-parity");
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

/**
 * The CLI's own entry point on the same rows — not the shared mapper called
 * directly, which would only prove the mapper agrees with itself.
 */
function throughTheRunner() {
  return canonicalForRow(DOCUMENT, LINES);
}

describe("the route and the corpus runner map the same rows the same way", () => {
  it("produces the same BG-23 rows on both paths", async () => {
    const route = await throughTheRoute();
    const runner = throughTheRunner();
    expect(route.layer1.vatBreakdown).toHaveLength(1);
    expect(runner.layer1.vatBreakdown).toEqual(route.layer1.vatBreakdown);
    expect(runner.layer1.vatBreakdown[0].rate.value).toBe(20);
    expect(runner.layer1.vatBreakdown[0].taxableAmount.value).toBe(1704);
  });

  it("reads BT-72 and BG-4's name out of the snapshot on both paths", async () => {
    const route = await throughTheRoute();
    const runner = throughTheRunner();
    expect(runner.layer1.actualDeliveryDate.value).toBe("2026-08-12");
    expect(runner.layer1.actualDeliveryDate.value).toBe(
      route.layer1.actualDeliveryDate.value,
    );
    // The route resolved no provider row here, so both fall back to the
    // transcribed name — the same name, from the same place.
    expect(runner.layer1.seller.name.value).toBe(
      "SYNTHETIC Üzüm Bağcılık A.Ş.",
    );
    expect(runner.layer1.seller.name.value).toBe(
      route.layer1.seller.name.value,
    );
  });

  it("classifies the deposit line and totals it identically on both paths", async () => {
    const route = await throughTheRoute();
    const runner = throughTheRunner();
    expect(runner.layer1.lines.map((l) => l.lineKind?.value)).toEqual([
      "goods",
      "deposit",
    ]);
    expect(runner.layer1.totals).toEqual(route.layer1.totals);
    expect(runner.layer1.allowancesCharges).toEqual(
      route.layer1.allowancesCharges,
    );
  });

  it("names no vat_breakdown_present failure in the runner's own output", () => {
    const out = runCorpus([{ document: DOCUMENT, lines: LINES }]);
    expect(out.documents_read).toBe(1);
    const named = out.named_failures.map((f) => f.invariant);
    expect(named).not.toContain("vat_breakdown_present");
    expect(named).not.toContain("deposits_coded_and_excluded");
    expect(named).not.toContain("document_lines_total");
    expect(named).not.toContain("line_net_amount");
    // and the breakdown was genuinely TESTED, not skipped as untestable
    expect(out.per_invariant.vat_breakdown_present.holds).toBeGreaterThan(0);
  });
});
