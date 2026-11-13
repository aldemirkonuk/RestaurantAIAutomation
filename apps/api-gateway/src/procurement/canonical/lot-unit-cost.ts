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
  isMass,
  isVolumeItemUnit,
  massFactor,
  normalizeUom,
  toBottles,
  Uom,
  UOMS,
  volumeFactor,
} from "../documents/document-types";

/**
 * The house item the line books into: only its unit (`restaurant_inventory.uom`,
 * ADR 0070) matters here. A weighed line is costed per ONE of that unit, since
 * that is what the lot's integer `qty` counts (R8). A container line ignores it.
 */
export interface LotCostItem {
  uom?: string | null;
}

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
  /** ml in one bottle or keg of the line, when printed. */
  format_ml?: number | string | null;
}

/** `unitCost` is `perBottle` at the column's precision, and what is posted. */
export type LotUnitCost =
  | { ok: true; perBottle: number; unitCost: number; basis: string; bottles: number; priced: string; per: string; printed?: number }
  | { ok: false; kind: "no_price" }
  | { ok: false; kind: "refused"; reason: string; printed?: number };

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
/** A cost per bottle as the reason prints it: the posted six places, never fewer than two. */
export function sixPlaces(n: number): string {
  const t = n.toFixed(6).replace(/0+$/, "");
  const dot = t.indexOf(".");
  return dot < 0 ? `${t}.00` : t.length - dot - 1 < 2 ? t.padEnd(dot + 3, "0") : t;
}

export function perBottleLotCost(line: LotCostLine, item?: LotCostItem): LotUnitCost {
  const price = asNumber(line.unit_price);
  // Skipped before this existed, and still: not a price anybody agreed.
  if (price == null || price <= 0) return { ok: false, kind: "no_price" };
  // `printed` lets a re-verify spot a lot booked AT the printed price (QA 9a).
  return { ...resolve(line, price, item), printed: toLotCostPrecision(price) } as LotUnitCost;
}

function resolve(line: LotCostLine, price: number, item?: LotCostItem): LotUnitCost {
  // r21: an item kept in ml/l is costed per one of it; litres book only there.
  if (item?.uom && isVolumeItemUnit(String(item.uom))) return byVolume(line, price, String(item.uom));
  if (item?.uom && (line.uom === "liter" || line.price_base_uom === "liter"))
    return refuse(`the invoice line is measured in liters, but the item it books into is kept in ${item.uom}s, and a liter is not a number of ${item.uom}s`);
  return byContainer(line, price, item);
}

/**
 * An item kept by volume (r21): `5 liter @ 120` into ml is 0.12 a ml; a bottle,
 * case or keg converts by what one holds (`format_ml`): `12 bottle @ 30` of
 * 200 ml is 0.15 a ml. No size printed: refused, never booked as 1 ml a bottle.
 */
function byVolume(line: LotCostLine, price: number, kept: string): LotUnitCost {
  const uom = asUom(line.uom);
  const rawBase = line.price_base_qty;
  const base = rawBase == null || rawBase === "" ? 1 : asNumber(rawBase);
  const baseUom = line.price_base_uom == null || line.price_base_uom === "" ? uom : asUom(line.price_base_uom);
  if (isMass(uom) || isMass(baseUom))
    return refuse(`the invoice line is weighed in ${isMass(uom) ? uom : baseUom}, but the item it books into is kept in ${kept}, and a weight is not a volume`);
  if (uom === "liter" || baseUom === "liter") {
    if (uom !== "liter" || baseUom !== "liter")
      return refuse(`the invoice line is counted in ${uom ? words(uom) : "an unknown unit"}s but priced per ${baseUom ? words(baseUom) : "an unknown unit"}, and a liter is not a number of bottles`);
    if (base == null || base <= 0)
      return refuse(`the invoice line prints its price for ${JSON.stringify(rawBase)} liters, which cannot be divided by`);
    const toItem = volumeFactor("liter", kept) as number;
    const unitsPriced = base * toItem;
    const perUnit = price / unitsPriced;
    const counted = asNumber(line.qty_bottles);
    const checked = check(line, perUnit, counted == null ? null : Math.abs(counted) * toItem, kept, `${counted} liter`);
    if (checked) return checked;
    const priced = `${base === 1 ? "" : `${base} `}liter${base === 1 ? "" : "s"}`;
    return inItem(price, priced, unitsPriced, perUnit, kept);
  }

  // A container: what one bottle costs, then what one of the item's unit costs.
  const asBottles = byContainer(line, price, undefined);
  if (!asBottles.ok) return asBottles;
  const fmt = asNumber(line.format_ml);
  const what = asBottles.per === "keg" ? "keg" : "bottle";
  if (fmt == null || !(fmt > 0))
    return refuse(`the item this line books into is kept in ${kept}, but the invoice line counts ${uom ? words(uom) : "bottle"}s and does not say how much one ${what} holds, so what one ${kept} costs is not known`);
  const perItemUnit = volumeFactor("ml", kept) as number;
  const unitsPerBottle = fmt * perItemUnit;
  const unitsPriced = asBottles.bottles * unitsPerBottle;
  const perUnit = asBottles.perBottle / unitsPerBottle;
  return inItem(price, `${asBottles.priced} of ${fmt} ml`, unitsPriced, perUnit, kept);
}

