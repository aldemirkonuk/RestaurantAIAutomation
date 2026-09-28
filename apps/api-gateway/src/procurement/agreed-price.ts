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
      ? ` (${pricePackSize} bottles)`
      : "";
  return `${money} per ${priceUom}${pack}`;
}

export type PerBottleResolution =
  | { ok: true; perBottle: number; note: string }
  | { ok: false; reason: string };

/**
 * A stated price, converted ONCE to per bottle, with the arithmetic returned.
 *
 * **SUPERSEDED AS THE `price_history` PATH — ADR 0119 Q4, 2026-09-05.** This
 * was written for a series whose `unit` column was the hardcoded literal
 * `'BOTTLE'`, so a case price had to be divided before it could enter. The
 * founder has since decided that the series carries the STATED unit
 * (`20260905072500_the_price_series_states_its_unit.sql`), so `recordPriceHistory`
 * no longer converts anything and no longer calls this.
 *
 * It survives as the ONE implementation of this division in the tree, used by
 * `agreedPricePerBottleForDoor`: `invoice-match.ts` genuinely does compare
 * bottle-equivalents, so the receiving door genuinely does need a per-bottle
 * reading of a case-priced agreement. Everything below still holds for that
 * caller.
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

/**
 * What one ROUTE knows about an order's agreed price unit.
 *
 * Two states, and the distinction between them is the whole point of the type:
 * `{ read: false }` means this route never looked at `procurement_order_items`,
 * so it can say nothing; `{ read: true, stated: null }` means it looked and the
 * line states no unit. They serialise differently on purpose — the first omits
 * both DTO keys, the second sends them as JSON `null` — because a consumer that
 * read an ABSENT key as "unstated" would be reporting the absence of a read as
 * a fact about the row, which is the fault ADR 0020 and the house's
 * absence-reported-as-health rule name.
 *
 * `mapOrderRow` defaults to `{ read: false }`, so a new caller that forgets to
 * pass a reading says nothing rather than saying "unstated": the failure mode
 * of forgetting is silence, never a fabricated fact.
 */
export type AgreedPriceUnitReading =
  | { read: false }
  | {
      read: true;
      stated: StatedPriceUnit | null;
      /**
       * The money outside the price (ADR 0119 Q3), when this route read those
       * columns too. OPTIONAL for the same reason `read` exists at all: a route
       * that selected `price_uom` but not `allowance` knows nothing about the
       * fees, and emitting `allowance: null` would report the absence of a read
       * as "the agreement names no allowance". Absent here means the fee keys
       * are absent on the wire.
       */
      fees?: AgreementFees;
    };

/**
 * The one price unit an ORDER can be said to have, folded from its lines.
 *
 * The pair lives on the LINE (ADR 0119 option O1) and the header carries no
 * unit of its own — `procurement_orders.final_price` is an echo by comment
 * (`20260905010000_an_agreed_price_states_its_unit.sql`). So a header-level
 * field can only ever report a unit the lines AGREE on, and this is where that
 * agreement is decided:
 *
 *   * no lines at all       -> null. A header with no line under it states
 *                              nothing.
 *   * one line, pair stated -> that pair. The ordinary case: one line per order
 *                              (`upsertOrderLine` writes `line_no: 1` and
 *                              deletes the rest before inserting).
 *   * any line unstated     -> null. A half-stated order has no single unit,
 *                              and printing the stated half would attach one
 *                              line's unit to another line's money.
 *   * lines that DISAGREE   -> null, for the same reason. Two units is not a
 *                              header fact.
 *
 * Every null here reaches the page as the register's own refusal sentence, so a
 * fold that loses a unit costs a sentence, never a wrong number.
 */
export function foldOrderPriceUnit(
  lines:
    | ReadonlyArray<{
        price_uom?: string | null;
        price_pack_size?: number | null;
      }>
    | null
    | undefined,
): StatedPriceUnit | null {
  if (!Array.isArray(lines) || lines.length === 0) return null;

  let agreed: StatedPriceUnit | null = null;
  for (const line of lines) {
    const stated = readStatedPriceUnit(line);
    if (!stated) return null;
    if (agreed === null) {
      agreed = stated;
      continue;
    }
    if (
      agreed.priceUom !== stated.priceUom ||
      agreed.pricePackSize !== stated.pricePackSize
    ) {
      return null;
    }
  }
  return agreed;
}

/* ==========================================================================
 * PHASE 2 (ADR 0119, founder decisions Q3, Q4 and Q6, 2026-09-05)
 * ==========================================================================
 * Q3 — the money outside the unit price gets its own columns on the agreement
 *      line, mirroring the invoice, and the total prints its working.
 * Q4 — `price_history` carries a STATED unit; nothing is converted on the way
 *      in, and an agreement that states no unit does not enter the series.
 * Q6 — a split case is its own agreement line, never a surcharge on the case
 *      line.
 * ========================================================================== */

