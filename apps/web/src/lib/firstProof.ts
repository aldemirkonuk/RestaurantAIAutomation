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
// The Turkish words are folded (r28 G3); the gateway's comment says why each is in or out.
const KITCHEN = ['food', 'kitchen', 'dish', 'starter', 'dessert', 'entree', 'entrée', 'pasta', 'salad', 'mains', 'main course', 'appetizer', 'appetiser', 'sides', 'soup', 'meze', 'mezze', 'grill', 'small plate', 'snack', 'tapas', 'pizza', 'burger', 'sandwich', 'ana yemek', 'yemekler', 'ara sicak', 'corba', 'izgara', 'kebap', 'kebab', 'salata', 'baslangic', 'pide', 'lahmacun', 'makarna', 'kahvalti', 'aperatif', 'sandvic', 'kofte', 'manti', 'borek', 'doner']

/** The gateway's DESSERT_SECTIONS: a section weighed like 'dessert' ("Tatlılar" is Turkish for desserts). */
const DESSERT_SECTIONS = new Set(['dessert', 'desserts', 'tatli', 'tatlilar'])

/** The gateway's foldForHints: lowercase, accents and dots off, the dotless ı read as i. */
export function foldForHints(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/ı/g, 'i')
}

/** ADR 0213: unmatched fallback, plus missing/unknown category. Never invent certainty. */
export function lineNeedsPencil(item: Pick<MenuImportReviewItem, 'matched' | 'needsReview' | 'category'>) {
  if (item.needsReview) return true
  if (item.matched === false) return true
  const category = item.category?.toLowerCase().trim() ?? ''
  if (!category || category === 'unknown') return true
  return !VOCABULARY.has(category)
}

/** A hint as a whole word (plural allowed): "pasta" trips it, "Pastaio" and "dishwasher" do not. */
const HINT_WORDS = new RegExp(`(^|[^\\p{L}\\p{N}])(${KITCHEN.join('|')})(s|es|ler|lar|leri|lari|si|i)?(?=$|[^\\p{L}\\p{N}])`, 'u')

/**
 * Words that make a line in the 'dessert' section a dessert wine and not a
 * course. The same list as the gateway's `DESSERT_WINE_CUES`
 * (menu-line-view.ts); a CLAIMS row keeps the two equal. The last four are
 * Turkish, folded (r28 G3): wine, "of wine", glass, bottle.
 */
const DESSERT_WINE_CUES = [
  'wine', 'vin', 'vino', 'glass', 'bottle', 'sauternes', 'barsac', 'tokaji', 'tokay', 'port', 'porto',
  'moscato', 'muscat', 'moscatel', 'eiswein', 'icewine', 'ice wine', 'late harvest', 'vin santo',
  'vin doux', 'pedro ximenez', 'pedro ximénez', 'madeira', 'sherry', 'oloroso', 'banyuls', 'maury',
  'passito', 'recioto', 'auslese', 'beerenauslese', 'trockenbeerenauslese', 'noble rot',
  'sarap', 'sarabi', 'kadeh', 'sise',
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
  if (DESSERT_SECTIONS.has(foldForHints(section))) {
    if ([item.vintage, item.region, item.grapeVariety, item.producer].some(filled)) return false
    return !DESSERT_WINE_WORDS.test(foldForHints(`${item.name ?? ''} ${item.rawText ?? ''}`))
  }
  if (VOCABULARY.has(section)) return false
  const hay = foldForHints(`${section} ${item.rawText ?? ''}`)
  return HINT_WORDS.test(hay)
}

export function pencilledCount(items: MenuImportReviewItem[]) {
  return items.filter((item) => !isKitchenLine(item) && lineNeedsPencil(item)).length
}

/**
 * Whose proof it is (r28 onboarding gap 7): the account and the house of the
 * session that read the menu, from the access token's own claims (`sub`,
 * `restaurantId`, auth.service.ts). The proof lives in the tab, and signing
 * out cleared nothing, so on a shared tablet the next owner (or the same
 * owner in another house) opened /house and /house/menu on the first
 * owner's lines, and placing one PATCHed the first owner's menu and failed
 * as "That line was not placed." `null` when no token can be read at all
 * (no session): only then does an unstamped proof match.
 */
type ProofStamp = { account: string; house: string } | null

function sessionStamp(): ProofStamp {
  try {
    const token = localStorage.getItem('accessToken')
    const part = token?.split('.')[1]
    if (!part) return null
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as {
      sub?: unknown
      restaurantId?: unknown
    }
    // A claim that is missing is said as '' and still compared, so two
    // tokens that each lack one never match on the other claim alone.
    return {
      account: typeof claims.sub === 'string' ? claims.sub : '',
      house: typeof claims.restaurantId === 'string' ? claims.restaurantId : '',
    }
  } catch {
    return null
  }
}

