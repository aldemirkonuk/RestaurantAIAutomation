import { Test, TestingModule } from "@nestjs/testing";
import { DatabaseService } from "../../database/database.service";
import { CanonicalDocumentService } from "./canonical-document.service";
import { DocumentCorrectionService } from "./document-correction.service";

/**
 * The correction door (ADR 0104 D5, slice 3). All ids and numbers are SYNTHETIC.
 *
 * WHAT THIS FILE IS FOR, in the order the rules matter:
 *
 *   1. A CORRECTION IS AN APPEND. Revision n+1 plus an audit row, and the
 *      service issues no UPDATE and no DELETE on either table. The database
 *      refuses both anyway (the trigger, proven in
 *      supabase/tests/20260903160000_..._test.sql T1–T3 and
 *      20260905120000_..._test.sql T18–T19) — but a service that TRIES is a
 *      service one migration away from succeeding.
 *   2. A CORRECTION MOVES THE ARITHMETIC. The corrected quantity has to reach
 *      layer 3 and the invariants, not just the envelope on the sheet. A
 *      cosmetic overlay would leave the page showing 10 while every verdict
 *      still graded 12.
 *   3. A FAILED READ IS NEVER AN UNCORRECTED DOCUMENT (ADR 0067). If the
 *      correction log cannot be read, the document must not render as though
 *      nobody had ever corrected it.
 *   4. THE PATH IS A CLOSED LIST. `__proto__`, a field outside the registry and
 *      a line that does not exist are all refused at the door.
 */

const DOC_ROW = {
  id: "doc-1",
  restaurant_id: "rest-1",
  provider_id: null,
  doc_type: "invoice",
  doc_number: "SYN-A-88214",
  doc_date: "2026-08-14",
  references_doc_number: null,
  currency: "TRY",
  subtotal: 1704,
  freight: null,
  fuel_surcharge: null,
  split_case_fee: null,
  delivery_fee: null,
  deposit_total: null,
  tax: null,
  other_charges: null,
  discount_total: null,
  total: 1704,
  extraction_confidence: 0.8,
  extraction_model: "synthetic-model",
  direction: "issued_by_vendor",
  jurisdiction: "TR",
  source_channel: "upload",
  notes: null,
};

// PostgREST hands numerics back as STRINGS; the mock keeps that so a coercion
// bug cannot hide behind a friendlier fixture.
const LINE_ROWS = [
  {
    line_no: 1,
    vendor_sku: "SKU-1",
    description: "SYNTHETIC Öküzgözü",
    vintage: 2021,
    format_ml: 750,
    qty: "12",
    uom: "bottle",
    pack_size: 1,
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
  },
];

/** The envelope a correction of line 1's quantity to 10 leaves behind. */
const QTY_TO_TEN = {
  value: 10,
  source: "human_corrected",
  confidence: null,
  revision: 2,
  as_printed: "12",
  verified_by: null,
  verified_at: null,
};