/**
 * The money on an agreement line that is NOT the price of the wine.
 *
 * `20260905073000_the_agreement_names_the_money_outside_the_price.sql` — three
 * nullable `numeric(12,2)` columns mirroring `procurement_document_lines`'
 * `allowance` and `deposit`, plus the freight the invoice codes at document
 * level. ADR 0119 invariant 5: *money outside the unit price is named, not
 * folded in.*
 *
 * All three are POSITIVE amounts for the WHOLE LINE. `allowance` deducts;
 * `deposit` and `freight` add. The direction is carried by the name, never by a
 * sign — a negative allowance is a charge wearing a deduction's name, and the
 * database CHECKs refuse one.
 *
 * `null` and `0` are different facts and both are legal: `null` is *the
 * agreement said nothing about a deposit*, `0` is *the agreement says there is
 * none*. Nothing here ever turns the first into the second.
 */
export interface AgreementFees {
  allowance: number | null;
  deposit: number | null;
  freight: number | null;
}

/** No fee stated at all — every line written before ADR 0119 phase 2. */
export const NO_AGREEMENT_FEES: AgreementFees = {
  allowance: null,
  deposit: null,
  freight: null,
};

function feeAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/**
 * The three fees as they sit on a row or a DTO.
 *
 * A value that is not a non-negative finite number is read as ABSENT rather
 * than as zero: a `"abc"` deposit is something nobody stated, and reading it as
 * $0.00 would put "the vendor charged no deposit" into the record on the
 * strength of a typo.
 */
export function readAgreementFees(
  row:
    | {
        allowance?: number | string | null;
        deposit?: number | string | null;
        freight?: number | string | null;
      }
    | null
    | undefined,
): AgreementFees {
  if (!row) return { ...NO_AGREEMENT_FEES };
  return {
    allowance: feeAmount(row.allowance),
    deposit: feeAmount(row.deposit),
    freight: feeAmount(row.freight),
  };
}

/** Does this agreement name any money outside the goods price? */
export function hasStatedFees(fees: AgreementFees): boolean {
  return (
    fees.allowance !== null || fees.deposit !== null || fees.freight !== null
  );
}

export type AgreementLineTotal =
  | {
      ok: true;
      /** The wine, at the agreed price, before any fee. */
      goods: number;
      /** goods − allowance + deposit + freight. What the line comes to. */
      total: number;
      /** The whole arithmetic, in one sentence, for printing beside the figure. */
      working: string;
    }
  | { ok: false; reason: "price_unit_not_countable"; message: string };

/**
 * What the line comes to, with the fees named and the working printed.
 *
 * The goods half is `agreedOrderTotal` unchanged — the same arithmetic phase 1
 * shipped, drawn from the price's own unit. This adds the second half of ADR
 * 0119 invariant 5: the fees are applied HERE, visibly, rather than being
 * absorbed into a unit price where nothing could ever separate them again.
 *
 * With all three fees NULL the total is the goods total and the working is the
 * goods working, byte for byte — which is every line written before phase 2, so
 * no existing figure moves.
 */
export function agreementLineTotal(input: {
  price: number | null | undefined;
  stated: StatedPriceUnit | null;
  bottlesTotal: number;
  quantity: number;
  unitType: Uom;
  opaque: boolean;
  fees: AgreementFees;
}): AgreementLineTotal {
  const goodsResolution = agreedOrderTotal(input);
  if (!goodsResolution.ok) return goodsResolution;

  const goods = Math.round(goodsResolution.total * 100) / 100;
  const { allowance, deposit, freight } = input.fees;

  if (!hasStatedFees(input.fees)) {
    return { ok: true, goods, total: goods, working: goodsResolution.note };
  }

  const total =
    Math.round(
      (goods - (allowance ?? 0) + (deposit ?? 0) + (freight ?? 0)) * 100,
    ) / 100;

  const parts: string[] = [`Goods $${goods.toFixed(2)}`];
  if (allowance !== null) parts.push(`less allowance $${allowance.toFixed(2)}`);
  if (deposit !== null) parts.push(`plus deposit $${deposit.toFixed(2)}`);
  if (freight !== null) parts.push(`plus freight $${freight.toFixed(2)}`);

  // NO trailing "= $total" here. Both callers print the figure themselves —
  // the sheet above the working, the ledger row after it — and a sentence that
  // carried the total too printed it twice on the row, measured in the first
  // capture of this pass (`$SP/shots-price-unit-2/`, "= $2178.00. = $2,178.00").
  return {
    ok: true,
    goods,
    total,
    working: `${goodsResolution.note} ${parts.join(", ")}.`,
  };
}

