/**
 * What a seal on a PROCUREMENT DOCUMENT act is a seal over.
 *
 * ---------------------------------------------------------------------------
 * THE DECISION (founder, 2026-09-06, batch 64)
 * ---------------------------------------------------------------------------
 * Asked whether procurement's three write routes should be sealed, the founder
 * answered: *"Decide as a module: seal all three"* — the option read *"One
 * policy for the corridor: verify, line edit and currency restatement each take
 * a redeemed seal like the payment and register acts do. Its own pass; the
 * receiving flow gains one ceremony per act."*
 *
 * `documents.controller.ts` said in writing, until this file existed, that
 * sealing `PATCH :id/currency` alone *"would read as a policy while leaving the
 * other six non-GET routes on this controller open"* and that whether the
 * corridor as a whole should be sealed was a founder question. It was asked and
 * it was answered, so the three acts named in the answer are sealed together and
 * the rest of the controller is deliberately, visibly, NOT — see
 * `scripts/check_money_routes_are_sealed.py`, which prints every unsealed write
 * on this controller rather than passing over it in silence.
 *
 * ---------------------------------------------------------------------------
 * ONE SUBJECT KIND, THREE ACTS
 * ---------------------------------------------------------------------------
 * The subject of all three is the DOCUMENT (`subject_kind
 * 'procurement_document'`, `subject_id` the document's own uuid) — including the
 * line edit, whose line is named in the ARGUMENTS instead. Two reasons, both
 * about what a refusal can then say:
 *
 *   * A line is not a thing a person holds an opinion about on its own. What a
 *     manager is deciding is "this correction, on this document"; a refusal
 *     reading "that seal was issued for a different line" would name the row
 *     rather than the paper.
 *   * `subject_id` has no foreign key (`20260904210000`), so a line id would
 *     work mechanically — and would put two DIFFERENT tables' uuids under one
 *     kind, which is exactly the collision `subject_kind` exists to stop.
 *
 * The acts are bare verbs (`verify`, `line_edit`, `currency_restate`) because
 * that is the vocabulary the column already holds — `approve` and `cancel` on an
 * order, `set_default` and `remove` on a payment method, `purchase` on credits.
 * The kind disambiguates; prefixing them `document.` would have been a second
 * naming scheme in one column.
 *
 * ---------------------------------------------------------------------------
 * THE ARGUMENTS ARE WHAT THE PERSON WAS LOOKING AT
 * ---------------------------------------------------------------------------
 * This is the half that makes a seal more than a second click. `args_hash`
 * covers what was on the screen when the hold began, so a token minted over one
 * state cannot be spent after that state moved:
 *
 *   * VERIFY hashes the whole transcription — the document's own figures AND
 *     every line, sorted by id. Verify is the record a vendor dispute leans on
 *     and it asserts one thing: that this transcription is faithful. A seal that
 *     covered only the document id would let a line be corrected between the
 *     gesture and the write, and the person's name would then stand behind a
 *     figure they never read. That is the edit-after-approval hole, arriving at
 *     the one route where the whole point is the human's word.
 *   * LINE_EDIT hashes the line AS IT STANDS and the PATCH being applied. A
 *     seal obtained for "qty 12" cannot be spent to write 120, and one obtained
 *     while the line said 12 cannot be spent after a second manager made it 20 —
 *     which is the collision `documents.ts` could previously only report AFTER
 *     the fact, because the table has no `updated_at` to precondition on.
 *   * CURRENCY_RESTATE hashes the code being written AND the one the document
 *     carries now. A seal minted to move a document from NOT RECORDED to EUR
 *     cannot be spent after somebody else already filed it in USD.
 *
 * The restatement's free-text `reason` is deliberately NOT hashed: it is what a
 * person types about the decision, not the decision, and binding it would refuse
 * an honest approval because a typo was fixed in the box.
 *
 * ---------------------------------------------------------------------------
 * EVERY NUMBER IS A FIXED-PRECISION STRING
 * ---------------------------------------------------------------------------
 * `normaliseSealTotal` is IMPORTED rather than re-implemented. PostgREST returns
 * `numeric` as a string and `float` as a number, so a seal that hashed "12.00" at
 * issue and 12 at redemption would refuse every honest correction — the defect
 * `order-seal.ts` already found and wrote down. A second copy of that rule here
 * is how the two ends learn to disagree.
 *
 * Nothing in this file touches a database or Nest, so every rule above is
 * testable without either (`document-seal.spec.ts`).
 */