const sameStamp = (a: ProofStamp, b: ProofStamp) =>
  a === null || b === null ? a === b : a.account === b.account && a.house === b.house

/** The stored proof, only when this session's account and house read it. */
function storedProof(): (MenuImportResult & { stamp?: ProofStamp }) | null {
  const value = sessionStorage.getItem(FIRST_PROOF_KEY)
  if (!value) return null
  const proof = JSON.parse(value) as MenuImportResult & { stamp?: ProofStamp }
  if (sameStamp(proof.stamp ?? null, sessionStamp())) return proof
  // Another account's, or another house's: it is never shown, and never
  // left in the tab for the next person either.
  sessionStorage.removeItem(FIRST_PROOF_KEY)
  sessionStorage.removeItem(FIRST_PROOF_SOURCE_KEY)
  return null
}

export function readProof(): (MenuImportResult & { sourceImage?: string | null }) | null {
  try {
    const proof = storedProof() as (MenuImportResult & { sourceImage?: string | null }) | null
    if (!proof) return null
    if (!proof.sourceImage) {
      proof.sourceImage = sessionStorage.getItem(FIRST_PROOF_SOURCE_KEY)
    }
    return proof
  } catch {
    return null
  }
}

/**
 * What the first proof holds, said the way /house says it (r28 onboarding
 * gap 6). `pencilledCount` skips kitchen lines, so a proof that read only
 * dishes counted 0 in pencil and /house called it "set in ink" over no drink
 * at all. A proof with no drink line is said as what it is.
 */
export type ProofStanding =
  | { kind: 'empty' }
  | { kind: 'dishes-only'; dishes: number }
  | { kind: 'ink' }
  | { kind: 'pencil'; lines: number }

export function proofStanding(items: MenuImportReviewItem[]): ProofStanding {
  const drinks = items.filter((item) => !isKitchenLine(item))
  if (drinks.length === 0) {
    return items.length === 0 ? { kind: 'empty' } : { kind: 'dishes-only', dishes: items.length }
  }
  const lines = drinks.filter(lineNeedsPencil).length
  return lines === 0 ? { kind: 'ink' } : { kind: 'pencil', lines }
}

/**
 * Keep the proof in this tab. Returns false when the browser refuses storage
 * (private mode, a full quota, storage switched off) — never throws (r28
 * onboarding gap 8). The menu is already kept on the gateway when this runs,
 * so a throw here made the page say the photo could not be read, and the
 * owner read it again into a second draft. On a refusal any older proof in
 * the tab is removed too, so /house/menu never shows an earlier menu's lines
 * for this one (placing them would change that earlier menu): it finds no
 * proof and says the menu is read and kept, with the way to Menu.
 */
export function writeProof(result: MenuImportResult, sourceImage?: string | null): boolean {
  try {
    sessionStorage.setItem(FIRST_PROOF_KEY, JSON.stringify({ ...result, stamp: sessionStamp() }))
  } catch {
    try {
      sessionStorage.removeItem(FIRST_PROOF_KEY)
      sessionStorage.removeItem(FIRST_PROOF_SOURCE_KEY)
    } catch {
      // Storage that cannot be reached holds no earlier proof either.
    }
    return false
  }
  if (sourceImage) {
    try {
      sessionStorage.setItem(FIRST_PROOF_SOURCE_KEY, sourceImage)
    } catch {
      sessionStorage.removeItem(FIRST_PROOF_SOURCE_KEY)
    }
  } else {
    sessionStorage.removeItem(FIRST_PROOF_SOURCE_KEY)
  }
  return true
}

/**
 * Keep the lines as they now stand (walk 2026-11-11). Placing a line or
 * adding one saved it on the gateway but only in the page's state, so a
 * reload of /house/menu put every line back to "needs a place" and /house
 * still counted them pencilled. The stored proof's items are rewritten;
 * the page image (its own key) is left alone. Storage that refuses is not
 * an error: the gateway already holds the change.
 */
export function saveProofItems(items: MenuImportReviewItem[]) {
  try {
    // Only this session's own proof is rewritten (gap 7).
    const proof = storedProof()
    if (!proof) return
    sessionStorage.setItem(FIRST_PROOF_KEY, JSON.stringify({ ...proof, items }))
  } catch {
    // Blocked or full storage: the page keeps its state for this visit.
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
