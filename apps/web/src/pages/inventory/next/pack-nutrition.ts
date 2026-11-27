/**
 * What one whole pack holds (DD-r108-37): "A 750 ml bottle: 1,725 kcal" under
 * the card's per-100 table. Pure, and as honest as the table above it:
 * - the size is the one the house or the library RECORDED, never the list's
 *   750 ml fill for an unsized good: no recorded size, no line;
 * - each figure is per100 x amount / 100, kept at 6 decimals (shown at the
 *   card's own precision); a figure nobody stated stays null ("not known");
 * - figures per 100 g on a good kept by volume count only through a STATED
 *   weight of one ml for that good (#1463's rule); without it the line says
 *   it needs one, and nothing is guessed from water;
 * - the strength (ABV) is a share of the volume, the same for the whole
 *   bottle, so it is not scaled; energy worked out from it keeps its note.
 */
import type { StoredNutrition } from '../../../services/api/inventory';

/** Goods kept in containers whose size is a bottle's (as the drawer's size line). */
const DRINK_UNITS = new Set(['bottle', 'case', 'keg', 'glass', 'shot']);

export interface PackSource {
  /** The house's own size; the library's default 750 is never a recorded size. */
  bottleSizeHouseMl?: number | null;
}
export interface PackHouse {
  kind: string | null;
  uom: string | null;
}

/** The recorded size of one container, in ml, or null when none was recorded. */
export function packSizeMl(row: PackSource, house: PackHouse | undefined): number | null {
  const ml = row.bottleSizeHouseMl;
  if (ml === null || ml === undefined || !Number.isFinite(ml) || ml <= 0) return null;
  if (house && (house.kind === 'food' || house.kind === 'supply')) return null;
  if (house && house.uom !== null && !DRINK_UNITS.has(house.uom)) return null;
  return ml;
}

const FIELDS = ['energyKcal', 'proteinG', 'fatG', 'carbohydrateG', 'sugarsG', 'saltG'] as const;
type PackField = (typeof FIELDS)[number];

export type PackNutrition =
  | { kind: 'figures'; sizeMl: number; figures: Record<PackField, number | null>; energyFromAbv: boolean }
  | { kind: 'needs_weight'; sizeMl: number };

const six = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * The whole pack's figures, or null when no size is recorded. `mlGrams` is
 * what one ml of this good weighs, in g, as the house stated it (null: not stated).
 */
export function packNutrition(f: StoredNutrition, sizeMl: number | null, mlGrams: number | null = null): PackNutrition | null {
  if (sizeMl === null || !Number.isFinite(sizeMl) || sizeMl <= 0) return null;
  let amount = sizeMl;
  if (f.basis === '100g') {
    if (mlGrams === null || !Number.isFinite(mlGrams) || mlGrams <= 0) return { kind: 'needs_weight', sizeMl };
    amount = sizeMl * mlGrams;
  }
  const figures = {} as Record<PackField, number | null>;
  for (const k of FIELDS) {
    const v = f[k];
    figures[k] = v === null || !Number.isFinite(v) ? null : six((v * amount) / 100);
  }
  return { kind: 'figures', sizeMl, figures, energyFromAbv: f.energyFromAbv };
}
