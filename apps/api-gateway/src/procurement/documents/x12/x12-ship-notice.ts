import { normalizeUom, toBottles, Uom } from "../document-types";
import { applyTieOut, ParsedDocument, ParsedLine } from "../parsed-document";
import {
  el,
  real,
  X12Delimiters,
  X12Transaction,
  x12Date,
} from "./x12-envelope";

/**
 * EDI 856 — Advance Ship Notice. The electronic packing slip.
 *
 * This is the most valuable document the system can receive, and it carries no
 * prices at all. Its worth is evidentiary: it is the DISTRIBUTOR'S OWN statement
 * of what left their warehouse. When their 856 says 22 and their 810 bills 24,
 * the overbill is proven by their paperwork and there is nothing for their AR
 * desk to dispute. Every other discrepancy is our count against their word.
 *
 * Structure is hierarchical rather than flat, which is the thing that catches
 * people out. HL segments form a tree — Shipment > Order > Pack > Item — and an
 * item does not restate the purchase order it belongs to. The PO number lives on
 * the ancestor order level, so parsing HLs as a flat list loses the link between
 * a shipped line and the order it fulfils, and every line arrives orphaned.
 *
 *   BSN  shipment id (02), date (03)
 *   HL   id (01), parent id (02), level code (03): S shipment, O order, P pack, I item
 *   PRF  purchase order number (01) — appears at the ORDER level
 *   LIN  product identification, qualifier/value pairs from element 02
 *   SN1  shipped quantity (02) and unit (03) — the number that matters
 *   PO4  pack detail, where bottles-per-case lives
 *   CTT  HL count, used as a completeness check
 */

interface HlNode {
  id: string;
  parentId: string | null;
  level: string;
  poNumber: string | null;
}

/** Walk up the HL tree to the nearest ancestor carrying a PO number. */
function inheritedPo(
  node: HlNode | undefined,
  nodes: Map<string, HlNode>,
): string | null {
  let cur = node;
  const seen = new Set<string>();
  while (cur) {
    if (cur.poNumber) return cur.poNumber;
    // A malformed file can point a parent at itself or form a cycle; without
    // this guard the parser hangs on a document a human could read at a glance.
    if (seen.has(cur.id)) return null;
    seen.add(cur.id);
    cur = cur.parentId ? nodes.get(cur.parentId) : undefined;
  }
  return null;
}

export function parse856(
  tx: X12Transaction,
  _delimiters: X12Delimiters,
): ParsedDocument {
  const warnings: string[] = [];
  const segs = tx.segments;
  const bsn = segs.find((s) => s.tag === "BSN");

  const refs: Record<string, string> = {};
  for (const s of segs.filter((x) => x.tag === "REF")) {
    const q = el(s, 1);
    const v = el(s, 2);
    if (q && v) refs[q.toUpperCase()] = v;
  }

  const seller = segs.find(
    (s) => s.tag === "N1" && ["SE", "VN", "SU", "SF"].includes(el(s, 1) ?? ""),
  );

  const nodes = new Map<string, HlNode>();
  const lines: ParsedLine[] = [];
  let currentNode: HlNode | undefined;
  let openLine: ParsedLine | null = null;
  let lineNo = 0;
  let hlCount = 0;

  for (const seg of segs) {
    switch (seg.tag) {
      case "HL": {
        hlCount++;
        const id = el(seg, 1) ?? String(hlCount);
        const node: HlNode = {
          id,
          parentId: el(seg, 2),
          level: (el(seg, 3) ?? "").toUpperCase(),
          poNumber: null,
        };
        nodes.set(id, node);
        currentNode = node;
        // A new hierarchical level ends the previous item, so a PO4 or PID
        // appearing after it belongs to the new one.
        openLine = null;
        break;
      }

      case "PRF": {
        // Purchase order reference, normally at the order level. Recorded on
        // whichever node is open so descendants can inherit it.
        if (currentNode) currentNode.poNumber = el(seg, 1);
        break;
      }

      case "LIN": {
        const ids: Record<string, string> = {};
        for (let i = 2; i < seg.elements.length; i += 2) {
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
          qty: 0,
          uom: "each",
          packSize: 1,
          qtyBottles: 0,
          freeGoodsQty: 0,
          // A packing slip states no prices. Leaving these null rather than 0 is
          // deliberate: 0 would tie out to a free delivery and quietly zero the
          // cost basis if this document were ever treated as an invoice.
          unitPrice: null,
          // A packing slip carries no price at all, so it carries no price
          // basis either. Absent, not unread.
          priceBaseQty: null,
          priceBaseUom: null,
          lineTotal: null,
          allowance: null,
          deposit: null,
          poNumber: inheritedPo(currentNode, nodes),
        };
        lines.push(openLine);
        break;
      }

      case "SN1": {
        if (!openLine) {
          // SN1 without a preceding LIN still tells us a quantity shipped;
          // dropping it would understate the shipment.
          openLine = {
            lineNo: ++lineNo,
            vendorSku: null,
            description: null,
            vintage: null,
            formatMl: null,
            qty: 0,
            uom: "each",
            packSize: 1,
            qtyBottles: 0,
            freeGoodsQty: 0,
            unitPrice: null,
            priceBaseQty: null,
            priceBaseUom: null,
            lineTotal: null,
            allowance: null,
            deposit: null,
            poNumber: inheritedPo(currentNode, nodes),
          };
          lines.push(openLine);
        }
        const qty = real(el(seg, 2)) ?? 0;
        const rawUom = el(seg, 3);
        const uom = normalizeUom(rawUom);
        if (rawUom && !uom)
          warnings.push(
            `Line ${openLine.lineNo}: unrecognised unit "${rawUom}" — quantity left unconverted.`,
          );
        const resolved: Uom = uom ?? "each";
        openLine.qty = qty;
        openLine.uom = resolved;
        openLine.qtyBottles = toBottles(qty, resolved, openLine.packSize);
        break;
      }

      case "PO4": {
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
        if (openLine && !openLine.description)
          openLine.description = el(seg, 5) ?? el(seg, 4);
        break;
      }

      case "CTT": {
        const stated = real(el(seg, 1));
        if (stated != null && stated !== hlCount)
          warnings.push(
            `CTT says ${stated} hierarchical levels but ${hlCount} were parsed — the file may be truncated.`,
          );
        break;
      }
    }
  }

  const orphaned = lines.filter((l) => !l.poNumber).length;
  if (orphaned && orphaned === lines.length && lines.length > 0)
    warnings.push(
      "No purchase order reference found on any line — this shipment will need linking to an order by hand.",
    );

  const doc: ParsedDocument = {
    docType: "packing_slip",
    docNumber: el(bsn, 2) ?? refs.SI ?? null,
    docDate: x12Date(el(bsn, 3)),
    // The 810 that bills this shipment will cite this number back at us; that
    // reference is how documents self-assemble into a delivery.
    referencesDocNumber: refs.BM ?? null,
    poNumber: lines.find((l) => l.poNumber)?.poNumber ?? refs.PO ?? null,
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
    // A packing slip has no monetary total, and asserting 0 would make it tie
    // out to a free delivery.
    total: null,
    lines,
    computedLinesTotal: null,
    tieOutDelta: null,
    tiesOut: null,
    confidence: Math.max(0.4, 0.97 - warnings.length * 0.08),
    warnings,
  };

  return applyTieOut(doc);
}
