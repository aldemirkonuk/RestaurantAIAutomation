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

// The same list as the gateway's KITCHEN_HINTS (menu-line-view.ts says why each course word is there).
const KITCHEN = ['food', 'kitchen', 'dish', 'starter', 'dessert', 'entree', 'entrée', 'pasta', 'salad', 'mains', 'main course', 'appetizer', 'appetiser', 'sides', 'soup', 'meze', 'mezze', 'grill', 'small plate', 'snack', 'tapas', 'pizza', 'burger', 'sandwich']

/** ADR 0213: unmatched fallback, plus missing/unknown category. Never invent certainty. */
export function lineNeedsPencil(item: Pick<MenuImportReviewItem, 'matched' | 'needsReview' | 'category'>) {
  if (item.needsReview) return true
  if (item.matched === false) return true
  const category = item.category?.toLowerCase().trim() ?? ''
  if (!category || category === 'unknown') return true
  return !VOCABULARY.has(category)
}

/** A hint as a whole word (plural allowed): "pasta" trips it, "Pastaio" and "dishwasher" do not. */
const HINT_WORDS = new RegExp(`(^|[^\\p{L}\\p{N}])(${KITCHEN.join('|')})(s|es)?(?=$|[^\\p{L}\\p{N}])`, 'u')

/**
 * Words that make a line in the 'dessert' section a dessert wine and not a
 * course. The same list as the gateway's `DESSERT_WINE_CUES`
 * (menu-line-view.ts); a CLAIMS row keeps the two equal.
 */
const DESSERT_WINE_CUES = [
  'wine', 'vin', 'vino', 'glass', 'bottle', 'sauternes', 'barsac', 'tokaji', 'tokay', 'port', 'porto',
  'moscato', 'muscat', 'moscatel', 'eiswein', 'icewine', 'ice wine', 'late harvest', 'vin santo',
  'vin doux', 'pedro ximenez', 'pedro ximénez', 'madeira', 'sherry', 'oloroso', 'banyuls', 'maury',
  'passito', 'recioto', 'auslese', 'beerenauslese', 'trockenbeerenauslese', 'noble rot',
]

/** A cue as a whole word, a vintage year, or a pour size ("75cl", "100 ml"). */
const DESSERT_WINE_WORDS = new RegExp(
  `(^|[^\\p{L}\\p{N}])((${DESSERT_WINE_CUES.join('|')})s?|(19|20)\\d{2}|\\d+\\s?(cl|ml))(?=$|[^\\p{L}\\p{N}])`,
  'u',
)

type KitchenTestLine = Pick<MenuImportReviewItem, 'category' | 'rawText'> &
  Partial<Pick<MenuImportReviewItem, 'name' | 'producer' | 'vintage' | 'region' | 'grapeVariety'>>

const filled = (v: string | null | undefined) => typeof v === 'string' && v.trim() !== ''

/**
 * The same test as the gateway's `isKitchenLine` (menu-line-view.ts). A line in
 * a known drink section (VOCABULARY) is never a kitchen line (QA M18);
 * otherwise a hint, as a whole word, in the section or in the raw line makes it
 * one. 'dessert' is both a drink section and a course, so a 'dessert' line is a
 * drink only on evidence: a vintage, region, grape or producer, or a
 * dessert-wine word, a vintage year or a pour size in its name or raw line.
 * "Tiramisu" with none of these is a course.
 */
export function isKitchenLine(item: KitchenTestLine) {
  const section = (item.category ?? '').toLowerCase().trim()
  if (section === 'dessert') {
    if ([item.vintage, item.region, item.grapeVariety, item.producer].some(filled)) return false
    return !DESSERT_WINE_WORDS.test(`${item.name ?? ''} ${item.rawText ?? ''}`.toLowerCase())
  }
  if (VOCABULARY.has(section)) return false
  const hay = `${section} ${item.rawText ?? ''}`.toLowerCase()
  return HINT_WORDS.test(hay)
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
