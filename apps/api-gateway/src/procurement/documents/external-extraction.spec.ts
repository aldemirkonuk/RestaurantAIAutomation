import { Test, TestingModule } from "@nestjs/testing";
import { DocumentIntakeService } from "./document-intake.service";
import { DatabaseService } from "../../database/database.service";
import { DocumentExtractorService } from "./document-extractor.service";
import { CanonicalDocumentService } from "../canonical/canonical-document.service";

/**
 * The extraction door — `applyExternalExtraction`.
 *
 * WHAT IT IS FOR. The gateway's own extractor calls Anthropic with
 * `ANTHROPIC_API_KEY`, and that key has no credit: three synthetic PDFs pushed
 * at the local gateway on 2026-09-04 all came back
 * `422 Anthropic 400: Your credit balance is too low`. PR #300 made that
 * failure survivable (D6: the document is stored unread rather than discarded),
 * which leaves a real document sitting in `needs_review` with no lines. This
 * door fills exactly that document from an extraction produced OUTSIDE the
 * gateway's model client — a Claude Code session reads the PDF and posts the
 * JSON the model would have returned.
 *
 * WHAT IT IS NOT. It is not a correction path. A document that has already been
 * read is refused (409), because overwriting a read document silently discards
 * a human's edits and the revision history that justifies them — that is
 * slice 3's job, with its own append-only shape.
 *
 * These tests fail against the unmodified service: `applyExternalExtraction`
 * does not exist on it, so the file does not compile.
 */

// ---------------------------------------------------------------------------
// A Supabase double that records what was written, per table and per verb.
// Same shape as proposal-preservation.spec.ts's, which is the one harness in
// this folder that can answer "what payload went to WHICH table".
// ---------------------------------------------------------------------------

interface DbCall {
  table: string;
  verb: "select" | "insert" | "update" | "upsert" | null;
  payload?: any;
  columns?: string;
  single: boolean;
  filters: Array<[string, string, unknown]>;
}

function makeDb(handler: (call: DbCall) => { data: any; error: any }) {
  const calls: DbCall[] = [];

  function builder(table: string) {
    const call: DbCall = { table, verb: null, single: false, filters: [] };
    calls.push(call);

    const chain: any = {
      select(columns?: string) {
        if (call.verb === null) call.verb = "select";
        call.columns = columns;
        return chain;
      },
      insert(payload: any) {
        call.verb = "insert";
        call.payload = payload;
        return chain;
      },
      update(payload: any) {
        call.verb = "update";
        call.payload = payload;
        return chain;
      },
      upsert(payload: any) {
        call.verb = "upsert";
        call.payload = payload;
        return chain;
      },
      eq(c: string, v: unknown) {
        call.filters.push(["eq", c, v]);
        return chain;
      },
      neq: () => chain,
      is: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      single() {
        call.single = true;
        return Promise.resolve(handler(call));
      },
      maybeSingle() {
        call.single = true;
        return Promise.resolve(handler(call));
      },
      then(resolve: any, reject: any) {
        return Promise.resolve(handler(call)).then(resolve, reject);
      },
    };
    return chain;
  }

  return {
    calls,
    client: { from: (table: string) => builder(table) },
    written(table: string, verb: DbCall["verb"]) {
      return calls
        .filter((c) => c.table === table && c.verb === verb)
        .map((c) => c.payload);
    },
  };
}

const DOCS = "procurement_documents";
const LINES = "procurement_document_lines";
const LINKS = "procurement_document_links";

/** A document as the D6 degradation branch leaves it: unread, not empty. */
const degradedDoc = (over: Record<string, unknown> = {}) => ({
  id: "doc-1",
  status: "needs_review",
  doc_type: "unknown",
  extraction_confidence: 0,
  ...over,
});

/**
 * A one-line invoice priced per CASE — `142,00 / KS(12)` — with the vendor's
 * own literals kept beside the numbers. This is the shape BT-149/BT-150 and
 * migration 20260904120000 exist for.
 */
const CASE_PRICED_JSON = JSON.stringify({
  docType: "invoice",
  docNumber: "F-2026-9001",
  docDate: "2026-09-01",
  vendorName: "Kavaklıdere",
  currency: "TRY",
  subtotal: 1704,
  tax: 0,
  total: 1704,
  printed: { subtotal: "1.704,00", total: "1.704,00" },
  lines: [
    {
      vendorSku: "KV-ANK-750",
      description: "Ancyra Kalecik Karası 750ml",
      vintage: 2022,
      formatMl: 750,
      qty: 12,
      uom: "bottle",
      packSize: 12,
      unitPrice: 142,
      priceBaseQty: 12,
      priceBaseUom: "bottle",
      lineTotal: 1704,
      printed: { unitPrice: "142,00 / KS(12)", lineTotal: "1.704,00" },
    },
  ],
});

/**
 * A DocumentExtractorService whose `normalize` is the shipped one. Its
 * constructor dependencies are never reached from `normalize`, so they are
 * deliberately absent rather than mocked into looking present.
 */