/** QA 9a by volume: the printed total must bear the price out. */
function check(line: LotCostLine, perUnit: number, inItemUnits: number | null, kept: string, countedSaid: string): LotUnitCost | null {
  if (!Number.isFinite(perUnit) || perUnit <= 0) return refuse(`a price of ${perUnit} per ${kept} is not a price`);
  const total = asNumber(line.line_total);
  if (total == null || inItemUnits == null || inItemUnits === 0) return null;
  const unitCost = toLotCostPrecision(perUnit);
  if (Math.abs(perUnit * inItemUnits - Math.abs(total)) > Math.max(0.05, Math.abs(total) * 0.01))
    return refuse(`the invoice line totals ${total} for ${countedSaid}, but ${sixPlaces(unitCost)} a ${kept} makes ${sixPlaces(unitCost * inItemUnits)}, so the price's unit is not what the line says`);
  return null;
}

function inItem(price: number, priced: string, unitsPriced: number, perUnit: number, kept: string): LotUnitCost {
  const unitCost = toLotCostPrecision(perUnit);
  if (!(unitCost > 0))
    return refuse(`a price per ${kept} of ${perUnit} rounds to ${sixPlaces(unitCost)}, and a lot is never booked at a cost of nothing`);
  const basis =
    unitsPriced === 1
      ? `invoice price ${price} per ${priced}; booked as-is`
      : `invoice price ${price} per ${priced} = ${sixPlaces(perUnit)} per ${kept}`;
  return { ok: true, perBottle: perUnit, unitCost, basis, bottles: unitsPriced, priced, per: kept };
}

