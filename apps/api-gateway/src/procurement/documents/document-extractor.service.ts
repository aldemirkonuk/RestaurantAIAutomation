import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ModelClientService,
  NfEventRef,
} from "../../common/model-client/model-client.service";
import { NfVerdictService } from "../../common/model-client/nf-verdict.service";
import { DOC_TYPES, normalizeUom, toBottles, Uom } from "./document-types";
import { applyTieOut, ParsedDocument, ParsedLine } from "./parsed-document";
import {
  reconciliationVerdict,
  RECONCILIATION_BASIS,
} from "./reconciliation-verdict";
import { DocType } from "./document-types";

/**
 * How long an extraction will wait for its own footprint row id before giving
 * up and recording no attribution (ADR 0059).
 *
 * The emit is already in flight when this is called — the model call it belongs
 * to has returned — so in the normal case the ref is settled or about to be,
 * and this never actually waits. It exists for the abnormal case: a footprint
 * insert that stalls must not stall the extraction. Attribution is the cheap
 * thing to lose here, and it is the one that gets lost.
 */
export const EVENT_ID_WAIT_MS = 2_000;

/** The ref's id, or null if it has not settled within EVENT_ID_WAIT_MS. */
export async function settledEventId(
  ref: NfEventRef,
  waitMs: number = EVENT_ID_WAIT_MS,
): Promise<string | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      ref.id,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), waitMs);
        // Do not hold the event loop open for an instrument. A process that
        // is otherwise finished must be allowed to exit.
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * DocumentExtractorService — vision extraction for documents that are not EDI.
 *
 * Mirrors the shipped menus/parsers/scan-parser.service.ts pattern, and produces
 * the same ParsedDocument that the X12 parsers do, so nothing downstream can
 * tell a photographed invoice from an electronic one.
 *
 * EXTRACTION IS A PROPOSAL. This service reads a document and returns JSON. It
 * does not write to inventory, the ledger, an order, or a cost basis. The dead
 * InvoiceScannerModal it replaces posted straight to an /invoices/:id/add-to-inventory
 * endpoint that never existed — and if it had, it would have bypassed the match
 * engine entirely, stocking whatever a model read off a photograph.
 *
 * The arithmetic self-check (applyTieOut) is the cheapest and most reliable
 * guard available: a model that hallucinates a quantity or a price almost always
 * breaks the sum, and a document whose lines do not add up to its own stated
 * total is exactly the one a human should look at first. It costs nothing and
 * needs no second model call.
 */

