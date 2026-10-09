import { useCallback, useEffect, useState } from 'react'
import {
  getMenuVersion,
  listMenuVersions,
  type MenuImportResult,
  type MenuImportReviewItem,
  type MenuLine,
  type MenuVersion,
} from '../services/api/menus'

export const FIRST_PROOF_KEY = 'mudavym:first-proof'
export const FIRST_PROOF_SOURCE_KEY = 'mudavym:first-proof-source'

/**
 * A line of the first proof. `matched` is null when nobody can say: the
 * house's record keeps a line's section, never whether the reading matched it
 * to the wine library (ADR 0309).
 *
 * `kitchenLine` is the house's own answer (the gateway's `kitchen_line`), null
 * when the gateway did not send one. `rawLineWithheld` is true when the house
 * keeps a raw line for this line and did not send it to this viewer.
 */
export type ProofLine = Omit<MenuImportReviewItem, 'matched'> & {
  matched: boolean | null
  kitchenLine?: boolean | null
  rawLineWithheld?: boolean
}

/**
 * What one tab just read, stamped with the house it was read for and the
 * person who read it (ADR 0309).
 */
export type StoredProof = MenuImportResult & {
  restaurantId?: string
  userId?: string
  sourceImage?: string | null
}

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
 * ADR 0213: unmatched fallback, plus missing/unknown category. Never invent
 * certainty. A line whose match nobody can tell (`matched: null`, ADR 0309)
 * is pencilled by its section alone, and the page says so.
 */
export function lineNeedsPencil(item: Pick<ProofLine, 'matched' | 'needsReview' | 'category'>) {
  if (item.needsReview) return true
  if (item.matched === false) return true
  const category = item.category?.toLowerCase().trim() ?? ''
  if (!category || category === 'unknown') return true
  return !VOCABULARY.has(category)
}

/**
 * A kitchen line is set aside, not pencilled. The house's own answer
 * (`kitchenLine`, from the gateway's `kitchen_line`) wins, so every tab and
 * every role splits one menu the same. A gateway that does not send it falls
 * back to a hint in the section or in the raw line this viewer has.
 */
export function isKitchenLine(item: Pick<ProofLine, 'category' | 'rawText' | 'kitchenLine'>) {
  if (typeof item.kitchenLine === 'boolean') return item.kitchenLine
  const hay = `${item.category ?? ''} ${item.rawText ?? ''}`.toLowerCase()
  return KITCHEN.some((hint) => hay.includes(hint))
}

export function pencilledCount(items: ProofLine[]) {
  return items.filter((item) => !isKitchenLine(item) && lineNeedsPencil(item)).length
}

/**
 * The reading this tab kept for `restaurantId`, read by `userId`, or null. A
 * reading stamped with another house or another person, or with no house or
 * no person (written before the stamps existed), is ignored: it cannot be
 * shown to be this house's (MENU-07 b) or this person's. With no house or no
 * person given, nothing is read.
 */
export function readProof(
  restaurantId: string | null | undefined,
  userId: string | null | undefined,
): StoredProof | null {
  if (!restaurantId || !userId) return null
  try {
    const value = sessionStorage.getItem(FIRST_PROOF_KEY)
    if (!value) return null
    const proof = JSON.parse(value) as StoredProof
    if (!proof || proof.restaurantId !== restaurantId || !Array.isArray(proof.items)) return null
    if (!proof.userId || proof.userId !== userId) return null
    if (!proof.sourceImage) {
      proof.sourceImage = sessionStorage.getItem(FIRST_PROOF_SOURCE_KEY)
    }
    return proof
  } catch {
    return null
  }
}

