import { unitWord } from '../../../components/documents/canonical-format';

/**
 * Units whose quantity counts containers, so the line needs to say how many
 * bottles one holds. A bottle, keg, liter or "each" line needs no such figure,
 * and a guessed twelve is wrong by a factor of twelve (ADR 0104 BT-149).
 */
const CONTAINER_UOMS: ReadonlySet<string> = new Set(['case', 'pack', 'split_case']);

/** Does this line's unit count cases, packs or split cases? */
export function takesPackSize(uom: string | null | undefined): boolean {
  return uom != null && CONTAINER_UOMS.has(uom);
}

/** The word printed after a line's quantity: "case" for 1, "cases" for 2, "each". */
export function qtyUnitWord(uom: string | null | undefined, qty: number | null | undefined): string {
  if (!uom) return '';
  return unitWord(uom, qty);
}