const SYSTEM_PROMPT = `You are reading a beverage distributor's delivery paperwork for a restaurant's back office.

CLASSIFY the document first. It is exactly one of these twelve:
- "invoice": states prices and an amount owed. A Turkish e-Fatura or fatura is an invoice.
- "packing_slip": lists what shipped, usually WITHOUT prices. Often titled packing slip or ASN.
- "delivery_note": a despatch advice that travels WITH the goods and carries no money — a Turkish irsaliye or e-İrsaliye, a bordro, a European delivery note. If it names quantities and a vehicle or a driver and prints no prices, it is this, not a packing_slip.
- "receiving_advice": OUR OWN door count, written by the receiving restaurant rather than the vendor. It records what was counted at the door, not what was shipped or billed.
- "credit_memo": a credit or adjustment against an earlier invoice (a Turkish iade faturası is the same document issued the other way).
- "delivery_receipt": a signature/proof-of-delivery sheet with little or no line detail.
- "statement": a period roll-up of several invoices.
- "price_list": a vendor price sheet or quotation. Prices with no quantities ordered and no amount owed.
- "portal_export": a CSV, spreadsheet or PDF pulled out of a distributor portal (Sysco/MOXē, Dot, Provi and the like). Machine-laid-out columns, often several documents' worth of rows, and usually an export header or a filename banner rather than a letterhead.
- "purchase_order": what WE asked for, before anything shipped.
- "informal_note": a handwritten slip, a photographed scrap of paper, or a note from an unregistered supplier (a farmer, a market stall). It is a legally normal transaction, not a broken document — classify it as itself so it does not sit in review ageing.
- "unknown": anything else. Use this when you genuinely cannot tell; do not stretch one of the eleven to fit.

A document with no prices is almost certainly a packing_slip or a delivery_note, NOT an invoice. This distinction matters more than any other field: a shipping document is the distributor's own statement of what shipped, and mislabelling one as an invoice destroys that evidence.

EXTRACT, transcribing only what is printed:
- docNumber (invoice/slip number), docDate (ISO), poNumber, referencesDocNumber (an invoice a credit memo adjusts, or the packing slip an invoice bills)
- vendorName
- header money: subtotal, freight, fuelSurcharge, splitCaseFee, deliveryFee, depositTotal, tax, otherCharges, discountTotal, total
- lines: vendorSku, description, vintage, formatMl, qty, uom, packSize (bottles per case), unitPrice, priceBaseQty, priceBaseUom, lineTotal, allowance, deposit

RULES
- Transcribe, never compute. If a line total is not printed, leave it null; do not multiply.
- Never invent a value to make the arithmetic work. A document that does not add up must come back not adding up — that is a signal, and smoothing it over hides the error we exist to catch.
- uom is one of: bottle, case, keg, pack, split_case, each, liter. Use what the document says.
- packSize is bottles per case when stated (a "12/750ml" case is packSize 12). Null if not stated — do not assume 12.
- priceBaseQty / priceBaseUom are the quantity the UNIT PRICE is stated for, and its unit — ONLY when the document prints it. "142,00 / KS(12)" is priceBaseQty 12, priceBaseUom "bottle"; "22.00 / BT" is priceBaseQty 1, priceBaseUom "bottle". Null if not stated — do not assume 12, exactly as for packSize. Getting this wrong is a factor-of-twelve error on the line.
- Free goods: only set a line's allowance/zero price if the document itself says so.
- Money as plain numbers, no currency symbols or thousands separators.
- "printed": alongside each line and alongside the document totals, return the LITERAL text the page shows for money and quantity fields, exactly as printed — keep the vendor's own grouping and decimal marks ("1.704,00" stays "1.704,00", "142,00 / KS(12)" stays whole). Line keys: qty, unitPrice, lineTotal, allowance, deposit. Document keys: subtotal, tax, freight, total. Omit a key you did not read; never write "" and never rewrite the number into our format.
- Anything illegible: null, and say so in "unreadable".

OUTPUT only valid JSON:
{"docType":"invoice","docNumber":null,"docDate":null,"poNumber":null,"referencesDocNumber":null,"vendorName":null,"currency":"USD","subtotal":null,"freight":null,"fuelSurcharge":null,"splitCaseFee":null,"deliveryFee":null,"depositTotal":null,"tax":null,"otherCharges":null,"discountTotal":null,"total":null,"printed":{},"lines":[{"vendorSku":null,"description":null,"vintage":null,"formatMl":null,"qty":0,"uom":"bottle","packSize":null,"unitPrice":null,"priceBaseQty":null,"priceBaseUom":null,"lineTotal":null,"allowance":null,"deposit":null,"printed":{}}],"unreadable":[]}`;

/**
 * The fence-stripping `normalize` applies before `JSON.parse`.
 *
 * Exported so a caller that wants to say WHY a body did not parse — the
 * extraction door's 422 — can run the SAME preprocessing this parser runs.
 * Duplicating the regex there would eventually let a body the door rejects be
 * one `normalize` would have accepted, and vice versa.
 */
export function stripJsonFence(rawText: string): string {
  return rawText.replace(/^```json\s*|\s*```$/g, "").trim();
}

type MediaType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "application/pdf";

@Injectable()
export class DocumentExtractorService {
  private readonly logger = new Logger(DocumentExtractorService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly modelClient: ModelClientService,
    private readonly nfVerdicts: NfVerdictService,
  ) {}

