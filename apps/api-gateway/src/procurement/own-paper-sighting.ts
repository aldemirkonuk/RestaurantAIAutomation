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
 */
export function decideOwnPaperSighting(
  input: OwnPaperSightingInput,
  opts: { isOutlier?: boolean } = {},
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
      is_outlier: opts.isOutlier === true,
      raw: {
        origin: "own_paper",
        priceHistorySource: input.source,
        orderId,
        // The document's own unit word, kept verbatim beside the pack size it
        // resolved to, so a person auditing the row can see what the paper
        // said rather than only what the platform made of it.
        statedUnit: input.unitLabel ?? null,
        notes: input.notes ?? null,
      },
    },
  };
}