describe("DocumentCorrectionService", () => {
  let service: DocumentCorrectionService;
  let canonical: CanonicalDocumentService;

  let verbs: string[];
  let answers: Record<
    string,
    { data: unknown; error: { message: string } | null }
  >;
  let insertAnswers: Record<
    string,
    { data: unknown; error: { message: string } | null }
  >;
  let inserts: { table: string; payload: Record<string, unknown> }[];
  let currentTable: string;

  /**
   * THE TABLE IS CAPTURED WHEN THE CHAIN IS MADE, not when it resolves.
   *
   * The older mocks in this folder read a shared `currentTable` at resolution
   * time, which is wrong the moment a service issues two reads under
   * `Promise.all`: both `from()` calls run before either awaits, so both chains
   * resolve against the LAST table named. That made a correction-log read come
   * back as the revision read and quietly hid every assertion below.
   */
  const makeChain = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    let didInsert = false;
    const answerFor = () =>
      (didInsert ? insertAnswers[table] : undefined) ??
      answers[table] ?? { data: null, error: null };
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
        verbs.push(`${table}.${verb}`);
        if (verb === "insert") {
          didInsert = true;
          inserts.push({
            table,
            payload: args[0] as Record<string, unknown>,
          });
        }
        if (verb === "single" || verb === "maybeSingle") {
          const a = answerFor();
          const data = Array.isArray(a?.data) ? (a.data[0] ?? null) : a?.data;
          return Promise.resolve({
            data: a?.error ? null : (data ?? null),
            error: a?.error ?? null,
          });
        }
        void args;
        return self();
      });
    }
    (chain as { then: unknown }).then = (
      resolve: (v: unknown) => unknown,
    ): unknown => {
      const a = answerFor();
      return Promise.resolve({
        data: a?.error ? null : (a?.data ?? null),
        error: a?.error ?? null,
      }).then(resolve);
    };
    return chain;
  };

  const client = {
    from: jest.fn((table: string) => {
      currentTable = table;
      return makeChain(table);
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    verbs = [];
    inserts = [];
    currentTable = "";
    insertAnswers = {
      document_revisions: { data: { id: "rev-2", revision: 2 }, error: null },
      document_corrections: {
        data: {
          revision: 2,
          kind: "correction",
          field_path: "lines[0].quantity",
          before: {
            value: 12,
            source: "extracted",
            confidence: null,
            revision: 1,
          },
          after: QTY_TO_TEN,
          reason: "we counted ten at the door",
          corrected_by: "u1",
          corrected_at: "2026-09-05T09:40:00Z",
        },
        error: null,
      },
    };
    answers = {
      procurement_documents: { data: DOC_ROW, error: null },
      procurement_document_lines: { data: LINE_ROWS, error: null },
      procurement_order_items: { data: [], error: null },
      restaurants: {
        data: { id: "rest-1", name: "SYNTHETIC Meyhane" },
        error: null,
      },
      users: { data: [{ user_id: "u1", name: "Ayşe" }], error: null },
      document_revisions: { data: [], error: null },
      document_corrections: { data: [], error: null },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanonicalDocumentService,
        DocumentCorrectionService,
        { provide: DatabaseService, useValue: { getClient: () => client } },
      ],
    }).compile();
    service = module.get(DocumentCorrectionService);
    canonical = module.get(CanonicalDocumentService);
  });

  // -------------------------------------------------------------------------
  describe("a correction is an append", () => {
    it("writes revision n+1 and an audit row, and issues no UPDATE or DELETE", async () => {
      const res = await service.correct("rest-1", "doc-1", "u1", {
        path: "lines[0].quantity",
        value: 10,
        reason: "we counted ten at the door",
      });
      expect(res.ok).toBe(true);

      // TWO revision rows: the extraction as revision 1 (nothing had ever
      // written it down) and the correction as revision 2. Without the first,
      // the log would open with a correction and no baseline to read it against.
      const revisions = inserts.filter((i) => i.table === "document_revisions");
      expect(revisions.map((r) => r.payload.revision)).toEqual([1, 2]);
      expect(revisions[0].payload.source).toBe("extracted");
      expect(revisions[0].payload.created_by).toBeNull();
      expect(revisions[1].payload.source).toBe("human_corrected");

      const audit = inserts.find((i) => i.table === "document_corrections");
      expect(audit?.payload).toMatchObject({
        document_id: "doc-1",
        revision: 2,
        field_path: "lines[0].quantity",
        reason: "we counted ten at the door",
        kind: "correction",
        corrected_by: "u1",
      });
      // What was there before is what the vendor argument rests on.
      expect((audit?.payload.before as { value: number }).value).toBe(12);
      expect((audit?.payload.after as { value: number }).value).toBe(10);
      expect((audit?.payload.after as { source: string }).source).toBe(
        "human_corrected",
      );

      expect(verbs.filter((v) => v.endsWith(".update"))).toEqual([]);
      expect(verbs.filter((v) => v.endsWith(".delete"))).toEqual([]);
    });

    it("writes the revision BEFORE the audit row, so a lost race writes neither", async () => {
      await service.correct("rest-1", "doc-1", "u1", {
        path: "lines[0].quantity",
        value: 10,
      });
      const order = inserts.map((i) => i.table);
      expect(order.indexOf("document_revisions")).toBeLessThan(
        order.indexOf("document_corrections"),
      );
    });

    it("keeps the paper's glyphs: as_printed is carried, never rewritten", async () => {
      answers.document_corrections = { data: [], error: null };
      const res = await service.correct("rest-1", "doc-1", "u1", {
        path: "lines[0].description",
        value: "SYNTHETIC Öküzgözü 2021",
      });
      expect(res.ok).toBe(true);
      const audit = inserts.find((i) => i.table === "document_corrections");
      const after = audit?.payload.after as { as_printed: string | null };
      const before = audit?.payload.before as { as_printed: string | null };
      expect(after.as_printed).toBe(before.as_printed);
    });
  });

  // -------------------------------------------------------------------------
  describe("a correction moves the arithmetic, not only the envelope", () => {
    it("replays the corrected quantity through the mapper: layer 1, layer 2 and layer 3 all follow", async () => {
      answers.document_corrections = {
        data: [
          {
            revision: 2,
            kind: "correction",
            field_path: "lines[0].quantity",
            after: QTY_TO_TEN,
          },
        ],
        error: null,
      };
      answers.document_revisions = { data: [{ revision: 2 }], error: null };

      const res = await canonical.buildFromDocumentId("rest-1", "doc-1");
      if (!res.ok) throw new Error(res.error);

      expect(res.value.revision).toBe(2);
      expect(res.value.layer1.lines[0].quantity.value).toBe(10);
      expect(res.value.layer1.lines[0].quantity.source).toBe("human_corrected");
      // Layer 2's bottle-equivalent is re-derived, not left at the stored 12.
      expect(res.value.layer2.lines[0].qtyBottles).toBe(10);
      // Layer 3's `billed` is the bottle-equivalent, so it follows too. THIS is
      // the assertion a cosmetic overlay fails: the sheet would say 10 and the
      // four-way spine would still reconcile 12 against the order.
      expect(res.value.layer3.lines[0].billed).toBe(10);
    });

    it("regrades the invariants against the corrected numbers", async () => {
      answers.document_corrections = {
        data: [
          {
            revision: 2,
            kind: "correction",
            field_path: "lines[0].quantity",
            after: QTY_TO_TEN,
          },
        ],
        error: null,
      };
      answers.document_revisions = { data: [{ revision: 2 }], error: null };

      const res = await canonical.buildFromDocumentId("rest-1", "doc-1");
      if (!res.ok) throw new Error(res.error);

      // BT-131 = BT-129 x BT-146: 10 x 142 = 1420, against a stated 1704. The
      // uncorrected document held (12 x 142 = 1704) and the rule PASSED, so a
      // build that did not regrade would still report it as holding.
      const lineNet = res.value.layer3.verdicts.find(
        (v) => v.id === "line_net_amount" && v.path === "lines[0]",
      );
      expect(lineNet?.holds).toBe(false);
    });

    it("leaves a field with no arithmetic consequence alone in layer 3", async () => {
      answers.document_corrections = {
        data: [
          {
            revision: 2,
            kind: "correction",
            field_path: "seller.address",
            after: {
              value: "SYNTHETIC Mah. 1 Sok. No 2",
              source: "human_corrected",
              confidence: null,
              revision: 2,
            },
          },
        ],
        error: null,
      };
      answers.document_revisions = { data: [{ revision: 2 }], error: null };

      const res = await canonical.buildFromDocumentId("rest-1", "doc-1");
      if (!res.ok) throw new Error(res.error);
      expect(res.value.layer1.seller.address.value).toBe(
        "SYNTHETIC Mah. 1 Sok. No 2",
      );
      expect(res.value.layer3.lines[0].billed).toBe(12);
    });
  });

  // -------------------------------------------------------------------------
  describe("a failed read is never an uncorrected document", () => {
    it("fails the build when the correction log cannot be read", async () => {
      answers.document_corrections = {
        data: null,
        error: { message: "connection reset" },
      };
      const res = await canonical.buildFromDocumentId("rest-1", "doc-1");
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toContain("document_corrections read failed");
    });

    it("fails the build when the revision read breaks, rather than reporting revision 1", async () => {
      answers.document_revisions = {
        data: null,
        error: { message: "statement timeout" },
      };
      const res = await canonical.buildFromDocumentId("rest-1", "doc-1");
      expect(res.ok).toBe(false);
    });

    it("fails the LOG read rather than returning an empty log", async () => {
      answers.document_corrections = {
        data: null,
        error: { message: "connection reset" },
      };
      const res = await service.correctionLog("rest-1", "doc-1");
      expect(res.ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("the path is a closed list", () => {
    const refused = async (path: string, value: unknown = 1) =>
      service.correct("rest-1", "doc-1", "u1", { path, value });

    it("refuses __proto__ and every other object path", async () => {
      for (const path of [
        "__proto__",
        "constructor.prototype",
        "layer2.lines",
        "lines.0.quantity",
        "totals.taxExclusiveAmount",
      ]) {
        const res = await refused(path);
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.status).toBe(400);
      }
      // Nothing was written on the way to any of those refusals.
      expect(inserts).toEqual([]);
    });

    it("refuses a line index the document does not have", async () => {
      const res = await refused("lines[9].quantity", 4);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(400);
        expect(res.error).toContain("1 line");
      }
      expect(inserts).toEqual([]);
    });

    it("refuses text where the field is a number, and the reverse", async () => {
      const a = await refused("lines[0].quantity", "ten");
      const b = await refused("lines[0].description", 12);
      expect(a.ok).toBe(false);
      expect(b.ok).toBe(false);
      expect(inserts).toEqual([]);
    });

    it("refuses a unit it cannot convert, rather than storing a word", async () => {
      // `kasa` and `koli` ARE readable — normalizeUom folds the Turkish
      // words for a shipping case. A genuinely unconvertible word is the test.
      const res = await refused("lines[0].unit", "demijohn");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain("demijohn");
      expect(inserts).toEqual([]);
    });

    it("accepts null as 'the document states nothing here'", async () => {
      const res = await service.correct("rest-1", "doc-1", "u1", {
        path: "lines[0].vintage",
        value: null,
        reason: "the label year is not printed on this invoice",
      });
      expect(res.ok).toBe(true);
      const audit = inserts.find((i) => i.table === "document_corrections");
      expect((audit?.payload.after as { value: unknown }).value).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("who may call it", () => {
    it("is a 404 for another tenant's document, and writes nothing", async () => {
      // The document read is scoped by restaurant_id, so the row does not come
      // back at all for the wrong tenant — the same shape as a missing id.
      answers.procurement_documents = { data: null, error: null };
      const res = await service.correct("rest-2", "doc-1", "u1", {
        path: "lines[0].quantity",
        value: 10,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(404);
      expect(inserts).toEqual([]);
    });

    it("refuses the log for another tenant's document", async () => {
      answers.procurement_documents = { data: null, error: null };
      const res = await service.correctionLog("rest-2", "doc-1");
      expect(res.ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("two people at once", () => {
    it("turns the unique-index race into a 409 and writes no audit row", async () => {
      insertAnswers.document_revisions = {
        data: null,
        error: {
          message:
            'duplicate key value violates unique constraint "document_revisions_document_id_revision_key" (23505)',
        },
      };
      const res = await service.correct("rest-1", "doc-1", "u1", {
        path: "lines[0].quantity",
        value: 10,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(409);
        expect(res.error).toContain("nothing was written");
      }
      expect(inserts.filter((i) => i.table === "document_corrections")).toEqual(
        [],
      );
    });

    it("says the revision landed when only the audit row failed — never 'the correction failed'", async () => {
      insertAnswers.document_corrections = {
        data: null,
        error: { message: "deadlock detected" },
      };
      const res = await service.correct("rest-1", "doc-1", "u1", {
        path: "lines[0].quantity",
        value: 10,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(500);
        expect(res.error).toContain("WAS written");
        expect(res.error).toContain("audit row was not");
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("the verified_by tick", () => {
    it("records who and when WITHOUT changing the value or its source", async () => {
      insertAnswers.document_corrections = {
        data: {
          revision: 2,
          kind: "verification",
          field_path: "totals.taxInclusiveAmount",
          before: {
            value: 1704,
            source: "extracted",
            confidence: null,
            revision: 1,
          },
          after: {
            value: 1704,
            source: "extracted",
            confidence: null,
            revision: 2,
            verified_by: "u1",
            verified_at: "2026-09-05T09:40:00Z",
          },
          reason: null,
          corrected_by: "u1",
          corrected_at: "2026-09-05T09:40:00Z",
        },
        error: null,
      };
      const res = await service.verifyField("rest-1", "doc-1", "u1", {
        path: "totals.taxInclusiveAmount",
      });
      expect(res.ok).toBe(true);

      const audit = inserts.find((i) => i.table === "document_corrections");
      expect(audit?.payload.kind).toBe("verification");
      const after = audit?.payload.after as {
        value: number;
        source: string;
        verified_by: string;
      };
      expect(after.value).toBe(1704);
      // A human confirming an extracted number does not make it human-entered.
      expect(after.source).toBe("extracted");
      expect(after.verified_by).toBe("u1");

      // Same two rows as a correction: the extraction written down as revision
      // 1, then the tick as revision 2, whose SOURCE is the human — the tick is
      // a human act even though the value it stands behind is not.
      const revisions = inserts.filter((i) => i.table === "document_revisions");
      expect(revisions.map((r) => r.payload.revision)).toEqual([1, 2]);
      expect(revisions[1].payload.source).toBe("human_entered");
    });

    it("clears the tick when a later correction CHANGES the value", async () => {
      answers.document_corrections = {
        data: [
          {
            revision: 2,
            kind: "verification",
            field_path: "lines[0].quantity",
            after: {
              value: 12,
              source: "extracted",
              confidence: null,
              revision: 2,
              verified_by: "u1",
              verified_at: "2026-09-05T09:00:00Z",
            },
          },
        ],
        error: null,
      };
      answers.document_revisions = { data: [{ revision: 2 }], error: null };

      const res = await service.correct("rest-1", "doc-1", "u2", {
        path: "lines[0].quantity",
        value: 10,
        reason: "we counted ten",
      });
      expect(res.ok).toBe(true);
      const audit = inserts.find((i) => i.table === "document_corrections");
      const after = audit?.payload.after as { verified_by: string | null };
      // Ayşe stood behind 12. Printing "verified by Ayşe" beside 10 would be a
      // human assertion nobody made; the old tick survives in `before`.
      expect(after.verified_by).toBeNull();
      expect(
        (audit?.payload.before as { verified_by: string | null }).verified_by,
      ).toBe("u1");
    });

    it("keeps the tick when a correction restates the same value", async () => {
      answers.document_corrections = {
        data: [
          {
            revision: 2,
            kind: "verification",
            field_path: "lines[0].quantity",
            after: {
              value: 12,
              source: "extracted",
              confidence: null,
              revision: 2,
              verified_by: "u1",
              verified_at: "2026-09-05T09:00:00Z",
            },
          },
        ],
        error: null,
      };
      answers.document_revisions = { data: [{ revision: 2 }], error: null };

      const res = await service.correct("rest-1", "doc-1", "u2", {
        path: "lines[0].quantity",
        value: 12,
        reason: "re-checked, it really is twelve",
      });
      expect(res.ok).toBe(true);
      const audit = inserts.find((i) => i.table === "document_corrections");
      expect(
        (audit?.payload.after as { verified_by: string | null }).verified_by,
      ).toBe("u1");
    });
  });

  // -------------------------------------------------------------------------
  describe("the log a person reads", () => {
    it("names the corrector and the field in words", async () => {
      answers.document_corrections = {
        data: [
          {
            revision: 2,
            kind: "correction",
            field_path: "lines[0].netPrice",
            before: {
              value: 142,
              source: "extracted",
              confidence: null,
              revision: 1,
            },
            after: QTY_TO_TEN,
            reason: "the paper says 132,00",
            corrected_by: "u1",
            corrected_at: "2026-08-14T09:40:00Z",
          },
        ],
        error: null,
      };
      const res = await service.correctionLog("rest-1", "doc-1");
      if (!res.ok) throw new Error(res.error);
      expect(res.value).toHaveLength(1);
      expect(res.value[0]).toMatchObject({
        label: "Unit price, line 1",
        reason: "the paper says 132,00",
        correctedByName: "Ayşe",
        kind: "correction",
      });
    });

    it("says the name is unknown rather than printing a user id", async () => {
      answers.users = { data: [], error: null };
      answers.document_corrections = {
        data: [
          {
            revision: 2,
            kind: "correction",
            field_path: "documentNumber",
            before: null,
            after: null,
            reason: null,
            corrected_by: "u-gone",
            corrected_at: "2026-08-14T09:40:00Z",
          },
        ],
        error: null,
      };
      const res = await service.correctionLog("rest-1", "doc-1");
      if (!res.ok) throw new Error(res.error);
      expect(res.value[0].correctedByName).toBeNull();
      expect(res.value[0].correctedBy).toBe("u-gone");
    });
  });
});
