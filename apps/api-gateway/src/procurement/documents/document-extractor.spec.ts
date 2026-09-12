import { ConfigService } from "@nestjs/config";
import {
  DocumentExtractorService,
  settledEventId,
  stripJsonFence,
} from "./document-extractor.service";
import { isDocumentLike } from "./document-intake.service";
import { NfEventRef } from "../../common/model-client/model-client.service";

const svc = new DocumentExtractorService(
  {
    get: () => undefined,
  } as unknown as ConfigService,
  // modelClient — these tests exercise normalize() only, never the transport.
  {} as any,
  // nfVerdicts — likewise unreached: the verdict is written by extract(), not
  // normalize(). reconciliation-verdict.spec.ts covers the grading rule itself.
  {} as any,
);

const json = (o: unknown) => JSON.stringify(o);

const INVOICE = {
  docType: "invoice",
  docNumber: "INV-88213",
  docDate: "2026-07-15",
  vendorName: "Southern Glazers",
  currency: "USD",
  freight: 48,
  total: 1104,
  lines: [
    {
      description: "Barolo",
      qty: 24,
      uom: "bottles",
      unitPrice: 22,
      lineTotal: 528,
    },
    {
      description: "Sancerre",
      qty: 2,
      uom: "CS",
      packSize: 12,
      unitPrice: 264,
      lineTotal: 528,
    },
  ],
};

describe("DocumentExtractorService.normalize", () => {
  it("normalises units and converts cases to bottles", () => {
    const d = svc.normalize(json(INVOICE), "test");

    expect(d.lines[0].uom).toBe("bottle"); // "bottles" plural from the model
    expect(d.lines[1].uom).toBe("case"); // "CS"
    expect(d.lines[1].packSize).toBe(12);
    expect(d.lines[1].qtyBottles).toBe(24);
  });

  it("ties out lines plus charges against the stated total", () => {
    const d = svc.normalize(json(INVOICE), "test");

    expect(d.computedLinesTotal).toBe(1056);
    expect(d.tiesOut).toBe(true);
    expect(d.warnings).toHaveLength(0);
  });

  it("drops confidence hard when the arithmetic breaks", () => {
    // A model that misreads a quantity or a price almost always breaks the sum.
    // This is the cheapest hallucination detector available and it costs nothing.
    const d = svc.normalize(json({ ...INVOICE, total: 9999 }), "test");

    expect(d.tiesOut).toBe(false);
    expect(d.confidence).toBeLessThanOrEqual(0.35);
    expect(d.warnings.join(" ")).toMatch(/off by/);
  });

  it("never infers free goods from a photograph", () => {
    // Netting quantity out of the billable comparison on a model's guess would
    // mask a real overbill — the expensive direction to be wrong.
    const d = svc.normalize(
      json({ ...INVOICE, lines: [{ qty: 11, uom: "bottle", unitPrice: 0 }] }),
      "test",
    );
    expect(d.lines[0].freeGoodsQty).toBe(0);
  });

  it("does not compute a line total the document did not print", () => {
    // The prompt says transcribe, never calculate. A computed total that
    // disagrees with the paper would defeat the tie-out check by construction.
    const d = svc.normalize(
      json({
        docType: "invoice",
        lines: [{ qty: 6, uom: "bottle", unitPrice: 450 }],
      }),
      "test",
    );
    expect(d.lines[0].lineTotal).toBeNull();
  });

  it("flags an invoice with no prices as probably a packing slip", () => {
    // Mislabelling a packing slip as an invoice destroys the evidence that makes
    // an overbilling claim self-proving.
    const d = svc.normalize(
      json({ docType: "invoice", lines: [{ qty: 24, uom: "bottle" }] }),
      "test",
    );
    expect(d.warnings.join(" ")).toMatch(/packing slip/i);
  });

  it("returns unknown rather than an empty invoice when the model returns prose", () => {
    // An empty invoice reads downstream as a vendor who billed nothing.
    const d = svc.normalize("I'm sorry, I can't read this image.", "test");

    expect(d.docType).toBe("unknown");
    expect(d.confidence).toBe(0);
    expect(d.lines).toHaveLength(0);
  });

  it("files an unrecognised document type as unknown instead of guessing", () => {
    const d = svc.normalize(
      json({ docType: "bill_of_lading", lines: [] }),
      "test",
    );

    expect(d.docType).toBe("unknown");
    expect(d.warnings.join(" ")).toMatch(/bill_of_lading/);
  });

  it("strips currency noise the prompt asked the model not to send", () => {
    const d = svc.normalize(
      json({ docType: "invoice", total: "$1,104.00", lines: [] }),
      "test",
    );
    expect(d.total).toBe(1104);
  });

  it("treats a missing total as untestable, not as a failed tie-out", () => {
    // Reporting "does not tie out" for a document with no stated total would
    // train people to ignore the flag.
    const d = svc.normalize(
      json({ docType: "packing_slip", lines: [{ qty: 24, uom: "bottle" }] }),
      "test",
    );
    expect(d.tiesOut).toBeNull();
  });

  it("keeps confidence below the EDI ceiling even on a clean read", () => {
    // EDI is structured data from the source system; this is a model reading a
    // photograph possibly taken in a stairwell, and the number should say so.
    const d = svc.normalize(json(INVOICE), "test");
    expect(d.confidence).toBeLessThan(0.9);
  });
});

