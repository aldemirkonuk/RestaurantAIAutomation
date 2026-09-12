/**
 * The unit an agreed price is stated in — the page's half of ADR 0119.
 *
 * WHY THESE WORDS EXIST TWICE
 * ---------------------------
 * The gateway's copy is `apps/api-gateway/src/procurement/agreed-price.ts`; a
 * browser cannot import it, and copying is the house rule for the next tree
 * (never import across a page boundary, never import a server module). The two
 * are kept deliberately close in wording, because a page that describes a
 * refusal the register does not make is worse than a page that says nothing:
 * the desk would learn a rule that is not the rule.
 *
 * If they drift, the gateway is right. Its refusal is the one that decides
 * whether a row enters `vendor_price_observations`; this file only explains it.
 *
 * WHAT THE DESK IS BEING ASKED
 * ----------------------------
 * Not "how many bottles are in a case" — the order already asks that, and
 * knowing it does not tell you which unit the PRICE is quoted in. The question
 * is the one ADR 0117's Q6 could not answer: *is $420 the case or the bottle?*
 * The two differ by the pack, always in the direction that looks like a
 * bargain, and no later reader can tell them apart.
 */

/**
 * The seven the database accepts.
 *
 * `procurement_order_items_price_uom_check`
 * (`20260905010000_an_agreed_price_states_its_unit.sql`), the same list as the
 * quantity's `unit_type`. Anything else is a 400 from the gateway, so the
 * picker offers exactly these and nothing else.
 */
export const PRICE_UOMS = [
  'bottle',
  'case',
  'keg',
  'pack',
  'split_case',
  'each',
  'liter',
] as const;
export type PriceUom = (typeof PRICE_UOMS)[number];

/** Units where one of them holds more than one bottle, so the pack matters. */
const MULTIPLYING = new Set<PriceUom>(['case', 'pack', 'split_case']);

/** Units with no bottle inside them at all — a keg is not `n` bottles. */
const OPAQUE = new Set<PriceUom>(['keg', 'liter']);

export function isMultiplying(uom: PriceUom | null): boolean {
  return uom !== null && MULTIPLYING.has(uom);
}

export function isOpaqueUnit(uom: PriceUom | null): boolean {
  return uom !== null && OPAQUE.has(uom);
}

/** What the picker says. The stored word is the value; this is the reading. */
export const PRICE_UOM_LABEL: Record<PriceUom, string> = {
  bottle: 'per bottle',
  case: 'per case',
  keg: 'per keg',
  pack: 'per pack',
  split_case: 'per split case',
  each: 'per each',
  liter: 'per litre',
};

export interface StatedPriceUnit {
  priceUom: PriceUom;
  pricePackSize: number;
}

/**
 * "$420.00 per case (12 bottles)". Mirrors the gateway's `describeAgreedPrice`.
 *
 * Returns null for an absent price rather than "$0.00": `Number(null)` is 0 and
 * a fabricated zero is the one figure this page may never print (ADR 0020).
 */
export function describeStatedPrice(
  price: number | null | undefined,
  stated: StatedPriceUnit | null,
): string | null {
  if (price == null || !Number.isFinite(Number(price))) return null;
  const money = `$${Number(price).toFixed(2)}`;
  if (!stated) return money;
  const pack =
    stated.pricePackSize > 1 ? ` (${stated.pricePackSize} bottles)` : '';
  return `${money} per ${stated.priceUom.replace('_', ' ')}${pack}`;
}

/**
 * The money on an agreement line that is NOT the price of the wine — ADR 0119
 * Q3, the page's half of `procurement_order_items.allowance/deposit/freight`.
 *
 * All three are POSITIVE amounts for the WHOLE line. `allowance` deducts;
 * `deposit` and `freight` add. The direction is in the name, never in a sign,
 * and the gateway's CHECKs refuse a negative.
 *
 * `null` is "the agreement named none", `0` is "the agreement named zero", and
 * nothing on this page turns the first into the second — a $0.00 deposit is a
 * claim about a vendor and an absent one is not.
 */
export interface AgreementFees {
  allowance: number | null;
  deposit: number | null;
  freight: number | null;
}

export const NO_FEES: AgreementFees = {
  allowance: null,
  deposit: null,
  freight: null,
};

export function hasStatedFees(fees: AgreementFees): boolean {
  return (
    fees.allowance !== null || fees.deposit !== null || fees.freight !== null
  );
}

function feeAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/**
 * The fees the route sent — and whether it sent them at all.
 *
 * The same three-state contract as `readPriceUnitFromWire`, for the same
 * reason: a route that reads the line's price columns but not its fee columns
 * emits no fee keys, and reading their absence as "no deposit was agreed" would
 * be a claim of knowledge nobody has.
 */
export function readFeesFromWire(o: {
  allowance?: number | null;
  deposit?: number | null;
  freight?: number | null;
}): { read: boolean; fees: AgreementFees } {
  const read = 'allowance' in o || 'deposit' in o || 'freight' in o;
  if (!read) return { read: false, fees: NO_FEES };
  return {
    read: true,
    fees: {
      allowance: feeAmount(o.allowance),
      deposit: feeAmount(o.deposit),
      freight: feeAmount(o.freight),
    },
  };
}

