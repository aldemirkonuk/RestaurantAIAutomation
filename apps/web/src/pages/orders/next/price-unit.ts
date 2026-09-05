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

export type AgreementTotal =
  | { ok: true; total: number; working: string }
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
}): AgreementTotal | null {
  const { price, stated, quantity, unitType } = input;
  if (price == null || quantity == null || !Number.isFinite(price)) return null;

  const orderOpaque = OPAQUE.has(unitType);
  const bottlesPerUnit = orderOpaque ? 1 : (input.bottlesPerUnit ?? 1);
  const bottlesTotal = quantity * bottlesPerUnit;

  if (!stated) {
    return {
      ok: true,
      total: price * bottlesTotal,
      working: `${bottlesTotal} × $${price.toFixed(2)} — no price unit stated, so this uses the old per-bottle convention.`,
    };
  }

  if (orderOpaque || OPAQUE.has(stated.priceUom)) {
    if (stated.priceUom === unitType) {
      return {
        ok: true,
        total: price * quantity,
        working: `${quantity} × $${price.toFixed(2)} per ${unitType}.`,
      };
    }
    return {
      ok: false,
      message: `This order is placed in ${unitType}s and the price is stated per ${stated.priceUom}. Nothing says how many ${stated.priceUom}s a ${unitType} is, so the order's value cannot be worked out.`,
    };
  }

  const unitsBought = bottlesTotal / stated.pricePackSize;
  return {
    ok: true,
    total: Math.round(price * unitsBought * 100) / 100,
    working:
      stated.pricePackSize === 1
        ? `${bottlesTotal} × $${price.toFixed(2)} per ${stated.priceUom}.`
        : `${bottlesTotal} bottles ÷ ${stated.pricePackSize} = ${unitsBought} ${stated.priceUom}${unitsBought === 1 ? '' : 's'} × $${price.toFixed(2)}.`,
  };
}

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
