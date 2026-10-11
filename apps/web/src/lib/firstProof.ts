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

/**
 * Words and phrases that mark a kitchen (food) line, in English and Turkish
 * (F-1173), matched as whole words. The same list as the gateway's
 * KITCHEN_HINTS (apps/api-gateway/src/menus/menu-line-view.ts); a CLAIMS row
 * keeps the two equal, and the two isKitchenLine tests are the same test.
 */
const KITCHEN = [
  'food',
  'foods',
  'kitchen',
  'dish',
  'dishes',
  'starter',
  'starters',
  'appetizer',
  'appetizers',
  'appetiser',
  'appetisers',
  'small plates',
  'mains',
  'main course',
  'main courses',
  'entree',
  'entrees',
  'entrée',
  'entrées',
  'sides',
  'pasta',
  'pizza',
  'salad',
  'salads',
  'soup',
  'soups',
  'sandwich',
  'sandwiches',
  'burger',
  'burgers',
  'breakfast',
  'brunch',
  'dessert',
  'mezze',
  'meze',
  'mezeler',
  'ara sıcak',
  'ara sıcaklar',
  'ana yemek',
  'ana yemekler',
  'yemek',
  'yemekler',
  'başlangıç',
  'başlangıçlar',
  'salata',
  'salatalar',
  'çorba',
  'çorbalar',
  'ızgara',
  'ızgaralar',
  'kebap',
  'kebaplar',
  'pide',
  'kahvaltı',
  'mutfak',
]

/** A section that names wine ("Dessert wines", "Kırmızı şaraplar") is a drink section. */
const WINE_WORDS = ['wine', 'wines', 'şarap', 'şaraplar']

/**
 * Turkish drink sections, matched as whole words in the section (F-1272): a
 * CSV's Tür/Kategori cell is kept as written. The same list as the gateway's
 * DRINK_WORDS.
 */
const DRINK_WORDS = ['kırmızı', 'beyaz', 'roze', 'pembe', 'köpüklü', 'tatlı şarap', 'rakı', 'bira', 'biralar', 'viski', 'şarap']

/**
 * Food nouns that keep a section a kitchen one whatever drink word it also
 * says (F-1317): "Kırmızı Et" is red meat, not red wine. The same list as the
 * gateway's FOOD_NOUNS.
 */
const FOOD_NOUNS = ['et', 'etler', 'yemek', 'yemekler', 'yemekleri', 'tavuk', 'balık', 'balıklar', 'köfte', 'kebap', 'kebaplar', 'meze', 'mezeler', 'salata', 'salatalar', 'çorba', 'çorbalar', 'ızgara', 'ızgaralar']

/**
 * Hints that mark food only as the section's own heading, never inside a raw
 * line (F-1272): 'tatlı' in a row means sweet. As the heading, "Tatlı" is the
 * dessert section (F-1317) unless it also says şarap. The same list as the
 * gateway's SECTION_HINTS.
 */
const SECTION_HINTS = ['desserts', 'tatlı', 'tatlılar']

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

/**
 * A text as its words, once per lower-casing, each padded so a hint is found
 * only whole. Both lower-casings: "TATLI" is "tatlı" only the Turkish way.
 */
function wordRuns(text: string) {
  return [text.toLowerCase(), text.toLocaleLowerCase('tr')].map(
    (lower) => ` ${lower.split(/[^\p{L}\p{M}]+/u).filter(Boolean).join(' ')} `,
  )
}

export function isKitchenLine(item: Pick<MenuImportReviewItem, 'category' | 'rawText'>) {
  // A known drink section wins over a kitchen hint: 'dessert' is a wine
  // section (a Muscat de Beaumes-de-Venise), and a wine whose line names a
  // starter pairing is still a wine (F-022, ADR 0309 owed 7). Otherwise a
  // whole-word hint in the section or the raw line decides (F-1173).
  if (VOCABULARY.has(categoryOf(item))) return false
  const section = item.category ?? ''
  const sectionRuns = wordRuns(section)
  const sectionSays = (words: string[]) => sectionRuns.some((run) => words.some((w) => run.includes(` ${w} `)))
  // A food noun beats a drink word: "Kırmızı Et" is meat (F-1317).
  if (sectionSays(FOOD_NOUNS)) return true
  if (sectionSays([...WINE_WORDS, ...DRINK_WORDS])) return false
  if (sectionSays(SECTION_HINTS)) return true
  const runs = wordRuns(`${section} ${item.rawText ?? ''}`)
  return KITCHEN.some((hint) => runs.some((run) => run.includes(` ${hint} `)))
}

export function pencilledCount(items: MenuImportReviewItem[]) {
  return items.filter((item) => !isKitchenLine(item) && lineNeedsPencil(item)).length
}

type StoredProof = MenuImportResult & { sourceImage?: string | null; restaurantId?: string | null }

/**
 * The proof this tab kept for `restaurantId` (F-273). A proof is stored with
 * the house it was read for; one kept for another house, or kept before the
 * house was recorded, is not this house's menu and reads as none. Without a
 * house to check against, the kept proof is returned as before.
 */
export function readProof(restaurantId?: string | null): StoredProof | null {
  try {
    const value = sessionStorage.getItem(FIRST_PROOF_KEY)
    if (!value) return null
    const proof = JSON.parse(value) as StoredProof
    if (restaurantId && proof.restaurantId !== restaurantId) return null
    if (!proof.sourceImage) {
      proof.sourceImage = sessionStorage.getItem(FIRST_PROOF_SOURCE_KEY)
    }
    return proof
  } catch {
    return null
  }
}

export function writeProof(
  result: MenuImportResult,
  sourceImage?: string | null,
  restaurantId?: string | null,
) {
  sessionStorage.setItem(FIRST_PROOF_KEY, JSON.stringify({ ...result, restaurantId: restaurantId ?? null }))
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
