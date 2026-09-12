/**
 * What a document seal is a seal OVER — the pure half, no database and no Nest.
 *
 * These are the properties that make the seal more than a second click. Each one
 * is a way the mechanism could be decorative if the arguments were chosen badly,
 * and each is stated as a hash comparison rather than as a claim about intent.
 */

import { hashCallArgs } from "../../common/seal/seal-token";
import {
  DOCUMENT_SEAL_ACTS,
  DOCUMENT_SEAL_SUBJECT_KIND,
  FIELD_VERIFY_VERDICT,
  documentCurrencySealArgs,
  documentFieldCorrectSealArgs,
  documentFieldVerifySealArgs,
  documentLineEditPatchArgs,
  documentLineEditSealArgs,
  documentSealLine,
  documentVerifySealArgs,
  isDocumentSealAct,
} from "./document-seal";
import { SEAL_SUBJECT_KINDS } from "../../common/seal/seal-subject";
import {
  DOCUMENT_SEAL_DOC_COLUMNS,
  DOCUMENT_SEAL_LINE_COLUMNS,
} from "./documents.controller";

const DOC = {
  id: "doc-1",
  status: "needs_review",
  currency: null,
  doc_number: "INV-1",
  doc_date: "2026-09-01",
  total: 120,
  freight: null,
  fuel_surcharge: null,
  split_case_fee: null,
  delivery_fee: null,
  deposit_total: null,
  tax: null,
  other_charges: null,
  discount_total: null,
};

const LINE_A = {
  id: "line-a",
  line_no: 1,
  qty: 12,
  uom: "bottle",
  pack_size: 1,
  qty_bottles: 12,
  free_goods_qty: 0,
  unit_price: 10,
  line_total: 120,
  allowance: null,
  description: "Kavaklidere Yakut",
  vintage: 2021,
  vendor_sku: "KY-21",
};

const LINE_B = { ...LINE_A, id: "line-b", line_no: 2, description: "Okuzgozu" };

describe("document-seal — the acts and the kind", () => {
  it("declares exactly the five acts the founder's two decisions name", () => {
    // Three from batch 64 on the /receipts face, two from batch 69 on ADR
    // 0104's canonical face. The list is asserted BY NAME rather than by count
    // so a rename cannot pass as a widening.
    expect([...DOCUMENT_SEAL_ACTS]).toEqual([
      "verify",
      "line_edit",
      "currency_restate",
      "field_correct",
      "field_verify",
    ]);
  });

  it("keeps the field tick one word away from nothing — `field_verify`, never `verification`", () => {
    // The names are load-bearing: `verify` on this same kind is the
    // DOCUMENT-WIDE act, and an act called `verification` beside it would be
    // two authorities separated by a suffix.
    expect([...DOCUMENT_SEAL_ACTS]).not.toContain("verification");
    expect([...DOCUMENT_SEAL_ACTS]).not.toContain("correction");
  });

  it("names a kind the seal service actually admits", () => {
    // The literal in this module and the literal in the union have to be the
    // same characters, or the gateway declares a kind the database refuses.
    expect(SEAL_SUBJECT_KINDS as readonly string[]).toContain(
      DOCUMENT_SEAL_SUBJECT_KIND,
    );
  });

  it("recognises its own acts and nothing else", () => {
    expect(isDocumentSealAct("verify")).toBe(true);
    expect(isDocumentSealAct("currency_restate")).toBe(true);
    expect(isDocumentSealAct("field_correct")).toBe(true);
    expect(isDocumentSealAct("field_verify")).toBe(true);
    expect(isDocumentSealAct("verification")).toBe(false);
    // An ORDER's acts are a different subject kind's vocabulary.
    expect(isDocumentSealAct("approve")).toBe(false);
    expect(isDocumentSealAct(undefined)).toBe(false);
  });
});

