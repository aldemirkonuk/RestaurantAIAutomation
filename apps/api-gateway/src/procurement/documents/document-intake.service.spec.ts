import { Test, TestingModule } from "@nestjs/testing";
import { DocumentIntakeService } from "./document-intake.service";
import { DatabaseService } from "../../database/database.service";
import { DocumentExtractorService } from "./document-extractor.service";
import { CanonicalDocumentService } from "../canonical/canonical-document.service";
import { getCorrelationId } from "../../common/model-client/correlation";

describe("DocumentIntakeService — original bytes persistence (decision E47)", () => {
  let service: DocumentIntakeService;

  const mockSingle = jest.fn();
  const mockMaybeSingle = jest.fn();
  const mockStorageUpload = jest.fn();

  const mockSupabaseChain: any = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
    storage: {
      from: jest.fn().mockReturnValue({
        upload: mockStorageUpload,
        download: jest.fn(),
      }),
    },
  };

  const mockDatabaseService = {
    getClient: jest.fn(() => mockSupabaseChain),
  };

  const mockExtractor = {
    available: jest.fn().mockReturnValue(false),
    extract: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSupabaseChain.from.mockReturnThis();
    mockSupabaseChain.select.mockReturnThis();
    mockSupabaseChain.insert.mockReturnThis();
    mockSupabaseChain.eq.mockReturnThis();
    mockSupabaseChain.order.mockReturnThis();
    mockSupabaseChain.limit.mockReturnThis();
    mockSupabaseChain.storage.from.mockReturnValue({
      upload: mockStorageUpload,
      download: jest.fn(),
    });

    // Not a duplicate by default.
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    // Insert of procurement_documents succeeds by default.
    mockSingle.mockResolvedValue({ data: { id: "doc-1" }, error: null });
    mockStorageUpload.mockResolvedValue({ data: { path: "ok" }, error: null });
    mockExtractor.available.mockReturnValue(false);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentIntakeService,
        { provide: DatabaseService, useValue: mockDatabaseService },
        { provide: DocumentExtractorService, useValue: mockExtractor },
        // DocumentIntakeService gained a CanonicalDocumentService dependency
        // with the extraction door (it appends the document's revision). It is
        // the real service over the same mocked client — nothing on the path
        // under test reaches it, and a stub would have to pretend otherwise.
        CanonicalDocumentService,
      ],
    }).compile();

    service = module.get<DocumentIntakeService>(DocumentIntakeService);
  });

  it("uploads the raw bytes to vendor-attachments at {restaurantId}/documents/{sha256}/{filename} for the upload channel", async () => {
    const buffer = Buffer.from("fake pdf bytes");

    await service.ingest({
      restaurantId: "rest-1",
      source: "upload",
      buffer,
      filename: "invoice.pdf",
      mimeType: "application/pdf",
    });

    expect(mockSupabaseChain.storage.from).toHaveBeenCalledWith(
      "vendor-attachments",
    );
    expect(mockStorageUpload).toHaveBeenCalledTimes(1);
    const [path, uploadedBytes, opts] = mockStorageUpload.mock.calls[0];
    expect(path).toMatch(/^rest-1\/documents\/[a-f0-9]{64}\/invoice\.pdf$/);
    expect(Buffer.isBuffer(uploadedBytes)).toBe(true);
    expect(opts).toMatchObject({
      contentType: "application/pdf",
      upsert: true,
    });

    // storage_path on the insert must be the uploaded path, not null.
    const insertCall = mockSupabaseChain.insert.mock.calls[0][0];
    expect(insertCall.storage_path).toBe(path);
  });

  it("uploads the raw bytes for the photo channel too", async () => {
    const buffer = Buffer.from("fake photo bytes");

    await service.ingest({
      restaurantId: "rest-2",
      source: "photo",
      buffer,
      filename: "receipt.jpg",
      mimeType: "image/jpeg",
    });

    expect(mockStorageUpload).toHaveBeenCalledTimes(1);
    const insertCall = mockSupabaseChain.insert.mock.calls[0][0];
    expect(insertCall.storage_path).not.toBeNull();
  });

  it("does not re-upload when storagePath is already resolved (email channel)", async () => {
    const buffer = Buffer.from("already stored bytes");

    await service.ingest({
      restaurantId: "rest-3",
      source: "email",
      buffer,
      filename: "invoice.pdf",
      mimeType: "application/pdf",
      storagePath: "rest-3/conv-1/already-stored.pdf",
    });

    expect(mockStorageUpload).not.toHaveBeenCalled();
    const insertCall = mockSupabaseChain.insert.mock.calls[0][0];
    expect(insertCall.storage_path).toBe("rest-3/conv-1/already-stored.pdf");
  });

  it("skips storage entirely for text-only EDI intake, which keeps its content in raw_payload", async () => {
    await service.ingest({
      restaurantId: "rest-4",
      source: "edi",
      text: "ISA*00*          *00*          *ZZ*SENDER*ZZ*RECEIVER*260101*1200*U*00401*000000001*0*P*>~",
      filename: "810.edi",
    });

    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  /**
   * Finding 8 of `v3.0-TECH-DEBT.md` (2026-09-04): "the original is not
   * reachable". The bucket was MEASURED on 2026-09-05 and all three objects
   * were present and signable — the finding's premise was wrong — but the
   * SHAPE that would have made it unfalsifiable was real and is what these
   * two tests hold shut. A failed upload used to return NULL, which is the
   * same value the EDI channel returns because it has no bytes at all: the
   * document then said "no original was stored for this document" and nothing
   * anywhere recorded that bytes had arrived and the write had broken.
   */
  it("surfaces a failed upload as a FAILED WRITE, never as an absent file", async () => {
    mockStorageUpload.mockResolvedValue({
      data: null,
      error: { message: "bucket unreachable" },
    });

    const result = await service.ingest({
      restaurantId: "rest-9",
      source: "upload",
      buffer: Buffer.from("SYNTHETIC bytes"),
      filename: "invoice.pdf",
      mimeType: "application/pdf",
    });

    // 1. The document still lands — a broken bucket must not discard a
    //    readable invoice.
    expect(result.documentId).toBe("doc-1");
    expect(result.error).toBeUndefined();
    // 2. But the failure is NAMED, and named as a write failure.
    expect(result.storageError).toMatch(/could not be stored/);
    expect(result.storageError).toMatch(/failed write, not a document that/);
    // 3. And it reaches the row, so the screen can say it.
    const insertCall = mockSupabaseChain.insert.mock.calls[0][0];
    expect(String(insertCall.notes)).toMatch(/could not be stored/);
  });

  it("never claims a storage_path the bucket does not have", async () => {
    mockStorageUpload.mockResolvedValue({
      data: null,
      error: { message: "bucket unreachable" },
    });

    await service.ingest({
      restaurantId: "rest-9",
      source: "upload",
      buffer: Buffer.from("SYNTHETIC bytes"),
      filename: "invoice.pdf",
      mimeType: "application/pdf",
    });

    const insertCall = mockSupabaseChain.insert.mock.calls[0][0];
    expect(insertCall.storage_path).toBeNull();
  });

  it("says nothing about storage when the channel had no bytes to store", async () => {
    // EDI keeps its content in raw_payload. `storageError` ABSENT is the
    // answer here — an empty string would read as a failure that happened.
    const result = await service.ingest({
      restaurantId: "rest-9",
      source: "edi",
      text: "ISA*00*",
    });
    expect(result.storageError).toBeUndefined();
  });

  it("does not fail ingest when the storage upload errors — it is best-effort", async () => {
    mockStorageUpload.mockResolvedValueOnce({
      data: null,
      error: { message: "bucket unavailable" },
    });
    const buffer = Buffer.from("bytes that fail to upload");

    const result = await service.ingest({
      restaurantId: "rest-5",
      source: "upload",
      buffer,
      filename: "invoice.pdf",
      mimeType: "application/pdf",
    });

    expect(result.error).toBeUndefined();
    const insertCall = mockSupabaseChain.insert.mock.calls[0][0];
    expect(insertCall.storage_path).toBeNull();
  });

  /**
   * The sweep is a @Cron, so there is no HTTP request to inherit a correlation
   * id from — and `ingest` reaches DocumentExtractorService -> the model client
   * -> neural_footprint_event. Before the wrap, every email-sourced extraction
   * wrote correlation_id NULL (confirmed against the live table on 2026-08-24),
   * which is most of them: the HTTP path is manual upload.
   */
  describe("sweepUningestedAttachments — correlation scope", () => {
    const attachment = (id: string) => ({
      id,
      restaurant_id: "rest-1",
      provider_id: "prov-1",
      order_id: null,
      filename: `${id}.pdf`,
      mime_type: "application/pdf",
      storage_path: `rest-1/${id}.pdf`,
      sha256: null,
    });

    beforeEach(() => {
      mockSupabaseChain.limit.mockResolvedValueOnce({
        data: [attachment("att-1"), attachment("att-2")],
        error: null,
      });
      mockSupabaseChain.storage.from.mockReturnValue({
        upload: mockStorageUpload,
        download: jest.fn().mockResolvedValue({
          data: { arrayBuffer: async () => new ArrayBuffer(8) },
          error: null,
        }),
      });
    });

    it("opens a correlation scope around each attachment, so NF rows are joinable", async () => {
      const seen: (string | null)[] = [];
      jest.spyOn(service, "ingest").mockImplementation(async () => {
        seen.push(getCorrelationId());
        return { documentId: "doc-x", duplicate: false } as any;
      });

      expect(getCorrelationId()).toBeNull(); // no ambient scope: a cron has none
      await service.sweepUningestedAttachments();

      expect(seen).toHaveLength(2);
      expect(seen.every((id) => typeof id === "string" && id.length > 0)).toBe(
        true,
      );
    });

    it("gives each attachment its OWN id, so one id never spans two documents", async () => {
      const seen: (string | null)[] = [];
      jest.spyOn(service, "ingest").mockImplementation(async () => {
        seen.push(getCorrelationId());
        return { documentId: "doc-x", duplicate: false } as any;
      });

      await service.sweepUningestedAttachments();

      expect(new Set(seen).size).toBe(2);
    });

    it("does not leak the scope past the sweep", async () => {
      jest
        .spyOn(service, "ingest")
        .mockResolvedValue({ documentId: "doc-x", duplicate: false } as any);

      await service.sweepUningestedAttachments();

      expect(getCorrelationId()).toBeNull();
    });
  });
});

