import type { MenuImportResult, MenuImportReviewItem } from '../services/api/menus'

export const FIRST_PROOF_KEY = 'mudavym:first-proof'
export const FIRST_PROOF_SOURCE_KEY = 'mudavym:first-proof-source'

const VOCABULARY = new Set([
  'wine',
  'red',
  'white',
  'rose',
  'sparkling',
  'orange',
  'dessert',
  'fortified',
  'beer',
  'cider',
  'sake',
  'cocktail',
  'spirit',
  'whiskey',
  'soft drink',
  'non-alcoholic',
])

const KITCHEN = ['food', 'kitchen', 'dish', 'starter', 'dessert', 'entree', 'entrée', 'pasta', 'salad']

/**
 * The sections a line can be placed in: the gateway's MENU_CATEGORY_VOCABULARY
 * (wine-extract-item.interface.ts), in menu order. The import never writes a
 * bare 'wine', so it is not offered (F-024).
 */
export const MENU_KINDS = [
  'red',
  'white',
  'rose',
  'sparkling',
  'orange',
  'dessert',
  'fortified',
  'beer',
  'cider',
  'whiskey',
  'spirit',
  'cocktail',
  'soft drink',
  'non-alcoholic',
  'sake',
] as const

/**
 * The kinds of drink the footer asks about, each covered by any of its
 * sections. The coverage check used to look for 'wine' and 'soft drink' on a
 * menu whose lines say red, white… and non-alcoholic, so a list of 60 wines
 * was told it had no wine (F-024).
 */
export const MENU_FAMILIES: { key: string; kinds: readonly string[] }[] = [
  { key: 'wine', kinds: ['wine', 'red', 'white', 'rose', 'sparkling', 'orange', 'dessert', 'fortified'] },
  { key: 'beer', kinds: ['beer'] },
  { key: 'cider', kinds: ['cider'] },
  { key: 'spirit', kinds: ['spirit', 'whiskey'] },
  { key: 'cocktail', kinds: ['cocktail'] },
  { key: 'soft drink', kinds: ['soft drink', 'non-alcoholic'] },
  { key: 'sake', kinds: ['sake'] },
]

function categoryOf(item: Pick<MenuImportReviewItem, 'category'>) {
  return item.category?.toLowerCase().trim() ?? ''
}

/** The kinds of drink with no line on this menu. */
export function absentFamilies(items: Pick<MenuImportReviewItem, 'category'>[]) {
  const present = new Set(items.map(categoryOf))
  return MENU_FAMILIES.filter((family) => !family.kinds.some((kind) => present.has(kind)))
}

/**
 * Why a line is pencilled, in words (F-021). The pencil used to say only
 * "Worth a second look", so with a thin library nearly every line, correct
 * wines included, carried a mark with no reason.
 */
export function pencilReason(
  item: Pick<MenuImportReviewItem, 'matched' | 'needsReview' | 'category'>,
): string | null {
  if (!lineNeedsPencil(item)) return null
  const category = categoryOf(item)
  if (!category || category === 'unknown') return 'We could not tell which section this belongs in.'
  if (!VOCABULARY.has(category)) return `Read into "${item.category}", which is not a section we keep.`
  if (item.matched === false) return 'Not in the library yet, so nothing was filled in from it. Check the name reads as printed.'
  return 'The reader marked this line to check.'
}

/** ADR 0213: unmatched fallback, plus missing/unknown category. Never invent certainty. */
export function lineNeedsPencil(item: Pick<MenuImportReviewItem, 'matched' | 'needsReview' | 'category'>) {
  if (item.needsReview) return true
  if (item.matched === false) return true
  const category = item.category?.toLowerCase().trim() ?? ''
  if (!category || category === 'unknown') return true
  return !VOCABULARY.has(category)
}

export function isKitchenLine(item: Pick<MenuImportReviewItem, 'category' | 'rawText'>) {
  // A known drink section wins over a kitchen hint: 'dessert' is a wine
  // section (a Muscat de Beaumes-de-Venise), and a wine whose line names a
  // starter pairing is still a wine (F-022, ADR 0309 owed 7).
  if (VOCABULARY.has(categoryOf(item))) return false
  const hay = `${item.category ?? ''} ${item.rawText ?? ''}`.toLowerCase()
  return KITCHEN.some((hint) => hay.includes(hint))
}

export function pencilledCount(items: MenuImportReviewItem[]) {
  return items.filter((item) => !isKitchenLine(item) && lineNeedsPencil(item)).length
}

export function readProof(): (MenuImportResult & { sourceImage?: string | null }) | null {
  try {
    const value = sessionStorage.getItem(FIRST_PROOF_KEY)
    if (!value) return null
    const proof = JSON.parse(value) as MenuImportResult & { sourceImage?: string | null }
    if (!proof.sourceImage) {
      proof.sourceImage = sessionStorage.getItem(FIRST_PROOF_SOURCE_KEY)
    }
    return proof
  } catch {
    return null
  }
}

export function writeProof(result: MenuImportResult, sourceImage?: string | null) {
  sessionStorage.setItem(FIRST_PROOF_KEY, JSON.stringify(result))
  if (sourceImage) {
    try {
      sessionStorage.setItem(FIRST_PROOF_SOURCE_KEY, sourceImage)
    } catch {
      sessionStorage.removeItem(FIRST_PROOF_SOURCE_KEY)
    }
  } else {
    sessionStorage.removeItem(FIRST_PROOF_SOURCE_KEY)
  }
}

/** Pixel or page box the extractor already named. Never invented. */
export type LineBox = {
  x: number
  y: number
  width: number
  height: number
  page?: number
  pageWidth?: number
  pageHeight?: number
}

export function lineSourceCrop(
  item: { bbox?: LineBox | null },
  sourceImage?: string | null,
): { image: string; box: LineBox } | null {
  if (!sourceImage || !item.bbox) return null
  const { x, y, width, height } = item.bbox
  if (![x, y, width, height].every((n) => Number.isFinite(n)) || width <= 0 || height <= 0) {
    return null
  }
  return { image: sourceImage, box: item.bbox }
}