export type AgreementTotal =
  | { ok: true; goods: number; total: number; working: string }
  | { ok: false; message: string };

/**
 * What the agreement is worth, drawn from the pair — and the working shown.
 *
 * The same arithmetic the gateway will do (`agreedOrderTotal`), computed here
 * so the desk sees the number BEFORE it commits rather than discovering it on
 * the row afterwards. `working` is the sentence printed under the figure: the
 * house shows its working for every total it prints, and a total whose unit was
 * just chosen by a picker is exactly where that matters.
 *
 * A shape the order cannot be counted in returns a refusal rather than a
 * number, because the gateway will refuse it too and a page that showed a total
 * for an order the server will reject has told the desk something untrue.
 */
export function agreementTotal(input: {
  price: number | null;
  stated: StatedPriceUnit | null;
  quantity: number | null;
  unitType: PriceUom;
  bottlesPerUnit: number | null;
  /**
   * The money outside the price of the wine (ADR 0119 Q3). Absent means the
   * agreement names none, and the total and its working are then byte for byte
   * what they were before phase 2 — no existing figure moves.
   */
  fees?: AgreementFees;
}): AgreementTotal | null {
  const { price, stated, quantity, unitType } = input;
  if (price == null || quantity == null || !Number.isFinite(price)) return null;

  const orderOpaque = OPAQUE.has(unitType);
  const bottlesPerUnit = orderOpaque ? 1 : (input.bottlesPerUnit ?? 1);
  const bottlesTotal = quantity * bottlesPerUnit;
  const fees = input.fees ?? NO_FEES;

  // The goods half first — the wine at the agreed price, in the price's own
  // unit — then the fees, applied where a reader can watch it happen. Mirrors
  // the gateway's `agreementLineTotal`, which is the number that actually gets
  // written; if the two ever disagree the desk is shown a total the server will
  // not honour.
  const goodsOnly = (goods: number, working: string): AgreementTotal => {
    if (!hasStatedFees(fees)) {
      return { ok: true, goods, total: goods, working };
    }
    const total =
      Math.round(
        (goods -
          (fees.allowance ?? 0) +
          (fees.deposit ?? 0) +
          (fees.freight ?? 0)) *
          100,
      ) / 100;
    const parts = [`Goods $${goods.toFixed(2)}`];
    if (fees.allowance !== null)
      parts.push(`less allowance $${fees.allowance.toFixed(2)}`);
    if (fees.deposit !== null)
      parts.push(`plus deposit $${fees.deposit.toFixed(2)}`);
    if (fees.freight !== null)
      parts.push(`plus freight $${fees.freight.toFixed(2)}`);
    // NO trailing "= $total": the sheet prints the figure above this sentence
    // and the ledger row prints it after, so carrying it here printed it twice
    // on the row. Measured in the first capture of this pass.
    return {
      ok: true,
      goods,
      total,
      working: `${working} ${parts.join(', ')}.`,
    };
  };

  if (!stated) {
    return goodsOnly(
      price * bottlesTotal,
      `${bottlesTotal} × $${price.toFixed(2)} — no price unit stated, so this uses the old per-bottle convention.`,
    );
  }

  if (orderOpaque || OPAQUE.has(stated.priceUom)) {
    if (stated.priceUom === unitType) {
      return goodsOnly(
        price * quantity,
        `${quantity} × $${price.toFixed(2)} per ${unitType}.`,
      );
    }
    return {
      ok: false,
      message: `This order is placed in ${unitType}s and the price is stated per ${stated.priceUom}. Nothing says how many ${stated.priceUom}s a ${unitType} is, so the order's value cannot be worked out.`,
    };
  }

  const unitsBought = bottlesTotal / stated.pricePackSize;
  return goodsOnly(
    Math.round(price * unitsBought * 100) / 100,
    stated.pricePackSize === 1
      ? `${bottlesTotal} × $${price.toFixed(2)} per ${stated.priceUom}.`
      : `${bottlesTotal} bottles ÷ ${stated.pricePackSize} = ${unitsBought} ${stated.priceUom}${unitsBought === 1 ? '' : 's'} × $${price.toFixed(2)}.`,
  );
}

/**
 * "an allowance of $25.00, a deposit of $6.00" — the fees a row prints.
 *
 * Returns null when the agreement names none, so a row that has no fees prints
 * nothing rather than a line saying so: absence of a fee is the ordinary case
 * and does not need announcing. Absence of a READ does — see
 * `ROW_FEES_NOT_READ`.
 */
