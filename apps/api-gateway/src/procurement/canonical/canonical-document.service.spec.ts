import { Test, TestingModule } from "@nestjs/testing";
import { DatabaseService } from "../../database/database.service";
import { CanonicalDocumentService } from "./canonical-document.service";

/**
 * Mocked supabase. All ids and numbers are SYNTHETIC.
 *
 * The two things this file exists to prove:
 *   1. A FAILED READ IS NEVER AN EMPTY DOCUMENT (ADR 0067). supabase-js
 *      RESOLVES with { data, error }; a service that destructures `data` and
 *      ignores `error` renders a broken query as an invoice with no lines.
 *   2. persistRevision NEVER ISSUES AN UPDATE (ADR 0104 D5). The database
 *      refuses one anyway — the append-only trigger, proven in
 *      supabase/tests/20260903160000_canonical_document_and_delivery_test.sql —
 *      but the service must not try, and the mock records every verb it calls.
 */

const DOC_ROW = {
  id: "doc-1",
  restaurant_id: "rest-1",
  provider_id: "prov-1",
  doc_type: "invoice",
  doc_number: "SYN-1001",
  doc_date: "2026-08-20",
  references_doc_number: null,
  currency: "USD",
  subtotal: 660,
  freight: 48,
  fuel_surcharge: null,
  split_case_fee: null,
  delivery_fee: null,
  deposit_total: null,
  tax: null,
  other_charges: null,
  discount_total: null,
  total: 708,
  extraction_confidence: 0.91,
  extraction_model: "synthetic-model",
  direction: "issued_by_vendor",
  jurisdiction: "US-CA",
  source_channel: "email",
  notes: null,
};

// Numerics come back from PostgREST as STRINGS. Written that way on purpose:
// a mock that hands back numbers would hide a real coercion bug.
const LINE_ROWS = [
  {
    line_no: 1,
    vendor_sku: "SKU-1",
    description: "SYNTHETIC Sancerre",
    vintage: 2023,
    format_ml: 750,
    qty: "24",
    uom: "bottle",
    pack_size: 1,
    qty_bottles: "24",
    free_goods_qty: "0",
    unit_price: "22.0000",
    line_total: "528.00",
    allowance: null,
    deposit: null,
    order_line_id: "ol-1",
    match_method: "vendor_sku",
    match_confidence: "0.980",
  },
  {
    line_no: 2,
    vendor_sku: null,
    description: "SYNTHETIC Barolo",
    vintage: 2019,
    format_ml: 750,
    qty: "6",
    uom: "bottle",
    pack_size: 1,
    qty_bottles: "6",
    free_goods_qty: "0",
    unit_price: "22.0000",
    line_total: "132.00",
    allowance: null,
    deposit: null,
    order_line_id: null,
    match_method: null,
    match_confidence: null,
  },
];

