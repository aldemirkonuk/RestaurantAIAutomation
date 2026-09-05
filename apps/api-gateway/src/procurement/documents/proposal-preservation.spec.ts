import { Test, TestingModule } from "@nestjs/testing";
import { DocumentIntakeService } from "./document-intake.service";
import { DatabaseService } from "../../database/database.service";
import { DocumentExtractorService } from "./document-extractor.service";
import { CanonicalDocumentService } from "../canonical/canonical-document.service";

/**
 * ADR 0059 — a machine proposal shown to a human is written before the human
 * answers, and the answer is APPENDED, never substituted.
 *
 * These tests all fail against pristine `origin/main`:
 *
 *   L1  `linkLine` wrote `match_confidence: 1, match_method: "manual"` over the
 *       model's estimate at the exact instant the pair became a label
 *       (documents.controller.ts:244-245). There was no confirmLineMatch at all,
 *       so the L1 block does not even compile against the pre-fix service.
 *   L2  suggested pairings were never persisted — `result.suggested` was logged
 *       and returned on the HTTP response and nothing else
 *       (document-intake.service.ts:497-502).
 *   L5  `extraction_model` had a column and no writer.
 *   L6  `procurement_documents` had no `event_id` column and nothing to put in it.
 *
 * What they deliberately do NOT assert: that the values are good, or that the
 * corpus is useful. Only that both halves of every pair survive the write.
 */

// ---------------------------------------------------------------------------
// A Supabase double that records what was written, per table and per verb.
//
// The shared-chain mock used elsewhere in this folder cannot answer "what
// payload went to WHICH table", and every assertion below is exactly that
// question.
// ---------------------------------------------------------------------------

interface DbCall {
  table: string;
  verb: "select" | "insert" | "update" | "upsert" | null;
  payload?: any;
  options?: any;
  columns?: string;
  single: boolean;
  filters: Array<[string, string, unknown]>;
}

function makeDb(
  handler: (call: DbCall) => { data: any; error: any } = () => ({
    data: null,
    error: null,
  }),
) {
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
      upsert(payload: any, options?: any) {
        call.verb = "upsert";
        call.payload = payload;
        call.options = options;
        return chain;
      },
      eq(c: string, v: unknown) {
        call.filters.push(["eq", c, v]);
        return chain;
      },
      neq(c: string, v: unknown) {
        call.filters.push(["neq", c, v]);
        return chain;
      },
      is(c: string, v: unknown) {
        call.filters.push(["is", c, v]);
        return chain;
      },
      in(c: string, v: unknown) {
        call.filters.push(["in", c, v]);
        return chain;
      },
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
      // Awaiting the builder itself (list reads, and fire-and-forget writes).
      then(resolve: any, reject: any) {
        return Promise.resolve(handler(call)).then(resolve, reject);
      },
    };
    return chain;
  }

  return {
    calls,
    client: { from: (table: string) => builder(table) },
    /** Every payload written to `table` by `verb`. */
    written(table: string, verb: DbCall["verb"]) {
      return calls
        .filter((c) => c.table === table && c.verb === verb)
        .map((c) => c.payload);
    },
  };
}

async function buildService(db: ReturnType<typeof makeDb>, extractor: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      DocumentIntakeService,
      { provide: DatabaseService, useValue: { getClient: () => db.client } },
      { provide: DocumentExtractorService, useValue: extractor },
      // DocumentIntakeService gained a CanonicalDocumentService dependency
      // with the extraction door (it appends the document's revision). It is
      // the real service over the same mocked client — nothing on the path
      // under test reaches it, and a stub would have to pretend otherwise.
      CanonicalDocumentService,
    ],
  }).compile();
  return module.get<DocumentIntakeService>(DocumentIntakeService);
}

/** Let the fire-and-forget writes (`void this.…`) run before asserting. */
const settle = () => new Promise((r) => setImmediate(r));

const LINES_TABLE = "procurement_document_lines";
const SUGGESTIONS_TABLE = "procurement_line_match_suggestions";

// ---------------------------------------------------------------------------
// L2 — the suggestions the matcher did not write
// ---------------------------------------------------------------------------

