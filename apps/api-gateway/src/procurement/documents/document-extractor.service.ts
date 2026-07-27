import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { normalizeUom, toBottles, Uom } from "./document-types";
import { applyTieOut, ParsedDocument, ParsedLine } from "./parsed-document";
import { DocType } from "./document-types";

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

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You are reading a beverage distributor's delivery paperwork for a restaurant's back office.

CLASSIFY the document first. It is one of:
- "invoice": states prices and an amount owed.
- "packing_slip": lists what shipped, usually WITHOUT prices. Often titled packing slip, delivery note, or ASN.
- "credit_memo": a credit or adjustment against an earlier invoice.
- "delivery_receipt": a signature/proof-of-delivery sheet with little or no line detail.
- "statement": a period roll-up of several invoices.
- "unknown": anything else.

A document with no prices is almost certainly a packing slip, NOT an invoice. This distinction matters more than any other field: a packing slip is the distributor's own statement of what shipped, and mislabelling one as an invoice destroys that evidence.

EXTRACT, transcribing only what is printed:
- docNumber (invoice/slip number), docDate (ISO), poNumber, referencesDocNumber (an invoice a credit memo adjusts, or the packing slip an invoice bills)
- vendorName
- header money: subtotal, freight, fuelSurcharge, splitCaseFee, deliveryFee, depositTotal, tax, otherCharges, discountTotal, total
- lines: vendorSku, description, vintage, formatMl, qty, uom, packSize (bottles per case), unitPrice, lineTotal, allowance, deposit

RULES
- Transcribe, never compute. If a line total is not printed, leave it null; do not multiply.
- Never invent a value to make the arithmetic work. A document that does not add up must come back not adding up — that is a signal, and smoothing it over hides the error we exist to catch.
- uom is one of: bottle, case, keg, pack, split_case, each, liter. Use what the document says.
- packSize is bottles per case when stated (a "12/750ml" case is packSize 12). Null if not stated — do not assume 12.
- Free goods: only set a line's allowance/zero price if the document itself says so.
- Money as plain numbers, no currency symbols or thousands separators.
- Anything illegible: null, and say so in "unreadable".

OUTPUT only valid JSON:
{"docType":"invoice","docNumber":null,"docDate":null,"poNumber":null,"referencesDocNumber":null,"vendorName":null,"currency":"USD","subtotal":null,"freight":null,"fuelSurcharge":null,"splitCaseFee":null,"deliveryFee":null,"depositTotal":null,"tax":null,"otherCharges":null,"discountTotal":null,"total":null,"lines":[{"vendorSku":null,"description":null,"vintage":null,"formatMl":null,"qty":0,"uom":"bottle","packSize":null,"unitPrice":null,"lineTotal":null,"allowance":null,"deposit":null}],"unreadable":[]}`;

type MediaType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "application/pdf";

@Injectable()
export class DocumentExtractorService {
  private readonly logger = new Logger(DocumentExtractorService.name);

  constructor(private readonly configService: ConfigService) {}

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

    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model(),
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 300)}`);
    }

    const payload: any = await res.json();
    const text =
      (payload.content || []).find((b: any) => b.type === "text")?.text ?? "{}";

    return this.normalize(text, this.model());
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
      parsed = JSON.parse(rawText.replace(/^```json\s*|\s*```$/g, "").trim());
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
            lineTotal: num(l?.lineTotal),
            allowance: num(l?.allowance),
            deposit: num(l?.deposit),
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
      computedLinesTotal: null,
      tieOutDelta: null,
      tiesOut: null,
      // Deliberately lower than the EDI parsers' ceiling. EDI is structured data
      // straight from the source system; this is a model reading a photograph
      // that may have been taken in a stairwell, and the confidence should say so.
      confidence: Math.max(0.1, 0.8 - warnings.length * 0.1),
      warnings,
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

  private coerceDocType(value: unknown, warnings: string[]): DocType {
    const v = String(value ?? "").toLowerCase();
    const known: DocType[] = [
      "invoice",
      "packing_slip",
      "delivery_receipt",
      "credit_memo",
      "statement",
      "purchase_order",
    ];
    if ((known as string[]).includes(v)) return v as DocType;
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

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length && s.toLowerCase() !== "null" ? s : null;
}