describe("CanonicalDocumentService", () => {
  let service: CanonicalDocumentService;

  /** Every verb the service issued, in order. */
  let verbs: string[];
  /** Per-table canned answers. */
  let answers: Record<
    string,
    { data: unknown; error: { message: string } | null }
  >;
  /** What a chain that CALLED .insert() resolves to, when it differs from the
   *  read answer for the same table. */
  let insertAnswers: Record<
    string,
    { data: unknown; error: { message: string } | null }
  >;
  let currentTable: string;
  /** Every payload handed to .insert(), so the ASSERTION is on what the service
   *  wrote and not on what the mock echoed back. */
  let inserts: { table: string; payload: Record<string, unknown> }[];

  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    let didInsert = false;
    const answerFor = () =>
      (didInsert ? insertAnswers[currentTable] : undefined) ??
      answers[currentTable];
    for (const verb of [
      "select",
      "eq",
      "in",
      "order",
      "limit",
      "single",
      "maybeSingle",
      "insert",
      "update",
      "upsert",
      "delete",
    ]) {
      chain[verb] = jest.fn((...args: unknown[]) => {
        verbs.push(`${currentTable}.${verb}`);
        if (verb === "insert") {
          didInsert = true;
          inserts.push({
            table: currentTable,
            payload: args[0] as Record<string, unknown>,
          });
        }
        if (verb === "single" || verb === "maybeSingle") {
          const a = answerFor();
          const data = Array.isArray(a?.data) ? (a.data[0] ?? null) : a?.data;
          return Promise.resolve({
            data: data ?? null,
            error: a?.error ?? null,
          });
        }
        void args;
        return self();
      });
    }
    // A chain that is awaited without .single() resolves to the table's answer.
    (chain as { then: unknown }).then = (
      resolve: (v: unknown) => unknown,
    ): unknown => {
      const a = answerFor();
      return Promise.resolve({
        data: a?.data ?? null,
        error: a?.error ?? null,
      }).then(resolve);
    };
    return chain;
  };

  const client = {
    from: jest.fn((table: string) => {
      currentTable = table;
      return makeChain();
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    verbs = [];
    inserts = [];
    currentTable = "";
    insertAnswers = {
      // What a real .insert(...).select().single() hands back.
      document_revisions: { data: { id: "rev-new", revision: 1 }, error: null },
    };
    answers = {
      procurement_documents: { data: DOC_ROW, error: null },
      procurement_document_lines: { data: LINE_ROWS, error: null },
      procurement_order_items: {
        data: [{ id: "ol-1", inventory_id: "inv-1", master_wine_id: "mw-1" }],
        error: null,
      },
      // BG-4 / BG-7 — the seller comes from the resolved provider row and the
      // buyer from the restaurant row; `procurement_documents` has neither
      // column, which is why all three real documents read on 2026-09-04 said
      // "The seller is not named on this document".
      providers: {
        data: {
          id: "prov-1",
          name: "SYNTHETIC Glazers",
          company_name: "SYNTHETIC Glazers Wine & Spirits",
        },
        error: null,
      },
      restaurants: {
        data: { id: "rest-1", name: "SYNTHETIC Meyhane" },
        error: null,
      },
      document_revisions: { data: [], error: null },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanonicalDocumentService,
        { provide: DatabaseService, useValue: { getClient: () => client } },
      ],
    }).compile();
    service = module.get(CanonicalDocumentService);
  });

  describe("buildFromDocumentId", () => {
    it("builds the canonical object from the columns and the lines", async () => {
      const res = await service.buildFromDocumentId("rest-1", "doc-1");
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.documentId).toBe("doc-1");
      expect(res.value.jurisdiction).toBe("US-CA");
      expect(res.value.layer1.lines).toHaveLength(2);
      // strings coerced to numbers, not NaN and not dropped
      expect(res.value.layer1.lines[0].netAmount.value).toBe(528);
      expect(res.value.layer1.lines[0].quantity.value).toBe(24);
    });

    it("resolves layer 2 from the match tables for matched lines only", async () => {
      const res = await service.buildFromDocumentId("rest-1", "doc-1");
      if (!res.ok) throw new Error(res.error);
      expect(res.value.layer2.lines[0]).toMatchObject({
        inventoryId: "inv-1",
        masterWineId: "mw-1",
        matchMethod: "vendor_sku",
        matchConfidence: 0.98,
      });
      // A WRONG LINK IS WORSE THAN NO LINK: the unmatched line stays null.
      expect(res.value.layer2.lines[1].inventoryId).toBeNull();
      expect(res.value.layer2.lines[1].matchMethod).toBeNull();
    });

    it("returns a FAILED READ, not an empty document, when the document query errors", async () => {
      answers.procurement_documents = {
        data: null,
        error: { message: "connection reset" },
      };
      const res = await service.buildFromDocumentId("rest-1", "doc-1");
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toContain("procurement_documents read failed");
      expect(res.error).toContain("connection reset");
    });

    it("returns a FAILED READ, not a zero-line document, when the LINE query errors", async () => {
      answers.procurement_document_lines = {
        data: null,
        error: { message: "statement timeout" },
      };
      const res = await service.buildFromDocumentId("rest-1", "doc-1");
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toContain("procurement_document_lines read failed");
    });

    it("returns a FAILED READ when the match-table query errors", async () => {
      answers.procurement_order_items = {
        data: null,
        error: { message: "permission denied" },
      };
      const res = await service.buildFromDocumentId("rest-1", "doc-1");
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toContain("procurement_order_items read failed");
    });

    it("distinguishes 'not found' from 'the read failed'", async () => {
      answers.procurement_documents = { data: null, error: null };
      const res = await service.buildFromDocumentId("rest-1", "doc-1");
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toContain("not found");
      expect(res.error).not.toContain("read failed");
    });

    it("scopes the read by restaurant as well as by id", async () => {
      await service.buildFromDocumentId("rest-1", "doc-1");
      const eqCalls = verbs.filter((v) => v === "procurement_documents.eq");
      expect(eqCalls).toHaveLength(2);
    });
  });

  describe("persistRevision", () => {
    const canonical = () => ({
      documentId: "doc-1",
      restaurantId: "rest-1",
      docType: "invoice",
      direction: "issued_by_vendor" as const,
      jurisdiction: "US-CA" as const,
      revision: 1,
      layer1: { marker: "synthetic" } as never,
      layer2: { providerId: null, lines: [] },
      layer3: {
        lines: [],
        tiesOut: null,
        tieOutDeltaCents: null,
        verdicts: [],
      },
    });

    it("writes revision 1 when the document has none", async () => {
      answers.document_revisions = { data: [], error: null };
      await service.persistRevision("doc-1", canonical(), "extracted");
      expect(inserts).toHaveLength(1);
      expect(inserts[0].table).toBe("document_revisions");
      expect(inserts[0].payload).toMatchObject({
        document_id: "doc-1",
        revision: 1,
        source: "extracted",
        created_by: null,
      });
    });

    it("writes the NEXT revision when revisions already exist", async () => {
      answers.document_revisions = {
        data: [{ revision: 4, id: "rev-4" }],
        error: null,
      };
      await service.persistRevision(
        "doc-1",
        canonical(),
        "human_corrected",
        "user-9",
      );
      expect(inserts[0].payload).toMatchObject({
        revision: 5,
        source: "human_corrected",
        created_by: "user-9",
      });
      // and the revision number is stamped INTO layer1, so a stored document
      // can never disagree with the row that holds it
      expect(
        (inserts[0].payload.layer1 as Record<string, unknown>).revision,
      ).toBe(5);
    });

    it("NEVER issues an UPDATE or a DELETE on document_revisions", async () => {
      answers.document_revisions = {
        data: [{ revision: 2, id: "rev-3" }],
        error: null,
      };
      await service.persistRevision("doc-1", canonical(), "computed");
      expect(verbs).toContain("document_revisions.insert");
      expect(verbs.some((v) => v.endsWith(".update"))).toBe(false);
      expect(verbs.some((v) => v.endsWith(".delete"))).toBe(false);
      expect(verbs.some((v) => v.endsWith(".upsert"))).toBe(false);
    });

    it("surfaces a failed revision read instead of silently starting at 1", async () => {
      answers.document_revisions = {
        data: null,
        error: { message: "relation does not exist" },
      };
      const res = await service.persistRevision(
        "doc-1",
        canonical(),
        "extracted",
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toContain("document_revisions read failed");
      // and it did NOT go on to insert a revision 1 over the top of history
      expect(verbs).not.toContain("document_revisions.insert");
      expect(inserts).toHaveLength(0);
    });

    it("surfaces an insert failure rather than reporting a revision that does not exist", async () => {
      // The read succeeds (revision 1 exists); the INSERT of revision 2 loses
      // the race on UNIQUE (document_id, revision).
      answers.document_revisions = { data: [{ revision: 1 }], error: null };
      insertAnswers.document_revisions = {
        data: null,
        error: { message: "duplicate key value violates unique constraint" },
      };
      const res = await service.persistRevision(
        "doc-1",
        canonical(),
        "extracted",
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toContain("insert failed");
      expect(res.error).toContain("revision 2");
    });

    it("reports a no-row-no-error insert as a failure, never as a fabricated success", async () => {
      answers.document_revisions = { data: [], error: null };
      insertAnswers.document_revisions = { data: null, error: null };
      const res = await service.persistRevision(
        "doc-1",
        canonical(),
        "extracted",
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toContain("returned no row and no error");
    });
  });
});

/**
 * The three fields that have NO COLUMN, and the two parties that have no
 * column either (findings 2, 3 and 4 of `v3.0-TECH-DEBT.md`, 2026-09-04).
 * Every id, name and number below is SYNTHETIC.
 */
describe("CanonicalDocumentService — what the columns cannot hold", () => {
  let service: CanonicalDocumentService;
  let answers: Record<
    string,
    { data: unknown; error: { message: string } | null }
  >;
  let currentTable = "";

  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const verb of ["select", "eq", "in", "order", "limit"])
      chain[verb] = jest.fn(self);
    chain.maybeSingle = jest.fn(() => {
      const a = answers[currentTable];
      const data = Array.isArray(a?.data) ? (a.data[0] ?? null) : a?.data;
      return Promise.resolve({ data: data ?? null, error: a?.error ?? null });
    });
    (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => {
      const a = answers[currentTable];
      return Promise.resolve({
        data: a?.data ?? null,
        error: a?.error ?? null,
      }).then(resolve);
    };
    return chain;
  };

  const client = {
    from: jest.fn((table: string) => {
      currentTable = table;
      return makeChain();
    }),
  };

  const ROW = {
    ...DOC_ROW,
    provider_id: null,
    currency: "TRY",
    subtotal: 1704,
    deposit_total: 180,
    tax: 340.8,
    total: 2224.8,
    // The parser's own snapshot — the only place these three ever live.
    extracted: {
      vendorName: "SYNTHETIC Uzum Bagcilik A.S.",
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

  const LINES = [
    {
      ...LINE_ROWS[0],
      line_no: 1,
      description: "SYNTHETIC Okuzgozu",
      qty: "12",
      qty_bottles: "12",
      unit_price: "142.0000",
      line_total: "1704.00",
      order_line_id: null,
      match_method: null,
      match_confidence: null,
    },
    {
      ...LINE_ROWS[1],
      line_no: 2,
      description: "SYNTHETIC Depozito (kasa)",
      qty: "2",
      uom: "each",
      qty_bottles: "0",
      unit_price: "90.0000",
      line_total: "180.00",
    },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();
    currentTable = "";
    answers = {
      procurement_documents: { data: ROW, error: null },
      procurement_document_lines: { data: LINES, error: null },
      procurement_order_items: { data: [], error: null },
      restaurants: {
        data: { id: "rest-1", name: "SYNTHETIC Meyhane" },
        error: null,
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanonicalDocumentService,
        { provide: DatabaseService, useValue: { getClient: () => client } },
      ],
    }).compile();
    service = module.get(CanonicalDocumentService);
  });

  it("names the seller from the snapshot and the buyer from the restaurant row", async () => {
    const res = await service.buildFromDocumentId("rest-1", "doc-1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.layer1.seller.name.value).toBe(
      "SYNTHETIC Uzum Bagcilik A.S.",
    );
    expect(res.value.layer1.seller.name.source).toBe("extracted");
    expect(res.value.layer1.buyer.name.value).toBe("SYNTHETIC Meyhane");
    // Our own record, so it must NOT claim the page printed it.
    expect(res.value.layer1.buyer.name.source).toBe("human_entered");
    expect(res.value.layer1.buyer.name.as_printed).toBeNull();
  });

  it("prefers the resolved provider's trading name when one is linked", async () => {
    answers.procurement_documents = {
      data: { ...ROW, provider_id: "prov-1" },
      error: null,
    };
    answers.providers = {
      data: {
        id: "prov-1",
        name: "SYNTHETIC Glazers",
        company_name: "SYNTHETIC Glazers Wine & Spirits",
      },
      error: null,
    };
    const res = await service.buildFromDocumentId("rest-1", "doc-1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.layer1.seller.name.value).toBe(
      "SYNTHETIC Glazers Wine & Spirits",
    );
    expect(res.value.layer1.seller.name.source).toBe("human_entered");
  });

  it("carries BT-72 and BG-23 out of the snapshot", async () => {
    const res = await service.buildFromDocumentId("rest-1", "doc-1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.layer1.actualDeliveryDate.value).toBe("2026-08-12");
    expect(res.value.layer1.vatBreakdown).toHaveLength(1);
    expect(res.value.layer1.vatBreakdown[0].rate.value).toBe(20);
    expect(res.value.layer1.vatBreakdown[0].taxableAmount.value).toBe(1704);
  });

  it("restores the deposit line's kind by line_no, and keeps it out of BT-106", async () => {
    const res = await service.buildFromDocumentId("rest-1", "doc-1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.layer1.lines[1].lineKind?.value).toBe("deposit");
    expect(res.value.layer1.totals.linesNetTotal.value).toBe(1704);
    const deposit = res.value.layer1.allowancesCharges.find(
      (ac) => ac.reasonCode.value === "7161",
    );
    expect(deposit?.amount.value).toBe(180);
  });

  it("REPORTS a failed provider read rather than an unnamed seller", async () => {
    answers.procurement_documents = {
      data: { ...ROW, provider_id: "prov-1" },
      error: null,
    };
    answers.providers = { data: null, error: { message: "connection reset" } };
    const res = await service.buildFromDocumentId("rest-1", "doc-1");
    // "We could not read the provider" and "this document names no seller" are
    // different sentences; only one of them sends someone looking for paper.
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/providers read failed/);
  });

  it("survives an `extracted` snapshot that carries none of the three", async () => {
    answers.procurement_documents = {
      data: { ...ROW, extracted: null },
      error: null,
    };
    const res = await service.buildFromDocumentId("rest-1", "doc-1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.layer1.seller.name.value).toBeNull();
    expect(res.value.layer1.actualDeliveryDate.value).toBeNull();
    expect(res.value.layer1.vatBreakdown).toEqual([]);
    expect(res.value.layer1.lines[1].lineKind?.value).toBe("goods");
  });
});