import { normaliseSealTotal } from "../order-seal";

/** The subject kind, named once. Mirrored by `common/seal/seal-subject.ts`. */
export const DOCUMENT_SEAL_SUBJECT_KIND = "procurement_document" as const;

/** The three acts the founder's decision names, and nothing else. */
export const DOCUMENT_SEAL_ACTS = [
  "verify",
  "line_edit",
  "currency_restate",
] as const;

export type DocumentSealAct = (typeof DOCUMENT_SEAL_ACTS)[number];

export function isDocumentSealAct(value: unknown): value is DocumentSealAct {
  return (
    typeof value === "string" &&
    (DOCUMENT_SEAL_ACTS as readonly string[]).includes(value)
  );
}

/**
 * THE COLUMN LISTS ARE NOT HERE, AND THAT IS DELIBERATE.
 *
 * `DOCUMENT_SEAL_DOC_COLUMNS` and `DOCUMENT_SEAL_LINE_COLUMNS` live on
 * `documents.controller.ts`, beside the `.select()` calls that use them.
 * `scripts/check_read_columns_exist.py` resolves a const only within the file
 * that reads it — a list imported from here is UNREADABLE to that guard, and a
 * read nobody can check is exactly what it exists to count. This module stays
 * pure (it takes rows; it never fetches them), and `document-seal.spec.ts`
 * asserts that every field the functions below touch is named in those lists,
 * so the two cannot drift apart in silence.
 *
 * `order_line_id` is absent from the line list on purpose: a pairing is a claim
 * about which ORDER line this one answers, and verify asserts nothing about
 * that. Including it would make a seal refuse because the matcher ran in the
 * background.
 */

/** A row as PostgREST hands it back. Deliberately loose; every field is normalised. */
export type SealDocumentRow = Record<string, unknown>;

/** `null` stays `null`; anything else becomes its trimmed string. Never "" for null. */
function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

/** An integer field (a vintage), or null. Junk is `null` at BOTH ends, never 0. */
function whole(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * One line, as the seal sees it. The key order here does not matter —
 * `hashCallArgs` sorts keys at every level — but the VALUE normalisation does,
 * and it is the same function at both ends by construction.
 */
export function documentSealLine(line: SealDocumentRow): Record<string, unknown> {
  return {
    id: text(line.id),
    lineNo: whole(line.line_no),
    qty: normaliseSealTotal(line.qty),
    uom: text(line.uom),
    packSize: normaliseSealTotal(line.pack_size),
    qtyBottles: normaliseSealTotal(line.qty_bottles),
    freeGoodsQty: normaliseSealTotal(line.free_goods_qty),
    unitPrice: normaliseSealTotal(line.unit_price),
    lineTotal: normaliseSealTotal(line.line_total),
    allowance: normaliseSealTotal(line.allowance),
    description: text(line.description),
    vintage: whole(line.vintage),
    vendorSku: text(line.vendor_sku),
  };
}

/**
 * The arguments a VERIFY seal is taken over: the whole transcription.
 *
 * The lines are SORTED BY ID before they are hashed. PostgREST does not promise
 * an order without an `order()`, and two reads that returned the same rows in
 * two orders would hash to two different seals — a refusal for a reason nobody
 * could see, which teaches operators that the seal is decoration.
 */
export function documentVerifySealArgs(
  doc: SealDocumentRow,
  lines: readonly SealDocumentRow[],
): Record<string, unknown> {
  return {
    documentId: text(doc.id),
    status: text(doc.status),
    currency: text(doc.currency),
    docNumber: text(doc.doc_number),
    docDate: text(doc.doc_date),
    total: normaliseSealTotal(doc.total),
    freight: normaliseSealTotal(doc.freight),
    fuelSurcharge: normaliseSealTotal(doc.fuel_surcharge),
    splitCaseFee: normaliseSealTotal(doc.split_case_fee),
    deliveryFee: normaliseSealTotal(doc.delivery_fee),
    depositTotal: normaliseSealTotal(doc.deposit_total),
    tax: normaliseSealTotal(doc.tax),
    otherCharges: normaliseSealTotal(doc.other_charges),
    discountTotal: normaliseSealTotal(doc.discount_total),
    lineCount: lines.length,
    lines: [...lines]
      .map(documentSealLine)
      .sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? ""))),
  };
}