describe("isDocumentLike", () => {
  it("accepts the formats distributors actually send", () => {
    expect(isDocumentLike("application/pdf", "invoice_88213.pdf")).toBe(true);
    expect(isDocumentLike("image/jpeg", "IMG_4471.jpg")).toBe(true);
    expect(isDocumentLike(null, "SGWS_810.edi")).toBe(true);
  });

  it("rejects the images that ride along on every vendor email", () => {
    // Running each of these through a vision model costs money per message and
    // fills the review queue with noise, which teaches people to ignore it.
    expect(isDocumentLike("image/png", "company-logo.png")).toBe(false);
    expect(isDocumentLike("image/png", "email_signature.png")).toBe(false);
    expect(isDocumentLike("image/gif", "footer-banner.gif")).toBe(false);
  });

  it("rejects unrelated file types", () => {
    expect(isDocumentLike("application/zip", "archive.zip")).toBe(false);
    expect(isDocumentLike("text/calendar", "invite.ics")).toBe(false);
  });
});

/**
 * ADR 0059 (L6) — the footprint id is carried out with the document so the
 * extraction can be attributed to a model.
 *
 * The wait is BOUNDED, and that is the whole substance of these tests.
 * `model-client.service.ts:326` states that emission latency never rides a user
 * path: the emit is `void`ed on purpose, and the ref settles only when that
 * background insert finishes. A plain `await ref.id` would have handed the
 * instrument the power to hang the extraction it measures — the exact inversion
 * the module forbids — on a path where the user is a receiver standing at a
 * door with a driver waiting.
 */
