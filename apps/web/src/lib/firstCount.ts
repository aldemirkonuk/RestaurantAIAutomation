/**
 * onboarding-r110-g2: the first stock count, walked shelf by shelf.
 *
 * Pure parts of /house/count: which goods are still to count, the order the
 * walk takes (shelf, then name), and what a typed count means. The page
 * (pages/HouseCount.tsx) holds the walk itself.
 */

export interface CountGood {
  id: string
  name: string
  /** The good's own unit (ADR 0070: an integer quantity plus its uom). */
  uom: string | null
  locationId: string | null
  lastCountedAt: string | null
}

type Raw = Record<string, unknown>

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** One gateway inventory row as the walk needs it; null when it is not a live good. */
export function toCountGood(row: unknown): CountGood | null {
  const r = (row ?? {}) as Raw
  const id = text(r.id)
  if (!id) return null
  if (r.isActive === false || r.is_active === false) return null
  const unitType = text(r.unit_type)
  return {
    id,
    name: text(r.wineName) ?? text(r.display_name) ?? text(r.wine_name) ?? 'A good with no name',
    uom: text(r.uom) ?? (unitType ? unitType.toLowerCase() : null),
    locationId: text(r.storage_location_id) ?? text(r.storageLocationId),
    lastCountedAt: text(r.lastCountedAt) ?? text(r.last_counted_at),
  }
}

/** Goods no count has reached yet. A counted good drops out of a resumed walk. */
export function notCounted(goods: CountGood[]): CountGood[] {
  return goods.filter((g) => g.lastCountedAt === null)
}

/**
 * Shelf to sheet: by storage location, then by name. A location the house
 * named sorts by that name; one whose name could not be read keeps its goods
 * together after the named ones; a good with no location comes last.
 */
export function shelfOrder(goods: CountGood[], locationNames: Map<string, string>, locale?: string): CountGood[] {
  const rank = (g: CountGood): [number, string] => {
    if (g.locationId === null) return [2, '']
    const name = locationNames.get(g.locationId)
    return name ? [0, name] : [1, g.locationId]
  }
  const cmp = (a: string, b: string) => a.localeCompare(b, locale, { sensitivity: 'base', numeric: true })
  return [...goods].sort((a, b) => {
    const [ra, ka] = rank(a)
    const [rb, kb] = rank(b)
    if (ra !== rb) return ra - rb
    return cmp(ka, kb) || cmp(a.name, b.name) || a.id.localeCompare(b.id)
  })
}

/**
 * Every unit counts whole (ADR 0070: quantities stay integer and the unit
 * belongs to the item; the uom CHECK is bottle, case, keg, pack, each,
 * glass, shot, ml, l, mg, g, kg). The gateway rounds a decimal
 * (inventory.service.ts recordSpotCount `Math.round`), so one typed here
 * would be written as a number nobody counted. A part kg or l is refused.
 */
export type TypedCount =
  | { kind: 'empty' }
  | { kind: 'count'; qty: number }
  | { kind: 'decimal' }
  | { kind: 'negative' }
  | { kind: 'unreadable' }

/** What the field says. Empty is not zero: it writes nothing. A decimal is refused in every unit. */
export function readTypedCount(typed: string): TypedCount {
  const s = typed.trim()
  if (s === '') return { kind: 'empty' }
  if (/^-/.test(s)) return { kind: 'negative' }
  // stock_live is a Postgres integer: a count past it cannot be written.
  if (/^\d+$/.test(s)) return Number(s) <= 2147483647 ? { kind: 'count', qty: Number(s) } : { kind: 'unreadable' }
  if (/^\d*[.,]\d+$|^\d+[.,]$/.test(s)) return { kind: 'decimal' }
  return { kind: 'unreadable' }
}

/** The unit, as the card says it after the number. */
export function unitWord(uom: string | null): string {
  switch (uom) {
    case null:
    case 'bottle':
      return 'bottles'
    case 'each':
      return 'each'
    case 'case':
      return 'cases'
    case 'keg':
      return 'kegs'
    case 'pack':
      return 'packs'
    case 'glass':
      return 'glasses'
    case 'shot':
      return 'shots'
    default:
      return uom
  }
}
