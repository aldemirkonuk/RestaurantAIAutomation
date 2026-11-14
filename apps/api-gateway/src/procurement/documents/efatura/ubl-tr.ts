import { toBottles, Uom } from "../document-types";
import {
  applyTieOut,
  ParsedDocument,
  ParsedLine,
  ParsedTaxBreakdownRow,
} from "../parsed-document";
import { all, at, parseXml, textAt, XmlElement, XmlRefused } from "./xml-lite";

/**
 * THE E-INVOICE FILE, READ AS WRITTEN (proposal-receipt row 3.3; ADR 0104
 * D14; ADR 0261 W43).
 *
 * A Turkish e-Fatura, e-Arşiv fatura or e-İrsaliye is a UBL-TR 1.2 XML file.
 * Every figure on it is a field, so nothing here is guessed: no model runs,
 * and a field the file does not carry stays null. The printed literal of each
 * money field is kept beside the number (ADR 0104 D1).
 *
 * WHAT THIS DOES NOT DO, said so the screen never implies it:
 * - The file's electronic signature (XAdES in `ext:UBLExtensions`) is NOT
 *   verified. `einvoice.signed` says whether one is present; `signatureChecked`
 *   is always false until a verifier lands.
 * - The GİB QR code on a printed e-Arşiv is not read; a photo still goes to the
 *   model.
 *
 * Money arithmetic follows UBL: a line's `LineExtensionAmount` is already net
 * of its own allowances, so it is the line's total; document-level
 * `AllowanceCharge` elements are the discount and the charges; the total the
 * tie-out checks is `TaxInclusiveAmount` (lines − allowances + charges + tax).
 * `AllowanceTotalAmount` is NOT used: integrators differ on whether it repeats
 * the line discounts, and using it would subtract them twice.
 */

const UBL_ROOTS = new Set(["Invoice", "DespatchAdvice"]);

/** Cheap sniff on the first bytes: an XML file whose root is a UBL paper. */
export function looksLikeUbl(text: string): boolean {
  const head = text.slice(0, 4000).replace(/^﻿/, "");
  if (!/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*</.test(head)) return false;
  return (
    /<([A-Za-z0-9_-]+:)?(Invoice|DespatchAdvice)[\s>]/.test(head) &&
    /urn:oasis:names:specification:ubl:schema:xsd:(Invoice|DespatchAdvice)-2/.test(head)
  );
}

/** UN/ECE Rec 20 unit codes an e-invoice uses, to the units the match counts. */
const UNIT_CODES: Record<string, Uom> = {
  C62: "each",
  NIU: "each",
  H87: "each",
  EA: "each",
  BO: "bottle",
  BTL: "bottle",
  CS: "case",
  CA: "case",
  CT: "case",
  BX: "case",
  CR: "case",
  PK: "pack",
  PA: "pack",
  LTR: "liter",
  LT: "liter",
};

const UNIT_WORDS: Record<string, string> = {
  KGM: "kilogram",
  GRM: "gram",
  MTR: "metre",
  MTK: "square metre",
  MLT: "millilitre",
  CLT: "centilitre",
  DAY: "day",
  HUR: "hour",
  MON: "month",
};

function num(
  el: XmlElement | null,
  field: string,
  warnings: string[],
  printed?: Record<string, string>,
  key?: string,
): number | null {
  const raw = el?.text.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    warnings.push(`The file's ${field} reads "${raw}", which is not a number; it was left empty.`);
    return null;
  }
  if (printed && key) printed[key] = raw;
  return n;
}

