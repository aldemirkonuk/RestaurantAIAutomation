/**
 * An invoice line's printed price as the cost of ONE bottle (QA round 7c B1:
 * `2 cases @ 264 / case, pack 12` booked 264 a bottle, not 22).
 *
 * In `lineNetFromPrice`'s terms: the price is for `price_base_qty` (BT-149) of
 * `price_base_uom` (BT-150), by default one of the line's own `uom`; per
 * bottle = price ÷ toBottles(base, baseUom, pack_size). It refuses by name
 * rather than guess: an unstated pack (the column's DEFAULT 1), an unknown
 * unit, a bad base, a keg or litre against another unit. A keg priced per keg
 * passes through, as on `main`. Landed cost is #780's, not this file's.
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

/** `unitCost` is `perBottle` at the column's precision, and what is posted. */
export type LotUnitCost =
  | { ok: true; perBottle: number; unitCost: number; basis: string }
  | { ok: false; kind: "no_price" }
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
      reason: `the invoice line's unit reads ${JSON.stringify(line.uom ?? null)}, which is not a unit this house counts in`,
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
  const per = `${base === 1 ? "" : `${base} `}${words(baseUom)}${base === 1 ? "" : "s"}`;
  if (MULTIPLYING.has(baseUom) && (pack == null || pack <= 1))
    return {
      ok: false,
      kind: "refused",
      reason: `the invoice line prices ${price} per ${per} but does not state how many bottles a ${words(baseUom)} holds, so the price of one bottle is not known`,
    };

  const bottlesPriced = toBottles(base, baseUom, pack ?? 1);
  const perBottle = four(price / bottlesPriced);
  if (!Number.isFinite(perBottle) || perBottle <= 0)
    return { ok: false, kind: "refused", reason: `${price} for ${bottlesPriced} bottles is not a price per bottle` };

  const unitCost = toLotCostPrecision(perBottle);
  if (!(unitCost > 0))
    return {
      ok: false,
      kind: "refused",
      reason: `a price per bottle of ${perBottle} rounds to ${unitCost.toFixed(2)}, and a lot is never booked at a cost of nothing`,
    };

  const priced = MULTIPLYING.has(baseUom) ? `${per} of ${pack}` : per;
  const basis =
    bottlesPriced === 1
      ? `invoice price ${price} per ${priced}; booked as-is`
      : `invoice price ${price} per ${priced} = ${perBottle.toFixed(4)} per ${baseUom === "keg" || baseUom === "liter" ? baseUom : "bottle"}`;
  return { ok: true, perBottle, unitCost, basis };
}

/** What `unit_cost numeric(10,2)` keeps, half away from zero: posting 11.8333
 * would defeat `finalise_delivery_cost`'s idempotency. Widening is QA H1. */
export function toLotCostPrecision(perBottle: number): number {
  return Number(`${Math.round(Number(`${perBottle}e2`))}e-2`);
}
