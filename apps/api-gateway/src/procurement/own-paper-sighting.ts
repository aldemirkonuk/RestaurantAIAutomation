import { isIso4217 } from "../common/iso-4217";

/**
 * The house's own paper, turned into a price sighting.
 *
 * WHY THIS EXISTS
 * ---------------
 * `price_history` records what this house paid; `vendor_price_observations` is
 * the register every price READER joins on — the market box on /notifications
 * (`vendor-comparison.service.ts:333` -> `price-below-average.ts`), the beverage
 * register's `quote` line (`beverages.service.ts`), the market producer
 * (`notifications/producers/market-price.producer.ts`). Measured 2026-09-04 the
 * two writers `price_history` finally has (`procurement.service.ts:2902` on a
 * verified receipt, `:4393` on a confirmed order) write to the WRONG table for
 * all four of those readers, so the best-provenanced price this house will ever
 * have — a checked invoice line, trust tier 1 — is invisible to every one of
 * them. ADR 0117 decided the register's first fill is exactly this mirror.
 *
 * THE FIVE THINGS A SIGHTING MUST NAME
 * ------------------------------------
 * ADR 0117: "A row may enter the price register only if it names, on the row,
 * five things: what number it is, who published it, when they published it,
 * what unit it is in, and where it is a price. Anything missing one of the five
 * is not a sighting and is refused, not defaulted."
 *
 * So this module's whole job is to REFUSE. `decideOwnPaperSighting` returns a
 * refusal carrying a sentence a person can read, and the caller logs it and
 * writes nothing. In particular:
 *
 *   * A missing bottle volume is a refusal, not a 750. `restaurant_inventory
 *     .bottle_size_ml` is nullable, and `20260903171000_the_house_item_is_the
 *     _ledgers_key.sql:61` names the `?? 750` default as the defect: a 375ml
 *     half-bottle written as 750 halves its unit price and makes it the best
 *     deal in the ladder.
 *   * The price carried is the document's OWN number in the document's OWN
 *     unit, with `pack_size` and `unit_volume_ml` beside it. Nothing here
 *     converts: `normalizeUnitPrice` (`analytics/engine/vendor-price-consensus
 *     .ts:115`) is the single place a conversion is allowed to happen, and it
 *     needs the unconverted operands to do it.
 *   * `observed_at` is the event's own date, never `now()`.
 *
 * WHY THE PAYLOAD IS BUILT HERE AND NOT INLINE
 * --------------------------------------------
 * Every refusal above is arithmetic over inputs, so it is testable without a
 * database — the same reason `toBottleOperands` is exported from
 * `invoice-match.ts`. The service does the I/O; this file does the judgement.
 */

import { createHash } from "node:crypto";

import {
  flagOutliers,
  normalizeUnitPrice,
} from "../analytics/engine/vendor-price-consensus";

/** The two `price_history.source` values this mirror covers. */
export type OwnPaperSource = "receipt_verified" | "order_confirmed";

/**
 * Trust tier and `source_type` per ADR 0117's class A: a verified invoice is
 * ground truth (tier 1, `invoice`); a confirmed order is a commitment in
 * writing but not yet a bill (tier 2, `quote`). Both values are already in
 * `vpo_source_type_check` (`20260805154027_vendor_price_observations.sql:112`),
 * so this needs no migration.
 */
export const OWN_PAPER_CLASS: Readonly<
  Record<OwnPaperSource, { sourceType: "invoice" | "quote"; trustTier: 1 | 2 }>
> = Object.freeze({
  receipt_verified: { sourceType: "invoice", trustTier: 1 },
  order_confirmed: { sourceType: "quote", trustTier: 2 },
});

/**
 * Is this `price_history.source` one the register mirrors?
 *
 * `PRICE_HISTORY_SOURCES` (`order-units.ts:239`) may grow, and a source this
 * module has no class for must produce no row rather than a row filed under a
 * class that is a guess.
 */
export function isOwnPaperSource(source: string): source is OwnPaperSource {
  return Object.prototype.hasOwnProperty.call(OWN_PAPER_CLASS, source);
}

