import { normalizeUom, toBottles, Uom } from "../document-types";
import { applyTieOut, ParsedDocument, ParsedLine } from "../parsed-document";
import {
  el,
  n2,
  real,
  X12Delimiters,
  X12Transaction,
  x12Date,
} from "./x12-envelope";

/**
 * EDI 812 — Credit/Debit Adjustment. The credit memo.
 *
 * This is the document that makes the headline metric honest. Until an 812
 * arrives, "dollars recovered" means "dollars we asked for" — and a number on a
 * dashboard that a bookkeeper cannot tie to a vendor statement destroys trust
 * the first time they check, which they always do. A credit is only recovered
 * when the distributor has issued the memo. Everything before that is a claim.
 *
 *   BCD  date (01), adjustment number (02), amount (04, IMPLIED 2 DECIMALS),
 *        credit/debit flag (05), reason code (06), the invoice it adjusts (07)
 *   CDD  per-line adjustment: reason (01), flag (02), quantity credited (03)
 *   IT1  the line being adjusted
 *   REF  cross-references, including the original invoice
 *
 * SIGN CONVENTION. Amounts are stored POSITIVE with `docType` carrying the
 * direction: a credit_memo means money owed back to the restaurant. A debit
 * adjustment — the distributor billing us MORE after the fact, which does happen
 * — is flagged loudly rather than silently subtracted, because a debit that
 * looks like a credit turns an extra charge into apparent recovery, which is the
 * worst possible direction for this error to run.
 */

/** BCD05 / CDD02: C = credit to the buyer, D = debit against the buyer. */
function isDebit(flag: string | null): boolean {
  return (flag ?? "").toUpperCase() === "D";
}

export function parse812(
  tx: X12Transaction,
  _delimiters: X12Delimiters,
): ParsedDocument {
  const warnings: string[] = [];
  const segs = tx.segments;
  const bcd = segs.find((s) => s.tag === "BCD");

  const refs: Record<string, string> = {};
  for (const s of segs.filter((x) => x.tag === "REF")) {
    const q = el(s, 1);
    const v = el(s, 2);
    if (q && v) refs[q.toUpperCase()] = v;
  }

  const seller = segs.find(
    (s) => s.tag === "N1" && ["SE", "VN", "SU"].includes(el(s, 1) ?? ""),
  );

  const debit = isDebit(el(bcd, 5));
  if (debit)
    warnings.push(
      "BCD05 marks this as a DEBIT adjustment — the vendor is charging more, not crediting. It must not count toward recovered dollars.",
    );

  const lines: ParsedLine[] = [];
  let openLine: ParsedLine | null = null;
  let lineNo = 0;

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
        const resolved: Uom = uom ?? "each";

        const ids: Record<string, string> = {};
        for (let i = 6; i < seg.elements.length; i += 2) {
          const q = el(seg, i);
          const v = el(seg, i + 1);
          if (q && v) ids[q.toUpperCase()] = v;
        }

        openLine = {
          lineNo: ++lineNo,
          vendorSku: ids.VN ?? ids.VP ?? ids.UP ?? ids.BP ?? null,
          description: null,
          vintage: null,
          formatMl: null,
          qty,
          uom: resolved,
          packSize: 1,
          qtyBottles: toBottles(qty, resolved, 1),
          freeGoodsQty: 0,
          unitPrice: real(el(seg, 4)),
          // No separate price basis exists in an 812 line; the price is per
          // IT103's unit. Absent, not unread.
          priceBaseQty: null,
          priceBaseUom: null,
          lineTotal: null,
          allowance: null,
          deposit: null,
          poNumber: refs.PO ?? null,
        };
        lines.push(openLine);
        break;
      }

      case "CDD": {
        // Per-line adjustment detail. CDD03 is the quantity actually credited,
        // which can differ from the IT1 quantity when a vendor part-credits a line.
        if (openLine) {
          const creditedQty = real(el(seg, 3));
          if (creditedQty != null) {
            openLine.qty = creditedQty;
            openLine.qtyBottles = toBottles(
              creditedQty,
              openLine.uom,
              openLine.packSize,
            );
          }
          if (isDebit(el(seg, 2)) !== debit)
            warnings.push(
              `Line ${openLine.lineNo} points the opposite way to the header (CDD02 vs BCD05) — review before posting.`,
            );
        }
        break;
      }

      case "PID": {
        if (openLine && !openLine.description)
          openLine.description = el(seg, 5) ?? el(seg, 4);
        break;
      }
    }
  }

  for (const l of lines) {
    if (l.lineTotal == null && l.unitPrice != null)
      l.lineTotal = Math.round(l.unitPrice * l.qty * 100) / 100;
  }

  // BCD04 is type N2. TDS01 is the fallback and is also N2.
  const headerAmount =
    n2(el(bcd, 4)) ??
    n2(
      el(
        segs.find((s) => s.tag === "TDS"),
        1,
      ),
    );

  const doc: ParsedDocument = {
    docType: debit ? "unknown" : "credit_memo",
    docNumber: el(bcd, 2) ?? refs.CM ?? null,
    docDate: x12Date(el(bcd, 1)),
    // BCD07 is the invoice this adjusts. It is the entire point of the document:
    // without it a credit cannot be tied to the claim it settles, and recovery
    // stays unverifiable.
    referencesDocNumber: el(bcd, 7) ?? refs.IV ?? null,
    poNumber: refs.PO ?? null,
    vendorName: el(seller, 2),
    vendorAccount: refs.VN ?? null,
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
    total: headerAmount != null ? Math.abs(headerAmount) : null,
    lines,
    computedLinesTotal: null,
    tieOutDelta: null,
    tiesOut: null,
    confidence: Math.max(0.4, 0.97 - warnings.length * 0.08),
    warnings,
  };

  if (!doc.referencesDocNumber)
    doc.warnings.push(
      "No invoice reference (BCD07) — this credit cannot be matched to the claim it settles without one.",
    );

  return applyTieOut(doc);
}