function realExtractor(): DocumentExtractorService {
  return new DocumentExtractorService(
    undefined as never,
    undefined as never,
    undefined as never,
  );
}

function makeCanonical() {
  return {
    buildFromDocumentId: jest.fn().mockResolvedValue({
      ok: true,
      value: { layer1: { docType: "invoice" } },
    }),
    persistRevision: jest
      .fn()
      .mockResolvedValue({ ok: true, value: { id: "rev-1", revision: 1 } }),
  };
}

async function buildService(
  db: ReturnType<typeof makeDb>,
  canonical: ReturnType<typeof makeCanonical>,
) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      DocumentIntakeService,
      { provide: DatabaseService, useValue: { getClient: () => db.client } },
      {
        provide: DocumentExtractorService,
        // THE REAL PARSER, not a stub. `normalize` is the JSON contract the
        // door accepts, and a stub of it would test the door against a
        // contract the model was never given. It touches neither the config
        // nor the model client, so the three constructor dependencies are
        // genuinely unused on this path.
        useValue: realExtractor(),
      },
      { provide: CanonicalDocumentService, useValue: canonical },
    ],
  }).compile();
  return module.get<DocumentIntakeService>(DocumentIntakeService);
}

/** Answers every read the happy path makes. */
function happyHandler(opts: { existingLines?: any[]; doc?: any } = {}) {
  return (call: DbCall) => {
    if (call.table === DOCS && call.verb === "select")
      return {
        data: opts.doc === null ? null : (opts.doc ?? degradedDoc()),
        error: null,
      };
    if (call.table === DOCS && call.verb === "update")
      return { data: null, error: null };
    if (call.table === LINES && call.verb === "insert")
      return { data: null, error: null };
    if (call.table === LINES && call.verb === "select") {
      // The gate's own count read asks for `id` alone; the matcher asks for a
      // long column list. Two different questions, two different answers.
      if ((call.columns ?? "").trim() === "id")
        return { data: opts.existingLines ?? [], error: null };
      return { data: [], error: null };
    }
    if (call.table === LINKS && call.verb === "select")
      return { data: [], error: null };
    return { data: null, error: null };
  };
}

