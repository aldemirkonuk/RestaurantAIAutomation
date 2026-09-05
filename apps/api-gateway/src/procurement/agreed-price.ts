/**
 * The agreed price, and the unit it is stated in — ADR 0119 phase 1 (option O1).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `procurement_order_items` states the unit of its QUANTITY (`unit_type` beside
 * `bottles_per_unit`) and, until `20260905010000_an_agreed_price_states_its_unit
 * .sql`, said nothing about the unit of its PRICE. The column is called
 * `final_unit_price` and the arithmetic beside it means *per bottle*
 * (`procurement.service.ts` `line_total = finalPrice × bottlesTotal`), so a row
 * whose `unit_type` says `case` reads one way to a person and another way to
 * the code. ADR 0117's Q6 is that gap; ADR 0119 answered it with a stated
 * `(price_uom, price_pack_size)` pair.
 *
 * Everything here is arithmetic over inputs — no database, no Nest — for the
 * same reason `own-paper-sighting.ts` and `order-units.ts` are: the refusals
 * are the product, and a refusal that can only be exercised through two service
 * mocks is a refusal nobody re-reads.
 *
 * THE THREE RULES THIS FILE ENFORCES
 * ----------------------------------
 * 1. **Both or neither.** A unit with no pack cannot be converted, and a pack
 *    with no unit names nothing. The database CHECK
 *    `procurement_order_items_price_unit_pair_check` says the same thing; this
 *    says it earlier, in a sentence, so the desk gets an explanation instead of
 *    a 23514.
 * 2. **The price's unit is INDEPENDENT of the quantity's.** Five cases at a
 *    per-bottle price is an ordinary order — Connecticut posts a bottle price
 *    and a case price separately for the same item, and they are not related by
 *    division (bottle = case ÷ pack + 2–8¢, OLR 2004-R-0593). Nothing here
 *    checks the two units against each other, deliberately.
 * 3. **An unstated unit stays unstated.** `null` is never read as `bottle`.
 *    Every function below returns a refusal carrying a sentence rather than a
 *    default (ADR 0020, ADR 0119 invariant 7).
 *
 * WHAT IT CANNOT DO, STATED SO IT IS NOT ASSUMED
 * ----------------------------------------------
 * Nothing here can check that the NUMBER in `final_unit_price` is actually in
 * `price_uom` — only the person or parser who typed it knows that. ADR 0119
 * conceded this in its own counter-argument: the pair does not make a mis-keyed
 * price impossible, it makes one auditable, and moves the failure from silent
 * to attributable.
 */

import { Uom, normalizeUom } from "./documents/document-types";

/**
 * The units a price may be stated in.
 *
 * The same seven singulars as `ORDER_UNIT_TYPES` (`order-units.ts:63`), the
 * document line's `uom` (`baseline:4401`) and the receipt event's `counted_uom`
 * (`:4593`) — the fourth copy of one vocabulary, and the CHECK added by
 * `20260905010000_an_agreed_price_states_its_unit.sql` is its database half.
 * Kept as its own literal rather than aliased so that widening the quantity
 * vocabulary cannot silently widen what a price may claim: ADR 0119's "revisit
 * if" names exactly that possibility, and all four copies move together or none
 * does (ADR 0115 phase 2 item 3a).
 */
export const PRICE_UOM_TYPES = [
  "bottle",
  "case",
  "keg",
  "pack",
  "split_case",
  "each",
  "liter",
] as const;

/** Units where one of them holds more than one bottle. Mirrors `order-units.ts:74`. */
const MULTIPLYING: ReadonlySet<Uom> = new Set<Uom>([
  "case",
  "pack",
  "split_case",
]);

/**
 * Units with no bottle inside them at all.
 *
 * A keg is not `n` bottles and a litre is not a bottle; `order-units.ts:81`
 * already says so for quantities, and it matters twice as much for money: a
 * per-keg price has no per-bottle reading to convert to, so `price_history` —
 * whose `unit` column is the literal `'BOTTLE'` — must refuse it rather than
 * divide by 1 and call the result a bottle price.
 */