describe("document-seal — money is a fixed-precision string at both ends", () => {
  it("hashes a numeric string and a number to the same seal", () => {
    // PostgREST returns `numeric` as a string and `float` as a number. A seal
    // that hashed "10.00" at issue and 10 at redemption would refuse every
    // honest act — the defect `order-seal.ts` found and wrote down.
    const asNumber = documentSealLine(LINE_A);
    const asString = documentSealLine({
      ...LINE_A,
      qty: "12",
      unit_price: "10.00",
      line_total: "120",
    });
    expect(hashCallArgs(asString)).toBe(hashCallArgs(asNumber));
  });

  it("keeps an unreadable figure as 'unknown' rather than substituting zero", () => {
    const line = documentSealLine({ ...LINE_A, unit_price: null });
    expect(line.unitPrice).toBe("unknown");
    // And it CHANGES the moment the figure becomes readable, which is a change
    // worth refusing on. Substituting 0 would have hashed an unknown price as a
    // free one.
    expect(hashCallArgs(line)).not.toBe(hashCallArgs(documentSealLine(LINE_A)));
  });
});

describe("documentVerifySealArgs — the whole transcription", () => {
  it("does not depend on the order the lines came back in", () => {
    // PostgREST promises no order without an `order()`. Two reads that returned
    // the same rows in two orders must not produce two different seals.
    const a = documentVerifySealArgs(DOC, [LINE_A, LINE_B]);
    const b = documentVerifySealArgs(DOC, [LINE_B, LINE_A]);
    expect(hashCallArgs(a)).toBe(hashCallArgs(b));
  });

  it("changes when a line is corrected", () => {
    const before = documentVerifySealArgs(DOC, [LINE_A, LINE_B]);
    const after = documentVerifySealArgs(DOC, [
      { ...LINE_A, qty: 14 },
      LINE_B,
    ]);
    expect(hashCallArgs(after)).not.toBe(hashCallArgs(before));
  });

  it("changes when a line is ADDED or REMOVED, not only when one moves", () => {
    const two = documentVerifySealArgs(DOC, [LINE_A, LINE_B]);
    const one = documentVerifySealArgs(DOC, [LINE_A]);
    expect(hashCallArgs(one)).not.toBe(hashCallArgs(two));
    expect(two.lineCount).toBe(2);
  });

  it("changes when the document's own stated total moves", () => {
    const before = documentVerifySealArgs(DOC, [LINE_A]);
    const after = documentVerifySealArgs({ ...DOC, total: 130 }, [LINE_A]);
    expect(hashCallArgs(after)).not.toBe(hashCallArgs(before));
  });

  it("does NOT change when the matcher pairs a line to an order line", () => {
    // A pairing is a claim about which ORDER line this one answers. Verify
    // asserts nothing about that, and hashing it would make a seal refuse
    // because a background job ran.
    const before = documentVerifySealArgs(DOC, [LINE_A]);
    const after = documentVerifySealArgs(DOC, [
      { ...LINE_A, order_line_id: "ol-9", match_confidence: 0.99 },
    ]);
    expect(hashCallArgs(after)).toBe(hashCallArgs(before));
  });
});