function sum(values: Array<number | null>): number | null {
  const kept = values.filter((v): v is number => v != null);
  return kept.length ? Math.round(kept.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}

function partyOf(party: XmlElement | null) {
  if (!party) return { name: null, taxId: null, taxOffice: null, address: null, country: null };
  const ids = all(party, "PartyIdentification");
  const taxIdEl = ids
    .map((p) => at(p, "ID"))
    .find((id) => /^(VKN|TCKN)$/i.test(id?.attrs.schemeID ?? ""));
  const person = at(party, "Person");
  const personName = person
    ? [textAt(person, "FirstName"), textAt(person, "FamilyName")].filter(Boolean).join(" ")
    : "";
  const addr = at(party, "PostalAddress");
  const countryName = textAt(addr, "Country/Name");
  const countryCode = textAt(addr, "Country/IdentificationCode");
  const address = addr
    ? [
        textAt(addr, "StreetName"),
        textAt(addr, "BuildingNumber"),
        textAt(addr, "CitySubdivisionName"),
        textAt(addr, "CityName"),
        textAt(addr, "PostalZone"),
        countryName,
      ]
        .filter(Boolean)
        .join(", ") || null
    : null;
  return {
    name: textAt(party, "PartyName/Name") ?? (personName || null),
    taxId: taxIdEl?.text.trim() || null,
    taxOffice: textAt(party, "PartyTaxScheme/TaxScheme/Name"),
    address,
    // The address wins when it names a country. Otherwise a VKN/TCKN is a Turkish
    // scheme by definition, so the number itself says "TR"; leaving it null made the
    // vendor resolver refuse a bare 10-digit id the reader already knew was Turkish.
    country:
      countryCode && /^[A-Za-z]{2}$/.test(countryCode)
        ? countryCode.toUpperCase()
        : countryName && /t[üu]rkiye|turkey/i.test(countryName)
          ? "TR"
          : taxIdEl
            ? "TR"
            : null,
  };
}

function hasSignature(el: XmlElement): boolean {
  const ext = at(el, "UBLExtensions");
  const walk = (e: XmlElement): boolean =>
    e.name === "Signature" || e.children.some(walk);
  return Boolean(ext && walk(ext)) || all(el, "Signature").length > 0;
}

/**
 * The unit a line counts in, and whether the count can be trusted as stated.
 *
 * `doubt` is true when the line's bottle count is NOT what the file means:
 * - A case or pack code (CS, CA, CT, BX, CR, PK, PA). A UBL-TR line states
 *   the number of cases, never how many are in one, so `packSize` stays 1 —
 *   the house rule for "the paper did not say" (parsed-document.ts, the
 *   price-base check) — and the bottle count equals the case count until a
 *   person sets the pack size on the line. Ten cases of twelve read as ten.
 * - A unit the match does not count in (KGM, GRM, MTR, …) or no unit at all:
 *   the line is filed as items so it can be shown, which is not what it is.
 *
 * The session's call (2026-11-11, under the 2026-11-07 /goal): say it on the
 * paper and lower the paper's confidence, rather than refuse the line.
 * Rejected: refusing the line (the money on it is real, and the tie-out
 * would then fail on a line the file does carry); guessing a pack of 12 (a
 * guessed twelve is wrong by a factor of twelve, ADR 0104 BT-149 note).
 */
function unitOf(
  code: string | undefined,
  lineNo: number,
  warnings: string[],
): { uom: Uom; doubt: boolean } {
  const c = (code ?? "").trim().toUpperCase();
  const known = UNIT_CODES[c];
  if (known === "case" || known === "pack") {
    const word = known === "case" ? "cases" : "packs";
    warnings.push(
      `Line ${lineNo}: the file counts in ${word} (${c}) and does not say how many are in one, so the bottle count is the number of ${word} until a pack size is set on the line. Set it before this paper is booked.`,
    );
    return { uom: known, doubt: true };
  }
  if (known) return { uom: known, doubt: false };
  warnings.push(
    c
      ? `Line ${lineNo}: the file counts in ${UNIT_WORDS[c] ? `${UNIT_WORDS[c]}s (${c})` : `unit code ${c}`}, which is not a unit the match counts; the quantity is left as the file states it, unconverted, and shown as items. Set the unit on the line before this paper is booked.`
      : `Line ${lineNo}: the file states no unit; the quantity is left unconverted and shown as items. Set the unit on the line before this paper is booked.`,
  );
  return { uom: "each", doubt: true };
}

/** The most a paper with a doubtful line's count may claim to be sure of. */
const DOUBTFUL_COUNT_CONFIDENCE = 0.5;

/** Read a UBL-TR file. Throws `XmlRefused` with a sentence when it cannot. */
export function readUblTr(xml: string): ParsedDocument {
  const root = parseXml(xml);
  if (!UBL_ROOTS.has(root.name))
    throw new XmlRefused(
      `The file's top element is <${root.name}>, not an e-invoice (Invoice) or an e-despatch (DespatchAdvice).`,
    );
  const despatch = root.name === "DespatchAdvice";
  const warnings: string[] = [];
  const printed: Record<string, string> = {};

  const profile = textAt(root, "ProfileID");
  const typeCode = textAt(root, despatch ? "DespatchAdviceTypeCode" : "InvoiceTypeCode");
  const ettn = textAt(root, "UUID");
  if (!ettn) warnings.push("The file carries no ETTN (UUID), so it cannot be told apart from a re-sent copy by its number.");

  const isReturn = !despatch && /IADE/i.test(typeCode ?? "");
  if (isReturn)
    warnings.push(
      `This e-invoice is a return (${typeCode}). Check who issued it before it is set against a delivery.`,
    );

  const seller = partyOf(
    at(root, despatch ? "DespatchSupplierParty/Party" : "AccountingSupplierParty/Party"),
  );
  const buyer = partyOf(
    at(root, despatch ? "DeliveryCustomerParty/Party" : "AccountingCustomerParty/Party"),
  );

  const lineEls = despatch ? all(root, "DespatchLine") : all(root, "InvoiceLine");
  // The file's own line numbers, when every line has one and no two share it;
  // otherwise every line is numbered by position, so two lines never share a
  // number (a mix of the two could).
  const fileIds = lineEls.map((le) => Number(textAt(le, "ID")));
  const idsUsable =
    fileIds.every((n) => Number.isInteger(n) && n > 0) &&
    new Set(fileIds).size === fileIds.length;
  if (lineEls.length && !idsUsable)
    warnings.push(
      "The file's line numbers are missing, not numbers, or repeated, so its lines are numbered here by their position.",
    );
  let doubtfulCount = false;
  const lines: ParsedLine[] = lineEls.map((le, i) => {
    const lineNo = idsUsable ? fileIds[i] : i + 1;
    const qtyEl = at(le, despatch ? "DeliveredQuantity" : "InvoicedQuantity");
    const lineWarnings: string[] = [];
    const statedQty = num(qtyEl, `line ${lineNo} quantity`, lineWarnings);
    if (statedQty == null && !qtyEl?.text.trim())
      lineWarnings.push(
        `Line ${lineNo}: the file states no quantity, so it is filed as 0. That is an unread quantity, not a line delivered empty.`,
      );
    if (statedQty == null) doubtfulCount = true;
    const qty = statedQty ?? 0;
    const unit = unitOf(qtyEl?.attrs.unitCode, lineNo, lineWarnings);
    const uom = unit.uom;
    if (unit.doubt) doubtfulCount = true;
    warnings.push(...lineWarnings);
    const linePrinted: Record<string, string> = {};
    if (qtyEl?.text.trim()) linePrinted.qty = `${qtyEl.text.trim()} ${qtyEl.attrs.unitCode ?? ""}`.trim();
    const unitPrice = num(at(le, "Price/PriceAmount"), `line ${lineNo} price`, warnings, linePrinted, "unitPrice");
    const lineTotal = num(at(le, "LineExtensionAmount"), `line ${lineNo} amount`, warnings, linePrinted, "lineTotal");
    const allowances = all(le, "AllowanceCharge").filter(
      (a) => textAt(a, "ChargeIndicator") === "false",
    );
    const allowance = sum(allowances.map((a) => num(at(a, "Amount"), `line ${lineNo} discount`, warnings)));
    if (allowance != null) linePrinted.allowance = String(allowance);
    const baseQty = num(at(le, "Price/BaseQuantity"), `line ${lineNo} price base`, warnings);
    const item = at(le, "Item");
    return {
      lineNo,
      vendorSku:
        textAt(item, "SellersItemIdentification/ID") ??
        textAt(item, "ManufacturersItemIdentification/ID"),
      description: textAt(item, "Name") ?? textAt(item, "Description"),
      qty,
      uom,
      packSize: 1,
      qtyBottles: toBottles(qty, uom, 1),
      freeGoodsQty: 0,
      unitPrice,
      lineTotal,
      allowance,
      lineKind: "goods",
      priceBaseQty: baseQty != null && baseQty !== 1 ? baseQty : null,
      priceBaseUom: null,
      printed: linePrinted,
      poNumber: null,
    };
  });
  if (!lines.length) warnings.push("The file lists no lines.");

  const despatchRefs = all(root, "DespatchDocumentReference")
    .map((d) => textAt(d, "ID"))
    .filter((v): v is string => Boolean(v));

  const base: ParsedDocument = {
    docType: despatch ? "delivery_note" : isReturn ? "credit_memo" : "invoice",
    docNumber: textAt(root, "ID"),
    docDate: textAt(root, "IssueDate"),
    deliveredDate: despatch ? textAt(root, "Shipment/Delivery/ActualDeliveryDate") ?? textAt(root, "ActualDespatchDate") : null,
    referencesDocNumber: textAt(root, "BillingReference/InvoiceDocumentReference/ID"),
    poNumber: textAt(root, "OrderReference/ID"),
    ettn: ettn ? ettn.toLowerCase() : null,
    einvoice: {
      kind: despatch ? "e-irsaliye" : /EARSIV/i.test(profile ?? "") ? "e-arsiv" : "e-fatura",
      profile,
      typeCode,
      signed: hasSignature(root),
      signatureChecked: false,
    },
    despatchRefs,
    vendorName: seller.name,
    vendorTaxId: seller.taxId,
    vendorTaxOffice: seller.taxOffice,
    vendorAddress: seller.address,
    vendorCountry: seller.country,
    buyerName: buyer.name,
    buyerTaxId: buyer.taxId,
    currency: despatch ? "" : (textAt(root, "DocumentCurrencyCode") ?? "").toUpperCase(),
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
    lines,
    computedLinesTotal: null,
    tieOutDelta: null,
    tiesOut: null,
    confidence: 0,
    warnings,
    printed,
    extractionModel: null,
  };

  if (!despatch) {
    const money = at(root, "LegalMonetaryTotal");
    base.subtotal = num(at(money, "LineExtensionAmount"), "lines total", warnings, printed, "subtotal");
    base.total =
      num(at(money, "TaxInclusiveAmount"), "total with tax", warnings, printed, "total") ??
      num(at(money, "PayableAmount"), "amount payable", warnings, printed, "total");
    const docAllowances = all(root, "AllowanceCharge");
    base.discountTotal = sum(
      docAllowances
        .filter((a) => textAt(a, "ChargeIndicator") === "false")
        .map((a) => num(at(a, "Amount"), "document discount", warnings)),
    );
    base.otherCharges = sum(
      docAllowances
        .filter((a) => textAt(a, "ChargeIndicator") === "true")
        .map((a) => num(at(a, "Amount"), "document charge", warnings)),
    );
    const taxTotals = all(root, "TaxTotal");
    base.tax = sum(taxTotals.map((t) => num(at(t, "TaxAmount"), "tax", warnings)));
    if (base.tax != null) printed.tax = String(base.tax);
    base.taxBreakdown = taxTotals.flatMap((t) =>
      all(t, "TaxSubtotal").map(
        (st): ParsedTaxBreakdownRow => ({
          rate: num(at(st, "Percent"), "tax rate", warnings),
          taxableBase: num(at(st, "TaxableAmount"), "taxable amount", warnings),
          amount: num(at(st, "TaxAmount"), "tax amount", warnings),
          category:
            textAt(st, "TaxCategory/TaxScheme/Name") ??
            textAt(st, "TaxCategory/TaxScheme/TaxTypeCode"),
        }),
      ),
    );
    const withheld = sum(
      all(root, "WithholdingTaxTotal").map((t) => num(at(t, "TaxAmount"), "withheld tax", warnings)),
    );
    if (withheld)
      warnings.push(
        `${withheld.toFixed(2)} of this invoice's tax is withheld (tevkifat): the house pays it to the tax office, not to the vendor.`,
      );
    if (!base.currency) warnings.push("The file states no currency (DocumentCurrencyCode).");
  }

  const tied = despatch ? base : applyTieOut(base);
  const byWarnings = Math.max(0.4, 0.98 - tied.warnings.length * 0.08);
  return {
    ...tied,
    // A tie-out proves the money adds up; it says nothing about whether ten
    // "cases" are ten bottles. A doubtful count caps the paper's confidence.
    confidence: doubtfulCount ? Math.min(byWarnings, DOUBTFUL_COUNT_CONFIDENCE) : byWarnings,
  };
}
