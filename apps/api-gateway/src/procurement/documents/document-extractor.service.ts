import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ModelClientService,
  NfEventRef,
} from "../../common/model-client/model-client.service";
import { NfVerdictService } from "../../common/model-client/nf-verdict.service";
import { DOC_TYPES, normalizeUom, toBottles, Uom } from "./document-types";
import {
  applyTieOut,
  CurrencySeen,
  LINE_KINDS,
  LineKind,
  ParsedDocument,
  ParsedLine,
  ParsedTaxBreakdownRow,
} from "./parsed-document";
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
- deliveredDate (ISO) — the date the GOODS WERE DELIVERED, transcribe only if printed
- vendorName
- header money: subtotal, freight, fuelSurcharge, splitCaseFee, deliveryFee, depositTotal, tax, otherCharges, discountTotal, total
- taxBreakdown: one row per printed tax rate — {rate, taxableBase, amount, category}
- lines: vendorSku, description, vintage, formatMl, qty, uom, packSize (bottles per case), unitPrice, priceBaseQty, priceBaseUom, lineTotal, allowance, deposit, lineKind

RULES
- Transcribe, never compute. If a line total is not printed, leave it null; do not multiply.
- "currency": the ISO 4217 alpha-3 the document DENOMINATES its money in, when the document itself says so. Null when it does not say — null is a correct answer and "USD" is not a fallback. A house that has stated its own currency supplies it downstream; a guess here would overwrite that.
- Never invent a value to make the arithmetic work. A document that does not add up must come back not adding up — that is a signal, and smoothing it over hides the error we exist to catch.
- uom is one of: bottle, case, keg, pack, split_case, each, liter. Use what the document says.
- packSize is bottles per case when stated (a "12/750ml" case is packSize 12). Null if not stated — do not assume 12.
- priceBaseQty / priceBaseUom are the quantity the UNIT PRICE is stated for, and its unit — ONLY when the document prints it. "142,00 / KS(12)" is priceBaseQty 12, priceBaseUom "bottle"; "22.00 / BT" is priceBaseQty 1, priceBaseUom "bottle". Null if not stated — do not assume 12, exactly as for packSize. Getting this wrong is a factor-of-twelve error on the line.
- deliveredDate: transcribe only if printed AS A DELIVERY DATE — "DELIVERED Aug 12, 2026", "TESLİM TARİHİ", "Teslim tarihi", or the date printed against a referenced irsaliye when that date is presented as the delivery date. It is NOT docDate: a Turkish invoice is commonly issued days after the despatch it bills. Null when the page prints no delivery date; never copy docDate into it.
- taxBreakdown: one row per rate the document actually prints, {"rate": 20, "taxableBase": 9172.00, "amount": 1834.40, "category": "S"}. "KDV %20 (matrah 9.172,00) 1.834,40" is ONE row; "Sales tax 8.625% on 2,940.00 = 253.58" is ONE row. rate is the percentage as a number (20, 8.625), taxableBase is the amount the rate was applied to (the matrah), amount is the tax it produced. category is the EN 16931 code (S standard, Z zero-rated, E exempt) only if the document states one — null otherwise. Empty array when no rate is printed; do not derive a rate by dividing the tax by a subtotal.
- lineKind: "goods" (default), "deposit" (the line IS a returnable-container deposit or CRV — a "Depozito", "CRV", "bottle deposit" row), or "fee" (the line IS a freight, fuel or delivery charge). A line that IS the deposit gets lineKind "deposit" and NO deposit amount — its own lineTotal is the deposit. The line-level "deposit" field is a DIFFERENT thing: a deposit charged on that line IN ADDITION to its net, e.g. twelve bottles of wine plus a per-bottle crate charge. Never set both on one line.
- Free goods: only set a line's allowance/zero price if the document itself says so.
- Money as plain numbers, no currency symbols or thousands separators.
- "currencySeen": the currency THIS PAGE shows, as EVIDENCE, with where you saw it. {"code": the ISO 4217 alpha-3 if the page prints one ("EUR", "TRY", "USD") else null, "asPrinted": the literal glyph or word exactly as printed ("EUR", "€", "TL", "₺", "Türk Lirası", "$", "£"), "where": the place on the page in a few words ("beside the grand total", "the KDV row", "the column header")}. Null for the whole object when the page shows NO currency anywhere — that is a real answer and you must give it rather than guessing one. Never infer a currency from the vendor's country, the language, or the date format: transcribe only a glyph, code or word that is actually printed.
- "printed": alongside each line and alongside the document totals, return the LITERAL text the page shows for money and quantity fields, exactly as printed — keep the vendor's own grouping and decimal marks ("1.704,00" stays "1.704,00", "142,00 / KS(12)" stays whole). Line keys: qty, unitPrice, lineTotal, allowance, deposit. Document keys: subtotal, tax, freight, total. Omit a key you did not read; never write "" and never rewrite the number into our format.
- Anything illegible: null, and say so in "unreadable".