function byContainer(line: LotCostLine, price: number, item?: LotCostItem): LotUnitCost {
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

  if (isMass(uom) || isMass(baseUom)) return weighed(line, price, uom, baseUom, base, rawBase, item);
  // The other way round: an item kept by weight priced per container has no
  // conversion either (a `3 each` cheese is not 3 grams).
  if (item?.uom && massFactor(String(item.uom), "g") != null)
    return refuse(`the item this line books into is kept in ${item.uom}, but the invoice line counts ${words(uom)}s, which is not a weight, so what one ${item.uom} costs is not known`);

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
  // Unrounded: the six-place rounding happens once, at the column's scale
  // (cost-math R7: a four-place step first posted 142/12 as 11.8333, and
  // 1,200 such bottles then missed their paper by 4 kuruş).
  const perBottle = price / bottlesPriced;
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
    const implied = perBottle * Math.abs(counted);
    if (Math.abs(implied - Math.abs(total)) > Math.max(0.05, Math.abs(total) * 0.01))
      return refuse(`the invoice line totals ${total} for ${counted} counted, but ${sixPlaces(unitCost)} each makes ${sixPlaces(unitCost * counted)}, so the price's unit is not what the line says`);
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

/**
 * A weighed line (R8): `3 kg @ 450` into a cheese kept in `g` is 0.45 a gram,
 * and the lot's 3000 g at 0.45 is the paper's 1350. The price is per `base` of
 * `baseUom`; per one of the ITEM's unit = price ÷ (base × massFactor(baseUom,
 * item unit)). Refused by name when the line mixes a weight with a container,
 * when the item states no unit or is not kept by weight, or when the printed
 * total says the price's unit was misread.
 */
function weighed(
  line: LotCostLine,
  price: number,
  uom: Uom,
  baseUom: Uom,
  base: number,
  rawBase: LotCostLine["price_base_qty"],
  item?: LotCostItem,
): LotUnitCost {
  if (!isMass(uom) || !isMass(baseUom))
    return refuse(`the invoice line is counted in ${words(uom)}s but priced per ${words(baseUom)}, and a weight is not a number of bottles`);
  const kept = item?.uom ? String(item.uom) : null;
  if (!kept)
    return refuse(`the invoice line is weighed in ${uom}, and the item it books into states no unit, so what one unit of it costs is not known`);
  const toItem = massFactor(baseUom, kept);
  const countedToItem = massFactor(uom, kept);
  if (toItem == null || countedToItem == null)
    return refuse(`the invoice line is priced per ${baseUom}, but the item it books into is kept in ${kept}s, and a weight is not a number of ${kept}s`);

  const unitsPriced = base * toItem;
  const perUnit = price / unitsPriced;
  if (!Number.isFinite(perUnit) || perUnit <= 0)
    return refuse(`${price} for ${unitsPriced} ${kept} is not a price per ${kept}`);
  const unitCost = toLotCostPrecision(perUnit);
  if (!(unitCost > 0))
    return refuse(`a price per ${kept} of ${perUnit} rounds to ${sixPlaces(unitCost)}, and a lot is never booked at a cost of nothing`);

  // QA 9a, by weight: the total for the weighed count must bear the price out.
  const total = asNumber(line.line_total);
  const counted = asNumber(line.qty_bottles);
  if (total != null && counted != null && counted !== 0) {
    const inItem = Math.abs(counted) * countedToItem;
    if (Math.abs(perUnit * inItem - Math.abs(total)) > Math.max(0.05, Math.abs(total) * 0.01))
      return refuse(`the invoice line totals ${total} for ${counted} ${uom}, but ${sixPlaces(unitCost)} a ${kept} makes ${sixPlaces(unitCost * inItem)}, so the price's unit is not what the line says`);
  }

  const priced = `${rawBase == null || rawBase === "" || base === 1 ? "" : `${base} `}${baseUom}`;
  const basis =
    unitsPriced === 1
      ? `invoice price ${price} per ${priced}; booked as-is`
      : `invoice price ${price} per ${priced} = ${sixPlaces(perUnit)} per ${kept}`;
  return { ok: true, perBottle: perUnit, unitCost, basis, bottles: unitsPriced, priced, per: kept };
}

function roundsToNothing(perBottle: number, unitCost: number): LotUnitCost {
  return {
    ok: false,
    kind: "refused",
    reason: `a price per bottle of ${perBottle} rounds to ${sixPlaces(unitCost)}, and a lot is never booked at a cost of nothing`,
  };
}

function basisOf(price: number, priced: string, bottles: number, perBottle: number, unit: string): string {
  return bottles === 1
    ? `invoice price ${price} per ${priced}; booked as-is`
    : `invoice price ${price} per ${priced} = ${sixPlaces(perBottle)} per ${unit}`;
}

/**
 * An accepted proposal's price per bottle (QA 10a (1), QA 12b C). A proposal
 * counters `line`'s printed price, so it is in the base the line's OWN facts
 * settle — printed base, pack, and the total that decides a bare bottle-row
 * price. A line whose printed price is refused refuses the proposal with it;
 * a line that prints no price is read on its unit columns alone.
 */
export function proposalPerBottle(proposed: unknown, line: LotCostLine, item?: LotCostItem): LotUnitCost {
  const price = asNumber(proposed);
  const cost = inLineBase(price, line, item);
  // A re-verify spots a lot booked at the proposal's RAW price (10a (1)).
  return price == null || price <= 0 ? cost : ({ ...cost, printed: toLotCostPrecision(price) } as LotUnitCost);
}

function inLineBase(price: number | null, line: LotCostLine, item?: LotCostItem): LotUnitCost {
  if (price == null || price <= 0) return { ok: false, kind: "no_price" };
  const printed = perBottleLotCost(line, item);
  if (!printed.ok && printed.kind === "no_price")
    return perBottleLotCost({ ...line, unit_price: price, qty_bottles: null, line_total: null }, item);
  if (!printed.ok) return printed;
  const perBottle = price / printed.bottles;
  const unitCost = toLotCostPrecision(perBottle);
  if (!(unitCost > 0)) return roundsToNothing(perBottle, unitCost);
  return { ...printed, perBottle, unitCost, basis: basisOf(price, printed.priced, printed.bottles, perBottle, printed.per) };
}

/**
 * What `unit_cost numeric(14,6)` keeps (#839's 20270302143700), half away from
 * zero: six places, so posting it again is the same number and
 * `finalise_delivery_cost` stays idempotent. It is the landed path's own
 * rounding (`toLandedPrecision`), so a line-only price and an accepted proposal
 * are no longer posted at two places beside a landed cost at six
 * (cost-math R7: 100 per case of 12 posted 8.33, and 12 bottles came to 99.96).
 */
export function toLotCostPrecision(perBottle: number): number {
  return Number(`${Math.round(Number(`${perBottle.toFixed(12)}e6`))}e-6`);
}

/**
 * The same price at cents: what a lot booked AT a printed price holds when it
 * was posted into the old `numeric(10,2)` column. A re-verify's repair must
 * still recognise it (`repairPrintedCost`), so the printed set keeps both.
 */
export function toCentsAsBooked(price: number): number {
  return Number(`${Math.round(Number(`${price.toFixed(12)}e2`))}e-2`);
}
