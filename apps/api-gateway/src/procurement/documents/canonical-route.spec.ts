import { HttpException } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";

/**
 * `GET /procurement/documents/:id/canonical` — ADR 0104 D12 slice 2,
 * deliverable 1. All ids and numbers are SYNTHETIC.
 *
 * What this route must never do is return `deliveries: []` for a read that
 * FAILED: the page renders an empty spine as "this document belongs to no
 * delivery" and collapses to the sheet, so a broken query would present itself
 * as a complete, ordinary answer (ADR 0067). `null` plus `failedRead` is the
 * shape that cannot be misread.
 */

const CANONICAL = {
  documentId: "doc-1",
  restaurantId: "rest-1",
  docType: "invoice",
  direction: "issued_by_vendor",
  jurisdiction: "TR",
  revision: 1,
  layer1: { lines: [] },
  layer2: { providerId: null, lines: [] },
  layer3: { lines: [], tiesOut: null, tieOutDeltaCents: null, verdicts: [] },
};

describe("DocumentsController.canonicalDocument", () => {
  let controller: DocumentsController;

  const mockMaybeSingle = jest.fn();
  const mockCreateSignedUrl = jest.fn();
  const mockChain: any = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: mockMaybeSingle,
    storage: {
      from: jest.fn().mockReturnValue({ createSignedUrl: mockCreateSignedUrl }),
    },
  };
  const mockDb = { getClient: jest.fn(() => mockChain) };
  const canonical = { buildFromDocumentId: jest.fn() };
  const spine = { forDocument: jest.fn() };
  const corrections = { correctionLog: jest.fn() };

  const user = { userId: "u1", restaurantId: "rest-1" };

  const spineDoc = (id: string, role: string, selected = false) => ({
    documentId: id,
    role,
    docType: "invoice",
    docNumber: `SYN-${id}`,
    docDate: "2026-08-14",
    status: "needs_review",
    total: 170.4,
    currency: "TRY",
    createdAt: "2026-08-14T09:12:00Z",
    isSelected: selected,
  });

  const spineRow = (id: string, documents: unknown[]) => ({
    deliveryId: id,
    state: "RECONCILING",
    provenance: "ORDERED",
    deliveredAt: "2026-08-12T07:41:00Z",
    agreedAt: null,
    verifiedAt: null,
    jurisdiction: "TR",
    providerId: null,
    selectedRole: "invoice",
    documents,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockChain.from.mockReturnThis();
    mockChain.select.mockReturnThis();
    mockChain.eq.mockReturnThis();
    mockChain.storage.from.mockReturnValue({
      createSignedUrl: mockCreateSignedUrl,
    });
    mockMaybeSingle.mockResolvedValue({
      data: {
        storage_path: "rest-1/documents/abc/fatura.pdf",
        content_type: "application/pdf",
        filename: "fatura.pdf",
        status: "needs_review",
        intake_verdict: null,
        intake_reason: null,
        source_channel: "upload",
        extraction_model: null,
        sha256: "abc",
        created_at: "2026-08-14T09:12:00Z",
      },
      error: null,
    });
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://example.invalid/signed" },
      error: null,
    });
    canonical.buildFromDocumentId.mockResolvedValue({
      ok: true,
      value: CANONICAL,
    });
    spine.forDocument.mockResolvedValue({ ok: true, value: [] });
    // ADR 0104 D5, slice 3. `[]` is a real answer — nobody has corrected this
    // document — and is deliberately not the same as the log read failing.
    corrections.correctionLog.mockResolvedValue({ ok: true, value: [] });

    controller = new DocumentsController(
      {} as any,
      mockDb as any,
      canonical as any,
      spine as any,
      corrections as any,
    );
  });

  it("returns the canonical object, the spine and a signed original", async () => {
    spine.forDocument.mockResolvedValue({
      ok: true,
      value: [
        spineRow("dl-1", [
          spineDoc("doc-po", "purchase_order"),
          spineDoc("doc-1", "invoice", true),
        ]),
      ],
    });

    const res: any = await controller.canonicalDocument("doc-1", user);
    expect(res.canonical.documentId).toBe("doc-1");
    expect(res.deliveries).toHaveLength(1);
    // Siblings exclude the document being shown.
    expect(res.siblings.map((s: any) => s.documentId)).toEqual(["doc-po"]);
    expect(res.original.imageUrl).toBe("https://example.invalid/signed");
    expect(res.original.pages).toBeNull();
    expect(res.failedRead).toBeUndefined();
  });

  it("returns an EMPTY spine when the document is on no delivery", async () => {
    const res: any = await controller.canonicalDocument("doc-1", user);
    // A real answer: the page collapses the spine and shows the sheet alone.
    expect(res.deliveries).toEqual([]);
    expect(res.siblings).toEqual([]);
    expect(res.failedRead).toBeUndefined();
  });

  it("reports a failed spine read as failedRead with a NULL spine, never []", async () => {
    spine.forDocument.mockResolvedValue({
      ok: false,
      error: "document_deliveries read failed for doc-1: connection reset",
    });
    const res: any = await controller.canonicalDocument("doc-1", user);
    expect(res.deliveries).toBeNull();
    expect(res.siblings).toBeNull();
    expect(res.failedRead.join(" ")).toContain("connection reset");
  });

  it("says WHY the original is missing rather than only that it is", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { storage_path: null, content_type: null, filename: null },
      error: null,
    });
    const res: any = await controller.canonicalDocument("doc-1", user);
    expect(res.original.imageUrl).toBeNull();
    expect(res.original.reason).toContain("no original was stored");
  });

  it("distinguishes a file that exists but could not be signed", async () => {
    mockCreateSignedUrl.mockResolvedValue({
      data: null,
      error: { message: "object not found" },
    });
    const res: any = await controller.canonicalDocument("doc-1", user);
    expect(res.original.imageUrl).toBeNull();
    expect(res.original.reason).toContain("could not be signed");
  });

  it("does not claim 'no original was stored' when the metadata read FAILED", async () => {
    // Measured 2026-09-04: this route selected a `filename` column that
    // `procurement_documents` has never had, PostgREST answered 42703 for the
    // whole select, and three documents with originals sitting in the bucket
    // reported "no original was stored for this document".
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "column procurement_documents.nope does not exist" },
    });
    const res: any = await controller.canonicalDocument("doc-1", user);
    expect(res.original.imageUrl).toBeNull();
    expect(res.original.reason).toMatch(/could not be read/);
    expect(res.original.reason).not.toMatch(/no original was stored/);
    expect(res.failedRead.join(" ")).toContain("does not exist");
  });

  it("404s a document that is not this restaurant's", async () => {
    canonical.buildFromDocumentId.mockResolvedValue({
      ok: false,
      error: "document doc-x not found for restaurant rest-1",
    });
    await expect(controller.canonicalDocument("doc-x", user)).rejects.toThrow(
      HttpException,
    );
  });

  it("carries the canonical read's notes out to the page", async () => {
    canonical.buildFromDocumentId.mockResolvedValue({
      ok: true,
      value: CANONICAL,
      notes: ["migration 20260904120000 has not been applied"],
    });
    const res: any = await controller.canonicalDocument("doc-1", user);
    expect(res.notes).toHaveLength(1);
  });
});