const OPAQUE: ReadonlySet<Uom> = new Set<Uom>(["keg", "liter"]);

/** A price unit that has been read and checked. Both halves, always. */
export interface StatedPriceUnit {
  priceUom: Uom;
  pricePackSize: number;
}

export type PriceUnitResolution =
  | { ok: true; stated: StatedPriceUnit | null }
  | {
      ok: false;
      reason:
        | "price_unit_half_stated"
        | "unknown_price_unit"
        | "bad_price_pack_size"
        | "price_pack_size_conflict";
      /** Operator-facing sentence. Safe to put in a 400 body. */
      message: string;
    };

function positiveInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
  return n;
}

/**
 * Read what the caller said the price's unit is — or refuse, in words.
 *
 * `{ ok: true, stated: null }` is the ordinary case for every order placed
 * before this shipped and every desk that does not state a unit: it is not an
 * error, it is an agreement whose price unit is unknown, and the register goes
 * on refusing it. What is an error is stating half of it.
 */
export function resolveStatedPriceUnit(input: {
  priceUom?: string | null;
  pricePackSize?: number | null;
}): PriceUnitResolution {
  const rawUom =
    typeof input.priceUom === "string" ? input.priceUom.trim() : "";
  const hasUom = rawUom !== "";
  const hasPack = input.pricePackSize != null;

  if (!hasUom && !hasPack) return { ok: true, stated: null };

  if (hasUom !== hasPack) {
    return {
      ok: false,
      reason: "price_unit_half_stated",
      message: hasUom
        ? `A price stated "per ${rawUom}" also has to say how many bottles are in one ${rawUom}. Half a statement cannot be converted, so it is refused rather than completed with a guess.`
        : `A pack size of ${input.pricePackSize} was given with no unit for the price to be in. A number with no unit is not a price.`,
    };
  }

  const priceUom = normalizeUom(rawUom);
  if (!priceUom) {
    return {
      ok: false,
      reason: "unknown_price_unit",
      message: `"${rawUom}" is not a unit a price can be stated in. Use one of: ${PRICE_UOM_TYPES.join(", ")}. An unrecognised unit is refused rather than assumed — every guess here is wrong by the pack size.`,
    };
  }

  const pricePackSize = positiveInt(input.pricePackSize);
  if (pricePackSize === null) {
    return {
      ok: false,
      reason: "bad_price_pack_size",
      message: `A pack size of ${JSON.stringify(input.pricePackSize)} divides a price instead of multiplying it. It must be a whole number of at least 1.`,
    };
  }

  if (!MULTIPLYING.has(priceUom) && pricePackSize !== 1) {
    return {
      ok: false,
      reason: "price_pack_size_conflict",
      message: `A price per ${priceUom} covers exactly one ${priceUom}, so its pack size must be 1, not ${pricePackSize}. A ${priceUom} priced per ${pricePackSize} is a case price with the wrong word on it.`,
    };
  }

  return { ok: true, stated: { priceUom, pricePackSize } };
}

/**
 * The pair as it sits on a `procurement_order_items` row, or null.
 *
 * Reads the database's own columns rather than a DTO, and applies the same
 * both-or-neither rule: a row that somehow carries only one half (a hand-written
 * UPDATE, a restore from before the CHECK) is read as UNSTATED rather than as
 * half a claim. The CHECK makes that unreachable through the app; this makes it
 * harmless if it ever is not.
 */
export function readStatedPriceUnit(
  row:
    | { price_uom?: string | null; price_pack_size?: number | null }
    | null
    | undefined,
): StatedPriceUnit | null {
  if (!row) return null;
  const resolved = resolveStatedPriceUnit({
    priceUom: row.price_uom ?? null,
    pricePackSize: row.price_pack_size ?? null,
  });
  return resolved.ok ? resolved.stated : null;
}

/**
 * "$420.00 per case (12 bottles)" — the phrase a person and a vendor both read.
 *
 * The pack is named only for a unit that actually holds more than one, because
 * "per bottle (1 bottle)" is noise, and named ALWAYS for one that does, because
 * a case price without its pack is the exact number this whole ADR is about.
 */