describe("documentLineEditSealArgs — the line and the correction", () => {
  const base = { documentId: "doc-1", lineId: "line-a", status: "needs_review" };

  it("binds the patch, so a seal for qty 12 cannot be spent on 120", () => {
    const twelve = documentLineEditSealArgs({
      ...base,
      line: LINE_A,
      patch: { qty: 12 },
    });
    const hundred = documentLineEditSealArgs({
      ...base,
      line: LINE_A,
      patch: { qty: 120 },
    });
    expect(hashCallArgs(hundred)).not.toBe(hashCallArgs(twelve));
  });

  it("binds the line as it stands, so a second manager's edit refuses it", () => {
    const held = documentLineEditSealArgs({
      ...base,
      line: LINE_A,
      patch: { qty: 14 },
    });
    const moved = documentLineEditSealArgs({
      ...base,
      line: { ...LINE_A, unit_price: 99 },
      patch: { qty: 14 },
    });
    expect(hashCallArgs(moved)).not.toBe(hashCallArgs(held));
  });

  it("keeps ABSENT and NULL apart", () => {
    // A patch that does not mention unitPrice leaves it alone; one that sends
    // null CLEARS it. Collapsing the two would let a seal minted to change a
    // quantity be spent on a request that also wiped the price.
    const absent = documentLineEditPatchArgs({ qty: 14 });
    const cleared = documentLineEditPatchArgs({ qty: 14, unitPrice: null });
    expect(absent).not.toHaveProperty("unitPrice");
    expect(cleared.unitPrice).toBeNull();
    expect(hashCallArgs(cleared)).not.toBe(hashCallArgs(absent));
  });

  it("ignores a key outside the closed list, at both ends", () => {
    // The list is closed so a caller cannot add a key at the write that was not
    // there at the mint and still hash the same.
    const clean = documentLineEditPatchArgs({ qty: 14 });
    const smuggled = documentLineEditPatchArgs({
      qty: 14,
      orderLineId: "ol-9",
    } as Record<string, unknown>);
    expect(hashCallArgs(smuggled)).toBe(hashCallArgs(clean));
  });

  it("hashes a form's string and a number the same, for the same correction", () => {
    expect(hashCallArgs(documentLineEditPatchArgs({ qty: "14" }))).toBe(
      hashCallArgs(documentLineEditPatchArgs({ qty: 14 })),
    );
  });

  it("hashes a line that could not be read as null rather than inventing one", () => {
    const args = documentLineEditSealArgs({
      ...base,
      line: null,
      patch: { qty: 14 },
    });
    expect(args.line).toBeNull();
    expect(hashCallArgs(args)).not.toBe(
      hashCallArgs(
        documentLineEditSealArgs({ ...base, line: LINE_A, patch: { qty: 14 } }),
      ),
    );
  });
});

describe("documentCurrencySealArgs — the pair of codes", () => {
  it("distinguishes a restatement from a confirmation", () => {
    const restate = documentCurrencySealArgs({
      documentId: "doc-1",
      status: "needs_review",
      previous: null,
      next: "EUR",
    });
    const confirm = documentCurrencySealArgs({
      documentId: "doc-1",
      status: "needs_review",
      previous: "EUR",
      next: "EUR",
    });
    expect(hashCallArgs(restate)).not.toBe(hashCallArgs(confirm));
  });

  it("refuses a seal held open while somebody else filed the document", () => {
    const held = documentCurrencySealArgs({
      documentId: "doc-1",
      status: "needs_review",
      previous: null,
      next: "EUR",
    });
    const after = documentCurrencySealArgs({
      documentId: "doc-1",
      status: "needs_review",
      previous: "USD",
      next: "EUR",
    });
    expect(hashCallArgs(after)).not.toBe(hashCallArgs(held));
  });

  it("does not bind the free-text reason", () => {
    // The reason is what a person types ABOUT the decision, not the decision.
    // Binding it would refuse an honest approval because a typo was fixed.
    const args = documentCurrencySealArgs({
      documentId: "doc-1",
      status: "needs_review",
      previous: null,
      next: "EUR",
    });
    expect(Object.keys(args)).not.toContain("reason");
  });
});

/**
 * THE TWO HALVES CANNOT DRIFT.
 *
 * The `.select()` lists live on the controller (so `check_read_columns_exist.py`
 * can read them) and the normalisation lives here. A field added to
 * `documentSealLine` but not to the list would be `undefined` at BOTH ends and
 * hash identically — a seal that silently stopped covering something, which is
 * the absence-reported-as-health shape wearing the seal's own badge.
 *
 * So the fields are MEASURED rather than asserted: a recording Proxy reports
 * every property the function actually touched.
 */
