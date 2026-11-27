/**
 * A typed sign-up survives a reload, a back-swipe and the trip to
 * /verify-email and back (r107 onboarding g2).
 *
 * Kept in sessionStorage, under one key, for 30 minutes: tab-scoped and gone
 * when the tab closes. Never localStorage (it outlives the person at a shared
 * till), and never a secret: the allow-list in `pick` is the whole shape, so a
 * password cannot be written by adding a field to the form.
 */
const KEY = 'mudavym:register-draft'
const TTL_MS = 30 * 60 * 1000

export type RegisterDraftMode = 'join' | 'create'

export interface RegisterDraft {
  mode: RegisterDraftMode
  name: string
  email: string
  restaurantName: string
  address: string
  city: string
  country: string
  postalCode: string
  phone: string
}

const FIELDS = ['name', 'email', 'restaurantName', 'address', 'city', 'country', 'postalCode', 'phone'] as const

function store(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

function pick(d: Partial<RegisterDraft> & { mode: RegisterDraftMode }): RegisterDraft {
  const out = { mode: d.mode } as RegisterDraft
  for (const f of FIELDS) out[f] = typeof d[f] === 'string' ? (d[f] as string) : ''
  return out
}

/** The stored draft for this path, or null: none, stale, another path's, unreadable. */
export function readRegisterDraft(mode: RegisterDraftMode, now: number = Date.now()): RegisterDraft | null {
  const s = store()
  if (!s) return null
  try {
    const raw = s.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RegisterDraft> & { at?: number }
    if (typeof parsed.at !== 'number' || now - parsed.at > TTL_MS || parsed.at > now + 60_000) {
      s.removeItem(KEY)
      return null
    }
    if (parsed.mode !== mode) return null
    return pick({ ...parsed, mode })
  } catch {
    return null
  }
}

/** Writes the draft, or removes the key when nothing has been typed. */
export function writeRegisterDraft(d: RegisterDraft, now: number = Date.now()): void {
  const s = store()
  if (!s) return
  try {
    const clean = pick(d)
    if (FIELDS.every((f) => clean[f].trim() === '')) {
      s.removeItem(KEY)
      return
    }
    s.setItem(KEY, JSON.stringify({ ...clean, at: now }))
  } catch {
    /* a full or blocked store loses the draft, never the sign-up */
  }
}

export function clearRegisterDraft(): void {
  try {
    store()?.removeItem(KEY)
  } catch {
    /* nothing to clear */
  }
}
