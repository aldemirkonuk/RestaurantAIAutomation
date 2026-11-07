/**
 * An invoice line's printed price, as the cost of ONE bottle on the shelf.
 *
 * QA round 7c B1 (2026-11-07): `finaliseAtVerified` posted `unit_price` — the
 * price AS PRINTED, per the line's own price base — as the lot's per-bottle
 * cost, so `2 cases @ 264 / case, pack 12` booked 264 a bottle (22 is right)
 * and `142,00 / KS(12)` booked 142 (11.8333 is right).
 *
 * The rule, in the vocabulary of `lineNetFromPrice` and PR #780's
 * `landed-cost.ts`: the price is FOR `price_base_qty` (BT-149) of
 * `price_base_uom` (BT-150); no base means "per one `uom`", no base unit means
 * the line's own `uom`. Per bottle = unit_price ÷ toBottles(base, baseUom,
 * pack_size), through the tree's one bottle-equivalent conversion.
 *
 * It REFUSES rather than guessing, with the reason, so the lot stays
 * provisional by name: a packed price unit whose `pack_size` is unstated (the
 * column's DEFAULT 1 means "the paper did not say"), an unknown unit, a bad
 * base, a keg or litre against any other unit. A keg priced per keg on a keg
 * line passes through: `toBottles` leaves that line's count in kegs, so the
 * cost is per the unit the lot counts, as on `main`.
 *
 * Not here: freight, fees, deposits, allowances, free goods — landed cost is
 * PR #780 and its wiring follow-up.
 */

import {
  comparableUnits,
  toBottles,
  Uom,
  UOMS,
} from "../documents/document-types";

/** The money and unit columns of one `procurement_document_lines` row. */
export interface LotCostLine {
  unit_price: number | string | null | undefined;
  uom: string | null | undefined;
  pack_size: number | string | null | undefined;
  price_base_qty: number | string | null | undefined;
  price_base_uom: string | null | undefined;
}

export type LotUnitCost =
  /**
   * `perBottle` is exact to four places; `unitCost` is that figure at the
   * precision `inventory_lots.unit_cost` keeps (see `toLotCostPrecision`) and
   * is what the RPC is sent; `basis` says how it was reached, in words.
   */
  | { ok: true; perBottle: number; unitCost: number; basis: string }
  /** The line prints no usable price. Not a refusal: there is nothing to convert. */
  | { ok: false; kind: "no_price" }
  /** There is a price, but nothing on the line says what one bottle of it costs. */
  | { ok: false; kind: "refused"; reason: string };

/** Units where one of them holds `pack_size` bottles. Mirrors `agreed-price.ts`. */
const MULTIPLYING: ReadonlySet<Uom> = new Set<Uom>([
  "case",
  "pack",
  "split_case",
]);

function asUom(v: unknown): Uom | null {
  return typeof v === "string" && (UOMS as readonly string[]).includes(v)
    ? (v as Uom)
    : null;
}

function asNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const words = (u: Uom) => u.replace("_", " ");
const four = (n: number) => Math.round(n * 10000) / 10000;

export function perBottleLotCost(line: LotCostLine): LotUnitCost {
  const price = asNumber(line.unit_price);
  // Skipped before this existed, and still: not a price anybody agreed.
  if (price == null || price <= 0) return { ok: false, kind: "no_price" };

  const uom = asUom(line.uom);
  if (!uom)
    return {
      ok: false,
      kind: "refused",
      reason: `the invoice line's unit reads ${JSON.stringify(line.uom ?? null)}, which is not a unit this house counts in, so its price of ${price} cannot be turned into a price per bottle`,
    };

  const rawBase = line.price_base_qty;
  const base = rawBase == null || rawBase === "" ? 1 : asNumber(rawBase);
  if (base == null || base <= 0)
    return {
      ok: false,
      kind: "refused",
      reason: `the invoice line prints its price for ${JSON.stringify(rawBase)} units, which cannot be divided by`,
    };

  const rawBaseUom = line.price_base_uom;
  const baseUom =
    rawBaseUom == null || rawBaseUom === "" ? uom : asUom(rawBaseUom);
  if (!baseUom)
    return {
      ok: false,
      kind: "refused",
      reason: `the invoice line prints its price per ${JSON.stringify(rawBaseUom)}, which is not a unit this house counts in`,
    };

  if (!comparableUnits(uom, baseUom))
    return {
      ok: false,
      kind: "refused",
      reason: `the invoice line is counted in ${words(uom)}s but priced per ${words(baseUom)}, and a ${words(uom === "keg" || uom === "liter" ? uom : baseUom)} is not a number of bottles`,
    };

  // Only a price per a packed unit needs the pack.
  const pack = asNumber(line.pack_size);
  if (MULTIPLYING.has(baseUom) && (pack == null || pack <= 1))
    return {
      ok: false,
      kind: "refused",
      reason: `the invoice line prices ${price} per ${base === 1 ? "" : `${base} `}${words(baseUom)}${base === 1 ? "" : "s"} but does not state how many bottles a ${words(baseUom)} holds, so the price of one bottle is not known`,
    };

  const bottlesPriced = toBottles(base, baseUom, pack ?? 1);
  const perBottle = four(price / bottlesPriced);
  if (!Number.isFinite(perBottle) || perBottle <= 0)
    return {
      ok: false,
      kind: "refused",
      reason: `the invoice line's price of ${price} for ${bottlesPriced} bottles does not resolve to a price per bottle`,
    };

  const unitCost = toLotCostPrecision(perBottle);
  if (!(unitCost > 0))
    return {
      ok: false,
      kind: "refused",
      reason: `the invoice line's price per bottle of ${perBottle} rounds to ${unitCost.toFixed(2)} at the two places a lot's cost is kept, and a lot is never booked at a cost of nothing`,
    };

  const priced =
    MULTIPLYING.has(baseUom)
      ? `${base === 1 ? "" : `${base} `}${words(baseUom)}${base === 1 ? "" : "s"} of ${pack}`
      : `${base === 1 ? "" : `${base} `}${words(baseUom)}${base === 1 ? "" : "s"}`;
  const basis =
    bottlesPriced === 1
      ? `invoice price ${price} per ${priced}; booked as-is`
      : `invoice price ${price} per ${priced} = ${perBottle.toFixed(4)} per ${baseUom === "keg" || baseUom === "liter" ? baseUom : "bottle"}`;
  return { ok: true, perBottle, unitCost, basis };
}

/**
 * What `inventory_lots.unit_cost numeric(10,2)` keeps, rounded half away from
 * zero as Postgres does. Sending 11.8333 would store 11.83 and defeat
 * `finalise_delivery_cost`'s `IS NOT DISTINCT FROM` idempotency on every
 * re-verify. The exact figure goes in the reason; widening is QA H1.
 */
export function toLotCostPrecision(perBottle: number): number {
  return Number(`${Math.round(Number(`${perBottle}e2`))}e-2`);
}
