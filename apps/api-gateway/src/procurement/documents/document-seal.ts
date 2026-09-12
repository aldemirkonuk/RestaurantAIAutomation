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
 * THE SECOND FACE (founder, 2026-09-11, batch 69)
 * ---------------------------------------------------------------------------
 * Asked whether the canonical face's twin acts should be sealed too, the founder
 * answered: *"Seal corrections and fields/verify too"* — *"The decision then
 * holds on both faces of the document; the guard's census becomes five acts."*
 *
 * The same document is worked on through two screens. `/receipts` corrects a
 * transcribed LINE and confirms the whole transcription; `/documents/:id` — ADR
 * 0104's canonical face — corrects one layer-1 FIELD (`POST :id/corrections`)
 * and ticks one field as checked by a human (`POST :id/fields/verify`). Batch 64
 * sealed the first face. Leaving the second open would have meant the decision
 * held on one face of the same paper and not on the other, which is not a policy
 * but an accident of which screen somebody opened.
 *
 * ---------------------------------------------------------------------------
 * ONE SUBJECT KIND, FIVE ACTS
 * ---------------------------------------------------------------------------
 * The subject of all five is the DOCUMENT (`subject_kind
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
 * THE TWO NEW ACTS ARE `field_correct` AND `field_verify`, and the names follow
 * that same rule rather than the domain's other vocabulary. Three names were
 * available and two were rejected in writing:
 *
 *   * `correction` / `verification` are what `document_corrections.kind` calls
 *     the ROWS these acts write, which is the tempting mirror. Rejected because
 *     `verification` sits one letter away from `verify`, the DOCUMENT-WIDE act
 *     already in this column under this very kind — two acts whose whole
 *     difference is a suffix, where confusing them would let a seal for one
 *     field stand for the whole transcription. A vocabulary that can be mistyped
 *     into a stronger authority is the wrong vocabulary.
 *   * A bare `correct` would not say WHICH correction: `line_edit` already
 *     corrects a line on the other face. `field_correct` and `field_verify` name
 *     their object the way `line_edit` and `currency_restate` name theirs, and
 *     every act on this kind then reads object-then-verb or bare-verb with
 *     nothing ambiguous between them.
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
 *   * FIELD_CORRECT hashes the REVISION THE PERSON WAS LOOKING AT — its number
 *     and its whole layer-1 content — plus the path and the value about to be
 *     written. Both halves are load-bearing and neither is redundant. The
 *     revision number refuses a correction written against a revision somebody
 *     else has already superseded, which is the 409 the append path can only
 *     report AFTER the fact. The content refuses the case the number cannot see:
 *     a document nobody has corrected has NO revision row at all and is rebuilt
 *     from its columns on every read, so a `line_edit` made on the /receipts
 *     face between the hold and the write moves what the canonical sheet says
 *     while the revision number stays at 1.
 *   * FIELD_VERIFY hashes the field's path, the value AS SHOWN, whether the
 *     document carries that field at all, and the verdict. A tick asserts one
 *     thing about one field — "I looked at this value and I stand behind it" —
 *     so it is bound to that value and deliberately NOT to the rest of the
 *     document: a correction to line 9 does not make a person's word about the
 *     invoice date untrue, and refusing it would teach operators that the seal
 *     fires at random. The verdict is in the arguments because there is exactly
 *     one today; naming it is what stops a second verdict, the day one exists,
 *     being spendable on a token minted for this one.
 *
 * The restatement's free-text `reason` is deliberately NOT hashed: it is what a
 * person types about the decision, not the decision, and binding it would refuse
 * an honest approval because a typo was fixed in the box. A field correction's
 * `reason` is left out for the same reason, and the same one only.
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

/**
 * The five acts the founder's two decisions name, and nothing else.
 *
 * Three from batch 64 (2026-09-06) on the /receipts face, two from batch 69
 * (2026-09-11) on ADR 0104's canonical face. `scripts/check_money_routes_are_
 * sealed.py`'s `SEALED_ACTS` census holds the same five, one row per handler.
 */
export const DOCUMENT_SEAL_ACTS = [
  "verify",
  "line_edit",
  "currency_restate",
  "field_correct",
  "field_verify",
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

// ---------------------------------------------------------------------------
// THE CANONICAL FACE (ADR 0104 D5). Founder, 2026-09-11, batch 69.
// ---------------------------------------------------------------------------

/**
 * The one verdict a field tick records today, named once.
 *
 * `POST :id/fields/verify` writes `verified_by`/`verified_at` and nothing else —
 * there is no "disputed" and no "could not read it". That is a fact about today,
 * so it is a CONSTANT rather than a caller's argument: a seal minted for this
 * verdict cannot be spent on a second one the day a second one exists, and the
 * refusal a person then reads names the act rather than shrugging.
 */
export const FIELD_VERIFY_VERDICT = "verified" as const;

/**
 * A correction's value, canonicalised for the hash — which here means NOT
 * coerced.
 *
 * `normaliseSealTotal` exists because PostgREST returns `numeric` as a string
 * and `float` as a number, so a figure read at the mint and the same figure read
 * at the write can differ in type. That cannot happen to this value: it comes
 * from the REQUEST BODY at both ends, typed by the caller, and never passes
 * through the database in between. Running it through a money normaliser would
 * buy nothing and cost two real things — it would round a three-decimal quantity
 * to two, making a seal minted for 12.005 spendable on 12.004, and it would
 * collapse the string "12" and the number 12 into one argument, which is exactly
 * the helpfulness `hashCallArgs`'s own header refuses ("a string '6' and a
 * number 6 are different arguments").
 *
 * So: `undefined` becomes `null`, because the DTO's absent value and an explicit
 * `null` are the same correction ("the document states nothing here") and the
 * controller sends `body.value ?? null` to the write. Everything else is passed
 * through exactly as it arrived.
 */
function correctionValue(value: unknown): unknown {
  return value === undefined ? null : value;
}

/**
 * The arguments a FIELD CORRECTION seal is taken over: the revision the person
 * was reading, in full, plus the correction about to be appended to it.
 *
 * `layer1` IS THE REVISION'S CONTENT, passed through rather than summarised.
 * `hashCallArgs` sorts keys at every level and walks arrays in order, so the
 * whole nested object hashes stably — and summarising it here would mean
 * choosing which parts of a document a person is allowed not to have read,
 * which is a judgement this file has no business making.
 *
 * BOTH ENDS READ IT THROUGH ONE READER (`CanonicalDocumentService.
 * buildFromDocumentId`, called by `documents.controller.ts` at the mint and at
 * the redemption). That is what makes the hash comparable at all: two different
 * readers of the same document is how issue and redemption learn to disagree.
 *
 * `revision` is `null` when the document could not be read. It hashes
 * identically at both ends and the route's own error is what the person sees.
 */
export function documentFieldCorrectSealArgs(input: {
  documentId: string;
  revision: number | null;
  layer1: unknown;
  path: string;
  value: unknown;
}): Record<string, unknown> {
  return {
    documentId: input.documentId,
    revision: input.revision ?? null,
    content: input.layer1 ?? null,
    path: input.path,
    value: correctionValue(input.value),
  };
}

/**
 * The arguments a FIELD TICK seal is taken over: the field, the value as shown,
 * whether the document carries the field at all, and the verdict.
 *
 * `fieldPresent` IS A SEPARATE FACT FROM `value`, and collapsing the two would
 * be the absence-as-health shape at seal granularity. A field this document does
 * not carry and a field that carries `null` both read as "nothing" on screen and
 * are different things: the first is a path the sheet has no row for, the second
 * is the paper stating nothing there. Hashed as one, a seal minted on a path the
 * document did not have could be spent after the path appeared carrying null.
 */
export function documentFieldVerifySealArgs(input: {
  documentId: string;
  path: string;
  fieldPresent: boolean;
  value: unknown;
  verdict: string;
}): Record<string, unknown> {
  return {
    documentId: input.documentId,
    path: input.path,
    fieldPresent: input.fieldPresent,
    value: input.value === undefined ? null : input.value,
    verdict: input.verdict,
  };
}