export interface OwnPaperSightingInput {
  /**
   * NEVER null. An own-paper sighting is THIS house's negotiating position, and
   * `belowTrailingAverage` reads `restaurant_id.is.null OR
   * restaurant_id.eq.<tenant>` (`vendor-comparison.service.ts:341`) — a null
   * would publish this house's invoice price into every other tenant's box.
   */
  restaurantId: string | null | undefined;
  orderId: string | null | undefined;
  providerId: string | null;
  vendorName: string | null;
  masterWineId: string | null;
  productName: string | null;
  source: OwnPaperSource;
  /** The document's own price, in the unit named below. Not converted. */
  unitPrice: number | null | undefined;
  /** The document's own unit word, for the audit trail. */
  unitLabel: string | null | undefined;
  /** Bottles in one of that unit. 1 for a unit that holds exactly one. */
  packSize: number | null | undefined;
  /** The bottle's volume. No default: absent is a refusal. */
  unitVolumeMl: number | null | undefined;
  /** The event's own date, ISO. Never `now()` supplied by the caller. */
  observedAt: string | null | undefined;
  /**
   * The DOCUMENT's own ISO 4217 code. No default: absent is a refusal (ADR 0117
   * Q25). Never the house's `restaurants.currency` — that is what the house
   * REPORTS in, not what this vendor billed, and production already holds a
   * house with TRY invoices against a USD row.
   */
  currency: string | null | undefined;
  notes?: string | null;
  /**
   * ADR 0160 §112 fork 6(a): the paper and the message this price was read
   * from. Optional, and NEVER a refusal when absent — fork 6(b)'s order link
   * (`source_ref`) still traces every own-paper row to its order, and a
   * missing paper is a gap the row states (`raw.provenance.sentence`), not a
   * reason to drop a verified price from the register.
   */
  provenance?: OwnPaperProvenance | null;
}

/**
 * Where an own-paper price was read from, as the writer found it (fork 6(a)).
 *
 * Every id here was read house-scoped by the caller
 * (`procurement.service.ts` `receiptPaperFor` / `dealMessageFor`), and the
 * database refuses any other house's document or message on its own
 * (`20260927130000_a_price_names_its_paper_and_its_messenger.sql`'s composite
 * keys) — so this module never has to trust them for the boundary.
 */
export interface OwnPaperProvenance {
  documentId?: string | null;
  documentLineId?: string | null;
  conversationMessageId?: string | null;
  /**
   * The sentence that says what was found and what was not — "the invoice
   * linked to this order, line 3" or "two invoices are linked to this order,
   * so none is named". Carried onto `raw.provenance.sentence` so a row with no
   * paper says WHY rather than reading like a row nobody looked for.
   */
  sentence?: string | null;
}

export interface OwnPaperSightingRow {
  restaurant_id: string;
  provider_id: string | null;
  vendor_name_raw: string | null;
  master_wine_id: string | null;
  product_name_raw: string | null;
  source_type: "invoice" | "quote";
  trust_tier: 1 | 2;
  source_ref: string;
  observed_at: string;
  effective_date: string;
  raw_price: number;
  currency: string;
  pack_size: number;
  unit_volume_ml: number;
  normalized_unit_price: number;
  normalization_note: string;
  content_hash: string;
  is_outlier: boolean;
  /**
   * A sentence a person can read, mirroring the manual writer's own words
   * (`vendor-comparison.service.ts`'s `outlierReason`) — never left null when
   * the caller supplied a `priorCount`. Before this field existed, an
   * own-paper row was judged (`is_outlier` was a real true/false) but said
   * nothing about it, so the register read "No judge has looked at this
   * row" for a row that HAD been looked at. Its own review finding — not
   * ADR 0160 §112 fork 6(a), whose `document_id` + line-reference provenance
   * is the three `document_id` / `document_line_id` /
   * `conversation_message_id` fields below (built 2026-09-25).
   */
  outlier_reason: string | null;
  outlier_basis: "write_time" | null;
  outlier_judged_at: string | null;
  /** ADR 0160 §112 fork 6(a) — see `OwnPaperProvenance`. */
  document_id: string | null;
  document_line_id: string | null;
  conversation_message_id: string | null;
  raw: Record<string, unknown>;
}