export function describeAgreedPrice(input: {
  price: number | null | undefined;
  stated: StatedPriceUnit | null;
}): string | null {
  // `Number(null)` is 0 and `Number.isFinite(0)` is true, so the absence has to
  // be tested before the coercion. Without this line an order with no price
  // renders "$0.00" — a fabricated figure of record, which is the one thing
  // this page is not allowed to print (ADR 0020).
  if (input.price == null) return null;
  const price = Number(input.price);
  if (!Number.isFinite(price)) return null;
  const money = `$${price.toFixed(2)}`;
  if (!input.stated) return money;
  const { priceUom, pricePackSize } = input.stated;
  const pack =
    pricePackSize > 1
      ? ` (${pricePackSize} bottle${pricePackSize === 1 ? "" : "s"})`
      : "";
  return `${money} per ${priceUom}${pack}`;
}

export type PerBottleResolution =
  | { ok: true; perBottle: number; note: string }
  | { ok: false; reason: string };

/**
 * The per-bottle figure `price_history` requires, derived ONCE and stated.
 *
 * `price_history.unit` is the hardcoded literal `'BOTTLE'`
 * (`procurement.service.ts` `recordPriceHistory`) and its own docblock records
 * that the column stays that way deliberately: a series whose unit could vary
 * is a series nothing can average. So a stated per-case price has to become a
 * per-bottle one before it enters that table, and the conversion has to be
 * visible.
 *
 * THIS IS NOT A SECOND CONVERSION OF THE REGISTER'S OPERANDS. ADR 0119
 * invariant 2 — one conversion, in one place, operands kept — is about
 * `vendor_price_observations`, where `normalizeUnitPrice` converts and
 * `raw_price`/`pack_size`/`unit_volume_ml` are stored beside the result so it
 * can be re-derived and disputed. That path is untouched: the sighting still
 * carries the document's own number in the document's own unit. This is the one
 * arithmetic `price_history`'s own column contract demands, and the note it
 * returns is written into that row's `notes` so it is re-derivable there too.
 *
 * An OPAQUE unit is REFUSED, not divided by one. A keg priced per keg has no
 * per-bottle reading; writing the keg price into a column that says BOTTLE
 * would be the same class of error as filing a case price as a bottle price,
 * which is what this build exists to end. ADR 0119 Q4 — whether the series
 * should carry a stated unit instead — is the founder's and is still open.
 */
export function perBottleFromAgreedPrice(input: {
  price: number | null | undefined;
  stated: StatedPriceUnit;
}): PerBottleResolution {
  const price = Number(input.price);
  if (!Number.isFinite(price) || price <= 0) {
    return {
      ok: false,
      reason: `the price is ${JSON.stringify(input.price)}, which is not an observation`,
    };
  }
  const { priceUom, pricePackSize } = input.stated;

  if (OPAQUE.has(priceUom)) {
    return {
      ok: false,
      reason: `the price is stated per ${priceUom}, and a ${priceUom} is not a number of bottles. price_history records a per-bottle series (its unit column is the literal 'BOTTLE'), so this price has no place in it — recording it would put a ${priceUom} price into a column asserting bottles`,
    };
  }

  if (pricePackSize === 1) {
    return {
      ok: true,
      perBottle: price,
      note: `Price stated per ${priceUom}, which holds one bottle; recorded as-is.`,
    };
  }

  return {
    ok: true,
    perBottle: Math.round((price / pricePackSize) * 10000) / 10000,
    note: `Price stated as $${price.toFixed(2)} per ${priceUom} of ${pricePackSize}; recorded per bottle as $${(price / pricePackSize).toFixed(4)}.`,
  };
}

export type AgreedTotalResolution =
  | { ok: true; total: number; note: string }
  | { ok: false; reason: "price_unit_not_countable"; message: string };