describe("settledEventId — attribution never blocks the extraction", () => {
  it("returns the id when the emit lands", async () => {
    const ref = new NfEventRef();
    ref.settle("evt-1");
    await expect(settledEventId(ref, 50)).resolves.toBe("evt-1");
  });

  it("returns null when the emit was dropped", async () => {
    const ref = new NfEventRef();
    // A dropped emit settles with null rather than hanging — the model client
    // guarantees this in its `.finally()`. Attribution is lost; nothing else is.
    ref.settle(null);
    await expect(settledEventId(ref, 50)).resolves.toBeNull();
  });

  it("gives up rather than waiting on a ref that never settles", async () => {
    const started = Date.now();
    // Never settled: a footprint insert that stalled. Before the bound, this
    // hung the extraction — and therefore the HTTP request — forever.
    const out = await settledEventId(new NfEventRef(), 20);
    expect(out).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

/**
 * Gap 1 (slice-1 tech debt) — the extractor must emit the five document types
 * ADR 0104 D2/S6 added, not file them as `unknown`.
 *
 * `unknown` is not a harmless holding pen. A Turkish irsaliye landing there
 * reads as "we could not classify this", which routes a legally ordinary
 * delivery into the review queue and ages it under ADR 0103 D9 — the exact
 * "a legally normal transaction must not read like a broken intake" failure
 * S6 names. One fixture per new literal, because a list that is right for four
 * of five is wrong in production for the fifth.
 */
describe("DocumentExtractorService — the five ADR 0104 document types", () => {
  const cases: [string, string][] = [
    ["delivery_note", "a Turkish irsaliye / e-İrsaliye with no money on it"],
    ["receiving_advice", "our own door count"],
    ["informal_note", "a handwritten slip from an unregistered vendor"],
    ["price_list", "a vendor price sheet"],
    ["portal_export", "a Sysco/MOXē-style portal export"],
  ];

  it.each(cases)("classifies %s (%s) as itself", (docType) => {
    const d = svc.normalize(json({ docType, lines: [] }), "test");
    expect(d.docType).toBe(docType);
    // And says nothing about not recognising it — a warning here would put the
    // document in front of a human for no reason.
    expect(d.warnings.join(" ")).not.toMatch(/not recognised/);
  });

  it("still files a genuinely unknown type as unknown, with its warning", () => {
    // The fallback is the point of the mechanism, not a leftover: widening the
    // list must not turn "we do not know what this is" into a silent guess.
    const d = svc.normalize(
      json({ docType: "bill_of_lading", lines: [] }),
      "test",
    );
    expect(d.docType).toBe("unknown");
    expect(d.warnings.join(" ")).toMatch(/bill_of_lading/);
  });
});

/**
 * Gap 2 — BT-149/BT-150 round-trip. The extractor must carry the PRINTED price
 * basis, and must not invent one.
 */
describe("DocumentExtractorService — printed price base (BT-149/BT-150)", () => {
  it("keeps a printed price base on the line", () => {
    const d = svc.normalize(
      json({
        docType: "invoice",
        lines: [
          {
            description: "Öküzgözü",
            qty: 1,
            uom: "case",
            packSize: 12,
            unitPrice: 142,
            lineTotal: 142,
            priceBaseQty: 12,
            priceBaseUom: "bottle",
          },
        ],
      }),
      "test",
    );
    expect(d.lines[0].priceBaseQty).toBe(12);
    expect(d.lines[0].priceBaseUom).toBe("bottle");
  });

  it("leaves the price base null when the document did not print one", () => {
    // Same rule the prompt already states for packSize: null, never assumed.
    // A guessed base of 12 is wrong by a factor of twelve on a per-bottle line.
    const d = svc.normalize(json(INVOICE), "test");
    expect(d.lines[1].priceBaseQty).toBeNull();
    expect(d.lines[1].priceBaseUom).toBeNull();
  });

  it("refuses an unrecognised price base unit rather than guessing bottle", () => {
    const d = svc.normalize(
      json({
        docType: "invoice",
        lines: [
          {
            qty: 1,
            uom: "case",
            unitPrice: 142,
            priceBaseQty: 12,
            priceBaseUom: "magnum",
          },
        ],
      }),
      "test",
    );
    expect(d.lines[0].priceBaseUom).toBeNull();
    expect(d.warnings.join(" ")).toMatch(/magnum/);
  });
});

/**
 * Gap 3 — `as_printed`. The extractor must return the literal glyphs for money
 * and quantity fields, and must never reformat them.
 */
describe("DocumentExtractorService — printed literals", () => {
  const TR_LINE = {
    docType: "invoice",
    total: 1704,
    printed: { total: "1.704,00" },
    lines: [
      {
        description: "Öküzgözü",
        qty: 12,
        uom: "bottle",
        unitPrice: 142,
        lineTotal: 1704,
        printed: {
          unitPrice: "142,00 / KS(12)",
          qty: "12",
          lineTotal: "1.704,00",
        },
      },
    ],
  };

  it("keeps a Turkish-formatted number byte for byte", () => {
    const d = svc.normalize(json(TR_LINE), "test");
    expect(d.lines[0].printed?.unitPrice).toBe("142,00 / KS(12)");
    expect(d.lines[0].printed?.lineTotal).toBe("1.704,00");
    expect(d.printed?.total).toBe("1.704,00");
    // The parsed number is ours; the string is the paper's. Both survive.
    expect(d.lines[0].lineTotal).toBe(1704);
  });

  it("does not invent a printed map when the model returned none", () => {
    // An empty map would read as "the paper printed nothing" rather than
    // "we did not keep it" — ADR 0067's distinction, on the other axis.
    const d = svc.normalize(json(INVOICE), "test");
    expect(d.lines[0].printed).toBeUndefined();
    expect(d.printed).toBeUndefined();
  });

  it("drops blank printed entries instead of storing whitespace", () => {
    const d = svc.normalize(
      json({
        docType: "invoice",
        lines: [
          {
            qty: 1,
            uom: "bottle",
            unitPrice: 10,
            printed: { qty: "  ", unitPrice: "10,00" },
          },
        ],
      }),
      "test",
    );
    expect(d.lines[0].printed).toEqual({ unitPrice: "10,00" });
  });
});

/**
 * CodeQL #1328 (`js/remote-property-injection`, high) — the `printed` map's
 * keys are written into an object, and since PR #301 that map can be supplied
 * by a client through `POST /procurement/documents/:id/extraction`. A key is a
 * key: `__proto__`, `constructor` and `prototype` are keys the model never
 * emits and a caller can.
 *
 * The fix is not an escape or a denylist — it is that only the money and
 * quantity fields the prompt names are ever copied. Anything else is dropped
 * and COUNTED, because a silently discarded field is the absence-as-health
 * fault on the smallest possible scale.
 */
describe("DocumentExtractorService — printed keys are an allow-list (CodeQL #1328)", () => {
  // Written as TEXT, not built from an object literal. A JS literal's
  // `__proto__` key sets the prototype instead of defining a property, so an
  // object literal physically cannot express the body a client posts;
  // `JSON.parse` defines it as an own property, which is exactly what the door
  // hands `normalize`.
  const HOSTILE_JSON = `{
    "docType": "invoice",
    "total": 10,
    "printed": {
      "total": "10,00",
      "__proto__": "polluted",
      "constructor": "polluted",
      "prototype": "polluted",
      "vendorName": "ACME"
    },
    "lines": [
      {
        "qty": 1,
        "uom": "bottle",
        "unitPrice": 10,
        "printed": {
          "unitPrice": "10,00",
          "__proto__": "polluted",
          "constructor": "polluted",
          "prototype": "polluted",
          "description": "not a money field"
        }
      }
    ]
  }`;

  it("puts __proto__ on the wire as an own key, which an object literal cannot", () => {
    // Guards the fixture itself: if this stops holding, every assertion below
    // is testing a weaker input than the door accepts.
    const body = JSON.parse(HOSTILE_JSON) as {
      printed: Record<string, unknown>;
    };
    expect(Object.keys(body.printed)).toContain("__proto__");
  });

  it("copies only the named money/quantity keys onto a line", () => {
    const d = svc.normalize(HOSTILE_JSON, "test");
    expect(d.lines[0].printed).toEqual({ unitPrice: "10,00" });
    for (const k of ["__proto__", "constructor", "prototype", "description"])
      expect(Object.keys(d.lines[0].printed ?? {})).not.toContain(k);
  });

  it("copies only the named money/quantity keys onto the document", () => {
    const d = svc.normalize(HOSTILE_JSON, "test");
    expect(d.printed).toEqual({ total: "10,00" });
    expect(Object.keys(d.printed ?? {})).not.toContain("vendorName");
  });

  it("leaves Object.prototype untouched", () => {
    svc.normalize(HOSTILE_JSON, "test");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).constructor).toBe(Object);
  });

  it("counts the dropped keys in warnings rather than discarding them silently", () => {
    const d = svc.normalize(HOSTILE_JSON, "test");
    // 4 on the line + 4 on the document = 8 keys the parse refused to keep.
    expect(d.warnings.join(" ")).toMatch(/8 printed field/);
  });

  it("keeps every key the prompt names", () => {
    const d = svc.normalize(
      JSON.stringify({
        docType: "invoice",
        printed: {
          subtotal: "1",
          freight: "2",
          fuelSurcharge: "3",
          splitCaseFee: "4",
          deliveryFee: "5",
          depositTotal: "6",
          tax: "7",
          otherCharges: "8",
          discountTotal: "9",
          total: "10",
        },
        lines: [
          {
            qty: 1,
            uom: "bottle",
            printed: {
              qty: "1",
              uom: "BT",
              packSize: "12",
              formatMl: "750",
              unitPrice: "10,00",
              priceBaseQty: "12",
              priceBaseUom: "KS",
              lineTotal: "120,00",
              allowance: "0,00",
              deposit: "0,00",
            },
          },
        ],
      }),
      "test",
    );
    expect(Object.keys(d.printed ?? {}).sort()).toEqual(
      [
        "deliveryFee",
        "depositTotal",
        "discountTotal",
        "freight",
        "fuelSurcharge",
        "otherCharges",
        "splitCaseFee",
        "subtotal",
        "tax",
        "total",
      ].sort(),
    );
    expect(Object.keys(d.lines[0].printed ?? {}).length).toBe(10);
    // Nothing was dropped, so nothing is reported as dropped.
    expect(d.warnings.join(" ")).not.toMatch(/printed field/);
  });
});

/**
 * CodeQL #1327 (`js/polynomial-redos`, high) — `stripJsonFence` ran
 * `/^```json\s*|\s*```$/g` over `rawText`. The second alternative has no
 * anchor at its start, so the engine retries `\s*` from every offset in a run
 * of whitespace: quadratic in the length of that run.
 *
 * Measured against the unmodified regex on this machine (node v22):
 * 200 kB of spaces took **21_833 ms**, and `" ".repeat(50_000) + "x"` took
 * **1_702 ms**. Both are supplied straight from a request body by the
 * extraction door PR #301 added, so either one is a single-request stall of
 * the gateway's event loop.
 *
 * The bound below is deliberately generous — the point is the two orders of
 * magnitude, not a benchmark.
 */
describe("DocumentExtractorService — fence stripping is linear (CodeQL #1327)", () => {
  const BOUND_MS = 200;

  const elapsed = (fn: () => void): number => {
    const t0 = process.hrtime.bigint();
    fn();
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };

  it("survives 200 kB of whitespace", () => {
    const ms = elapsed(() => stripJsonFence(" ".repeat(200_000)));
    expect(ms).toBeLessThan(BOUND_MS);
  });

  it("survives a whitespace run that cannot close the fence", () => {
    const ms = elapsed(() => stripJsonFence(" ".repeat(50_000) + "x"));
    expect(ms).toBeLessThan(BOUND_MS);
  });

  it("survives the same body through normalize(), which is what the door calls", () => {
    const ms = elapsed(() => svc.normalize(" ".repeat(200_000), "test"));
    expect(ms).toBeLessThan(BOUND_MS);
  });

  it("still strips the fences it always stripped", () => {
    expect(stripJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripJsonFence('{"a":1}')).toBe('{"a":1}');
    expect(stripJsonFence("```json```")).toBe("");
    expect(stripJsonFence("```")).toBe("");
    // A trailing fence with nothing after it is still a fence; a trailing
    // space after it defeated the old regex's `$` and still does.
    expect(stripJsonFence('{"a":1}\n```  ')).toBe('{"a":1}\n```');
  });
});

/**
 * The contract gaps the first render against real documents named (findings 3,
 * 4, 6 and 7 of `v3.0-TECH-DEBT.md`, 2026-09-04). All values SYNTHETIC.
 */
describe("the contract carries what the paper prints (findings 3, 4, 6, 7)", () => {
  it("transcribes a printed delivery date into BT-72, and never borrows docDate", () => {
    const withDelivery = svc.normalize(
      json({ ...INVOICE, deliveredDate: "2026-08-12" }),
      "test",
    );
    expect(withDelivery.deliveredDate).toBe("2026-08-12");
    expect(withDelivery.docDate).toBe("2026-07-15");

    // A document that prints no delivery date says so — it does NOT inherit
    // the issue date, which on a Turkish fatura can be a week later.
    expect(svc.normalize(json(INVOICE), "test").deliveredDate).toBeNull();
  });

  it("keeps a single printed tax line as ONE BG-23 row", () => {
    // "KDV %20 (matrah 9.172,00) 1.834,40" — one rate, one base, one amount.
    const tr = svc.normalize(
      json({
        ...INVOICE,
        tax: 1834.4,
        taxBreakdown: [
          { rate: 20, taxableBase: 9172, amount: 1834.4, category: "S" },
        ],
      }),
      "test",
    );
    expect(tr.taxBreakdown).toEqual([
      { rate: 20, taxableBase: 9172, amount: 1834.4, category: "S" },
    ]);

    // "Sales tax 8.625% on 2,940.00" — a fractional rate and no category.
    const ca = svc.normalize(
      json({
        ...INVOICE,
        tax: 253.58,
        taxBreakdown: [{ rate: 8.625, taxableBase: 2940, amount: 253.58 }],
      }),
      "test",
    );
    expect(ca.taxBreakdown).toEqual([
      { rate: 8.625, taxableBase: 2940, amount: 253.58 },
    ]);
  });

  it("drops a breakdown row with no rate, and SAYS it dropped it", () => {
    const doc = svc.normalize(
      json({ ...INVOICE, tax: 90, taxBreakdown: [{ amount: 90 }] }),
      "test",
    );
    expect(doc.taxBreakdown).toEqual([]);
    expect(doc.warnings.join(" ")).toMatch(/Dropped 1 VAT breakdown row/);
  });

  it("tells a deposit LINE apart from a deposit ON a line", () => {
    const doc = svc.normalize(
      json({
        ...INVOICE,
        lines: [
          // A goods line carrying a per-bottle crate charge.
          {
            description: "Okuzgozu",
            qty: 12,
            uom: "bottle",
            unitPrice: 142,
            lineTotal: 1704,
            deposit: 60,
          },
          // A line that IS the deposit. It keeps no `deposit` of its own —
          // the 2026-09-04 transcription set both and the arithmetic then
          // expected 360 against a stated 180.
          {
            description: "Depozito (kasa)",
            qty: 2,
            uom: "each",
            unitPrice: 90,
            lineTotal: 180,
            deposit: 180,
          },
        ],
      }),
      "test",
    );
    expect(doc.lines[0].lineKind).toBe("goods");
    expect(doc.lines[0].deposit).toBe(60);
    expect(doc.lines[1].lineKind).toBe("deposit");
    expect(doc.lines[1].deposit).toBeNull();
  });

  it("classifies an unlabelled CRV row from its description, never as goods", () => {
    const doc = svc.normalize(
      json({
        ...INVOICE,
        lines: [
          { description: "Barolo", qty: 12, uom: "bottle", unitPrice: 22 },
          {
            description: "CRV deposit 12 x 750ml",
            qty: 12,
            uom: "each",
            unitPrice: 0.1,
          },
          { description: "Freight", qty: 1, uom: "each", unitPrice: 45 },
        ],
      }),
      "test",
    );
    expect(doc.lines.map((l) => l.lineKind)).toEqual([
      "goods",
      "deposit",
      "fee",
    ]);
  });

  it("names an unrecognised lineKind rather than filing it as goods in silence", () => {
    const doc = svc.normalize(
      json({
        ...INVOICE,
        lines: [
          {
            description: "CRV deposit",
            qty: 1,
            uom: "each",
            unitPrice: 1,
            lineKind: "container",
          },
        ],
      }),
      "test",
    );
    expect(doc.warnings.join(" ")).toMatch(/unrecognised lineKind "container"/);
    // And it still lands on the description's answer, not on `goods`.
    expect(doc.lines[0].lineKind).toBe("deposit");
  });

  it("counts a deposit ONCE when the paper prints it as a line and a subtotal", () => {
    // The Turkish invoice of 2026-09-04: 180 as line 4 AND as depositTotal.
    // Counted twice, the tie-out is "off by 180" — which is what it said.
    const doc = svc.normalize(
      json({
        docType: "invoice",
        currency: "TRY",
        subtotal: 1704,
        depositTotal: 180,
        total: 1884,
        lines: [
          {
            description: "Okuzgozu",
            qty: 12,
            uom: "bottle",
            unitPrice: 142,
            lineTotal: 1704,
          },
          {
            description: "Depozito (kasa)",
            qty: 2,
            uom: "each",
            unitPrice: 90,
            lineTotal: 180,
          },
        ],
      }),
      "test",
    );
    expect(doc.computedLinesTotal).toBe(1704);
    expect(doc.tieOutDelta).toBe(0);
    expect(doc.tiesOut).toBe(true);
  });
});
