import { normalizeUom, toBottles, Uom } from "../document-types";
import { applyTieOut, ParsedDocument, ParsedLine } from "../parsed-document";
import {
  el,
  n2,
  real,
  X12Delimiters,
  X12Segment,
  X12Transaction,
  x12Date,
} from "./x12-envelope";

/**
 * EDI 810 — Invoice. What the distributor says we owe.
 *
 * Segments that carry meaning here:
 *   BIG  invoice date (01), invoice number (02), PO date (03), PO number (04)
 *   REF  cross-references; IV invoice, PO purchase order, VN vendor order
 *   N1   parties; SE/VN is the seller, which is the name a human recognises
 *   IT1  a billed line: qty (02), unit (03), unit price (04), then
 *        qualifier/value product-id PAIRS from element 06 onward
 *   PO4  pack detail — where bottles-per-case actually lives
 *   PID  free-form description
 *   SAC  allowance or charge: freight, fuel surcharge, split-case fee
 *   TDS  invoice total — IMPLIED TWO DECIMALS
 *   CTT  line count, used as a completeness check
 */

/**
 * SAC02 service codes we are confident about. Everything else lands in
 * otherCharges WITH a warning naming the code, rather than being guessed into
 * freight — a charge filed under the wrong heading still ties out, so the error
 * would never surface, and freight specifically gets allocated into landed cost.
 * Better to leave it unclassified and visible.
 */
const SAC_FREIGHT = new Set(["D240", "D245", "D500"]);
const SAC_TAX = new Set(["H850"]);

/** Description hints for charges whose service code we do not recognise. */
function classifyChargeByText(text: string | null): keyof ChargeBuckets | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (t.includes("fuel")) return "fuelSurcharge";
  if (t.includes("split") && t.includes("case")) return "splitCaseFee";
  if (t.includes("freight")) return "freight";
  if (t.includes("deliver")) return "deliveryFee";
  if (t.includes("deposit")) return "depositTotal";
  if (t.includes("tax")) return "tax";
  return null;
}

interface ChargeBuckets {
  freight: number;
  fuelSurcharge: number;
  splitCaseFee: number;
  deliveryFee: number;
  depositTotal: number;
  tax: number;
  otherCharges: number;
  discountTotal: number;
}

/** Product-id pairs start at IT106 and repeat: qualifier, value, qualifier, value... */
function productIds(seg: X12Segment): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 6; i < seg.elements.length; i += 2) {
    const q = el(seg, i);
    const v = el(seg, i + 1);
    if (q && v) out[q.toUpperCase()] = v;
  }
  return out;
}

