import type { GoodBody } from '../../services/api/houseGoods'

/**
 * A paper line whose good the house does not carry yet becomes a good here,
 * in the unit the line's cost can be read in (r21, invoices walk).
 *
 * Before this the chooser said "Add it on /inventory first": the line could
 * not be booked or costed until a person left the paper, carried the good on
 * another page and came back. The unit matters as much as the name. The
 * gateway costs a line per one of its ITEM's unit (`lot-unit-cost.ts`), so a
 * cheese billed `3 kg @ 450` must be kept in grams (0.45 a gram), oil billed
 * in liters in millilitres, and a case of beer by the bottle. A good kept in
 * the wrong unit is held at VERIFIED by name, so the form proposes the unit
 * the line fits and says plainly when a person picks one it does not.
 */

/** `restaurant_inventory.kind` values a house carries itself (`HOUSE_ITEM_KINDS`), plus wine. */
export type GoodKind = 'food' | 'supply' | 'beer' | 'spirit' | 'soft_drink' | 'other' | 'wine'
/** The units a carried good is KEPT in (ADR 0070: whole small units). */
export type GoodUnit = 'g' | 'ml' | 'bottle' | 'each' | 'keg'

export const GOOD_KINDS: { value: GoodKind; label: string }[] = [
  { value: 'food', label: 'Food' },
  { value: 'beer', label: 'Beer' },
  { value: 'spirit', label: 'Spirit' },
  { value: 'soft_drink', label: 'Soft drink' },
  { value: 'other', label: 'Other drink' },
  { value: 'supply', label: 'Supply' },
  { value: 'wine', label: 'Wine' },
]

export const GOOD_UNITS: { value: GoodUnit; label: string }[] = [
  { value: 'g', label: 'by weight (kept in grams)' },
  { value: 'ml', label: 'by volume (kept in millilitres)' },
  { value: 'bottle', label: 'by the bottle' },
  { value: 'each', label: 'by the piece' },
  { value: 'keg', label: 'by the keg' },
]

/** What the line says about itself: `procurement_document_lines` as the sheet reads it. */
export interface LineFacts {
  description: string | null
  /** The stored line unit: bottle, case, pack, split_case, each, keg, liter, kg, g. */
  uom: string | null
  /** What one bottle or keg holds, in ml, when printed. */
  formatMl: number | null
}

const WEIGHED = new Set(['kg', 'g'])
const CONTAINER = new Set(['bottle', 'case', 'pack', 'split_case', 'keg'])

/** The name, kind and unit a line proposes. A person can change any of them. */
export function proposeGood(line: LineFacts): { name: string; kind: GoodKind; unit: GoodUnit } {
  const name = (line.description ?? '').trim().slice(0, 120)
  const u = line.uom ?? ''
  if (WEIGHED.has(u)) return { name, kind: 'food', unit: 'g' }
  if (u === 'liter') return { name, kind: 'food', unit: 'ml' }
  if (u === 'keg') return { name, kind: 'beer', unit: 'keg' }
  if (CONTAINER.has(u)) return { name, kind: 'other', unit: 'bottle' }
  return { name, kind: 'food', unit: 'each' }
}

/**
 * Null when the gateway can cost this line in `unit`; otherwise the sentence
 * that says what will happen instead. It mirrors the gateway's own refusals,
 * so the words here are the ones VERIFIED would give.
 */
export function unitMisfit(line: LineFacts, unit: GoodUnit): string | null {
  const u = line.uom ?? ''
  // `each` is already the piece: "eachs" is not a word.
  const what = u && u !== 'each' ? u.replace('_', ' ') + 's' : 'pieces'
  if (unit === 'g')
    return WEIGHED.has(u)
      ? null
      : `This line counts ${what}, not a weight, so its cost waits until the line states its weight.`
  if (unit === 'ml') {
    if (u === 'liter') return null
    if (WEIGHED.has(u)) return 'This line is weighed, and a weight is not a volume.'
    return line.formatMl != null && line.formatMl > 0
      ? null
      : `This line counts ${what} and does not say how much one holds, so its cost waits until its size (ml) is filled in on the sheet.`
  }
  if (WEIGHED.has(u)) return `This line is weighed in ${u}; a weight is not a number of ${unit === 'each' ? 'pieces' : unit + 's'}. Keep it by weight.`
  if (u === 'liter') return `This line is measured in liters; a liter is not a number of ${unit === 'each' ? 'pieces' : unit + 's'}. Keep it by volume.`
  return null
}

/**
 * The sizes the gateway takes for one container (`CONTAINER_ML`,
 * house-item.service.ts): a bottle by the item edit's own 50-18000 ml, a keg
 * from 1 l to a 58.7 l half barrel. Only these two units have a size that
 * recipe cost reads; a good kept in ml, g or by the piece has none.
 */
const CONTAINER_ML: Partial<Record<GoodUnit, { min: number; max: number }>> = {
  bottle: { min: 50, max: 18000 },
  keg: { min: 1000, max: 60000 },
}

/**
 * The line's printed size, carried onto the good when it is kept by the bottle
 * or the keg (r21 D2): `Tonik 200 ml` becomes a good whose bottle holds 200,
 * so it costs per ml by 200 and is never read as a 750 ml wine bottle. The
 * sentence says what the good will hold, or that its size stays unknown.
 */
export function goodSize(
  line: LineFacts,
  unit: GoodUnit,
): { ml: number | null; said: string | null } {
  const band = CONTAINER_ML[unit]
  if (!band) return { ml: null, said: null }
  const f = line.formatMl
  if (f == null || !(f > 0))
    return { ml: null, said: `The paper does not say what one ${unit} holds, so the good's size is left unknown until it is set on the item.` }
  if (!Number.isInteger(f) || f < band.min || f > band.max)
    return { ml: null, said: `The paper says ${f} ml, which is not a ${unit} size the house can keep (${band.min} to ${band.max} ml), so the good's size is left unknown.` }
  return { ml: f, said: `One ${unit} holds ${f} ml, as the paper says.` }
}

/** The house-items body, or the sentence that says why there is none. */
export function goodBody(
  name: string,
  kind: GoodKind,
  unit: GoodUnit,
  sizeMl: number | null = null,
): { ok: true; body: GoodBody } | { ok: false; why: string } {
  const n = name.trim()
  if (kind === 'wine')
    return {
      ok: false,
      why: 'A wine is added from the wine library, so it keeps its producer, vintage and size: add it on /inventory, then pair this line with it.',
    }
  if (n.length < 1) return { ok: false, why: 'Give the good a name.' }
  if (n.length > 120) return { ok: false, why: 'Keep the name to 120 characters.' }
  const body: GoodBody = { kind, uom: unit, displayName: n }
  if (sizeMl !== null && CONTAINER_ML[unit]) body.bottleSizeMl = sizeMl
  return { ok: true, body }
}

/**
 * The size a paired good's label carries, or nothing. The inventory read fills
 * `bottleSizeMl` with 750 for every row that names no size, so a jar of olive
 * oil kept in ml would read "· 750 ml". A size is said only when the house set
 * one on the row, or when the good is a wine (its library names the bottle).
 */
export function goodSizeSuffix(item: {
  bottleSizeMl?: number | null
  bottle_size_ml?: number | null
  kind?: string | null
}): string {
  const own = item.bottle_size_ml
  if (own != null && own > 0) return ` · ${own} ml`
  if (item.kind === 'wine' && item.bottleSizeMl) return ` · ${item.bottleSizeMl} ml`
  return ''
}