/**
 * What the agreement is worth, drawn from the stated pair rather than assumed.
 *
 * `createOrder` has always computed `totalCost = finalPrice × bottlesTotal`
 * with a comment saying "prices in this table are per BOTTLE". That is exactly
 * the inherited convention ADR 0119 exists to replace, and the moment a price
 * is stated *per case* it is wrong by the pack size — twelve times too high, in
 * the direction that looks like a disaster rather than a bargain, which is at
 * least the visible direction.
 *
 * The arithmetic is "how many of the PRICE's unit did we buy":
 *
 *   * no stated pair -> the historical per-bottle convention, unchanged. This
 *     is every order placed before this shipped and every desk that does not
 *     state a unit; changing their totals retroactively would be a backfill by
 *     another name.
 *   * both sides denominated in bottles -> `bottlesTotal / pricePackSize` of
 *     the price's unit. 60 bottles at $420 per case of 12 is 5 cases, $2,100.
 *     A fractional result is real trade (five bottles bought at a case price is
 *     five twelfths of a case) and is kept rather than rounded to a whole unit.
 *   * an OPAQUE quantity (keg, litre) -> countable only when the price is
 *     stated in that same word. A keg order priced per bottle has no bottle
 *     count to multiply, and `bottles_total` on such an order counts kegs, not
 *     bottles.
 *   * a bottle-denominated quantity priced per keg or per litre -> REFUSED.
 *     `total_cost` is NOT NULL, so there is no honest null to write, and the
 *     one thing worse than refusing the order is inventing its value (ADR 0011,
 *     ADR 0020).
 */
export function agreedOrderTotal(input: {
  price: number | null | undefined;
  stated: StatedPriceUnit | null;
  /** `resolveOrderUnits().bottlesTotal` — bottles, or kegs/litres when opaque. */
  bottlesTotal: number;
  /** The count in the order's own unit. */
  quantity: number;
  /** `resolveOrderUnits().unitType`. */
  unitType: Uom;
  /** `resolveOrderUnits().opaque` — true when bottlesTotal is not a bottle count. */
  opaque: boolean;
}): AgreedTotalResolution {
  const price = Number(input.price);
  const safePrice = Number.isFinite(price) ? price : 0;

  if (!input.stated) {
    return {
      ok: true,
      total: safePrice * input.bottlesTotal,
      note: "No price unit stated; totalled on the historical per-bottle convention.",
    };
  }

  const { priceUom, pricePackSize } = input.stated;

  if (input.opaque || OPAQUE.has(priceUom)) {
    if (priceUom === input.unitType) {
      return {
        ok: true,
        total: safePrice * input.quantity,
        note: `Totalled as ${input.quantity} × $${safePrice.toFixed(2)} per ${priceUom}.`,
      };
    }
    return {
      ok: false,
      reason: "price_unit_not_countable",
      message: `This order is placed in ${input.unitType}s and its price is stated per ${priceUom}. Nothing on the order says how many ${priceUom}s a ${input.unitType} is, so the order's value cannot be worked out — state the price in ${input.unitType}s, or in a unit that has a bottle count.`,
    };
  }

  const priceUnitsBought = input.bottlesTotal / pricePackSize;
  return {
    ok: true,
    total: Math.round(safePrice * priceUnitsBought * 100) / 100,
    note:
      pricePackSize === 1
        ? `Totalled as ${input.bottlesTotal} × $${safePrice.toFixed(2)} per ${priceUom}.`
        : `Totalled as ${input.bottlesTotal} bottles ÷ ${pricePackSize} = ${priceUnitsBought} ${priceUom}(s) × $${safePrice.toFixed(2)}.`,
  };
}

/**
 * Why this agreement is not on the price register — the sentence, not the log.
 *
 * ADR 0119 invariant 6: *a refusal a person cannot see is not a refusal.* The
 * gateway has always logged this; `/orders` now prints it, and the web page
 * carries its own copy of these words (`pages/orders/next/price-unit.ts`)
 * because a browser cannot import gateway code. The two are kept deliberately
 * close in wording — if they drift, the page is describing a refusal the
 * register does not make.
 */
export function unstatedPriceUnitSentence(what: string): string {
  return (
    `${what} states no unit for its price, so it does not enter the price register. ` +
    `A number with no unit cannot be told apart from a case price twelve times its size, ` +
    `and ranking one against the other recommends the wrong vendor by a factor of the pack.`
  );
}
