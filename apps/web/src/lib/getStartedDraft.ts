/**
 * What a new owner typed on the restaurant step of /get-started survives a
 * reload, a back-swipe and an iOS tab discard (r107 onboarding g4).
 *
 * The same rules as the sign-up draft (r107 g2): sessionStorage (tab-scoped,
 * gone on close), 30 minutes, an allow-list of plain place fields, never a
 * secret. Tied to the signed-in person, so another account in the same tab
 * never inherits it. The coordinate a picked place carried is not kept: it
 * would no longer match an address typed over, and nothing can tell.
 */
const KEY = 'mudavym:get-started-draft'
const TTL_MS = 30 * 60 * 1000

export interface GetStartedDraft {
  restaurantName: string
  address: string
  city: string
  country: string
  stateProvince: string
  postalCode: string
  restaurantPhone: string
}

const FIELDS = ['restaurantName', 'address', 'city', 'country', 'stateProvince', 'postalCode', 'restaurantPhone'] as const

function store(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

function pick(d: Partial<GetStartedDraft>): GetStartedDraft {
  const out = {} as GetStartedDraft
  for (const f of FIELDS) out[f] = typeof d[f] === 'string' ? (d[f] as string) : ''
  return out
}

export function readGetStartedDraft(userId: string | null | undefined, now: number = Date.now()): GetStartedDraft | null {
  const s = store()
  if (!s || !userId) return null
  try {
    const raw = s.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<GetStartedDraft> & { at?: number; u?: string }
    if (typeof parsed.at !== 'number' || now - parsed.at > TTL_MS || parsed.at > now + 60_000) {
      s.removeItem(KEY)
      return null
    }
    if (parsed.u !== userId) return null
    return pick(parsed)
  } catch {
    return null
  }
}

export function writeGetStartedDraft(userId: string | null | undefined, d: GetStartedDraft, now: number = Date.now()): void {
  const s = store()
  if (!s || !userId) return
  try {
    const clean = pick(d)
    if (FIELDS.every((f) => clean[f].trim() === '')) {
      s.removeItem(KEY)
      return
    }
    s.setItem(KEY, JSON.stringify({ ...clean, u: userId, at: now }))
  } catch {
    /* a full or blocked store loses the draft, never the house */
  }
}

export function clearGetStartedDraft(): void {
  try {
    store()?.removeItem(KEY)
  } catch {
    /* nothing to clear */
  }
}
