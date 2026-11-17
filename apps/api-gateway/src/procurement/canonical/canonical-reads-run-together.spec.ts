import { Test, TestingModule } from "@nestjs/testing";
import { DatabaseService } from "../../database/database.service";
import { CanonicalDocumentService } from "./canonical-document.service";
import { LineMappingService } from "./line-mapping.service";
import { VendorResolutionService } from "../vendor-identity/vendor-resolution.service";

/**
 * r41 invoices gap P9. Opening one paper read its lines, corrections, parties
 * and the vendor's resolution one after another, though each needs only the
 * document id or the provider the document row names. All ids are SYNTHETIC.
 *
 * The client below holds every read except the document row's until the test
 * lets it go, and records which tables were asked while the others were still
 * held: a chain asks one table at a time, together asks them all.
 */

const DOC_ROW = {
  id: "doc-1",
  restaurant_id: "rest-1",
  provider_id: "prov-1",
  doc_type: "invoice",
  doc_number: "SYN-0001",
  doc_date: "2026-09-04",
  references_doc_number: null,
  currency: "USD",
  subtotal: 100,
  freight: null,
  fuel_surcharge: null,
  split_case_fee: null,
  delivery_fee: null,
  deposit_total: null,
  tax: null,
  other_charges: null,
  discount_total: null,
  total: 100,
  extraction_confidence: 0.8,
  extraction_model: "synthetic-model",
  direction: "issued_by_vendor",
  jurisdiction: "unknown",
  source_channel: "upload",
  notes: null,
  extracted: {},
};

const LINE = {
  id: "line-1",
  line_no: 1,
  vendor_sku: "SYN-1",
  description: "SYNTHETIC line",
  vintage: null,
  format_ml: null,
  qty: "10",
  uom: "each",
  pack_size: 1,
  qty_bottles: "10",
  free_goods_qty: "0",
  unit_price: "10.0000",
  line_total: "100.00",
  allowance: null,
  deposit: null,
  order_line_id: null,
  match_method: null,
  match_confidence: null,
  price_base_qty: null,
  price_base_uom: null,
  inventory_id: null,
};

type Answer = { data: unknown; error: { message: string } | null };

describe("the reads after the document row are asked together (r41 gap P9)", () => {
  let canonical: CanonicalDocumentService;
  let answers: Record<string, Answer>;
  let asked: string[];
  let held: boolean;
  let release: () => void;
  let gate: Promise<void>;

  const makeChain = (table: string) => {
    asked.push(table);
    const chain: Record<string, unknown> = {};
    const answer = () => {
      const a = answers[table] ?? { data: null, error: null };
      return { data: a.error ? null : (a.data ?? null), error: a.error };
    };
    const settle = () =>
      table === "procurement_documents" || !held
        ? Promise.resolve(answer())
        : gate.then(answer);
    for (const verb of ["select", "eq", "is", "in", "order", "limit", "insert", "update", "delete"]) {
      chain[verb] = jest.fn(() => chain);
    }
    chain.single = jest.fn(() => settle());
    chain.maybeSingle = jest.fn(() =>
      settle().then((a) => ({
        ...a,
        data: Array.isArray(a.data) ? (a.data[0] ?? null) : a.data,
      })),
    );
    (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown): unknown =>
      settle().then(resolve);
    return chain;
  };

  const client = { from: jest.fn((t: string) => makeChain(t)) };
  const flush = () => new Promise((r) => setImmediate(r));

  beforeEach(async () => {
    jest.clearAllMocks();
    asked = [];
    held = false;
    gate = new Promise<void>((r) => (release = r));
    answers = {
      procurement_documents: { data: DOC_ROW, error: null },
      procurement_document_lines: { data: [LINE], error: null },
      procurement_order_items: { data: [], error: null },
      restaurants: { data: { id: "rest-1", name: "SYNTHETIC House" }, error: null },
      providers: {
        data: {
          id: "prov-1",
          name: "SYNTHETIC Dist",
          company_name: "SYNTHETIC Dist Ltd",
          tax_id: null,
          tax_id_normalized: null,
          provisional_until_first_order: false,
        },
        error: null,
      },
      users: { data: [], error: null },
      document_revisions: { data: [], error: null },
      document_corrections: { data: [], error: null },
      document_line_mappings: { data: [], error: null },
      document_vendor_resolutions: { data: [], error: null },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanonicalDocumentService,
        LineMappingService,
        VendorResolutionService,
        { provide: DatabaseService, useValue: { getClient: () => client } },
      ],
    }).compile();
    canonical = module.get(CanonicalDocumentService);
  });

  it("asks the lines, the corrections, the provider and the vendor's resolution before any of them has answered", async () => {
    held = true;
    const pending = canonical.buildFromDocumentId("rest-1", "doc-1");
    await flush();
    // Every one of these is on its way while NONE has answered.
    expect(asked).toEqual(
      expect.arrayContaining([
        "procurement_documents",
        "procurement_document_lines",
        "document_corrections",
        "document_revisions",
        "providers",
        "document_vendor_resolutions",
      ]),
    );
    release();
    const res = await pending;
    expect(res.ok).toBe(true);
  });

  it("still says the lines failed first when the corrections failed too", async () => {
    answers.procurement_document_lines = { data: null, error: { message: "lines down" } };
    answers.document_corrections = { data: null, error: { message: "corrections down" } };
    const res = await canonical.buildFromDocumentId("rest-1", "doc-1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("procurement_document_lines read failed");
  });

  it("still says the corrections failed before the provider when both failed", async () => {
    answers.document_corrections = { data: null, error: { message: "corrections down" } };
    answers.providers = { data: null, error: { message: "providers down" } };
    const res = await canonical.buildFromDocumentId("rest-1", "doc-1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("document_corrections read failed");
  });

  it("a failed read of the vendor's resolution is still said as unavailable, not a failed build", async () => {
    answers.document_vendor_resolutions = { data: null, error: { message: "log down" } };
    const res = await canonical.buildFromDocumentId("rest-1", "doc-1");
    expect(res.ok).toBe(true);
  });
});
