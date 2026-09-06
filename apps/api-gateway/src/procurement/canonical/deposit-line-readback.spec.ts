import { Test, TestingModule } from "@nestjs/testing";
import { DatabaseService } from "../../database/database.service";
import { DocumentExtractorService } from "../documents/document-extractor.service";
import { DocumentIntakeService } from "../documents/document-intake.service";
import { CanonicalDocumentService } from "./canonical-document.service";
import { runCorpus } from "./cli";

/**
 * A DEPOSIT BILLED AS A LINE **AND** AS A SUBTOTAL, THROUGH PERSISTENCE.
 *
 * MEASURED 2026-09-05 on the Turkish invoice `b1e02edf-e696-4c93-8c41-
 * a3433873c8dd`, filled through `POST /procurement/documents/:id/extraction`.
 * The paper prints the ₺180 depozito TWICE — as line 4 and as a
 * "Depozito (KDV %0) 180,00" subtotal row — so its stated
 * `Mal/Hizmet Toplam Tutarı` of ₺9.352,00 is the goods (₺9.172,00) PLUS the
 * deposit. The door's own tie-out was right: `computed_lines_total` 9172,
 * `ties_out` true. The canonical render was not:
 *
 *     Lines      ₺9.352,00     <- the deposit line, still inside BT-106
 *     Charges    ₺180,00       <- the same deposit again, as a 7161 charge
 *     Before tax ₺9.532,00
 *     Tax        ₺1.834,40
 *     Total      ₺11.186,40    <- the STATED total, contradicting the ladder
 *
 * `scripts/canonical_corpus_run.py` named it as `total_with_vat` expected
 * 11366.4 found 11186.4.
 *
 * EVERY NAME, ID AND NUMBER BELOW IS SYNTHETIC. The arithmetic is the measured
 * document's: 142 + 7440 + 1590 = 9172 goods, a 180 deposit line, a stated
 * subtotal of 9352 that contains it, 20% VAT on 9172 = 1834.40, total 11186.40.
 */

// ---------------------------------------------------------------------------
// The extraction, in the shape the door accepts.
// ---------------------------------------------------------------------------

const TR_DEPOSIT_JSON = JSON.stringify({
  docType: "invoice",
  docNumber: "SYN-TR-4471",
  docDate: "2026-08-14",
  deliveredDate: "2026-08-12",
  vendorName: "SYNTHETIC Üzüm Bağcılık A.Ş.",
  currency: "TRY",
  // The paper's own subtotal row. It INCLUDES the depozito line below.
  subtotal: 9352,
  depositTotal: 180,
  tax: 1834.4,
  total: 11186.4,
  taxBreakdown: [
    { rate: 20, taxableBase: 9172, amount: 1834.4, category: "S" },
  ],
  printed: {
    subtotal: "9.352,00",
    depositTotal: "180,00",
    tax: "1.834,40",
    total: "11.186,40",
  },
  lines: [
    {
      description: "SYNTHETIC Öküzgözü 2021 · 750 ml",
      vintage: 2021,
      formatMl: 750,
      qty: 1,
      uom: "bottle",
      unitPrice: 142,
      lineTotal: 142,
      lineKind: "goods",
    },
    {
      description: "SYNTHETIC Kalecik Karası 2022 · 750 ml",
      vintage: 2022,
      formatMl: 750,
      qty: 24,
      uom: "bottle",
      unitPrice: 310,
      lineTotal: 7440,
      lineKind: "goods",
    },
    {
      description: "SYNTHETIC Narince 2023 · 750 ml",
      vintage: 2023,
      formatMl: 750,
      qty: 6,
      uom: "bottle",
      unitPrice: 265,
      lineTotal: 1590,
      lineKind: "goods",
    },
    {
      description: "Depozito · iade edilebilir kasa (2 KS)",
      qty: 2,
      uom: "each",
      unitPrice: 90,
      lineTotal: 180,
      lineKind: "deposit",
    },
  ],
});

// ---------------------------------------------------------------------------
// A Supabase double that records what was written, per table and per verb.
// ---------------------------------------------------------------------------

interface DbCall {
  table: string;
  verb: "select" | "insert" | "update" | null;
  payload?: unknown;
  columns?: string;
}