describe("DocumentIntakeService.applyExternalExtraction — the extraction door", () => {
  it("applies a case-priced extraction to a degraded document: lines, header, revision", async () => {
    const db = makeDb(happyHandler());
    const canonical = makeCanonical();
    const service = await buildService(db, canonical);

    const result = await service.applyExternalExtraction(
      "rest-1",
      "doc-1",
      CASE_PRICED_JSON,
      "claude-code:claude-fable-5-1",
      "user-1",
    );

    // ---- the lines landed, with the slice-2 columns intact -----------------
    const lineInserts = db.written(LINES, "insert");
    expect(lineInserts).toHaveLength(1);
    const rows = lineInserts[0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      document_id: "doc-1",
      restaurant_id: "rest-1",
      line_no: 1,
      vendor_sku: "KV-ANK-750",
      qty: 12,
      pack_size: 12,
      unit_price: 142,
      line_total: 1704,
      price_base_qty: 12,
      price_base_uom: "bottle",
      order_line_id: null,
    });
    // The vendor's own literals, unrewritten.
    expect(rows[0].printed).toEqual({
      unitPrice: "142,00 / KS(12)",
      lineTotal: "1.704,00",
    });

    // ---- the header was updated, not re-inserted --------------------------
    expect(db.written(DOCS, "insert")).toHaveLength(0);
    const update = db.written(DOCS, "update")[0];
    expect(update).toMatchObject({
      doc_type: "invoice",
      doc_number: "F-2026-9001",
      doc_date: "2026-09-01",
      currency: "TRY",
      subtotal: 1704,
      total: 1704,
      // The label is recorded VERBATIM: this extraction did not come from the
      // configured model and must never be attributable to it.
      extraction_model: "claude-code:claude-fable-5-1",
      // D6's degradation is cleared by the same write that ends it.
      intake_verdict: null,
      intake_reason: null,
    });
    expect(update.printed).toEqual({ subtotal: "1.704,00", total: "1.704,00" });
    expect(update.extraction_confidence).toBeGreaterThan(0);
    expect(update.ties_out).toBe(true);
    expect(update.status).toBe("received");

    // ---- the revision was appended, as `extracted` (ADR 0104 D1/D5) -------
    expect(canonical.persistRevision).toHaveBeenCalledTimes(1);
    expect(canonical.persistRevision.mock.calls[0][0]).toBe("doc-1");
    expect(canonical.persistRevision.mock.calls[0][2]).toBe("extracted");
    expect(canonical.persistRevision.mock.calls[0][3]).toBe("user-1");

    expect(result.tieOut).toEqual({
      computedLinesTotal: 1704,
      tieOutDelta: 0,
      tiesOut: true,
    });
    expect(result.warnings).toEqual([]);
    expect(result.revision).toEqual({
      ok: true,
      value: { id: "rev-1", revision: 1 },
    });
  });

  it("refuses a document that already has lines — 409, and writes nothing", async () => {
    const db = makeDb(happyHandler({ existingLines: [{ id: "line-1" }] }));
    const service = await buildService(db, makeCanonical());

    await expect(
      service.applyExternalExtraction(
        "rest-1",
        "doc-1",
        CASE_PRICED_JSON,
        "claude-code:claude-fable-5-1",
        "user-1",
      ),
    ).rejects.toThrow(/^ALREADY_READ:/);

    expect(db.written(LINES, "insert")).toHaveLength(0);
    expect(db.written(DOCS, "update")).toHaveLength(0);
  });

  it("refuses a document that already carries a non-degraded extraction — 409", async () => {
    const db = makeDb(
      happyHandler({
        doc: degradedDoc({ doc_type: "invoice", extraction_confidence: 0.8 }),
      }),
    );
    const service = await buildService(db, makeCanonical());

    await expect(
      service.applyExternalExtraction(
        "rest-1",
        "doc-1",
        CASE_PRICED_JSON,
        "claude-code:claude-fable-5-1",
        "user-1",
      ),
    ).rejects.toThrow(/^ALREADY_READ:/);
    expect(db.written(LINES, "insert")).toHaveLength(0);
  });

  it("names the reason when rawText is not JSON — 422, and writes nothing", async () => {
    const db = makeDb(happyHandler());
    const service = await buildService(db, makeCanonical());

    await expect(
      service.applyExternalExtraction(
        "rest-1",
        "doc-1",
        "I read the invoice and it says 1704 lira.",
        "claude-code:claude-fable-5-1",
        "user-1",
      ),
    ).rejects.toThrow(/^UNPARSABLE:/);

    expect(db.written(LINES, "insert")).toHaveLength(0);
    expect(db.written(DOCS, "update")).toHaveLength(0);
  });

  it("refuses a well-formed extraction that carries no lines, rather than locking the door on an empty read", async () => {
    const db = makeDb(happyHandler());
    const service = await buildService(db, makeCanonical());

    await expect(
      service.applyExternalExtraction(
        "rest-1",
        "doc-1",
        JSON.stringify({ docType: "invoice", total: 1704, lines: [] }),
        "claude-code:claude-fable-5-1",
        "user-1",
      ),
    ).rejects.toThrow(/^UNPARSABLE:/);
    expect(db.written(DOCS, "update")).toHaveLength(0);
  });

  it("is scoped by restaurant: another tenant's document is NOT FOUND", async () => {
    const db = makeDb(happyHandler({ doc: null }));
    const service = await buildService(db, makeCanonical());

    await expect(
      service.applyExternalExtraction(
        "rest-OTHER",
        "doc-1",
        CASE_PRICED_JSON,
        "claude-code:claude-fable-5-1",
        "user-1",
      ),
    ).rejects.toThrow("NOT_FOUND");

    // The read that decided it carried BOTH filters — tenant isolation on this
    // gateway is that eq and nothing else.
    const read = db.calls.find((c) => c.table === DOCS && c.verb === "select")!;
    expect(read.filters).toEqual(
      expect.arrayContaining([
        ["eq", "id", "doc-1"],
        ["eq", "restaurant_id", "rest-OTHER"],
      ]),
    );
  });

  it("surfaces a failed line-count read instead of treating it as 'no lines'", async () => {
    const db = makeDb((call) => {
      if (call.table === DOCS && call.verb === "select")
        return { data: degradedDoc(), error: null };
      if (call.table === LINES && call.verb === "select")
        return { data: null, error: { message: "connection reset" } };
      return { data: null, error: null };
    });
    const service = await buildService(db, makeCanonical());

    await expect(
      service.applyExternalExtraction(
        "rest-1",
        "doc-1",
        CASE_PRICED_JSON,
        "claude-code:claude-fable-5-1",
        "user-1",
      ),
    ).rejects.toThrow(/connection reset/);
    expect(db.written(LINES, "insert")).toHaveLength(0);
  });

  it("writes the lines BEFORE the header, so a line failure leaves the door open", async () => {
    const db = makeDb((call) => {
      if (call.table === DOCS && call.verb === "select")
        return { data: degradedDoc(), error: null };
      if (call.table === LINES && call.verb === "select")
        return { data: [], error: null };
      if (call.table === LINES && call.verb === "insert")
        return { data: null, error: { message: "lines rejected" } };
      return { data: null, error: null };
    });
    const service = await buildService(db, makeCanonical());

    await expect(
      service.applyExternalExtraction(
        "rest-1",
        "doc-1",
        CASE_PRICED_JSON,
        "claude-code:claude-fable-5-1",
        "user-1",
      ),
    ).rejects.toThrow(/lines rejected/);

    // The document is untouched, so it is still degraded and still fillable.
    expect(db.written(DOCS, "update")).toHaveLength(0);
  });
});
