import { Test, TestingModule } from "@nestjs/testing";
import { DatabaseService } from "../../database/database.service";
import { DocumentExtractorService } from "../documents/document-extractor.service";
import { DocumentIntakeService } from "../documents/document-intake.service";
import { CanonicalDocumentService } from "./canonical-document.service";

/**
 * The BT-149 / BT-150 / `as_printed` round trip (ADR 0104 D1, slice 2
 * deliverable 0). All ids, names and numbers here are SYNTHETIC.
 *
 * THE GAP THIS CLOSES. PR #298 taught the extractor to read the printed price
 * base and the literal glyphs of every money and quantity field, and carried
 * them on `ParsedLine`. `procurement_document_lines` had no column for any of
 * the three, so the values lived for exactly one HTTP request: intake dropped
 * them on the way in and `CanonicalDocumentService` had no way to read them
 * back. `142,00 / KS(12)` and `142,00` — a factor of twelve apart — were the
 * same stored row.
 *
 * Two halves, and both are needed: writing a column nothing reads and reading a
 * column nothing writes each pass a test on their own while the product still
 * shows nothing.
 */

const TR_LINE_PRINTED = {
  qty: "12 şişe",
  unitPrice: "142,00 / KS(12)",
  lineTotal: "142,00 TL",
  priceBaseQty: "KS(12)",
};

describe("price base and printed literals — write", () => {
  let service: DocumentIntakeService;

  const mockSingle = jest.fn();
  const mockMaybeSingle = jest.fn();
  const inserts: { table: string; payload: unknown }[] = [];
  let currentTable = "";

  const chain: any = {
    from: jest.fn((t: string) => {
      currentTable = t;
      return chain;
    }),
    select: jest.fn(() => chain),
    insert: jest.fn((payload: unknown) => {
      inserts.push({ table: currentTable, payload });
      return chain;
    }),
    eq: jest.fn(() => chain),
    order: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
    storage: {
      from: jest.fn(() => ({
        upload: jest
          .fn()
          .mockResolvedValue({ data: { path: "p" }, error: null }),
        download: jest.fn(),
      })),
    },
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve),
  };

  const extractor = {
    available: jest.fn().mockReturnValue(true),
    extract: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    inserts.length = 0;
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockSingle.mockResolvedValue({ data: { id: "doc-tr-1" }, error: null });
    extractor.available.mockReturnValue(true);
    extractor.extract.mockResolvedValue({
      docType: "invoice",
      docNumber: "SYN-A-88214",
      docDate: "2026-08-14",
      currency: "TRY",
      subtotal: 142,
      total: 170.4,
      tax: 28.4,
      lines: [
        {
          lineNo: 1,
          description: "SYNTHETIC Öküzgözü",
          qty: 12,
          uom: "bottle",
          packSize: 12,
          qtyBottles: 12,
          freeGoodsQty: 0,
          unitPrice: 142,
          lineTotal: null,
          // `142,00 / KS(12)`: the price is stated for TWELVE ŞİŞE, so the
          // basis is 12 bottles — not "1 case". Encoding it as a case would
          // divide the quantity by twelve a second time.
          priceBaseQty: 12,
          priceBaseUom: "bottle",
          printed: TR_LINE_PRINTED,
        },
      ],
      computedLinesTotal: null,
      tieOutDelta: null,
      tiesOut: null,
      confidence: 0.8,
      warnings: [],
      printed: { total: "170,40 TL", tax: "28,40 TL" },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentIntakeService,
        { provide: DatabaseService, useValue: { getClient: () => chain } },
        { provide: DocumentExtractorService, useValue: extractor },
        // DocumentIntakeService gained a CanonicalDocumentService dependency
        // with the extraction door (it appends the document's revision). It is
        // the real service over the same mocked client — nothing on the path
        // under test reaches it, and a stub would have to pretend otherwise.
        CanonicalDocumentService,
      ],
    }).compile();
    service = module.get(DocumentIntakeService);
  });

  it("writes BT-149, BT-150 and the printed literals onto the stored line", async () => {
    await service.ingest({
      restaurantId: "rest-syn",
      source: "upload",
      buffer: Buffer.from("SYNTHETIC TEST FIXTURE bytes"),
      filename: "fatura.pdf",
      mimeType: "application/pdf",
    });

    const lineInsert = inserts.find(
      (i) => i.table === "procurement_document_lines",
    );
    expect(lineInsert).toBeDefined();
    const row = (lineInsert!.payload as Record<string, unknown>[])[0];
    expect(row.price_base_qty).toBe(12);
    expect(row.price_base_uom).toBe("bottle");
    // Unreformatted, comma decimal intact.
    expect(row.printed).toEqual(TR_LINE_PRINTED);

    const docInsert = inserts.find((i) => i.table === "procurement_documents");
    expect((docInsert!.payload as Record<string, unknown>).printed).toEqual({
      total: "170,40 TL",
      tax: "28,40 TL",
    });
  });

  it("KEEPS the document when the extraction model fails (ADR 0104 D6)", async () => {
    // Measured 2026-09-04: the live extractor answered
    // `Anthropic 400: Your credit balance is too low`, and the whole ingest
    // 422'd — no row written, and the original bytes already uploaded to the
    // bucket with nothing pointing at them. A billing problem at the model
    // vendor must not be able to discard a restaurant's invoice.
    extractor.extract.mockRejectedValue(
      new Error("Anthropic 400: Your credit balance is too low"),
    );

    const res = await service.ingest({
      restaurantId: "rest-syn",
      source: "upload",
      buffer: Buffer.from("SYNTHETIC TEST FIXTURE bytes 3"),
      filename: "fatura.pdf",
      mimeType: "application/pdf",
    });

    expect(res.error).toBeUndefined();
    expect(res.documentId).toBe("doc-tr-1");
    const row = inserts.find((i) => i.table === "procurement_documents")!
      .payload as Record<string, unknown>;
    // Stored unread, in needs_review, WITH the reason on the record.
    expect(row.status).toBe("needs_review");
    expect(row.doc_type).toBe("unknown");
    expect(String(row.notes)).toContain("credit balance is too low");
    // And never an invoice that billed nothing.
    expect(row.total).toBeNull();
    expect(
      inserts.find((i) => i.table === "procurement_document_lines"),
    ).toBeUndefined();
  });

  it("stores NULL, never a placeholder, when the paper printed no basis", async () => {
    extractor.extract.mockResolvedValue({
      docType: "invoice",
      currency: "USD",
      total: 264,
      lines: [
        {
          lineNo: 1,
          description: "SYNTHETIC Sancerre",
          qty: 12,
          uom: "bottle",
          packSize: 1,
          qtyBottles: 12,
          freeGoodsQty: 0,
          unitPrice: 22,
          lineTotal: 264,
          priceBaseQty: null,
          priceBaseUom: null,
        },
      ],
      computedLinesTotal: null,
      tieOutDelta: null,
      tiesOut: null,
      confidence: 0.9,
      warnings: [],
    });

    await service.ingest({
      restaurantId: "rest-syn",
      source: "upload",
      buffer: Buffer.from("SYNTHETIC TEST FIXTURE bytes 2"),
      filename: "invoice.pdf",
      mimeType: "application/pdf",
    });

    const row = (
      inserts.find((i) => i.table === "procurement_document_lines")!
        .payload as Record<string, unknown>[]
    )[0];
    // A `1` here would assert the document printed a per-unit basis it never
    // printed; `{}` on `printed` would assert we kept literals we did not.
    expect(row.price_base_qty).toBeNull();
    expect(row.price_base_uom).toBeNull();
    expect(row.printed).toBeNull();
  });
});