OUTPUT only valid JSON:
{"docType":"invoice","docNumber":null,"docDate":null,"deliveredDate":null,"poNumber":null,"referencesDocNumber":null,"vendorName":null,"currency":null,"currencySeen":null,"subtotal":null,"freight":null,"fuelSurcharge":null,"splitCaseFee":null,"deliveryFee":null,"depositTotal":null,"tax":null,"otherCharges":null,"discountTotal":null,"total":null,"taxBreakdown":[],"printed":{},"lines":[{"vendorSku":null,"description":null,"vintage":null,"formatMl":null,"qty":0,"uom":"bottle","packSize":null,"unitPrice":null,"priceBaseQty":null,"priceBaseUom":null,"lineTotal":null,"allowance":null,"deposit":null,"lineKind":"goods","printed":{}}],"unreadable":[]}`;

/**
 * The fence-stripping `normalize` applies before `JSON.parse`.
 *
 * Exported so a caller that wants to say WHY a body did not parse — the
 * extraction door's 422 — can run the SAME preprocessing this parser runs.
 * Duplicating the logic there would eventually let a body the door rejects be
 * one `normalize` would have accepted, and vice versa.
 *
 * NO REGEX. This was `/^\`\`\`json\s*|\s*\`\`\`$/g` until CodeQL #1327
 * (`js/polynomial-redos`, high). The second alternative has no anchor at its
 * start, so on a run of whitespace the engine restarts `\s*` at every offset
 * and backtracks the whole run each time — quadratic. Measured on node v22:
 * 200 kB of spaces took 21_833 ms, and `" ".repeat(50_000) + "x"` took
 * 1_702 ms. Harmless while the only caller was a model's own reply; PR #301
 * put a client's request body on the same path, which makes one POST a
 * multi-second stall of the gateway's single event loop.
 *
 * The replacement is character-for-character equivalent to that regex and
 * linear. `\s*` after the opening fence and before the closing one both fall
 * inside the final `.trim()`, so they never needed matching in the first
 * place: what the regex actually decided was only WHETHER each fence was
 * there, and `startsWith`/`endsWith` decide that in one pass.
 */
