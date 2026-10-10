import { HttpException, HttpStatus } from "@nestjs/common";
import { policyFor } from "../../ask-readings/reading-data-classes";

/**
 * WHO MAY WRITE A VENDOR DOCUMENT'S MONEY, and what the door is told back.
 *
 * `DocumentsController` carries `JwtAuthGuard` and nothing else, on purpose:
 * the upload is the delivery door, and a runner photographs paper there (ADR
 * 0126). But the same controller also corrects a document's fields, edits its
 * lines, runs and confirms the match, fills an unread document and verifies the
 * transcription — the record the house pays its vendors from. Those acts
 * checked no role at all, and `SealChallengeService` does not either: its
 * header says the caller checks the role. So any signed-in person at the house,
 * staff included, could rewrite a unit price behind a seal they minted
 * themselves.
 *
 * ONE ANSWER TO "WHO HOLDS THE HOUSE'S MONEY": the `money` row of `ROLE_POLICY`
 * (ADR 0145), the same table Ask and the dashboard read. Owner and manager hold
 * it (`admin` reads the owner row); staff, an unknown role and a session with
 * no role at this house do not. The role is the token's, which `JwtStrategy`
 * re-derives from the access row on every request.
 *
 * Not every pairing goes through here: the upload still links and matches for
 * every caller, staff included (see `DocumentsController`'s class doc).
 *
 * Pure: no database, no Nest container. The controller calls it before any
 * seal is minted, redeemed or read, so a refusal spends nothing.
 */
export function holdsHouseMoney(role: string | null | undefined): boolean {
  return policyFor(role).sees.includes("money");
}

/** The document acts that write money, by the name the refusal speaks. */
export type DocumentMoneyAct =
  | "field_correct"
  | "field_verify"
  | "line_edit"
  | "verify"
  | "extraction"
  | "match"
  | "line_link"
  | "receipt_price";

const ACT_WORDS: Readonly<Record<DocumentMoneyAct, string>> = {
  field_correct: "Correcting a field on a vendor document",
  field_verify: "Marking a field on a vendor document as checked",
  line_edit: "Correcting a line on a vendor document",
  verify: "Confirming a vendor document's transcription",
  extraction: "Filling a vendor document with a reading",
  match: "Pairing a vendor document's lines with the order",
  line_link: "Confirming or undoing a line pairing on a vendor document",
  receipt_price:
    "Putting the invoice price or a price override on a delivery's receipt",
};

/**
 * Refuse a non-holder in words, or return.
 *
 * A 403 with a whole sentence: what the act is, who the session is at this
 * house, that nothing happened, and who can do it. The door is named because
 * the person refused here is usually standing at it, and what they came to do
 * there still works.
 */
export function assertHoldsHouseMoney(
  user: { role?: string | null } | null | undefined,
  act: DocumentMoneyAct,
): void {
  const role = user?.role ? String(user.role).trim() : "";
  if (holdsHouseMoney(role || null)) return;
  throw new HttpException(
    `${ACT_WORDS[act]} is desk work on the record this house pays its vendors from, so it is an owner's or a manager's act. ` +
      `${role ? `You are signed in as ${role} at this house` : "This session could not be shown to hold any role at this house"}, so nothing was sealed and nothing was changed. ` +
      (role
        ? "The photograph and the door count still go through for you; ask a manager or an owner to do this one."
        : "Ask a manager or an owner of this house to do this one."),
    HttpStatus.FORBIDDEN,
  );
}

/**
 * The keys of a parse the delivery door reads, and nothing else.
 *
 * `DoorModel.readPaper` (web) counts boxes and bottles from each line's `qty`,
 * `uom`, `packSize` and `qtyBottles`, names the paper by `docType` and
 * `docNumber`, and counts `lines`. That is the whole of what a non-holder is
 * sent back. AN ALLOWLIST, NOT A DENYLIST: a money field added to
 * `ParsedDocument` later stays withheld without anyone remembering to list it.
 * `warnings` is left out too, because a tie-out warning prints the figures it
 * compared — but HOW MANY there were is sent as `warningCount`, because the
 * door must not pre-fill a count from a reading that came with doubts (F-744).
 */
export const DOOR_ECHO_DOCUMENT_KEYS = [
  "docType",
  "docNumber",
  "lines",
] as const;
export const DOOR_ECHO_LINE_KEYS = [
  "lineNo",
  "qty",
  "uom",
  "packSize",
  "qtyBottles",
] as const;

function pick(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys)
    if (Object.prototype.hasOwnProperty.call(source, k)) out[k] = source[k];
  return out;
}

/**
 * The parse as the door may see it. Keys are OMITTED, never set to null: a
 * null price reads as "the paper printed none", which is a claim about the
 * paper, and this is a claim about the reader. `null` in, `null` out.
 */
export function doorEchoOf(
  parsed: object | null | undefined,
): Record<string, unknown> | null {
  if (!parsed) return null;
  const doc = pick(parsed as Record<string, unknown>, DOOR_ECHO_DOCUMENT_KEYS);
  if (Array.isArray(doc.lines))
    doc.lines = (doc.lines as unknown[]).map((l) =>
      l && typeof l === "object"
        ? pick(l as Record<string, unknown>, DOOR_ECHO_LINE_KEYS)
        : {},
    );
  const warnings = (parsed as { warnings?: unknown }).warnings;
  if (Array.isArray(warnings)) doc.warningCount = warnings.length;
  return doc;
}

