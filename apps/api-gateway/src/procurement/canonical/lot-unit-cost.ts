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
  normalizeUom,
  toBottles,
  Uom,
  UOMS,
} from "../documents/document-types";

/** The money and unit columns of one `procurement_document_lines` row. */
export interface LotCostLine {
  unit_price: number | string | null | undefined;
  uom?: string | null;
  pack_size?: number | string | null;
  price_base_qty?: number | string | null;
  price_base_uom?: string | null;
  /** What the line counted and printed as its total: the cross-check (QA 9a) and a bare bottle price (QA 10a). */
  qty_bottles?: number | string | null;
  line_total?: number | string | null;
  /** The paper's own glyphs; `uom` / `priceBaseUom` keep a unit we could not map. */
  printed?: unknown;
}

/** `unitCost` is `perBottle` at the column's precision, and what is posted. */
export type LotUnitCost =
  | { ok: true; perBottle: number; unitCost: number; basis: string; bottles: number; priced: string; per: string }
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
const refuse = (reason: string): LotUnitCost => ({ ok: false, kind: "refused", reason });
function printedUnit(p: unknown, key: string): string | null {
  const v = p && typeof p === "object" ? (p as Record<string, unknown>)[key] : null;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
const four = (n: number) => Math.round(n * 10000) / 10000;

export function perBottleLotCost(line: LotCostLine): LotUnitCost {
  const price = asNumber(line.unit_price);
  // Skipped before this existed, and still: not a price anybody agreed.
  if (price == null || price <= 0) return { ok: false, kind: "no_price" };
  // Audit D1: the extractor keeps an unmapped unit as `each` and its glyph in
  // `printed`. "kutu" stored as `each` is not one bottle; neither guess holds.
  const said = printedUnit(line.printed, "uom");
  const saidUom = said ? normalizeUom(said) : null;
  // A glyph that means one piece or one bottle (`pcs`, `btl.`) counts as `each` does (QA 10a (3)).
  if (said && line.uom === "each" && saidUom !== "each" && saidUom !== "bottle")
    return refuse(`the invoice prints its unit as "${said}", which this house does not count in, so what one bottle costs is not known`);
  const saidBase = printedUnit(line.printed, "priceBaseUom");
  if (saidBase && !line.price_base_uom && !normalizeUom(saidBase))
    return refuse(`the invoice prices per "${saidBase}", which this house does not count in, so what one bottle costs is not known`);

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
  if (!(unitCost > 0)) return roundsToNothing(perBottle, unitCost);

  // QA 9a: a printed line total that contradicts the per-bottle cost means the
  // price's unit was misread (24 bottles @ 264 printed as 528). Refused, not
  // re-derived from the total, which may carry a deposit or an allowance.
  // QA 10a (4): a credit note prints its count and total negative (or only the
  // total), so magnitudes are compared: a sign says which way the money went,
  // not what unit the price is in.
  const total = asNumber(line.line_total);
  const counted = asNumber(line.qty_bottles);
  const checked = total != null && counted != null && counted !== 0;
  if (checked) {
    const implied = four(perBottle * Math.abs(counted));
    if (Math.abs(implied - Math.abs(total)) > Math.max(0.05, Math.abs(total) * 0.01))
      return refuse(`the invoice line totals ${total} for ${counted} counted, but ${perBottle.toFixed(4)} each makes ${four(perBottle * counted)}, so the price's unit is not what the line says`);
  }

  // QA 10a (2): `24 bottle @ 264, pack 12` with no base reads 264 a bottle,
  // and is as likely a case's price. Only a printed base, or a total that
  // bears the bottle reading out (above), decides it; otherwise refused.
  const statedBase = (rawBaseUom != null && rawBaseUom !== "") || (rawBase != null && rawBase !== "");
  if ((uom === "bottle" || uom === "each") && bottlesPriced === 1 && !statedBase && pack != null && pack > 1 && !checked)
    return refuse(`the invoice line counts ${words(uom)}s that come ${pack} to a case and prints ${price} for one, with no line total that settles it, so whether ${price} is a bottle's price or a case's is not known`);

  const priced = MULTIPLYING.has(baseUom) ? `${per} of ${pack}` : per;
  const unit = baseUom === "keg" || baseUom === "liter" ? baseUom : "bottle";
  return { ok: true, perBottle, unitCost, basis: basisOf(price, priced, bottlesPriced, perBottle, unit), bottles: bottlesPriced, priced, per: unit };
}

function roundsToNothing(perBottle: number, unitCost: number): LotUnitCost {
  return {
    ok: false,
    kind: "refused",
    reason: `a price per bottle of ${perBottle} rounds to ${unitCost.toFixed(2)}, and a lot is never booked at a cost of nothing`,
  };
}

function basisOf(price: number, priced: string, bottles: number, perBottle: number, unit: string): string {
  return bottles === 1
    ? `invoice price ${price} per ${priced}; booked as-is`
    : `invoice price ${price} per ${priced} = ${perBottle.toFixed(4)} per ${unit}`;
}

/**
 * An accepted proposal's price per bottle (QA 10a (1), QA 12b C). A proposal
 * counters `line`'s printed price, so it is in the base the line's OWN facts
 * settle — printed base, pack, and the total that decides a bare bottle-row
 * price. A line whose printed price is refused refuses the proposal with it;
 * a line that prints no price is read on its unit columns alone.
 */
export function proposalPerBottle(proposed: unknown, line: LotCostLine): LotUnitCost {
  const price = asNumber(proposed);
  if (price == null || price <= 0) return { ok: false, kind: "no_price" };
  const printed = perBottleLotCost(line);
  if (!printed.ok && printed.kind === "no_price")
    return perBottleLotCost({ ...line, unit_price: price, qty_bottles: null, line_total: null });
  if (!printed.ok) return printed;
  const perBottle = four(price / printed.bottles);
  const unitCost = toLotCostPrecision(perBottle);
  if (!(unitCost > 0)) return roundsToNothing(perBottle, unitCost);
  return { ...printed, perBottle, unitCost, basis: basisOf(price, printed.priced, printed.bottles, perBottle, printed.per) };
}

/** What `unit_cost numeric(10,2)` keeps, half away from zero: posting 11.8333
 * would defeat `finalise_delivery_cost`'s idempotency. Widening is QA H1. */
export function toLotCostPrecision(perBottle: number): number {
  return Number(`${Math.round(Number(`${perBottle}e2`))}e-2`);
}