function touched(fn: (row: Record<string, unknown>) => unknown): string[] {
  const seen = new Set<string>();
  const probe = new Proxy(
    {},
    {
      get(_t, key) {
        if (typeof key === "string") seen.add(key);
        return undefined;
      },
      has: () => true,
    },
  ) as Record<string, unknown>;
  fn(probe);
  return [...seen];
}

const columnSet = (list: string) => new Set(list.split(",").map((c) => c.trim()));

describe("the seal's fields and the controller's .select() lists", () => {
  it("reads no line column the controller does not select", () => {
    const selected = columnSet(DOCUMENT_SEAL_LINE_COLUMNS);
    const read = touched((row) => documentSealLine(row));
    expect(read.length).toBeGreaterThan(0);
    expect(read.filter((c) => !selected.has(c))).toEqual([]);
  });

  it("reads no document column the controller does not select", () => {
    const selected = columnSet(DOCUMENT_SEAL_DOC_COLUMNS);
    const read = touched((row) => documentVerifySealArgs(row, []));
    expect(read.length).toBeGreaterThan(0);
    expect(read.filter((c) => !selected.has(c))).toEqual([]);
  });

  it("selects no line column the seal ignores, so the list stays honest", () => {
    // The converse. A column selected and never hashed reads, to somebody
    // maintaining this, like part of what a verification stands behind.
    const read = new Set(touched((row) => documentSealLine(row)));
    expect(
      [...columnSet(DOCUMENT_SEAL_LINE_COLUMNS)].filter((c) => !read.has(c)),
    ).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------
 * THE CANONICAL FACE (founder, 2026-09-11, batch 69).
 * ------------------------------------------------------------------------- */

/** A layer-1 field envelope, in the shape the canonical builder produces. */
const fieldEnv = (value: unknown) => ({
  value,
  source: "extracted",
  confidence: null,
  revision: 1,
});

const LAYER1 = () => ({
  documentNumber: fieldEnv("INV-1"),
  issueDate: fieldEnv("2026-09-01"),
  lines: [{ netPrice: fieldEnv(10), quantity: fieldEnv(12) }],
  totals: { linesNetTotal: fieldEnv(120) },
});

const correctArgs = (over: Record<string, unknown> = {}) =>
  documentFieldCorrectSealArgs({
    documentId: "doc-1",
    revision: 1,
    layer1: LAYER1(),
    path: "lines[0].netPrice",
    value: 132,
    ...over,
  });

describe("document-seal — a field correction is sealed against the revision it was read on", () => {
  it("refuses a correction written against a superseded revision", () => {
    // The 409 the append path can only report AFTER a revision has landed.
    expect(hashCallArgs(correctArgs())).not.toBe(
      hashCallArgs(correctArgs({ revision: 2 })),
    );
  });

  it("refuses a correction after the OTHER face moved the document, revision unchanged", () => {
    // A document nobody has corrected has no `document_revisions` row at all
    // and is rebuilt from its columns on every read, so a `line_edit` made on
    // /receipts moves the content while the number stands at 1. The revision
    // alone cannot see this; the content hash is why both are in the arguments.
    const moved = LAYER1();
    moved.lines[0].netPrice.value = 99;
    expect(hashCallArgs(correctArgs())).not.toBe(
      hashCallArgs(correctArgs({ layer1: moved })),
    );
  });

  it("binds the path and the value, so one correction's seal cannot buy another", () => {
    expect(hashCallArgs(correctArgs())).not.toBe(
      hashCallArgs(correctArgs({ path: "documentNumber" })),
    );
    expect(hashCallArgs(correctArgs())).not.toBe(
      hashCallArgs(correctArgs({ value: 1320 })),
    );
  });

  it("keeps `null` and an absent value the same correction, and nothing else", () => {
    // `value: null` IS a correction ("the document states nothing here") and
    // the controller sends `body.value ?? null`, so the two have to agree.
    expect(hashCallArgs(correctArgs({ value: null }))).toBe(
      hashCallArgs(correctArgs({ value: undefined })),
    );
    // ...and a string "132" is NOT the number 132. The value comes from the
    // request body at both ends, so there is no PostgREST drift to absorb and
    // collapsing the two would be the helpfulness `hashCallArgs` refuses.
    expect(hashCallArgs(correctArgs({ value: "132" }))).not.toBe(
      hashCallArgs(correctArgs({ value: 132 })),
    );
  });

  it("hashes the same document read twice to the same seal", () => {
    // Two builds of an unchanged document must agree, or every honest
    // correction is refused and operators learn the seal is decoration.
    expect(hashCallArgs(correctArgs())).toBe(hashCallArgs(correctArgs()));
  });

  it("is a different seal from the line edit on the other face", () => {
    expect(hashCallArgs(correctArgs())).not.toBe(
      hashCallArgs(
        documentLineEditSealArgs({
          documentId: "doc-1",
          lineId: "line-a",
          status: "needs_review",
          line: LINE_A,
          patch: { unitPrice: 132 },
        }),
      ),
    );
  });
});

const tickArgs = (over: Record<string, unknown> = {}) =>
  documentFieldVerifySealArgs({
    documentId: "doc-1",
    path: "lines[0].netPrice",
    fieldPresent: true,
    value: 10,
    verdict: FIELD_VERIFY_VERDICT,
    ...over,
  });

describe("document-seal — a field tick is sealed against the value it was shown", () => {
  it("refuses a tick after the figure moved underneath it", () => {
    expect(hashCallArgs(tickArgs())).not.toBe(
      hashCallArgs(tickArgs({ value: 132 })),
    );
  });

  it("keeps a field the document does not carry apart from one stating nothing", () => {
    // Both render as "nothing" on screen and are different facts. Hashed as
    // one, a tick minted on a path this document had no row for could be spent
    // after the path appeared carrying null.
    expect(hashCallArgs(tickArgs({ fieldPresent: false, value: null }))).not.toBe(
      hashCallArgs(tickArgs({ fieldPresent: true, value: null })),
    );
  });

  it("binds the field, so a tick on one figure cannot stand for another", () => {
    expect(hashCallArgs(tickArgs())).not.toBe(
      hashCallArgs(tickArgs({ path: "documentNumber" })),
    );
  });

  it("names the verdict, so a second verdict cannot spend this one's seal", () => {
    expect(FIELD_VERIFY_VERDICT).toBe("verified");
    expect(hashCallArgs(tickArgs())).not.toBe(
      hashCallArgs(tickArgs({ verdict: "disputed" })),
    );
  });

  it("is deliberately NOT bound to the rest of the document", () => {
    // The asymmetry with `field_correct`, stated as a measurement. A tick
    // asserts one thing about one field; refusing it because line 9 moved would
    // fire at random from the operator's side and teach them to ignore it.
    const a = tickArgs();
    const b = tickArgs();
    expect(hashCallArgs(a)).toBe(hashCallArgs(b));
    expect(Object.keys(a).sort()).toEqual([
      "documentId",
      "fieldPresent",
      "path",
      "value",
      "verdict",
    ]);
  });
});

/* ---------------------------------------------------------------------------
 * IS THAT HASH STABLE OVER A REAL BUILD? (auditor, 2026-09-11)
 * ---------------------------------------------------------------------------
 * Every case above hashes a hand-built fixture, which proves the arguments are
 * chosen well and proves nothing about the object the gateway actually hashes.
 * `field_correct` binds the WHOLE canonical document, built by
 * `CanonicalDocumentService.buildFromDocumentId` at the mint and again at the
 * redemption. If that builder emits anything that differs between two reads of
 * an unchanged document — a regenerated timestamp, a re-derived float, a set
 * iterated in insertion order that is not stable — then EVERY honest correction
 * is refused with "this document changed after the seal was issued", operators
 * learn the seal fires at random, and nothing else in this suite would catch it.
 *
 * So the real service is built here over a fake client (no database, no Nest
 * container, no production row) and the same document is read twice. The second
 * case is the one that keeps the first honest: a stability test that passed
 * because both builds produced nothing would be this repository's
 * absence-reported-as-health fault wearing a seal's badge.
 * ------------------------------------------------------------------------- */

import { CanonicalDocumentService } from "../canonical/canonical-document.service";

const BUILD_DOC_ROW = {
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

// Numerics arrive from PostgREST as STRINGS, written that way deliberately: a
// fixture handing back numbers would hide exactly the coercion this measures.
const buildLineRows = () => [
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

/** A supabase-shaped chain that answers per table. Reads only. */
function fakeClient(answers: Record<string, { data: unknown; error: null }>) {
  let table = "";
  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const verb of ["select", "eq", "in", "order", "limit"]) {
      chain[verb] = () => self();
    }
    for (const verb of ["single", "maybeSingle"]) {
      chain[verb] = () => {
        const a = answers[table];
        const data = Array.isArray(a?.data) ? (a.data[0] ?? null) : a?.data;
        return Promise.resolve({ data: data ?? null, error: null });
      };
    }
    (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: answers[table]?.data ?? null, error: null }).then(
        resolve,
      );
    return chain;
  };
  return {
    from: (t: string) => {
      table = t;
      return makeChain();
    },
  };
}

describe("document-seal — the correction seal over a REAL canonical build", () => {
  const buildTwice = async (lineRows: unknown[]) => {
    const client = fakeClient({
      procurement_documents: { data: BUILD_DOC_ROW, error: null },
      procurement_document_lines: { data: lineRows, error: null },
      procurement_order_items: {
        data: [{ id: "ol-1", inventory_id: "inv-1", master_wine_id: "mw-1" }],
        error: null,
      },
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
      document_corrections: { data: [], error: null },
      document_revisions: { data: [], error: null },
    });
    const service = new CanonicalDocumentService(
      { getClient: () => client } as never,
      /*
       * LineMappingService (ADR 0104 D12 slice 4, merged from main 2026-09-12).
       * A double that answers "no memory for this document" - the same answer
       * the real service gives when the document names no vendor, and the same
       * answer BOTH times. This test is about whether the seal's hash over the
       * canonical document is STABLE; a memory that replied differently on the
       * second build would make the hash move for a reason that has nothing to
       * do with the hash, and the test would be measuring the memory instead.
       */
      { proposalsFor: async () => ({ ok: true, value: new Map() }) } as never,
    );
    const read = await service.buildFromDocumentId("rest-1", "doc-1");
    if (!read.ok) throw new Error(`the fixture did not build: ${read.error}`);
    return read.value;
  };

  const sealOf = (built: { revision: number; layer1: unknown }) =>
    hashCallArgs(
      documentFieldCorrectSealArgs({
        documentId: "doc-1",
        revision: built.revision,
        layer1: built.layer1,
        path: "lines[0].netPrice",
        value: 132,
      }),
    );

  it("hashes two builds of the same unchanged document to the SAME seal", async () => {
    const first = await buildTwice(buildLineRows());
    const second = await buildTwice(buildLineRows());
    // If this ever goes red, every honest correction is being refused in
    // production and the named field in the diff is the one that moved.
    expect(sealOf(second)).toBe(sealOf(first));
  });

  it("and the fixture is not empty, so the case above cannot pass vacuously", async () => {
    const built = await buildTwice(buildLineRows());
    const l1 = built.layer1 as { lines?: unknown[] };
    expect(Array.isArray(l1.lines)).toBe(true);
    expect(l1.lines).toHaveLength(2);
  });

  it("MOVES when the document moves, so the hash is reading the document", async () => {
    const moved = buildLineRows();
    (moved[0] as { unit_price: string }).unit_price = "23.0000";
    expect(sealOf(await buildTwice(moved))).not.toBe(
      sealOf(await buildTwice(buildLineRows())),
    );
  });
});