export function parse810(
  tx: X12Transaction,
  _delimiters: X12Delimiters,
): ParsedDocument {
  const warnings: string[] = [];
  const segs = tx.segments;
  const big = segs.find((s) => s.tag === "BIG");

  const refs: Record<string, string> = {};
  for (const s of segs.filter((x) => x.tag === "REF")) {
    const q = el(s, 1);
    const v = el(s, 2);
    if (q && v) refs[q.toUpperCase()] = v;
  }

  const seller = segs.find(
    (s) => s.tag === "N1" && ["SE", "VN", "SU"].includes(el(s, 1) ?? ""),
  );

  const charges: ChargeBuckets = {
    freight: 0,
    fuelSurcharge: 0,
    splitCaseFee: 0,
    deliveryFee: 0,
    depositTotal: 0,
    tax: 0,
    otherCharges: 0,
    discountTotal: 0,
  };

  const lines: ParsedLine[] = [];
  let lineNo = 0;
  // SAC and PO4 attach to the IT1 above them when inside the detail loop, and to
  // the invoice as a whole before any IT1. Tracking the open line is what keeps
  // a per-line split-case fee from being counted as an invoice-level charge.
  let openLine: ParsedLine | null = null;

  for (const seg of segs) {
    switch (seg.tag) {
      case "IT1": {
        const qty = real(el(seg, 2)) ?? 0;
        const rawUom = el(seg, 3);
        const uom = normalizeUom(rawUom);
        if (rawUom && !uom)
          warnings.push(
            `Line ${lineNo + 1}: unrecognised unit "${rawUom}" — quantity left unconverted.`,
          );
        const resolvedUom: Uom = uom ?? "each";
        const ids = productIds(seg);

        openLine = {
          lineNo: ++lineNo,
          vendorSku: ids.VN ?? ids.VP ?? ids.UP ?? ids.BP ?? null,
          description: null,
          vintage: null,
          formatMl: null,
          qty,
          uom: resolvedUom,
          packSize: 1,
          qtyBottles: toBottles(qty, resolvedUom, 1),
          freeGoodsQty: 0,
          // IT104 is type R — an explicit decimal. Running it through n2()
          // would divide every unit price by one hundred.
          unitPrice: real(el(seg, 4)),
          // EDI states a unit price against IT102/IT103 and prints no
          // separate price basis, so BT-149/BT-150 are genuinely absent here
          // rather than unread.
          priceBaseQty: null,
          priceBaseUom: null,
          lineTotal: null,
          allowance: null,
          deposit: null,
          poNumber: null,
        };
        lines.push(openLine);
        break;
      }

      case "PO4": {
        // Pack detail: PO401 is units per pack. This is where bottles-per-case
        // comes from, and without it a case line stays a case line and the
        // split-case false alarm returns.
        if (openLine) {
          const pack = real(el(seg, 1));
          if (pack && pack >= 1) {
            openLine.packSize = Math.round(pack);
            openLine.qtyBottles = toBottles(
              openLine.qty,
              openLine.uom,
              openLine.packSize,
            );
          }
        }
        break;
      }

      case "PID": {
        if (openLine && !openLine.description) {
          openLine.description = el(seg, 5) ?? el(seg, 4);
        }
        break;
      }

      case "SAC": {
        // SAC01: A = allowance (reduces what we owe), C = charge (increases it).
        const indicator = (el(seg, 1) ?? "").toUpperCase();
        const code = (el(seg, 2) ?? "").toUpperCase();
        // SAC05 is type N2 — implied decimals. "1250" is $12.50.
        const amount = n2(el(seg, 5)) ?? 0;
        const description = el(seg, 15);
        if (!amount) break;

        if (indicator === "A") {
          // An allowance on a line is a post-off or depletion allowance: a
          // negotiated discount, not an error, and it must not read as one.
          if (openLine) openLine.allowance = (openLine.allowance ?? 0) + amount;
          else charges.discountTotal += amount;
          break;
        }

        const bucket =
          (SAC_FREIGHT.has(code) ? "freight" : null) ??
          (SAC_TAX.has(code) ? "tax" : null) ??
          classifyChargeByText(description);

        if (bucket) charges[bucket] += amount;
        else {
          charges.otherCharges += amount;
          if (code)
            warnings.push(
              `Charge code ${code}${description ? ` ("${description}")` : ""} is not mapped; counted under other charges.`,
            );
        }
        break;
      }

      case "TXI": {
        const amt = real(el(seg, 2));
        if (amt) charges.tax += amt;
        break;
      }

      case "CTT": {
        const stated = real(el(seg, 1));
        if (stated != null && stated !== lines.length)
          warnings.push(
            `CTT says ${stated} line items but ${lines.length} were parsed — the file may be truncated.`,
          );
        break;
      }
    }
  }

  // Line totals: prefer stated, else qty x price less any allowance.
  for (const l of lines) {
    if (l.lineTotal == null && l.unitPrice != null) {
      l.lineTotal =
        Math.round((l.unitPrice * l.qty - (l.allowance ?? 0)) * 100) / 100;
    }
    if (l.unitPrice === 0 && l.qty > 0) {
      // Deliberately NOT inferred as free goods. Netting quantity out of the
      // billable comparison on a guess would mask a genuine overbill, which is
      // the error that costs money; a human confirming a deal costs a click.
      warnings.push(
        `Line ${l.lineNo} is billed at zero — confirm whether it is agreed free goods before accepting.`,
      );
    }
  }

  const doc: ParsedDocument = {
    docType: "invoice",
    // BIG02 is the invoice number. Reading BIG01 here would put the date in it.
    docNumber: el(big, 2) ?? refs.IV ?? null,
    docDate: x12Date(el(big, 1)),
    referencesDocNumber: refs.BM ?? refs.SI ?? null,
    poNumber: el(big, 4) ?? refs.PO ?? null,
    vendorName: el(seller, 2),
    vendorAccount: refs.VN ?? null,
    currency:
      el(
        segs.find((s) => s.tag === "CUR"),
        2,
      ) ?? "USD",
    subtotal: null,
    freight: charges.freight || null,
    fuelSurcharge: charges.fuelSurcharge || null,
    splitCaseFee: charges.splitCaseFee || null,
    deliveryFee: charges.deliveryFee || null,
    depositTotal: charges.depositTotal || null,
    tax: charges.tax || null,
    otherCharges: charges.otherCharges || null,
    discountTotal: charges.discountTotal || null,
    // TDS01 is type N2 — implied decimals. Read as a plain number, a $528.00
    // invoice becomes $52,800 and ties out against nothing.
    total: n2(
      el(
        segs.find((s) => s.tag === "TDS"),
        1,
      ),
    ),
    lines,
    computedLinesTotal: null,
    tieOutDelta: null,
    tiesOut: null,
    // EDI is structured data from the source system, so a clean parse is
    // high-confidence in a way an image extraction never is. Warnings pull it
    // down so a human triages the doubtful ones first.
    confidence: Math.max(0.4, 0.97 - warnings.length * 0.08),
    warnings,
  };

  return applyTieOut(doc);
}