function makeDoor() {
  const calls: DbCall[] = [];
  function builder(table: string) {
    const call: DbCall = { table, verb: null };
    calls.push(call);
    const answer = () => {
      if (table === "procurement_documents" && call.verb === "select")
        return {
          data: {
            id: "doc-tr",
            status: "needs_review",
            doc_type: "unknown",
            extraction_confidence: 0,
          },
          error: null,
        };
      // Both the gate's own count read and the matcher's read find nothing.
      return { data: [], error: null };
    };
    const chain: Record<string, unknown> = {
      select(columns?: string) {
        if (call.verb === null) call.verb = "select";
        call.columns = columns;
        return chain;
      },
      insert(payload: unknown) {
        call.verb = "insert";
        call.payload = payload;
        return chain;
      },
      update(payload: unknown) {
        call.verb = "update";
        call.payload = payload;
        return chain;
      },
      eq: () => chain,
      neq: () => chain,
      is: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve(answer()),
      single: () => Promise.resolve(answer()),
      then: (resolve: (v: unknown) => unknown, reject: unknown) =>
        Promise.resolve(answer()).then(resolve, reject as never),
    };
    return chain;
  }
  return {
    calls,
    client: { from: (table: string) => builder(table) },
    payload(table: string, verb: DbCall["verb"]) {
      return calls.find((c) => c.table === table && c.verb === verb)?.payload;
    },
  };
}

/** The stored rows the door produced, in PostgREST's shape. */
interface Persisted {
  document: Record<string, unknown>;
  lines: Record<string, unknown>[];
}

/**
 * Push the extraction through the REAL door and hand back exactly what a later
 * read of those two tables would return.
 *
 * The point of going through `applyExternalExtraction` rather than hand-writing
 * a row is that `lineKind` has NO COLUMN: it survives only inside the
 * `extracted` jsonb snapshot the door writes, keyed on `lineNo`. A fixture that
 * asserted the snapshot's shape by hand would pass while the door wrote
 * something else.
 */
async function persistThroughTheDoor(): Promise<Persisted> {
  const db = makeDoor();
  const canonical = {
    buildFromDocumentId: jest
      .fn()
      .mockResolvedValue({ ok: true, value: { layer1: {} } }),
    persistRevision: jest
      .fn()
      .mockResolvedValue({ ok: true, value: { id: "rev-1", revision: 1 } }),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      DocumentIntakeService,
      { provide: DatabaseService, useValue: { getClient: () => db.client } },
      {
        // THE REAL PARSER. `normalize` is the contract the door accepts, and a
        // stub of it would test the door against a contract nobody was given.
        provide: DocumentExtractorService,
        useValue: new DocumentExtractorService(
          undefined as never,
          undefined as never,
          undefined as never,
        ),
      },
      { provide: CanonicalDocumentService, useValue: canonical },
    ],
  }).compile();
  const intake = module.get<DocumentIntakeService>(DocumentIntakeService);

  await intake.applyExternalExtraction(
    "rest-tr",
    "doc-tr",
    TR_DEPOSIT_JSON,
    "claude-code:synthetic",
    "user-1",
  );

  const header = db.payload("procurement_documents", "update") as Record<
    string,
    unknown
  >;
  const inserted = db.payload("procurement_document_lines", "insert") as Record<
    string,
    unknown
  >[];

  return {
    document: {
      id: "doc-tr",
      restaurant_id: "rest-tr",
      provider_id: null,
      source_channel: "email",
      direction: "issued_by_vendor",
      jurisdiction: "TR",
      notes: header.notes ?? null,
      ...header,
    },
    // Read back ordered by line_no, with the columns a fresh row carries.
    lines: [...inserted]
      .sort((a, b) => Number(a.line_no) - Number(b.line_no))
      .map((l) => ({
        ...l,
        match_method: null,
        match_confidence: null,
        // Numerics come back from PostgREST as STRINGS. Written that way on
        // purpose: a fixture handing back numbers would hide a coercion bug.
        qty: String(l.qty),
        unit_price: l.unit_price == null ? null : String(l.unit_price),
        line_total: l.line_total == null ? null : String(l.line_total),
        qty_bottles: String(l.qty_bottles),
        free_goods_qty: String(l.free_goods_qty),
      })),
  };
}

/** A CanonicalDocumentService reading exactly those rows back. */
async function serviceReading(rows: Persisted) {
  let table = "";
  const answers: Record<string, { data: unknown; error: null }> = {
    procurement_documents: { data: rows.document, error: null },
    procurement_document_lines: { data: rows.lines, error: null },
    procurement_order_items: { data: [], error: null },
    restaurants: {
      data: { id: "rest-tr", name: "SYNTHETIC Meyhane" },
      error: null,
    },
  };
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const verb of ["select", "eq", "in", "order", "limit"])
      c[verb] = () => c;
    c.maybeSingle = () => {
      const a = answers[table];
      const data = Array.isArray(a?.data) ? (a.data[0] ?? null) : a?.data;
      return Promise.resolve({ data: data ?? null, error: null });
    };
    (c as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: answers[table]?.data ?? null, error: null }).then(
        resolve,
      );
    return c;
  };
  const client = {
    from: (t: string) => {
      table = t;
      return chain();
    },
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CanonicalDocumentService,
      { provide: DatabaseService, useValue: { getClient: () => client } },
    ],
  }).compile();
  return module.get(CanonicalDocumentService);
}