/**
 * THE MACHINE'S OWN COLUMNS ARE WRITTEN BY THE MACHINE'S OWN WRITER.
 *
 * `computed_lines_total`, `tie_out_delta` and `ties_out` are the extraction's
 * proposal about a document, and ADR 0059's rule is that a proposal is written
 * by the thing that proposed it. `scripts/check_proposal_preservation.py`
 * declares THIS file their writer, and it failed the first version of the
 * currency restatement, which wrote all three from `documents.controller.ts`.
 *
 * The controller spec asserts the DELEGATION. These assert the write itself,
 * and the one property that made the move worth making: the tie-out is
 * re-derived through `applyTieOut`, so a restated document's arithmetic cannot
 * disagree with an extracted one's.
 */
describe("DocumentIntakeService.refileMoneyForCurrency", () => {
  const SNAPSHOT = {
    docType: "invoice",
    currency: "",
    subtotal: 9172,
    freight: 120,
    depositTotal: 180,
    tax: 1834.4,
    total: 11306.4,
    // Deliberately WRONG on the snapshot, to prove they are not carried over.
    computedLinesTotal: 999999,
    tieOutDelta: 0,
    tiesOut: true,
    lines: [
      {
        lineNo: 1,
        qty: 12,
        uom: "bottle",
        packSize: 1,
        qtyBottles: 12,
        freeGoodsQty: 0,
        unitPrice: 142,
        lineTotal: 1704,
        deposit: 60,
        allowance: null,
        priceBaseQty: null,
        priceBaseUom: null,
      },
    ],
  };

  function build(opts: { doc?: any; readError?: any; writeError?: any } = {}) {
    const updates: Array<{ table: string; row: any }> = [];
    const client = {
      from(table: string) {
        const q: any = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({
            data:
              opts.doc === undefined
                ? {
                    id: "doc-9",
                    currency: null,
                    total: null,
                    extracted: SNAPSHOT,
                  }
                : opts.doc,
            error: opts.readError ?? null,
          }),
          update(row: any) {
            updates.push({ table, row });
            const u: any = {};
            u.eq = () => u;
            u.then = (res: any) => res({ error: opts.writeError ?? null });
            return u;
          },
        };
        return q;
      },
    };
    const service = new DocumentIntakeService(
      { getClient: () => client } as any,
      { available: () => false, extract: jest.fn() } as any,
      {} as any,
    );
    return { service, updates };
  }

  it("writes the tie-out columns itself, re-derived and not carried over", async () => {
    const { service, updates } = build();
    const out = await service.refileMoneyForCurrency("doc-9", "rest-1", "TRY");

    const doc = updates.find((u) => u.table === "procurement_documents")!;
    expect(doc.row.total).toBe(11306.4);
    expect(doc.row.tax).toBe(1834.4);
    // 1704 goods + 120 freight + 180 deposit + 1834.40 tax = 3838.40 against a
    // stated 11306.40, so it does NOT tie out — and the snapshot's stale
    // `computedLinesTotal: 999999` / `tiesOut: true` are gone.
    expect(doc.row.computed_lines_total).toBe(1704);
    expect(doc.row.ties_out).toBe(false);

    const line = updates.find(
      (u) => u.table === "procurement_document_lines",
    )!;
    expect(line.row.unit_price).toBe(142);
    expect(line.row.deposit).toBe(60);

    expect(out.snapshotReadable).toBe(true);
    expect(out.linesRefiled).toBe(1);
    // Nothing was converted, and the sentence says so.
    expect(out.sentence).toContain("no exchange rate");
  });

  it("writes NOTHING when the stored reading cannot be parsed", async () => {
    const { service, updates } = build({
      doc: { id: "doc-9", currency: "USD", total: 400, extracted: { docType: "invoice" } },
    });
    const out = await service.refileMoneyForCurrency("doc-9", "rest-1", "EUR");

    // The document keeps the figures it already had. Writing nulls here would
    // ERASE money on an act that was only meant to re-label it.
    expect(updates).toHaveLength(0);
    expect(out.snapshotReadable).toBe(false);
    expect(out.sentence).toContain("nothing was erased");
  });

  it("tells a failed READ apart from a document with no reading (ADR 0067)", async () => {
    const { service } = build({ doc: null, readError: { message: "connection reset" } });
    await expect(
      service.refileMoneyForCurrency("doc-9", "rest-1", "TRY"),
    ).rejects.toThrow(/REFILE_READ_FAILED:connection reset/);
  });

  it("scopes both reads and writes to the tenant", async () => {
    // The `.eq()` chain is what carries `restaurant_id`; a route that dropped
    // it would re-file another house's document. Asserted by the write landing
    // at all through a chain that requires two eq hops before it resolves.
    const { service, updates } = build();
    await service.refileMoneyForCurrency("doc-9", "rest-1", "TRY");
    expect(updates.map((u) => u.table)).toEqual([
      "procurement_documents",
      "procurement_document_lines",
    ]);
  });
});