export function describeFees(fees: AgreementFees): string | null {
  const parts = [
    fees.allowance !== null
      ? `an allowance of $${fees.allowance.toFixed(2)}`
      : null,
    fees.deposit !== null ? `a deposit of $${fees.deposit.toFixed(2)}` : null,
    fees.freight !== null ? `freight of $${fees.freight.toFixed(2)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/**
 * What a row says when the route never read the fee columns.
 *
 * `GET /procurement/orders` reads them, so this is unreachable from the ledger
 * today. It exists for the same reason `ROW_PRICE_UNIT_NOT_READ` does: the day
 * a second route feeds these rows without the fee columns, the row must not
 * announce that the agreement names no deposit.
 */
export const ROW_FEES_NOT_READ =
  'This view did not read what the agreement charges outside the price of the wine. ' +
  'That is not the same as the agreement charging nothing.';

/**
 * The refusal the register would give, in the register's own terms.
 *
 * ADR 0119 invariant 6: *a refusal a person cannot see is not a refusal.* Until
 * now this was a `logger.warn` in the gateway and `/orders` said nothing, so a
 * house that buys everything by the case got a permanently empty `quote` tier
 * and no screen anywhere explained why. The desk sees it here, before saving,
 * with the one thing that fixes it.
 */
export const UNSTATED_PRICE_UNIT_REFUSAL =
  'Saved without a price unit, this agreement does not enter the price register. ' +
  'A number with no unit cannot be told apart from a case price twelve times its size, ' +
  'and ranking one against the other recommends the wrong vendor by a factor of the pack.';

/** The half-statement the gateway 400s on, said before the request is made. */
export function halfStatedRefusal(uom: PriceUom): string {
  return `A price stated "per ${uom.replace('_', ' ')}" also has to say how many bottles are in one. Half a statement cannot be converted, so it is refused rather than completed with a guess.`;
}

/**
 * What the LIST ROUTE said about one order's price unit — and whether it said
 * anything at all.
 *
 * `GET /procurement/orders` carries `priceUom` / `pricePackSize` since ADR 0119
 * phase 2, and the DTO's contract has three values, not two:
 *
 *   * both stated        -> `{ read: true, stated: {...} }`
 *   * both JSON `null`   -> `{ read: true, stated: null }` — the line was read
 *                           and states no unit. The register refuses it, and
 *                           the row prints that refusal.
 *   * the KEYS ABSENT    -> `{ read: false, stated: null }` — this payload came
 *                           from a route that does not read the order line, so
 *                           nothing here knows either way.
 *
 * The third case is the one that has to survive: reading an absent key as
 * "unstated" would print a refusal about a line nobody looked at, which is the
 * absence-reported-as-health fault pointed the other way — a claim of knowledge
 * where there is none. `'priceUom' in o` is the test, because that is exactly
 * the distinction JSON preserves.
 *
 * A half-stated pair (one key null, the other set) is read as UNSTATED rather
 * than as half a claim, matching the gateway's `readStatedPriceUnit` and the
 * database CHECK that makes it unreachable in the first place.
 */
export interface PriceUnitReading {
  read: boolean;
  stated: StatedPriceUnit | null;
}

export function readPriceUnitFromWire(o: {
  priceUom?: string | null;
  pricePackSize?: number | null;
}): PriceUnitReading {
  const read = 'priceUom' in o || 'pricePackSize' in o;
  if (!read) return { read: false, stated: null };

  const raw = typeof o.priceUom === 'string' ? o.priceUom.trim() : '';
  const pack = Number(o.pricePackSize);
  if (raw === '' || !Number.isInteger(pack) || pack < 1) {
    return { read: true, stated: null };
  }
  const uom = (PRICE_UOMS as readonly string[]).includes(raw)
    ? (raw as PriceUom)
    : null;
  if (uom === null) return { read: true, stated: null };
  if (!MULTIPLYING.has(uom) && pack !== 1) return { read: true, stated: null };
  return { read: true, stated: { priceUom: uom, pricePackSize: pack } };
}

/**
 * The sentence a ledger row prints under a price whose unit is not stated.
 *
 * Shorter than `UNSTATED_PRICE_UNIT_REFUSAL`, which is written for the moment
 * of SAVING (it says "saved without a price unit" and offers the fix). On a row
 * the agreement already exists, so the row states the consequence in the
 * present tense instead of warning about it. Same fact, same register, and the
 * gateway's `unstatedPriceUnitSentence` is the authority if the two drift.
 */
export const ROW_UNSTATED_PRICE_UNIT =
  'No unit is stated for this price, so the agreement is not on the price register. ' +
  'A number with no unit cannot be told apart from a case price twelve times its size.';

/**
 * The sentence a row prints when the PAGE was never told, as distinct from
 * being told "nothing was stated".
 *
 * `GET /procurement/orders` always carries the pair, so this is unreachable
 * from the ledger today. It exists because the alternative to an unreachable
 * sentence is a reachable lie: the day a second route feeds these rows without
 * the join, the row would otherwise announce a refusal about a line that was
 * never read.
 */
export const ROW_PRICE_UNIT_NOT_READ =
  'This view did not read the order line, so nothing here says what unit the price is in. ' +
  'That is not the same as the line stating none.';