  private model(): string {
    return (
      this.configService.get<string>("DOCUMENT_EXTRACTION_MODEL") ||
      "claude-haiku-4-5"
    );
  }

  available(): boolean {
    return !!this.configService.get<string>("ANTHROPIC_API_KEY");
  }

  /**
   * Read a document image or PDF into a ParsedDocument.
   * Throws only on transport failure; a document it cannot understand comes back
   * as docType "unknown" with warnings, because a human can still act on that.
   */
  async extract(
    base64: string,
    declaredMime?: string | null,
    restaurantId?: string | null,
  ): Promise<ParsedDocument> {
    const apiKey = this.configService.get<string>("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

    const mediaType = this.detectMediaType(base64, declaredMime);

    // PDFs go in a `document` block and images in an `image` block. Sending a
    // PDF as an image is rejected outright, which would silently route every
    // emailed invoice — the most common format a distributor sends — to failure.
    const content =
      mediaType === "application/pdf"
        ? [
            {
              type: "document",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            { type: "text", text: "Classify and extract this document." },
          ]
        : [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            { type: "text", text: "Classify and extract this document." },
          ];

    // P1 NF-A: model client owns transport + emission. This fetch previously
    // had NO timeout; 120s matches the comparably sized vendor-page extraction
    // (same model, same 8192-token budget, vision payload). HTTP failures
    // throw as `Anthropic <status>: <detail>` — the exact message the old
    // inline throw produced, so callers see nothing new.
    // OD-59: this call grades itself. The ref carries the NF row id back once
    // the (fire-and-forget) emit lands, so the verdict below can attach to it
    // without the extraction ever waiting on the instrument.
    const eventRef = new NfEventRef();

    const payload: any = await this.modelClient.call({
      body: {
        model: this.model(),
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      },
      timeoutMs: 120_000,
      nf: {
        subjectId: "DocumentExtractor",
        taskType: "document_extraction",
        stimulus: "procurement_doc",
        choice: "parsed_document",
        restaurantId: restaurantId ?? null,
        context: { media_type: mediaType },
        eventRef,
      },
    });

    const text =
      (payload.content || []).find((b: any) => b.type === "text")?.text ?? "{}";

    const doc = this.normalize(text, this.model());

    // The tie-out is already computed by `normalize`; this only carries it into
    // the footprint as a task-level verdict. `null` means this grader has no
    // standing to judge (not an invoice) — no row, and the event reads as
    // ungraded rather than as a pass.
    const verdict = reconciliationVerdict(doc);
    if (verdict)
      this.nfVerdicts.record(eventRef, RECONCILIATION_BASIS, verdict);

    // ADR 0059 (L6). Carry the footprint row id out with the document so the
    // extraction can be attributed to the call that produced it.
    //
    // BOUNDED, not a plain await. `emit` is fire-and-forget precisely so that
    // "emission latency never rides a user path" (model-client.service.ts:326),
    // and the ref settles only when that background insert finishes. Awaiting it
    // outright would hand the instrument the power to hang the extraction it is
    // measuring — the exact inversion this module's own comments forbid. So:
    // wait briefly, then give up and record no attribution. A missing event_id
    // costs gradability; a hung request costs the delivery.
    doc.eventId = await settledEventId(eventRef);

    return doc;
  }

  /**
   * Turn the model's JSON into a ParsedDocument.
   * Exported behaviour is deliberately forgiving about shape and strict about
   * meaning: a missing field becomes null, but a value that cannot be trusted
   * becomes a warning rather than a quiet default.
   */
  normalize(rawText: string, model: string): ParsedDocument {
    const warnings: string[] = [];
    let parsed: any = {};
    try {
      parsed = JSON.parse(stripJsonFence(rawText));
    } catch {
      // A model that returned prose instead of JSON has told us nothing usable.
      // Returning an empty invoice here would read downstream as a vendor who
      // billed nothing, so it comes back explicitly unknown.
      return applyTieOut({
        docType: "unknown",
        docNumber: null,
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
        confidence: 0,
        warnings: ["The extractor did not return readable JSON."],
        // A model DID run and DID answer — badly. Recording which one is the
        // whole point on this branch: an unattributed failure cannot be
        // compared against the same model's successes (ADR 0059).
        extractionModel: model,
      });
    }

    const docType = this.coerceDocType(parsed.docType, warnings);

    const lines: ParsedLine[] = Array.isArray(parsed.lines)
      ? parsed.lines.map((l: any, i: number) => {
          const rawUom = l?.uom ? String(l.uom) : null;
          const uom = normalizeUom(rawUom);
          if (rawUom && !uom)
            warnings.push(
              `Line ${i + 1}: unrecognised unit "${rawUom}" — quantity left unconverted.`,
            );
          const resolved: Uom = uom ?? "each";
          const qty = num(l?.qty) ?? 0;
          const packSize = Math.max(1, Math.round(num(l?.packSize) ?? 1));

          // BT-149/BT-150. Only what the page printed: `priceBaseQty` stays
          // NULL when the model did not read one, exactly as `packSize` does,
          // because a guessed base of 12 is a factor-of-twelve error on the
          // line. An unreadable base UNIT is refused rather than defaulted to
          // `bottle` for the same reason `normalizeUom` refuses elsewhere.
          const priceBaseQty = num(l?.priceBaseQty);
          const rawBaseUom = l?.priceBaseUom ? String(l.priceBaseUom) : null;
          const priceBaseUom = normalizeUom(rawBaseUom);
          if (rawBaseUom && !priceBaseUom)
            warnings.push(
              `Line ${i + 1}: unrecognised price base unit "${rawBaseUom}" — the printed price basis was not applied.`,
            );

          return {
            lineNo: i + 1,
            vendorSku: str(l?.vendorSku),
            description: str(l?.description),
            vintage: int(l?.vintage),
            formatMl: int(l?.formatMl),
            qty,
            uom: resolved,
            packSize,
            qtyBottles: toBottles(qty, resolved, packSize),
            // Never inferred from a photograph. Netting quantity out of the
            // billable comparison on a model's guess would hide a real overbill.
            freeGoodsQty: 0,
            unitPrice: num(l?.unitPrice),
            priceBaseQty,
            priceBaseUom,
            lineTotal: num(l?.lineTotal),
            allowance: num(l?.allowance),
            deposit: num(l?.deposit),
            ...spreadPrinted(l?.printed),
            poNumber: str(parsed.poNumber),
          };
        })
      : [];

    if (Array.isArray(parsed.unreadable) && parsed.unreadable.length)
      warnings.push(
        `Unreadable on the document: ${parsed.unreadable.slice(0, 5).join("; ")}`,
      );

    if (docType === "invoice" && lines.every((l) => l.unitPrice == null))
      warnings.push(
        "Classified as an invoice but no line carries a price — it may actually be a packing slip.",
      );

    const doc: ParsedDocument = {
      docType,
      docNumber: str(parsed.docNumber),
      docDate: str(parsed.docDate),
      referencesDocNumber: str(parsed.referencesDocNumber),
      poNumber: str(parsed.poNumber),
      vendorName: str(parsed.vendorName),
      vendorAccount: null,
      currency: str(parsed.currency) ?? "USD",
      subtotal: num(parsed.subtotal),
      freight: num(parsed.freight),
      fuelSurcharge: num(parsed.fuelSurcharge),
      splitCaseFee: num(parsed.splitCaseFee),
      deliveryFee: num(parsed.deliveryFee),
      depositTotal: num(parsed.depositTotal),
      tax: num(parsed.tax),
      otherCharges: num(parsed.otherCharges),
      discountTotal: num(parsed.discountTotal),
      total: num(parsed.total),
      lines,
      ...spreadPrinted(parsed.printed),
      computedLinesTotal: null,
      tieOutDelta: null,
      tiesOut: null,
      // Deliberately lower than the EDI parsers' ceiling. EDI is structured data
      // straight from the source system; this is a model reading a photograph
      // that may have been taken in a stairwell, and the confidence should say so.
      confidence: Math.max(0.1, 0.8 - warnings.length * 0.1),
      warnings,
      // ADR 0059 (L5). The value was already in hand — `model` is this
      // function's own parameter and has been logged on the line below since
      // the spine shipped. It simply never reached the insert, so
      // `extraction_model` was NULL on every row that ever existed.
      extractionModel: model,
    };

    const withTieOut = applyTieOut(doc);
    if (withTieOut.tiesOut === false)
      // The arithmetic broke, which is the strongest signal available that a
      // number was misread. Drop confidence hard so it sorts to the top of the
      // review queue rather than sitting mid-list looking ordinary.
      withTieOut.confidence = Math.min(withTieOut.confidence, 0.35);

    this.logger.debug(
      `extracted ${withTieOut.docType} via ${model}: ${withTieOut.lines.length} lines, ties out ${withTieOut.tiesOut}`,
    );
    return withTieOut;
  }

  /**
   * File the model's answer against the ONE vocabulary (`DOC_TYPES`).
   *
   * Derived from `DOC_TYPES` rather than repeating a list, because the two
   * copies drifted: `DOC_TYPES` and the CHECK constraint carried twelve while
   * this carried six, so an irsaliye the model classified correctly as
   * `delivery_note` was thrown away and refiled as `unknown` — an absence
   * reported as a classification.
   *
   * `unknown` stays a value the model may return AND the fallback for anything
   * outside the vocabulary. Widening the list must never make an unrecognised
   * label into a confident guess, so the warning survives untouched.
   */
  private coerceDocType(value: unknown, warnings: string[]): DocType {
    const v = String(value ?? "").toLowerCase();
    if ((DOC_TYPES as readonly string[]).includes(v)) return v as DocType;
    warnings.push(
      `Document type "${value ?? "(none)"}" was not recognised; filed as unknown for a human to classify.`,
    );
    return "unknown";
  }

  private detectMediaType(base64: string, declared?: string | null): MediaType {
    const d = (declared || "").toLowerCase();
    if (d.includes("pdf")) return "application/pdf";
    if (d.includes("png")) return "image/png";
    if (d.includes("webp")) return "image/webp";
    if (d.includes("gif")) return "image/gif";
    if (d.includes("jpeg") || d.includes("jpg")) return "image/jpeg";

    // Fall back to magic bytes: a declared content-type from an email header is
    // frequently wrong or absent, and the file itself does not lie.
    if (base64.startsWith("JVBERi")) return "application/pdf"; // %PDF
    if (base64.startsWith("/9j/")) return "image/jpeg";
    if (base64.startsWith("iVBORw")) return "image/png";
    if (base64.startsWith("UklGR")) return "image/webp";
    if (base64.startsWith("R0lGOD")) return "image/gif";
    return "image/jpeg";
  }
}

/** Number or null. Rejects NaN and strips currency noise the prompt asked not to send. */
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n =
    typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.round(n);
}

/**
 * The model's `printed` map, kept as text and NOTHING ELSE.
 *
 * Returned as a spreadable object so an ABSENT map stays absent on the line
 * rather than becoming `{}` — `{}` would read as "the paper printed nothing",
 * which is the opposite of "we did not keep it" (ADR 0067's distinction).
 *
 * Values are never trimmed, cased, re-grouped or re-pointed: `1.704,00` must
 * still be `1.704,00` when the screen shows it beside our 1704. Entries that are
 * empty or whitespace-only are DROPPED rather than stored, because an empty
 * `as_printed` beside a real value is what the `as_printed_not_mutated`
 * invariant exists to catch.
 */
function spreadPrinted(v: unknown): { printed?: Record<string, string> } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (typeof raw !== "string" || raw.trim() === "") continue;
    out[k] = raw;
  }
  return Object.keys(out).length ? { printed: out } : {};
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length && s.toLowerCase() !== "null" ? s : null;
}