export type OwnPaperSightingDecision =
  | { write: false; reason: string }
  | {
      write: true;
      sourceRef: string;
      contentHash: string;
      normalizedUnitPrice: number;
      row: OwnPaperSightingRow;
    };

/**
 * How many values the MAD test needs before its verdict means anything.
 *
 * `flagOutliers` falls back to "anything not equal to the median is an outlier"
 * when MAD is 0 (`vendor-price-consensus.ts:194`). The median of two unequal
 * values equals neither of them, so on a two-row group that branch flags BOTH —
 * and `belowTrailingAverage` filters `.eq("is_outlier", false)`, so a house's
 * second-ever invoice would erase its first from the ladder. Five values is the
 * smallest group where a single deviant can be outnumbered.
 *
 * This is a sample-size floor, not a bound on the price: no incoming value is
 * ever clamped, rounded or rejected for being extreme. A flagged row is still
 * written, still visible, still fixable at source (ADR 0117).
 */
export const MIN_OUTLIER_SAMPLE = 5;

/**
 * Is this new unit price an outlier against the prices already on the register
 * for the same product?
 *
 * The test is `flagOutliers` (`vendor-price-consensus.ts:188`) — the median
 * absolute deviation at 3.5 robust deviations — run over the prior values plus
 * the candidate, reading only the candidate's verdict. Nothing else in the
 * repository implements a second dispersion test, and nothing needed extracting
 * to share it: it is already an exported pure function.
 */
export function isOutlierAgainstPriors(
  priorUnitPrices: readonly number[],
  candidateUnitPrice: number,
): boolean {
  const priors = priorUnitPrices.filter((v) => Number.isFinite(v));
  if (priors.length + 1 < MIN_OUTLIER_SAMPLE) return false;
  const flags = flagOutliers([...priors, candidateUnitPrice]);
  return flags[flags.length - 1] === true;
}

function positiveInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
  return n;
}

/**
 * Build the sighting, or say in a sentence why there is not one.
 *
 * `isOutlier` is passed in rather than computed here because it is a property
 * of the GROUP, which only the caller can read. The caller obtains it from
 * `isOutlierAgainstPriors` with the register rows it has just fetched.
 *
 * `priorCount` is the same rows' length, so this can say WHY — "judged clean
 * against N priors" or "not judged: only N, below the floor" — the way
 * `vendor-comparison.service.ts`'s manual writer already does. A caller that
 * omits it gets `outlier_reason: null` (this file's own field goes unwritten,
 * not a guessed sentence) rather than a claim this function cannot back up —
 * and the caller MUST omit it when its register read failed, never pass 0.
 * A row with no `masterWineId` is never judged: there is no group, so any
 * `priorCount` is ignored and the row is stored unflagged with no reason.
 *
 * The sentence names the population the caller really reads: this house's
 * rows plus the public register's, every source type. It does NOT copy the
 * manual writer's "same comparison class" — that writer filters by class and
 * `priorSightingUnitPrices` does not.
 */