describe("ADR 0059 L2 — a suggestion the matcher did not apply is still recorded", () => {
  /**
   * One document line and two order lines. The SKUs differ, so nothing clears
   * AUTO_MATCH_THRESHOLD and everything the matcher finds lands in `suggested`
   * — which, before ADR 0059, meant it landed nowhere.
   */
  function matchFixture() {
    return makeDb((call) => {
      if (call.table === LINES_TABLE && call.verb === "select")
        return {
          data: [
            {
              id: "dl-1",
              vendor_sku: "SKU-A",
              description: "Sancerre Les Monts Damnes",
              vintage: 2022,
              format_ml: 750,
              qty_bottles: 12,
              unit_price: 28,
              order_line_id: null,
            },
          ],
          error: null,
        };
      if (call.table === "procurement_document_links")
        return { data: [{ order_id: "ord-1" }], error: null };
      if (call.table === "procurement_order_items")
        return {
          data: [
            {
              id: "ol-1",
              vendor_sku: "DIFFERENT-SKU",
              wine_name: "Sancerre Les Monts Damnes",
              vintage: 2023,
              total_bottles: 12,
              final_unit_price: 28,
            },
          ],
          error: null,
        };
      return { data: null, error: null };
    });
  }

  it("writes one row per candidate to procurement_line_match_suggestions", async () => {
    const db = matchFixture();
    const service = await buildService(db, {
      available: () => false,
      extract: jest.fn(),
    });

    const result = await service.matchDocumentLines("doc-1", "rest-1");
    await settle();

    // The pre-condition the test rests on: the matcher DID suggest something.
    // Without this, an empty suggestions table would look like a pass.
    expect(result.suggested.length).toBeGreaterThan(0);

    const writes = db.written(SUGGESTIONS_TABLE, "upsert");
    expect(writes).toHaveLength(1);
    const rows = writes[0];
    expect(rows).toHaveLength(result.suggested.length);
    expect(rows[0]).toMatchObject({
      restaurant_id: "rest-1",
      document_id: "doc-1",
      document_line_id: "dl-1",
      order_line_id: "ol-1",
    });
    // The four fields that make the row a label rather than a log line.
    expect(typeof rows[0].confidence).toBe("number");
    expect(typeof rows[0].method).toBe("string");
    expect(typeof rows[0].substitution).toBe("boolean");
    expect(typeof rows[0].reason).toBe("string");
  });

  it("a substitution is recorded AS a substitution, not flattened to a match", async () => {
    const db = matchFixture();
    const service = await buildService(db, {
      available: () => false,
      extract: jest.fn(),
    });

    await service.matchDocumentLines("doc-1", "rest-1");
    await settle();

    // Same wine, 2022 ordered and 2023 offered — the case the matcher's own
    // header calls the clearest thing separating beverage from food-cost
    // software. If this collapses to `false` the corpus cannot teach it.
    const rows = db.written(SUGGESTIONS_TABLE, "upsert")[0];
    expect(rows[0].substitution).toBe(true);
  });

  it("re-running restates a suggestion rather than piling up duplicates", async () => {
    const db = matchFixture();
    const service = await buildService(db, {
      available: () => false,
      extract: jest.fn(),
    });

    await service.matchDocumentLines("doc-1", "rest-1");
    await settle();

    // The intake sweep runs every five minutes. Without conflict handling on
    // the pair, one unresolved suggestion becomes a pile.
    const call = db.calls.find(
      (c) => c.table === SUGGESTIONS_TABLE && c.verb === "upsert",
    )!;
    expect(call.options).toMatchObject({
      onConflict: "document_line_id,order_line_id",
    });
  });

  it("a failed suggestion write never fails the matching run", async () => {
    const db = makeDb((call) => {
      if (call.table === SUGGESTIONS_TABLE)
        return { data: null, error: { message: "table missing" } };
      if (call.table === LINES_TABLE && call.verb === "select")
        return {
          data: [
            {
              id: "dl-1",
              vendor_sku: "SKU-A",
              description: "Chablis",
              vintage: 2022,
              format_ml: 750,
              qty_bottles: 12,
              unit_price: 28,
              order_line_id: null,
            },
          ],
          error: null,
        };
      if (call.table === "procurement_document_links")
        return { data: [{ order_id: "ord-1" }], error: null };
      if (call.table === "procurement_order_items")
        return {
          data: [
            {
              id: "ol-1",
              vendor_sku: "OTHER",
              wine_name: "Chablis",
              vintage: 2022,
              total_bottles: 12,
              final_unit_price: 28,
            },
          ],
          error: null,
        };
      return { data: null, error: null };
    });
    const service = await buildService(db, {
      available: () => false,
      extract: jest.fn(),
    });

    // The instrument never breaks the thing it measures.
    await expect(
      service.matchDocumentLines("doc-1", "rest-1"),
    ).resolves.toBeDefined();
    await settle();
  });
});