describe("price base and printed literals — read back", () => {
  let service: CanonicalDocumentService;
  /** Per-table answers, chosen by the column list the service asked for. */
  let answers: Record<
    string,
    (columns: string) => {
      data: unknown;
      error: { message: string; code?: string } | null;
    }
  >;
  let currentTable = "";
  let lastColumns = "";

  const chain = () => {
    const c: Record<string, unknown> = {};
    const self = () => c;
    for (const verb of ["eq", "in", "order", "limit"]) {
      c[verb] = jest.fn(self);
    }
    c.select = jest.fn((cols: string) => {
      lastColumns = cols;
      return c;
    });
    const answer = () => answers[currentTable](lastColumns);
    c.maybeSingle = jest.fn(() => {
      const a = answer();
      const data = Array.isArray(a.data) ? (a.data[0] ?? null) : a.data;
      return Promise.resolve({ data: a.error ? null : data, error: a.error });
    });
    (c as { then: unknown }).then = (resolve: (v: unknown) => unknown) => {
      const a = answer();
      return Promise.resolve({
        data: a.error ? null : a.data,
        error: a.error,
      }).then(resolve);
    };
    return c;
  };

  const client = {
    from: jest.fn((table: string) => {
      currentTable = table;
      return chain();
    }),
  };

  const DOC_ROW = {
    id: "doc-tr-1",
    restaurant_id: "rest-syn",
    provider_id: null,
    doc_type: "invoice",
    doc_number: "SYN-A-88214",
    doc_date: "2026-08-14",
    references_doc_number: null,
    currency: "TRY",
    subtotal: 142,
    freight: null,
    fuel_surcharge: null,
    split_case_fee: null,
    delivery_fee: null,
    deposit_total: null,
    tax: 28.4,
    other_charges: null,
    discount_total: null,
    total: 170.4,
    extraction_confidence: 0.8,
    extraction_model: "synthetic-model",
    direction: "issued_by_vendor",
    jurisdiction: "TR",
    source_channel: "upload",
    notes: null,
    printed: { total: "170,40 TL" },
  };

  // PostgREST hands numerics back as STRINGS.
  const LINE_ROW = {
    line_no: 1,
    vendor_sku: null,
    description: "SYNTHETIC Öküzgözü",
    vintage: 2021,
    format_ml: 750,
    qty: "12",
    uom: "bottle",
    pack_size: 12,
    qty_bottles: "12",
    free_goods_qty: "0",
    unit_price: "142.0000",
    line_total: null,
    allowance: null,
    deposit: null,
    order_line_id: null,
    match_method: null,
    match_confidence: null,
    price_base_qty: "12.000",
    price_base_uom: "bottle",
    printed: TR_LINE_PRINTED,
  };

  const strip = (row: Record<string, unknown>, keys: string[]) => {
    const out = { ...row };
    for (const k of keys) delete out[k];
    return out;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    answers = {
      procurement_documents: () => ({ data: DOC_ROW, error: null }),
      procurement_document_lines: () => ({ data: [LINE_ROW], error: null }),
      procurement_order_items: () => ({ data: [], error: null }),
      // BG-7 — the buyer is the restaurant row, which this service now reads.
      restaurants: () => ({
        data: { id: "rest-syn", name: "SYNTHETIC Meyhane" },
        error: null,
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanonicalDocumentService,
        { provide: DatabaseService, useValue: { getClient: () => client } },
      ],
    }).compile();
    service = module.get(CanonicalDocumentService);
  });

  it("round-trips a case-priced line's price base and printed strings", async () => {
    const res = await service.buildFromDocumentId("rest-syn", "doc-tr-1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const line = res.value.layer1.lines[0];
    expect(line.priceBaseQuantity.value).toBe(12);
    expect(line.priceBaseUnit.value).toBe("bottle");
    // The literal glyphs, never reformatted: the comma decimal survives.
    expect(line.netPrice.as_printed).toBe("142,00 / KS(12)");
    expect(line.quantity.as_printed).toBe("12 şişe");
    expect(res.value.layer1.totals.taxInclusiveAmount.as_printed).toBe(
      "170,40 TL",
    );
    // And the arithmetic that the basis exists to protect: 12 şişe at
    // 142,00 per KS(12) is 142,00, not 1.704,00.
    expect(res.value.layer3.tiesOut).not.toBe(false);
    expect(res.notes).toBeUndefined();
  });

  it("names a schema lag instead of reporting the basis as absent", async () => {
    // A database that has not applied 20260904120000 yet. PostgREST answers
    // 42703; the service must retry WITHOUT the new columns and SAY SO, because
    // "never stored" and "the paper printed no basis" render identically and
    // are not the same fact.
    answers.procurement_documents = (cols: string) =>
      cols.includes("printed")
        ? {
            data: null,
            error: {
              message: 'column "printed" does not exist',
              code: "42703",
            },
          }
        : { data: strip(DOC_ROW, ["printed"]), error: null };
    answers.procurement_document_lines = (cols: string) =>
      cols.includes("price_base_qty")
        ? {
            data: null,
            error: {
              message: 'column "price_base_qty" does not exist',
              code: "42703",
            },
          }
        : {
            data: [
              strip(LINE_ROW, ["price_base_qty", "price_base_uom", "printed"]),
            ],
            error: null,
          };

    const res = await service.buildFromDocumentId("rest-syn", "doc-tr-1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.layer1.lines).toHaveLength(1);
    // The basis falls back to OUR stated assumption of one invoiced unit, and
    // the paper kept no literal to show beside it. On its own that is
    // indistinguishable from a document that printed no basis — the note is
    // the entire difference, which is why it is asserted here and not merely
    // logged.
    expect(res.value.layer1.lines[0].priceBaseQuantity.value).toBe(1);
    expect(res.value.layer1.lines[0].netPrice.as_printed).toBeNull();
    expect(res.notes?.join(" ")).toContain("20260904120000");
    expect(res.notes?.join(" ")).toContain("NEVER STORED");
  });

  it("still fails the read when the error is not a missing column", async () => {
    answers.procurement_document_lines = () => ({
      data: null,
      error: { message: "connection reset", code: "08006" },
    });
    const res = await service.buildFromDocumentId("rest-syn", "doc-tr-1");
    // Not "a document with no lines" — ADR 0067.
    expect(res.ok).toBe(false);
  });
});