/**
 * A split case is its own line — the refusal, in words, before the 23514.
 *
 * ADR 0119 Q6, decided by the founder on 2026-09-05: *a split case is its own
 * agreement line — a different pack with a different price, never a surcharge
 * on the case line.* GS1's rule is the warrant: a change to the number of items
 * in a pack requires a new GTIN, so a broken case is a different trade item,
 * and a different trade item is a different line.
 *
 * What `split_case` NOW MEANS, having been a bare vocabulary word until this
 * decision: **the line is the broken case itself, priced as its own trade
 * item**, with `price_pack_size` the number of bottles actually in the broken
 * pack — not the number in a full case, and not a fee bolted onto one.
 *
 * The one shape a single row can be refused for is the one this returns a
 * sentence for, matching
 * `procurement_order_items_split_case_own_line_check`: `case` on one axis and
 * `split_case` on the other. Everything else stays legal, including a broken
 * case bought as loose bottles and priced per split case.
 */
export function splitCaseOwnLineRefusal(input: {
  priceUom: Uom | null;
  unitType: Uom | null;
}): string | null {
  const { priceUom, unitType } = input;
  if (priceUom === null || unitType === null) return null;

  if (priceUom === "split_case" && unitType === "case") {
    return (
      "Whole cases cannot be bought at a split-case price. A split case is a broken case — a different pack, " +
      "and therefore a different agreement line with its own price, never a surcharge on the case line. " +
      "Write the full cases on one line at the case price and the broken case on its own line at the split-case price."
    );
  }

  if (priceUom === "case" && unitType === "split_case") {
    return (
      "A split case cannot be priced at the full case price. If the vendor charges the case price for a broken case, " +
      "the difference is a split-case charge on its own line, not a case price attached to a quantity of split cases."
    );
  }

  return null;
}

/**
 * How the unit of a `price_history` observation is KNOWN — never assumed.
 *
 * ADR 0119 Q4, decided by the founder on 2026-09-05: *`price_history` carries a
 * stated unit; kegs and cases enter with their own unit; every comparison
 * groups by unit first.* Option B in the ADR, over option A (a strictly
 * per-bottle series with a conversion on the way in), which the ADR itself
 * called "the current shape and a lie the moment a keg is priced".
 *
 * Three claims, and the third is the point:
 *
 *   * `stated` — the agreement line states a `(price_uom, price_pack_size)`
 *     pair. The series records that unit and that price, unconverted. A case
 *     price enters as a case price.
 *   * `bottle_equivalent` — the caller has already converted every operand to
 *     bottles and can say WHERE. `verifyReceipt` is the one such caller:
 *     `computeMatch` converts all four documents to bottle-equivalents and
 *     refuses a unit it cannot read (`invoice-match.ts`), so its
 *     `effectiveUnitCost` is per bottle as a measured fact rather than a
 *     convention. `because` is written into the row's `notes`.
 *   * `unstated` — nothing says what unit the price is in. REFUSED. This is
 *     what phase 1's `'BOTTLE'` literal silently answered for, and it is the
 *     same refusal `decideOwnPaperSighting` already makes about the same event,
 *     so the two registers now decline the same rows for the same reason
 *     instead of one of them inventing a unit (ADR 0119 invariant 7).
 */
export type PriceSeriesUnitClaim =
  | { kind: "stated"; stated: StatedPriceUnit }
  | { kind: "bottle_equivalent"; because: string }
  | { kind: "unstated" };

export type PriceSeriesUnitResolution =
  | { ok: true; unit: Uom; note: string }
  | { ok: false; reason: string };

/**
 * The unit `price_history.unit` records, or the sentence saying why no row is
 * written.
 *
 * NOTHING IS CONVERTED HERE, deliberately. Phase 1's
 * `perBottleFromAgreedPrice` divided a case price by its pack on the way into a
 * column that said BOTTLE; the column now says `case`, so the division is not
 * only unnecessary, it would destroy the operand the series is supposed to
 * hold. The one conversion the platform performs is still
 * `normalizeUnitPrice`'s, on the register side, with its operands stored beside
 * the result (ADR 0119 invariant 2) — and there is now exactly one fewer
 * conversion in the tree than there was.
 */