export function stripJsonFence(rawText: string): string {
  let s = rawText;
  if (s.startsWith("```json")) s = s.slice(7);
  if (s.endsWith("```")) s = s.slice(0, -3);
  return s.trim();
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
    // Keys the `printed` maps offered that `PRINTED_KEYS` does not accept.
    // Collected across every line AND the document so the count below is one
    // sentence, not one per line — but never merely swallowed.
    const droppedPrintedKeys: string[] = [];
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
        // Empty, never `"USD"`. A model that returned prose read nothing, and
        // a document that says "these figures are dollars" on the strength of
        // a failed parse is exactly the claim that put dollar signs on Turkish
        // invoices (founder, 2026-09-06; `invoice-currency.ts`).
        currency: "",
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

          // What the line IS. An unrecognised label falls back to the
          // description sniff rather than to a confident `goods`: a CRV row
          // filed as wine is refundable money inside cost of goods.
          const lineKind = coerceLineKind(
            l?.lineKind,
            str(l?.description),
            i,
            warnings,
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
            // A line that IS the deposit carries no `deposit` amount: its own
            // total is the deposit, and keeping both would add it twice —
            // the `line_net_amount` 360-against-180 failure of 2026-09-04.
            deposit: lineKind === "deposit" ? null : num(l?.deposit),
            lineKind,
            ...spreadPrinted(l?.printed, droppedPrintedKeys),
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

    const docPrinted = spreadPrinted(parsed.printed, droppedPrintedKeys);
    if (droppedPrintedKeys.length)
      warnings.push(
        `Dropped ${droppedPrintedKeys.length} printed field(s) that are not money or quantity: ` +
          `${[...new Set(droppedPrintedKeys)].slice(0, 8).join(", ")}.`,
      );

    const doc: ParsedDocument = {
      docType,
      docNumber: str(parsed.docNumber),
      docDate: str(parsed.docDate),
      // BG-13 / BT-72. NULL when the paper printed no delivery date — never
      // `docDate`, which is the issuance date and can be a week later.
      deliveredDate: str(parsed.deliveredDate),
      referencesDocNumber: str(parsed.referencesDocNumber),
      poNumber: str(parsed.poNumber),
      vendorName: str(parsed.vendorName),
      vendorAccount: null,
      // WHAT THE DOCUMENT SAID, or nothing. The `?? "USD"` that stood here
      // until 2026-09-06 meant a model answering `null` — the correct answer
      // for a page that prints no currency — produced a document denominated
      // in dollars, and `applyCurrencyRules` downstream would then have taken
      // that as the vendor's own statement and never consulted the house.
      currency: str(parsed.currency) ?? "",
      currencySeen: normalizeCurrencySeen(parsed.currencySeen, warnings),
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
      taxBreakdown: normalizeTaxBreakdown(parsed.taxBreakdown, warnings),
      lines,
      ...docPrinted,
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
 * The money and quantity fields whose printed glyphs we keep — the ONLY keys
 * `spreadPrinted` will ever write.
 *
 * These are exactly the fields SYSTEM_PROMPT names for a line and for the
 * document totals. The list is closed on purpose: `printed` is a transcript of
 * the paper's numbers, so a key outside it is not a number we failed to
 * anticipate, it is a key the model was never asked for.
 */
const PRINTED_KEYS = [
  // line
  "qty",
  "uom",
  "packSize",
  "formatMl",
  "unitPrice",
  "priceBaseQty",
  "priceBaseUom",
  "lineTotal",
  "allowance",
  "deposit",
  // document totals
  "subtotal",
  "freight",
  "fuelSurcharge",
  "splitCaseFee",
  "deliveryFee",
  "depositTotal",
  "tax",
  "otherCharges",
  "discountTotal",
  "total",
] as const;

const PRINTED_KEY_SET: ReadonlySet<string> = new Set(PRINTED_KEYS);

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
 *
 * KEYS COME FROM `PRINTED_KEYS`, NEVER FROM THE INPUT. This used to iterate
 * `Object.entries(v)` and write `out[k]`, which CodeQL #1328
 * (`js/remote-property-injection`, high) flags because the key was a
 * user-provided value: harmless while the map could only come from our own
 * model call, and not harmless since PR #301 put
 * `POST /procurement/documents/:id/extraction` on the same path. Walking the
 * allow-list instead of the input makes `__proto__`, `constructor` and
 * `prototype` unreachable as keys by construction rather than by filter, and
 * the result object is `Object.create(null)` so nothing downstream can reach a
 * prototype through it either.
 *
 * Unknown keys are DROPPED AND COUNTED. Silently discarding them would be the
 * absence-as-health fault at its smallest scale: a transcript that lost a
 * field would look identical to one the paper never printed.
 */
function spreadPrinted(
  v: unknown,
  dropped: string[],
): { printed?: Record<string, string> } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const src = v as Record<string, unknown>;
  const out: Record<string, string> = Object.create(null);
  for (const key of PRINTED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const raw = src[key];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    out[key] = raw;
  }
  for (const key of Object.keys(src))
    if (!PRINTED_KEY_SET.has(key)) dropped.push(key);
  return Object.keys(out).length ? { printed: out } : {};
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length && s.toLowerCase() !== "null" ? s : null;
}

/**
 * The model's currency SIGHTING, validated into `CurrencySeen` or into null.
 *
 * Founder, 2026-09-06: the model must state the currency it SEES on the page,
 * with where it saw it, or state that it saw none. Three answers reach here and
 * they are kept apart:
 *
 *   * a well-formed sighting -> recorded, and `applyCurrencyRules` may hold the
 *     money on it (`invoice-currency.ts`);
 *   * `null` / absent -> the model saw none. A real answer, recorded as null.
 *   * a sighting with NO printed literal and no code -> not a sighting at all.
 *     It comes back null WITH a warning, because an object shaped like evidence
 *     that carries none is worse than nothing: it would make "the model looked
 *     and saw a currency" true of a page where it saw nothing.
 *
 * `where` is defaulted to a SENTENCE rather than an empty string when the model
 * omits it, so a screen never prints "seen at" followed by a blank. The default
 * says the location is unrecorded — it never invents one.
 *
 * NOTHING here resolves a glyph to a code. That is `seenCodes`' job, and it is
 * deliberately one function in one file: a second glyph table is how `$` starts
 * meaning `USD` again.
 */
function normalizeCurrencySeen(
  v: unknown,
  warnings: string[],
): CurrencySeen | null {
  if (v == null) return null;
  if (typeof v !== "object" || Array.isArray(v)) {
    warnings.push(
      `The extractor's currencySeen was ${JSON.stringify(v)}, which is not a sighting; no currency evidence was recorded for this document.`,
    );
    return null;
  }
  const raw = v as { code?: unknown; asPrinted?: unknown; where?: unknown };
  const code = str(raw.code);
  const asPrinted = str(raw.asPrinted);
  if (!code && !asPrinted) {
    warnings.push(
      "The extractor returned a currencySeen with neither a code nor a printed literal, so it says nothing about what is on the page; no currency evidence was recorded.",
    );
    return null;
  }
  return {
    code,
    // A sighting with a code but no literal is still a sighting; the code IS
    // what was printed in that case, and saying so beats an empty string.
    asPrinted: asPrinted ?? (code as string),
    where: str(raw.where) ?? "a place on the page the model did not name",
  };
}

/**
 * A returnable deposit or CRV, by the words vendors actually print.
 *
 * The SAME expression as `canonical-invariants.DEPOSIT_WORDS` on purpose, and
 * the reason it is duplicated rather than imported is that the two do opposite
 * jobs: this one CLASSIFIES a line the extractor left unlabelled, the invariant
 * one DETECTS a line nobody classified. Importing the detector into the
 * classifier would make the invariant unable to fail — it would be grading its
 * own input — which is the shape a guard must never have.
 */
const DEPOSIT_DESCRIPTION =
  /\b(crv|deposit|depozito|bottle\s*deposit|container\s*redemption)\b/i;
const FEE_DESCRIPTION =
  /\b(freight|nakliye|kargo|fuel\s*surcharge|delivery\s*fee|split[-\s]*case\s*fee)\b/i;

/**
 * What the line IS, from the model's own label when it gave one.
 *
 * An unlabelled line falls back to the DESCRIPTION rather than to `goods`,
 * because `goods` is the expensive wrong answer: a CRV row filed as wine sits
 * inside BT-106 and inflates beverage cost every month it recurs (ADR 0103 D7).
 * A label outside the vocabulary is a warning, never a silent `goods`.
 */
function coerceLineKind(
  value: unknown,
  description: string | null,
  index: number,
  warnings: string[],
): LineKind {
  const raw = str(value)?.toLowerCase() ?? null;
  if (raw) {
    if ((LINE_KINDS as readonly string[]).includes(raw)) return raw as LineKind;
    warnings.push(
      `Line ${index + 1}: unrecognised lineKind "${raw}" — classified from the description instead.`,
    );
  }
  const d = description ?? "";
  if (DEPOSIT_DESCRIPTION.test(d)) return "deposit";
  if (FEE_DESCRIPTION.test(d)) return "fee";
  return "goods";
}

/**
 * BG-23, from what the page printed.
 *
 * A row is kept only when it carries a RATE and at least one of the two
 * amounts: a row with neither cannot be checked against anything, and keeping
 * it would make `vat_breakdown_present` pass on a breakdown that says nothing.
 * Dropped rows are counted into a warning rather than swallowed.
 *
 * NOTHING HERE TOUCHES `printed`. `PRINTED_KEYS` is a closed allow-list of
 * SCALAR money and quantity fields, and these rows are objects; a breakdown row
 * has no single literal to keep, and widening the allow-list to nested shapes
 * would reopen exactly the key-from-the-input path CodeQL #1328 closed.
 */
function normalizeTaxBreakdown(
  v: unknown,
  warnings: string[],
): ParsedTaxBreakdownRow[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const rows: ParsedTaxBreakdownRow[] = [];
  let dropped = 0;
  for (const raw of v) {
    const row =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const rate = num(row?.rate);
    const taxableBase = num(row?.taxableBase);
    const amount = num(row?.amount);
    const category = str(row?.category);
    if (rate === null || (taxableBase === null && amount === null)) {
      dropped += 1;
      continue;
    }
    rows.push({
      rate,
      taxableBase,
      amount,
      ...(category ? { category } : {}),
    });
  }
  if (dropped)
    warnings.push(
      `Dropped ${dropped} VAT breakdown row(s) that carried no rate, or a rate with neither a base nor a tax amount.`,
    );
  // An EMPTY array is a real answer ("the model looked and the page printed no
  // rate"); `undefined` means the model returned no breakdown field at all.
  return rows;
}