// ---------------------------------------------------------------------------
// L1 — confirming a pairing must not overwrite the model's score
// ---------------------------------------------------------------------------

describe("ADR 0059 L1 — the confirmation is appended, never substituted", () => {
  function lineFixture(line: Record<string, unknown>, suggestion: any = null) {
    return makeDb((call) => {
      if (call.table === LINES_TABLE && call.verb === "select")
        return { data: line, error: null };
      if (call.table === LINES_TABLE && call.verb === "update")
        return { data: { id: "dl-1", ...call.payload }, error: null };
      if (call.table === SUGGESTIONS_TABLE && call.verb === "select")
        return { data: suggestion, error: null };
      return { data: null, error: null };
    });
  }

  it("a pairing the MATCHER applied keeps its match columns untouched", async () => {
    const db = lineFixture({
      id: "dl-1",
      order_line_id: "ol-1",
      proposed_confidence: 0.94,
      proposed_method: "vendor_sku",
    });
    const service = await buildService(db, {
      available: () => false,
      extract: jest.fn(),
    });

    await service.confirmLineMatch("doc-1", "dl-1", "rest-1", "user-1", "ol-1");

    const [payload] = db.written(LINES_TABLE, "update");
    // THE ASSERTION THIS WHOLE ADR EXISTS FOR. The pre-fix code wrote both.
    expect(payload).not.toHaveProperty("match_confidence");
    expect(payload).not.toHaveProperty("match_method");
    // ...and the human's answer arrives beside it, in its own columns.
    expect(payload).toMatchObject({
      order_line_id: "ol-1",
      confirmed_by: "user-1",
    });
    expect(typeof payload.confirmed_at).toBe("string");
  });

  it("accepting a SUGGESTED pairing records the machine's own numbers, not 1/manual", async () => {
    const db = lineFixture(
      {
        id: "dl-1",
        order_line_id: null,
        proposed_confidence: null,
        proposed_method: null,
      },
      { confidence: 0.71, method: "description" },
    );
    const service = await buildService(db, {
      available: () => false,
      extract: jest.fn(),
    });

    await service.confirmLineMatch("doc-1", "dl-1", "rest-1", "user-1", "ol-1");

    const [payload] = db.written(LINES_TABLE, "update");
    expect(payload).toMatchObject({
      match_confidence: 0.71,
      match_method: "description",
      proposed_confidence: 0.71,
      proposed_method: "description",
      confirmed_by: "user-1",
    });
    // A confidence of 1 here would be the defect wearing a different hat: the
    // machine proposed this pairing and 0.71 is what it actually thought.
    expect(payload.match_confidence).not.toBe(1);
  });

  it("a pairing NO machine proposed is honestly manual, and proposes nothing", async () => {
    const db = lineFixture({
      id: "dl-1",
      order_line_id: null,
      proposed_confidence: null,
      proposed_method: null,
    });
    const service = await buildService(db, {
      available: () => false,
      extract: jest.fn(),
    });

    await service.confirmLineMatch("doc-1", "dl-1", "rest-1", "user-1", "ol-9");

    const [payload] = db.written(LINES_TABLE, "update");
    expect(payload).toMatchObject({
      match_confidence: 1,
      match_method: "manual",
    });
    // NULL proposed_* is the true statement "the machine never offered an
    // opinion on this pair" — writing one would manufacture a label.
    expect(payload).not.toHaveProperty("proposed_confidence");
    expect(payload).not.toHaveProperty("proposed_method");
  });

  it("accepting resolves the suggestion it came from", async () => {
    const db = lineFixture(
      {
        id: "dl-1",
        order_line_id: null,
        proposed_confidence: null,
        proposed_method: null,
      },
      { confidence: 0.71, method: "description" },
    );
    const service = await buildService(db, {
      available: () => false,
      extract: jest.fn(),
    });

    await service.confirmLineMatch("doc-1", "dl-1", "rest-1", "user-1", "ol-1");
    await settle();

    const resolutions = db.written(SUGGESTIONS_TABLE, "update");
    expect(resolutions).toContainEqual(
      expect.objectContaining({
        resolved_as: "accepted",
        resolved_by: "user-1",
      }),
    );
    // The losing candidates on the same line are `superseded`, NOT `rejected`.
    // A human never judged them, and scoring them as rejections would invent
    // negative labels nobody produced.
    expect(resolutions).toContainEqual(
      expect.objectContaining({ resolved_as: "superseded" }),
    );
  });

  it("UNLINKING records a rejection and never erases the proposal", async () => {
    const db = lineFixture({
      id: "dl-1",
      order_line_id: "ol-1",
      proposed_confidence: 0.94,
      proposed_method: "vendor_sku",
    });
    const service = await buildService(db, {
      available: () => false,
      extract: jest.fn(),
    });

    await service.confirmLineMatch("doc-1", "dl-1", "rest-1", "user-1", null);
    await settle();

    const [payload] = db.written(LINES_TABLE, "update");
    expect(payload).toMatchObject({
      order_line_id: null,
      match_confidence: null,
      match_method: null,
      confirmed_by: null,
    });
    // "The model proposed this and a human rejected it" is the single most
    // valuable row in an entity-resolution corpus. Clearing proposed_* on
    // rejection would keep only the examples the model already got right.
    expect(payload).not.toHaveProperty("proposed_confidence");
    expect(payload).not.toHaveProperty("proposed_method");

    expect(db.written(SUGGESTIONS_TABLE, "update")).toContainEqual(
      expect.objectContaining({ resolved_as: "rejected" }),
    );
  });
});