/**
 * The fields a line edit may carry, named once.
 *
 * A CLOSED list, and the reason is the seal rather than validation (the intake
 * service already whitelists these columns). A patch normalised through an OPEN
 * list would let a caller add a key at the write that was not there at the mint
 * and still hash the same, which is precisely the property being bought.
 */
export const LINE_EDIT_PATCH_KEYS = [
  "qty",
  "unitPrice",
  "lineTotal",
  "description",
  "vintage",
  "packSize",
  "qtyBottles",
  "freeGoodsQty",
  "allowance",
  "uom",
  "vendorSku",
] as const;

export type LineEditPatchKey = (typeof LINE_EDIT_PATCH_KEYS)[number];

/**
 * The patch, canonicalised.
 *
 * ABSENT AND NULL ARE DIFFERENT ARGUMENTS and stay different: a patch that does
 * not mention `unitPrice` leaves it alone, and one that sends `null` CLEARS it.
 * Collapsing the two would let a seal minted to change a quantity be spent on a
 * request that also wiped the price.
 *
 * Numbers go through the money normaliser and strings through `text`, so a form
 * that posts `"12"` and one that posts `12` produce the same seal — they are the
 * same correction, and the intake service coerces neither (it REFUSES a
 * non-number). The refusal for junk is the route's, not the seal's.
 */
export function documentLineEditPatchArgs(
  patch: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const source = patch ?? {};
  const out: Record<string, unknown> = {};
  for (const key of LINE_EDIT_PATCH_KEYS) {
    if (!(key in source)) continue;
    if (source[key] === undefined) continue;
    switch (key) {
      case "description":
      case "uom":
      case "vendorSku":
        out[key] = text(source[key]);
        break;
      case "vintage":
        out[key] = source[key] === null ? null : whole(source[key]);
        break;
      default:
        out[key] = source[key] === null ? null : normaliseSealTotal(source[key]);
    }
  }
  return out;
}

/**
 * The arguments a LINE EDIT seal is taken over: the line as it stands, plus the
 * correction about to be written to it.
 */
export function documentLineEditSealArgs(input: {
  documentId: string;
  lineId: string;
  status: unknown;
  line: SealDocumentRow | null;
  patch: Record<string, unknown> | null | undefined;
}): Record<string, unknown> {
  return {
    documentId: input.documentId,
    lineId: input.lineId,
    status: text(input.status),
    // `null` is a real value: the line could not be read, or does not exist. It
    // hashes identically at both ends and the route's own 404 is what the person
    // sees — the seal does not invent a line to hash.
    line: input.line ? documentSealLine(input.line) : null,
    patch: documentLineEditPatchArgs(input.patch),
  };
}

/**
 * The arguments a CURRENCY RESTATEMENT seal is taken over.
 *
 * `previous` is what the document carries at the moment of the hold and `next`
 * is what the person chose. Both, because the decision is the pair: confirming
 * USD when the document already says USD and restating from USD to EUR are the
 * same route and the same act (`change_kind` on the audit row records which),
 * and only the pair distinguishes them.
 */
export function documentCurrencySealArgs(input: {
  documentId: string;
  status: unknown;
  previous: string | null;
  next: string;
}): Record<string, unknown> {
  return {
    documentId: input.documentId,
    status: text(input.status),
    previous: input.previous ?? null,
    next: input.next,
  };
}