/*
 * THE READS (money-policy M2). `GET /procurement/documents`, `GET :id` and
 * `GET :id/canonical` gave every signed-in member each price, total and
 * tie-out on the house's vendor paper, while the upload already withheld them.
 * A reader who does not hold the house's money now gets the same paper with
 * those keys OMITTED (never nulled, for the reason `doorEchoOf` gives) and
 * `amountsWithheld: true`. Quantities, names, dates, status and the door's
 * own reading stay, so the door and the receiving count still work.
 */

/**
 * The money columns of a `procurement_documents` row. `notes` holds the
 * parse's warnings, which print the figures they compared; `raw_payload` is
 * the paper as it arrived. `extracted` is not listed: it is cut to the door's
 * echo instead, which is what the receiving screen counts from.
 */
export const DOCUMENT_MONEY_COLUMNS = [
  "subtotal",
  "freight",
  "fuel_surcharge",
  "split_case_fee",
  "delivery_fee",
  "deposit_total",
  "tax",
  "other_charges",
  "discount_total",
  "total",
  "computed_lines_total",
  "tie_out_delta",
  "notes",
  "raw_payload",
] as const;

/** The money columns of a `procurement_document_lines` row; `printed` is the line as printed. */
export const DOCUMENT_LINE_MONEY_COLUMNS = [
  "unit_price",
  "line_total",
  "allowance",
  "deposit",
  "printed",
] as const;

function omitting(
  row: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out = { ...row };
  for (const k of keys) delete out[k];
  return out;
}

/** One document row as a non-holder may read it. */
export function documentRowWithoutMoney(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out = omitting(row, DOCUMENT_MONEY_COLUMNS);
  if ("extracted" in out)
    out.extracted = doorEchoOf(out.extracted as object | null);
  return out;
}

/** One document line as a non-holder may read it. */
export function documentLineWithoutMoney(
  line: Record<string, unknown>,
): Record<string, unknown> {
  return omitting(line, DOCUMENT_LINE_MONEY_COLUMNS);
}

/**
 * The layer-1 paths that carry no money. A correction on any other path
 * (`totals.*`, a line's `netPrice` or `netAmount`, an allowance, a tax rate)
 * is left out of a non-holder's correction log whole: what it was and what
 * it became are the amounts.
 * AN ALLOWLIST: a path added later stays withheld until someone lists it.
 */
const NON_MONEY_HEADER =
  /^(documentNumber|issueDate|typeCode|currency|paymentDueDate|paymentTerms|purchaseOrderReference|despatchAdviceReference|precedingInvoiceReference|actualDeliveryDate|deliveryLocation|(seller|buyer)\.[A-Za-z]+)$/;
const NON_MONEY_LINE =
  /^lines\[\d+\]\.(lineId|description|sellerItemId|quantity|unit|priceBaseQuantity|priceBaseUnit|lineKind|vintage|lot|formatMl|freeGoodsQty)$/;

export function isMoneyPath(path: string): boolean {
  return !NON_MONEY_HEADER.test(path) && !NON_MONEY_LINE.test(path);
}

const CANONICAL_LINE_MONEY = ["netPrice", "netAmount", "allowancesCharges"];
const LAYER1_MONEY = ["totals", "allowancesCharges", "vatBreakdown"];

/**
 * `GET :id/canonical` as a non-holder may read it. Layer 1 loses its prices,
 * line amounts, allowances, VAT breakdown and totals; layer 3 its money at
 * risk, its tie-out delta and its invariant results (each prints the figures
 * it compared); the delivery spine and the sibling papers their totals.
 * `amountsWithheld` is set on the canonical document too, because that is
 * the object the sheet is handed.
 */
export function canonicalReadWithoutMoney<T extends Record<string, any>>(
  read: T,
): T & { amountsWithheld: true } {
  const c = read.canonical ?? {};
  const l1 = c.layer1 ?? {};
  const l3 = c.layer3 ?? {};
  const spineDoc = (d: Record<string, unknown>) => omitting(d, ["total"]);
  return {
    ...read,
    canonical: {
      ...c,
      amountsWithheld: true,
      layer1: {
        ...omitting(l1, LAYER1_MONEY),
        lines: (l1.lines ?? []).map((l: Record<string, unknown>) =>
          omitting(l, CANONICAL_LINE_MONEY),
        ),
      },
      layer3: {
        ...omitting(l3, ["tieOutDeltaCents", "verdicts"]),
        lines: (l3.lines ?? []).map((l: Record<string, unknown>) =>
          omitting(l, ["moneyAtRisk"]),
        ),
      },
    },
    deliveries: Array.isArray(read.deliveries)
      ? read.deliveries.map((d: Record<string, any>) => ({
          ...d,
          documents: (d.documents ?? []).map(spineDoc),
        }))
      : read.deliveries,
    siblings: Array.isArray(read.siblings)
      ? read.siblings.map(spineDoc)
      : read.siblings,
    // A correction to a withheld field is withheld with it: its before and
    // after ARE the amounts, and an entry without them would read as a field
    // that held nothing.
    corrections: Array.isArray(read.corrections)
      ? read.corrections.filter(
          (e: Record<string, any>) => !isMoneyPath(String(e.path ?? "")),
        )
      : read.corrections,
    amountsWithheld: true,
  };
}
