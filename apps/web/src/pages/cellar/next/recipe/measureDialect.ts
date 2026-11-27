/**
 * The bar's measures (r110 drinks-g2): a saved line read as written, in ml, or
 * in US oz. DISPLAY ONLY: the saved spec never changes (recipes are
 * append-only), and nothing here is sent back.
 *
 * The ml family is ml, cl and l, plus the US fluid ounce (units.ts). dash,
 * barspoon, tsp, tbsp, g, kg and each are kept as written: a dash is a dash
 * in every bar, and a weight is not a volume.
 *
 * To oz: the nearest eighth of an ounce, at the jigger's 30 ml to 1 oz (the
 * bar's own convention: 45 ml is the 1½ oz pour, 22.5 ml is ¾). "≈" marks a
 * figure the eighth moved by more than 0.25 ml (20 ml is "≈ ⅝ oz").
 * To ml: a written ounce is the US fluid ounce, 29.5735 ml (1½ oz is 44.4 ml),
 * cl and l by ten and a thousand, to one decimal with ".0" dropped.
 * The card's foot says both, so no figure is a silent conversion.
 */
import { amountWithUnit } from './units';

export type Measure = 'as_written' | 'ml' | 'oz';
export const MEASURES: ReadonlyArray<{ id: Measure; label: string }> = [
  { id: 'as_written', label: 'As written' },
  { id: 'ml', label: 'ml' },
  { id: 'oz', label: 'US oz' },
];

/** A written US fluid ounce, in ml. */
export const US_FL_OZ_ML = 29.5735;
/** The jigger's ounce a ml spec is read in: 30 ml to 1 oz. */
export const JIGGER_OZ_ML = 30;
/** An eighth moved by more than this is marked "≈". */
export const APPROX_ML = 0.25;

export const MEASURE_FOOT = 'Converted from the saved spec (ml to oz at 30 ml a jigger ounce, a written oz at 29.57 ml); ≈ means rounded.';

const ML_OF: Record<string, number> = { ml: 1, cl: 10, l: 1000, oz: US_FL_OZ_ML };
const EIGHTHS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'];

/** "1 oz", "¾ oz", "1½ oz", "≈ ⅝ oz" for a volume given in ml. */
export function ozText(ml: number): string {
  const exactOz = ml / JIGGER_OZ_ML;
  const eighths = Math.max(1, Math.round(exactOz * 8));
  const shownMl = (eighths / 8) * JIGGER_OZ_ML;
  const whole = Math.floor(eighths / 8);
  const frac = EIGHTHS[eighths % 8];
  const said = `${whole > 0 ? whole : ''}${frac} oz`;
  return Math.abs(shownMl - ml) > APPROX_ML ? `≈ ${said}` : said;
}

/** "44.4 ml", "30 ml": one decimal, ".0" dropped. */
export const mlText = (ml: number) => `${String(Math.round(ml * 10) / 10)} ml`;

/**
 * One line's amount in the chosen measure. As written is exactly the card's
 * own `amountWithUnit` (byte-identical to the print before this change); a unit
 * outside the ml family stays as written in every measure.
 */
export function inMeasure(qty: number, unit: string | null | undefined, m: Measure): string {
  const per = unit ? ML_OF[unit] : undefined;
  if (m === 'as_written' || per === undefined || !Number.isFinite(qty) || qty <= 0) return amountWithUnit(qty, unit as never);
  const ml = qty * per;
  if (m === 'ml') return mlText(ml);
  // An ounce written as an ounce stays the ounce written ("1.25 oz" reads 1¼ oz), not re-read through the jigger.
  return ozText(unit === 'oz' ? qty * JIGGER_OZ_ML : ml);
}

/** True when any line would read differently in `m`: the card says it was converted only then. */
export const converts = (lines: Array<{ qty: number; unit: string | null | undefined }>, m: Measure) =>
  m !== 'as_written' && lines.some((l) => inMeasure(l.qty, l.unit, m) !== inMeasure(l.qty, l.unit, 'as_written'));