export function decideOwnPaperSighting(
  input: OwnPaperSightingInput,
  opts: { isOutlier?: boolean; priorCount?: number } = {},
): OwnPaperSightingDecision {
  const where = `${input.source} on order ${input.orderId ?? "(no id)"}`;

  const restaurantId =
    typeof input.restaurantId === "string" && input.restaurantId.trim()
      ? input.restaurantId.trim()
      : null;
  if (!restaurantId) {
    return {
      write: false,
      reason:
        `No price sighting written for ${where}: it names no restaurant. ` +
        `An own-paper price is this house's own negotiating position and a ` +
        `tenant-less row would be read by every other house's market box.`,
    };
  }

  const orderId =
    typeof input.orderId === "string" && input.orderId.trim()
      ? input.orderId.trim()
      : null;
  if (!orderId) {
    return {
      write: false,
      reason:
        `No price sighting written for ${input.source}: it names no order, so ` +
        `nothing could trace the number back to the paper it was read from.`,
    };
  }

  const price = Number(input.unitPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return {
      write: false,
      reason:
        `No price sighting written for ${where}: the price is ` +
        `${JSON.stringify(input.unitPrice)}. A zero or absent price is not an ` +
        `observation, and writing one would drag every average through it.`,
    };
  }

  const packSize = positiveInt(input.packSize);
  if (packSize === null) {
    return {
      write: false,
      reason:
        `No price sighting written for ${where}: the pack size is ` +
        `${JSON.stringify(input.packSize)} for a unit stated as ` +
        `${JSON.stringify(input.unitLabel)}. Without it the register cannot ` +
        `tell a case price from a bottle price, and ranking them together ` +
        `recommends the wrong vendor by a factor of the pack.`,
    };
  }

  const unitVolumeMl = positiveInt(input.unitVolumeMl);
  if (unitVolumeMl === null) {
    return {
      write: false,
      reason:
        `No price sighting written for ${where}: no bottle volume is recorded ` +
        `for this item (restaurant_inventory.bottle_size_ml is ` +
        `${JSON.stringify(input.unitVolumeMl)}), so the number has no unit. ` +
        `Refusing rather than assuming 750ml: a 375ml bottle written as 750 ` +
        `halves its unit price and becomes the best deal on the ladder.`,
    };
  }

  const observedAtRaw =
    typeof input.observedAt === "string" ? input.observedAt.trim() : "";
  const observedAt = observedAtRaw ? new Date(observedAtRaw) : null;
  if (!observedAt || Number.isNaN(observedAt.getTime())) {
    return {
      write: false,
      reason:
        `No price sighting written for ${where}: the observation date is ` +
        `${JSON.stringify(input.observedAt)}. A sighting must carry the date ` +
        `its own paper carries; stamping it with now() would make an old ` +
        `price look like today's.`,
    };
  }

  // ADR 0117 Q25, founder 2026-09-05. This was `(input.currency ?? "USD")`:
  // neither caller passes a currency, so every class-A sighting this register
  // would ever hold was about to be stamped USD on no evidence — the same
  // fabricated answer that put USD on a house in Fethiye
  // (`restaurants.currency`, 14 of 14). It is a refusal now, and the shape is
  // not new: the class-D sweep beside this one already refuses
  // `currency_unstated` with the sentence "A number without its currency is not
  // a price" (`vendor-intel/shop-reference-posting.ts:106-107`). Class A
  // defaulting while class D refuses was the inconsistency.
  //
  // `vendor_price_observations.currency` is NOT NULL
  // (`20260805154027_vendor_price_observations.sql:82`), so refuse and invent
  // are the only two options this table allows. THE COST, STATED: until a caller
  // states one, no class-A sighting is written. The register holds 0 rows today
  // and has since it was built, so nothing existing is lost — but the next
  // verified receipt writes no sighting where it would have written a USD one.
  // A USD one about a Turkish invoice is worse than none, because a refusal is
  // visible in the log and a wrong currency is invisible in the ladder.
  const currencyRaw =
    typeof input.currency === "string" ? input.currency.trim().toUpperCase() : "";
  // MEMBERSHIP, NOT SHAPE (2026-09-06). This asked `/^[A-Z]{3}$/`, so a
  // well-formed non-currency — `ZZZ` — was admitted into
  // `vendor_price_observations.currency`, which is the register every price
  // READER joins on. A denomination that does not exist in the ladder is worse
  // than a refused sighting for the same reason a USD one is.
  if (!isIso4217(currencyRaw)) {
    return {
      write: false,
      reason:
        `No price sighting written for ${where}: the currency is ` +
        `${JSON.stringify(input.currency)}. A number without its currency is ` +
        `not a price — this house's paper arrives in whatever its vendors ` +
        `bill, and one house in production already holds TRY invoices against ` +
        `a row that says USD. State the document's own ISO 4217 code (the ` +
        `invoice header carries it: procurement_documents.currency) and this ` +
        `sighting is admitted.`,
    };
  }

  const { sourceType, trustTier } = OWN_PAPER_CLASS[input.source];
  const currency = currencyRaw;

  // `normalizeUnitPrice` returns null on exactly three inputs: a price that is
  // not a number, a pack size below 1, and a yield outside (0, 1]
  // (`analytics/engine/vendor-price-consensus.ts:120-127`). All three are
  // already refused above — the price by `Number.isFinite(price) && price > 0`,
  // the pack by `positiveInt`, and the yield by being the literal 1 — so it
  // CANNOT be null here, and `unitVolumeMl >= 1` makes the result finite and
  // positive.
  //
  // There is therefore deliberately NO refusal branch on this result, and the
  // cast is type narrowing rather than a guard. An earlier draft had one, with
  // a sentence about "an unconvertible observation". It was unreachable by
  // construction, which is the same shape as everything else this build exists
  // to remove: a screen that cannot fire reads to the next person as a screen
  // that is running. If a future edit relaxes any of the three refusals above,
  // this is the line to revisit — not to re-add a branch to.
  const { unitPrice: rawNormalized, note } = normalizeUnitPrice({
    price,
    sourceType,
    observedAt: observedAt.toISOString(),
    packSize,
    unitVolumeMl,
    yieldFactor: 1,
  });
  const normalized = rawNormalized as number;

  // The document this row was read from. ADR 0117's `source_ref`.
  const sourceRef = `${input.source}:${orderId}`;

  // Idempotency. The table already carries a UNIQUE index on
  // (source_ref, content_hash) WHERE both are non-null
  // (`20260805154027_vendor_price_observations.sql:141`), designed so a re-read
  // that found nothing new is discarded rather than inflating the observation
  // count. A re-verification of the same receipt at the same numbers hashes
  // identically and is refused by the database; a re-verification that CHANGED
  // the price hashes differently and is a genuinely new sighting, which is the
  // correct outcome — the disagreement is the information.
  const contentHash = createHash("sha256")
    .update(
      JSON.stringify([
        sourceRef,
        restaurantId,
        input.masterWineId ?? null,
        input.providerId ?? null,
        Math.round(price * 100),
        packSize,
        unitVolumeMl,
        currency,
        observedAt.toISOString().slice(0, 10),
      ]),
    )
    .digest("hex");

  // The sentence, not just the boolean. `isOutlierAgainstPriors` (the
  // caller's own judge) returns `false` BOTH when a row is judged clean AND
  // when there were too few priors to judge at all — `opts.isOutlier` alone
  // cannot tell those apart, which is exactly how a judged-clean own-paper
  // row and a never-judged one both used to read "No judge has looked at
  // this row" on the register (review finding). `priorCount` recovers the
  // distinction the same way the manual writer already draws it.
  //
  // No product identity means no group: there is nothing this row could be
  // compared with, so nothing was counted and no count may be stated. A
  // `priorCount` for an unidentified row is ignored, whatever the caller
  // passes — otherwise the register would store "Not judged: only 0 earlier
  // sighting(s) of this product" beside a sheet that says the product is
  // "Unidentified" (PR #473 audit at 81f7a6abf, PR #482 audit at cd2dc58f6).
  const priorCount = input.masterWineId ? opts.priorCount : undefined;
  const judged =
    priorCount !== undefined && priorCount + 1 >= MIN_OUTLIER_SAMPLE;
  const outlierReason =
    priorCount === undefined
      ? null
      : !judged
        ? `Not judged: only ${priorCount} earlier sighting(s) of this product exist on this house's register and the public one (every source type counted), below the floor of ${MIN_OUTLIER_SAMPLE} at which a deviation test means anything. The row is stored as entered; it is not claimed to be clean.`
        : opts.isOutlier
          ? `Flagged at write time against ${priorCount} earlier sighting(s) of this product on this house's register and the public one (every source type counted): it sits more than 3.5 robust deviations from their median. The price is stored exactly as entered and stays visible; it is kept out of the "cheaper than usual" ladder until it is corrected at source or the nightly re-judge clears it.`
          : `Judged clean at write time against ${priorCount} earlier sighting(s) of this product on this house's register and the public one (every source type counted).`;
  const judgedAt = priorCount === undefined ? null : new Date().toISOString();

  // Fork 6(a). Deliberately NOT part of `contentHash` above: the hash answers
  // "is this the same evidence about the price", and finding the paper a
  // second time does not make a re-verification at the same numbers new
  // evidence. A line without its document is dropped rather than written —
  // a line reference means nothing without the paper it is a line of.
  const prov = provenanceIds(input.provenance);

  return {
    write: true,
    sourceRef,
    contentHash,
    normalizedUnitPrice: normalized,
    row: {
      restaurant_id: restaurantId,
      provider_id: input.providerId ?? null,
      vendor_name_raw: input.vendorName ?? null,
      master_wine_id: input.masterWineId ?? null,
      product_name_raw: input.productName ?? null,
      source_type: sourceType,
      trust_tier: trustTier,
      source_ref: sourceRef,
      observed_at: observedAt.toISOString(),
      effective_date: observedAt.toISOString().slice(0, 10),
      raw_price: Math.round(price * 100) / 100,
      currency,
      pack_size: packSize,
      unit_volume_ml: unitVolumeMl,
      normalized_unit_price: normalized,
      normalization_note: note,
      content_hash: contentHash,
      // An unidentified row has no group to sit outside of.
      is_outlier: input.masterWineId ? opts.isOutlier === true : false,
      outlier_reason: outlierReason,
      outlier_basis: priorCount === undefined ? null : "write_time",
      outlier_judged_at: judgedAt,
      document_id: prov.documentId,
      document_line_id: prov.documentLineId,
      conversation_message_id: prov.conversationMessageId,
      raw: {
        origin: "own_paper",
        priceHistorySource: input.source,
        orderId,
        // The ids are copied here as well as into their columns: the columns
        // are cleared when the paper or the message is deleted (ON DELETE SET
        // NULL), and this copy is what lets the register say "the paper was
        // deleted" rather than read as a row that never had one.
        provenance: {
          documentId: prov.documentId,
          documentLineId: prov.documentLineId,
          conversationMessageId: prov.conversationMessageId,
          sentence: prov.sentence,
        },
        // The document's own unit word, kept verbatim beside the pack size it
        // resolved to, so a person auditing the row can see what the paper
        // said rather than only what the platform made of it.
        statedUnit: input.unitLabel ?? null,
        notes: input.notes ?? null,
      },
    },
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrNull(v: unknown): string | null {
  return typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim() : null;
}

/**
 * The ids a sighting row may carry, cleaned. Exported for tests.
 *
 * A malformed id becomes null (the database would refuse the whole insert on
 * a non-uuid, and a verified receipt must not lose its price over a
 * provenance typo), and a line without its document is dropped with the
 * sentence saying so.
 */
export function provenanceIds(p: OwnPaperProvenance | null | undefined): {
  documentId: string | null;
  documentLineId: string | null;
  conversationMessageId: string | null;
  sentence: string | null;
} {
  const documentId = uuidOrNull(p?.documentId);
  const lineRaw = uuidOrNull(p?.documentLineId);
  const documentLineId = documentId ? lineRaw : null;
  const conversationMessageId = uuidOrNull(p?.conversationMessageId);
  let sentence = typeof p?.sentence === "string" && p.sentence.trim() ? p.sentence.trim() : null;
  if (lineRaw && !documentId) {
    sentence = [
      sentence,
      "A line reference was found without its document, so it is not recorded: a line means nothing without the paper it is a line of.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return { documentId, documentLineId, conversationMessageId, sentence };
}

/** One `procurement_documents` row as `receiptPaperFor` reads it. */
export interface PaperCandidate {
  id: string;
  doc_type: string | null;
  doc_number: string | null;
  status: string | null;
}

/** One `procurement_document_lines` row as `receiptPaperFor` reads it. */
export interface PaperLineCandidate {
  id: string;
  document_id: string;
  line_no: number | null;
  order_line_id: string | null;
}

/**
 * Which paper a VERIFIED RECEIPT's price was read from — fork 6(a)'s first
 * writer change (sketch 112 README: "receipt verification ... carries only
 * `raw.orderId`").
 *
 * The rule, and why it refuses rather than guesses:
 *   * the documents are the ones LINKED to this order
 *     (`procurement_document_links`), filtered to invoices — a packing slip
 *     states no price, and a credit memo is not what was charged;
 *   * a rejected or superseded invoice is not the paper a price was verified
 *     against, so it is left out;
 *   * exactly one invoice names the paper. Two or more is an ambiguity the
 *     writer does not settle by picking one: the row is written with no
 *     document and a sentence saying how many there were;
 *   * the line is the invoice line the line matcher paired with this order's
 *     line (`procurement_document_lines.order_line_id`, the only place a
 *     pairing means anything — `20260901200000_receiving_preserves_the_pair
 *     .sql`). Exactly one such line names it; none or several leaves the
 *     paper named without a line, and says which.
 *
 * Pure, so every branch is tested without a database.
 */
export function pickReceiptPaper(args: {
  orderId: string;
  orderLineId: string | null;
  documents: readonly PaperCandidate[];
  lines: readonly PaperLineCandidate[];
}): OwnPaperProvenance {
  const invoices = args.documents.filter(
    (d) =>
      d.doc_type === "invoice" &&
      d.status !== "rejected" &&
      d.status !== "superseded",
  );
  if (invoices.length === 0) {
    return {
      documentId: null,
      documentLineId: null,
      sentence:
        args.documents.length === 0
          ? `No document is attached to order ${args.orderId}, so this price names its order but no paper.`
          : `The ${args.documents.length} document(s) attached to order ${args.orderId} include no live invoice, so this price names its order but no paper.`,
    };
  }
  if (invoices.length > 1) {
    return {
      documentId: null,
      documentLineId: null,
      sentence: `${invoices.length} invoices are attached to order ${args.orderId}; the price is not tied to one of them rather than to a guess.`,
    };
  }
  const invoice = invoices[0];
  const label = invoice.doc_number ? `invoice ${invoice.doc_number}` : "the invoice";
  if (!args.orderLineId) {
    return {
      documentId: invoice.id,
      documentLineId: null,
      sentence: `Read from ${label} attached to this order. The order has no line row, so no invoice line is named.`,
    };
  }
  const matched = args.lines.filter(
    (l) => l.document_id === invoice.id && l.order_line_id === args.orderLineId,
  );
  if (matched.length === 1) {
    const n = matched[0].line_no;
    return {
      documentId: invoice.id,
      documentLineId: matched[0].id,
      sentence: `Read from ${label}${n != null ? `, line ${n}` : ""}, the line paired with this order's line.`,
    };
  }
  return {
    documentId: invoice.id,
    documentLineId: null,
    sentence:
      matched.length === 0
        ? `Read from ${label}; no line on it has been paired with this order's line yet, so no line is named.`
        : `Read from ${label}; ${matched.length} of its lines are paired with this order's line, so none is named rather than one picked.`,
  };
}

/** One inbound `procurement_conversations` row, as the deal readers see it. */
export interface DealMessageCandidate {
  id: string;
  conversation_context?: Record<string, any> | null;
}

/**
 * The vendor reply a confirmed deal was read out of — fork 6(a)'s second
 * writer change. It is the newest inbound message that carries a
 * `deal_proposal` not yet resolved: the SAME rule `resolveLatestDealProposal`
 * uses to mark it resolved, so the message the price names is the message the
 * manager confirmed. Rows must arrive newest first.
 */
export function pickDealMessage(
  rows: readonly DealMessageCandidate[],
): DealMessageCandidate | null {
  return (
    rows.find(
      (r) =>
        r.conversation_context?.deal_proposal &&
        !r.conversation_context?.deal_resolved_at,
    ) ?? null
  );
}