describe("a deposit stated as a line AND as a subtotal, through persistence", () => {
  let rows: Persisted;

  beforeEach(async () => {
    rows = await persistThroughTheDoor();
  });

  it("keeps the deposit line's kind in the snapshot the door writes", () => {
    const snapshot = rows.document.extracted as {
      lines: { lineNo: number; lineKind: string }[];
      taxBreakdown: unknown[];
      deliveredDate: string;
    };
    expect(snapshot.lines.map((l) => [l.lineNo, l.lineKind])).toEqual([
      [1, "goods"],
      [2, "goods"],
      [3, "goods"],
      [4, "deposit"],
    ]);
    // and the door's own tie-out excluded it, as the measured document's did
    expect(rows.document.computed_lines_total).toBe(9172);
    expect(rows.document.ties_out).toBe(true);
  });

  it("leaves the deposit out of BT-106 and carries it once as a 7161 charge", async () => {
    const service = await serviceReading(rows);
    const res = await service.buildFromDocumentId("rest-tr", "doc-tr");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const t = res.value.layer1.totals;

    // BT-106 — GOODS ONLY. The stated subtotal of 9352 contains the deposit,
    // so it is not the goods total and must not be carried as one.
    expect(t.linesNetTotal.value).toBe(9172);
    // …and the number is OURS now, so it must not borrow the paper's authority.
    expect(t.linesNetTotal.source).toBe("computed");
    expect(t.linesNetTotal.as_printed).toBeNull();

    // Exactly ONE deposit charge, coded, at document level (BG-21).
    const deposits = res.value.layer1.allowancesCharges.filter(
      (ac) => ac.reasonCode.value === "7161",
    );
    expect(deposits).toHaveLength(1);
    expect(deposits[0].amount.value).toBe(180);
    expect(deposits[0].isCharge.value).toBe(true);

    // BT-108 / BT-109 — the ladder the sheet prints.
    expect(t.chargesTotal.value).toBe(180);
    expect(t.taxExclusiveAmount.value).toBe(9352);

    // BT-109 + BT-110 = BT-112. The whole point: the ladder now reaches the
    // total the paper states instead of contradicting it by the deposit.
    expect(
      Math.round(
        ((t.taxExclusiveAmount.value ?? 0) + (t.taxAmount.value ?? 0)) * 100,
      ) / 100,
    ).toBe(t.taxInclusiveAmount.value);
    expect(t.taxInclusiveAmount.value).toBe(11186.4);
  });

  it("names no total_with_vat or deposits_coded_and_excluded failure", async () => {
    const out = runCorpus([{ document: rows.document, lines: rows.lines }]);
    const named = out.named_failures.map((f) => f.invariant);
    expect(named).not.toContain("total_with_vat");
    expect(named).not.toContain("deposits_coded_and_excluded");
    expect(named).not.toContain("vat_breakdown_present");
    expect(named).not.toContain("document_lines_total");
  });

  it("still prefers the stated subtotal when it already excludes the deposit", async () => {
    // The Californian CRV shape: the subtotal is the goods and the deposit is
    // a separate subtotal row. Nothing is subtracted, and BT-106 keeps the
    // paper's own literal.
    const document = {
      ...rows.document,
      subtotal: 9172,
      printed: { subtotal: "9.172,00" },
    };
    const service = await serviceReading({ ...rows, document });
    const res = await service.buildFromDocumentId("rest-tr", "doc-tr");
    if (!res.ok) throw new Error(res.error);
    const t = res.value.layer1.totals;
    expect(t.linesNetTotal.value).toBe(9172);
    expect(t.linesNetTotal.source).toBe("extracted");
    expect(t.linesNetTotal.as_printed).toBe("9.172,00");
  });

  it("does NOT silently subtract when the stated subtotal matches neither", async () => {
    // A subtotal that is neither the goods nor the goods-plus-deposit is a
    // transcription we cannot resolve. Inventing a BT-106 here would make
    // BR-CO-10 unfalsifiable; the stated number stands and the invariants name
    // the disagreement.
    const document = { ...rows.document, subtotal: 9000 };
    const service = await serviceReading({ ...rows, document });
    const res = await service.buildFromDocumentId("rest-tr", "doc-tr");
    if (!res.ok) throw new Error(res.error);
    expect(res.value.layer1.totals.linesNetTotal.value).toBe(9000);
    expect(res.value.layer1.totals.linesNetTotal.source).toBe("extracted");
  });
});