// ---------------------------------------------------------------------------
// L5 / L6 — an extraction attributable to a model
// ---------------------------------------------------------------------------

describe("ADR 0059 L5/L6 — the document records which model read it", () => {
  async function ingestWith(parsed: Record<string, unknown>) {
    const db = makeDb((call) => {
      if (call.table === "procurement_documents" && call.verb === "insert")
        return { data: { id: "doc-1" }, error: null };
      return { data: null, error: null };
    });
    const service = await buildService(db, {
      available: () => true,
      extract: jest.fn().mockResolvedValue({
        docType: "invoice",
        docNumber: "INV-1",
        docDate: null,
        referencesDocNumber: null,
        poNumber: null,
        vendorName: null,
        vendorAccount: null,
        currency: "USD",
        subtotal: null,
        freight: null,
        fuelSurcharge: null,
        splitCaseFee: null,
        deliveryFee: null,
        depositTotal: null,
        tax: null,
        otherCharges: null,
        discountTotal: null,
        total: null,
        lines: [],
        computedLinesTotal: null,
        tieOutDelta: null,
        tiesOut: null,
        confidence: 0.8,
        warnings: [],
        ...parsed,
      }),
    });

    await service.ingest({
      restaurantId: "rest-1",
      source: "photo",
      buffer: Buffer.from("bytes"),
      filename: "slip.jpg",
      mimeType: "image/jpeg",
    });
    return db.written("procurement_documents", "insert")[0];
  }

  it("writes extraction_model and event_id on the document row", async () => {
    const row = await ingestWith({
      extractionModel: "claude-haiku-4-5",
      eventId: "nf-event-1",
    });
    expect(row).toMatchObject({
      extraction_model: "claude-haiku-4-5",
      event_id: "nf-event-1",
    });
  });

  it("a dropped footprint costs attribution, never the document", async () => {
    const row = await ingestWith({
      extractionModel: "claude-haiku-4-5",
      eventId: null,
    });
    // NULL event_id is expected and fine — the emit is fire-and-forget. The
    // document still lands, and it still says which model read it.
    expect(row.event_id).toBeNull();
    expect(row.extraction_model).toBe("claude-haiku-4-5");
  });

  it("no model ran means NULL, not a manufactured model name", async () => {
    const row = await ingestWith({ extractionModel: null, eventId: null });
    expect(row.extraction_model).toBeNull();
  });
});