export function priceSeriesUnit(
  claim: PriceSeriesUnitClaim,
): PriceSeriesUnitResolution {
  switch (claim.kind) {
    case "stated":
      return {
        ok: true,
        unit: claim.stated.priceUom,
        note:
          claim.stated.pricePackSize > 1
            ? `Recorded per ${claim.stated.priceUom} of ${claim.stated.pricePackSize}, as agreed; not converted.`
            : `Recorded per ${claim.stated.priceUom}, as agreed; not converted.`,
      };
    case "bottle_equivalent":
      return {
        ok: true,
        unit: "bottle",
        note: `Recorded per bottle: ${claim.because}`,
      };
    case "unstated":
      return {
        ok: false,
        reason:
          "the agreement states no unit for its price, and price_history.unit is NOT NULL with no default — " +
          "a number with no unit cannot be told apart from a case price twelve times its size, so it is refused " +
          "rather than filed as a bottle price",
      };
  }
}

/**
 * The agreed price of an order, per BOTTLE, for the receiving door only.
 *
 * `verifyReceipt` compares the agreement's price against the invoice's, and
 * `invoice-match.ts` converts every operand to bottle-equivalents before it
 * compares anything (`poUnitPrice` is documented PER BOTTLE there). Measured on
 * this tree, the door fed it `procurement_orders.final_price` — the header, which
 * names no unit at all — so a case-priced agreement was compared against a
 * per-bottle invoice price and reported a price variance of a factor of the
 * pack, in the direction that reads as the vendor overcharging.
 *
 * This is the conversion that comparison needs, done once, from the LINE's own
 * stated pair, with the reason returned so the caller can say it. An OPAQUE
 * unit has no per-bottle reading, so the comparison is REFUSED rather than
 * made: a keg price tested against a per-bottle invoice figure produces a
 * confident wrong verdict, which is the fault `invoice-match` exists to end.
 */
export type DoorPriceResolution =
  | { ok: true; perBottle: number; note: string }
  | { ok: false; reason: string };

export function agreedPricePerBottleForDoor(input: {
  price: number | null | undefined;
  stated: StatedPriceUnit | null;
}): DoorPriceResolution {
  if (!input.stated) {
    // Nothing changed for an order that states no unit: the door compares the
    // number it has always compared, on the convention it has always used. A
    // "fix" that started refusing every legacy order at the receiving door
    // would close the door, not the gap.
    const price = Number(input.price);
    if (input.price == null || !Number.isFinite(price)) {
      return { ok: false, reason: "the order carries no agreed price" };
    }
    return {
      ok: true,
      perBottle: price,
      note: "No price unit stated on the line; compared on the historical per-bottle convention, unchanged.",
    };
  }

  // ONE implementation of this division in the tree, deliberately. Phase 1 put
  // it in `perBottleFromAgreedPrice` for `price_history`; ADR 0119 Q4 has since
  // taken that table off per-bottle, so this is now its only caller — the same
  // arithmetic, re-worded for the surface that asks (the refusal a receiver
  // reads must be about the invoice comparison, not about a price series).
  const converted = perBottleFromAgreedPrice({
    price: input.price,
    stated: input.stated,
  });
  if (!converted.ok) {
    const { priceUom } = input.stated;
    if (OPAQUE.has(priceUom)) {
      return {
        ok: false,
        reason: `the agreement is priced per ${priceUom}, and a ${priceUom} is not a number of bottles — the invoice's per-bottle price cannot be compared against it, and comparing them anyway would report a variance of whatever the two units differ by`,
      };
    }
    return { ok: false, reason: converted.reason };
  }

  const { priceUom, pricePackSize } = input.stated;
  return {
    ok: true,
    perBottle: converted.perBottle,
    note:
      pricePackSize === 1
        ? `Agreed per ${priceUom}, which holds one bottle; compared as-is.`
        : `Agreed at $${Number(input.price).toFixed(2)} per ${priceUom} of ${pricePackSize}; compared per bottle at $${converted.perBottle.toFixed(4)}.`,
  };
}

/** One embedded `procurement_order_items` row, as far as the money cares. */
export interface EmbeddedPriceUnitLine {
  price_uom?: string | null;
  price_pack_size?: number | null;
  allowance?: number | string | null;
  deposit?: number | string | null;
  freight?: number | string | null;
}

/**
 * PostgREST hands an embedded child back as an array, as a single object, or
 * not at all, depending on the relationship it inferred and how many rows
 * matched. All three are the same fact — the lines under this order — so they
 * are flattened here rather than at each call site, where the single-object
 * case is the one that gets forgotten and then silently reads as "no lines".
 */
export function embeddedOrderLines(value: unknown): EmbeddedPriceUnitLine[] {
  if (Array.isArray(value)) return value as EmbeddedPriceUnitLine[];
  if (value && typeof value === "object") return [value as EmbeddedPriceUnitLine];
  return [];
}