/** Keeps this tab's reading, stamped with its house and its person. With either missing, nothing is kept. */
export function writeProof(
  result: MenuImportResult,
  restaurantId: string | null | undefined,
  userId: string | null | undefined,
  sourceImage?: string | null,
) {
  if (!restaurantId || !userId) return
  sessionStorage.setItem(FIRST_PROOF_KEY, JSON.stringify({ ...result, restaurantId, userId }))
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

/** A line a person placed stays placed in this tab's reading, so a reload keeps it in ink. */
export function markProofLine(
  restaurantId: string | null | undefined,
  userId: string | null | undefined,
  menuItemId: string,
  patch: Partial<MenuImportReviewItem>,
) {
  if (!restaurantId || !userId) return
  try {
    const value = sessionStorage.getItem(FIRST_PROOF_KEY)
    if (!value) return
    const proof = JSON.parse(value) as StoredProof
    if (!proof || proof.restaurantId !== restaurantId || !Array.isArray(proof.items)) return
    if (!proof.userId || proof.userId !== userId) return
    proof.items = proof.items.map((item) => (item.menuItemId === menuItemId ? { ...item, ...patch } : item))
    sessionStorage.setItem(FIRST_PROOF_KEY, JSON.stringify(proof))
  } catch {
    // A full or blocked store keeps the older reading; the server still has the placement.
  }
}

function newestFirst(versions: MenuVersion[]) {
  const at = (v: MenuVersion) => String(v.extractedAt ?? v.createdAt ?? '')
  return [...versions].sort((a, b) => at(b).localeCompare(at(a)))
}

/**
 * Which kept menu /house and /house/menu show (ADR 0309): the current one;
 * else the newest draft that read at least one line (a count nobody recorded
 * is not a zero); else the newest kept menu of any kind. Null only when the
 * house has kept no menu at all.
 */
export function pickHouseMenu(versions: MenuVersion[]): MenuVersion | null {
  const ordered = newestFirst(versions)
  return (
    ordered.find((v) => v.current) ??
    ordered.find((v) => v.status === 'draft' && v.linesExtracted !== 0) ??
    ordered[0] ??
    null
  )
}

/**
 * The house's stored lines as proof lines. The stored row is the truth for
 * what it keeps (name, section, prices) and the house's `kitchen_line` decides
 * the kitchen split. The raw line comes from the row when the gateway sends it
 * to this viewer (an owner or a manager), else from this person's own reading
 * of the SAME menu in this tab. The match and the crop box come only from that
 * reading (ADR 0309).
 */
export function proofFromServer(lines: MenuLine[], reading: StoredProof | null): ProofLine[] {
  const byId = new Map((reading?.items ?? []).map((item) => [item.menuItemId, item]))
  return lines.map((line) => {
    const read = byId.get(line.id)
    return {
      menuItemId: line.id,
      submissionId: read?.submissionId ?? null,
      name: line.name,
      producer: line.producer,
      category: line.category,
      vintage: line.vintage,
      region: line.region,
      grapeVariety: line.grape_variety,
      byGlassPrice: line.by_glass_price,
      bottlePrice: line.bottle_price,
      rawText: line.raw_extracted_text ?? read?.rawText ?? null,
      kitchenLine: typeof line.kitchen_line === 'boolean' ? line.kitchen_line : null,
      rawLineWithheld: line.raw_line_withheld === true,
      matched: read ? read.matched : null,
      needsReview: read ? read.needsReview : false,
      bbox: read?.bbox ?? null,
    }
  })
}

export function proofReason(cause: unknown): string {
  const e = cause as { response?: { data?: { message?: unknown } }; message?: string }
  const m = e?.response?.data?.message
  if (typeof m === 'string' && m) return m
  if (Array.isArray(m) && m.length) return String(m[0])
  return e?.message || 'no reason was given'
}

export type HouseProof =
  | { state: 'loading' }
  | { state: 'failed'; reason: string }
  | { state: 'none' }
  | {
      state: 'ready'
      version: MenuVersion
      lines: ProofLine[]
      sourceImage: string | null
      /** This tab read this very menu, so its lines carry the reading's own marks. */
      fromReading: boolean
    }

/**
 * The house's newest read menu, from the server, for the house this session
 * is in (ADR 0309). A failed read is `failed` with its reason, never `none`;
 * `none` is the server saying the house has kept no menu. This tab's reading
 * is used only when `userId` read it.
 */
export function useHouseProof(
  restaurantId: string | null | undefined,
  userId: string | null | undefined,
): {
  proof: HouseProof
  retry: () => void
} {
  const [attempt, setAttempt] = useState(0)
  const [proof, setProof] = useState<HouseProof>({ state: 'loading' })

  useEffect(() => {
    setProof({ state: 'loading' })
    if (!restaurantId) return
    let live = true
    void (async () => {
      try {
        const list = await listMenuVersions()
        if (!Array.isArray(list?.versions)) {
          throw new Error("the house's menus came back without a list")
        }
        const pick = pickHouseMenu(list.versions)
        if (!pick) {
          if (live) setProof({ state: 'none' })
          return
        }
        const detail = await getMenuVersion(pick.menuId)
        if (!Array.isArray(detail?.items)) {
          throw new Error('the menu came back without its lines')
        }
        const cached = readProof(restaurantId, userId)
        const reading = cached && cached.menuId === pick.menuId ? cached : null
        if (!live) return
        setProof({
          state: 'ready',
          version: detail.version ?? pick,
          lines: proofFromServer(detail.items, reading),
          sourceImage: reading?.sourceImage ?? null,
          fromReading: reading !== null,
        })
      } catch (cause) {
        if (live) setProof({ state: 'failed', reason: proofReason(cause) })
      }
    })()
    return () => {
      live = false
    }
  }, [restaurantId, userId, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { proof, retry }
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
