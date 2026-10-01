/**
 * This device's storage: ask the browser to keep it, and say honestly how it
 * stands (the founder's storage ruling, 2026-09-29).
 *
 * The founder, 2026-09-29, verbatim: "option 1, not sent. but we have to find a
 * way to optimizew storage using per device? what sindustry equilavent".
 *
 * What was measured before building this: a queued door receipt is about 1 KB
 * and nothing queues photos or blobs, so a byte or count budget protects
 * nothing — 100 unsent changes are ~100 KB against a quota of a large share of
 * the disk. The real threat is the browser clearing the WHOLE origin (it never
 * evicts part of one): under storage pressure, and in Safari after 7 days of
 * browser use without a visit unless the site is a Home Screen web app. The
 * industry answer to that is not a cap but `navigator.storage.persist()` plus
 * telling the person when work waits too long:
 *   - Replicache, Linear: unsent mutations stay in IndexedDB, uncapped.
 *   - Figma: offline changes kept 30 days (7 in Safari), warns before logout.
 *   - Square offline mode: upload within 24 h, payments expire at 72 h.
 *   - Workbox Background Sync deletes a queued request after 7 days
 *     (`maxRetentionTime`) — REJECTED here: ADR 0241 never drops a change
 *     for waiting.
 *
 * HOW persist() IS ASKED FOR, per engine (MDN "Storage quotas and eviction
 * criteria"; web.dev "Persistent storage"):
 *   - Chromium (Chrome, Edge, Samsung, Android WebView): decided SILENTLY from
 *     site engagement / install / bookmark; never shows a prompt.
 *   - Safari / every iOS browser (WebKit): SILENT; granted to a Home Screen
 *     web app.
 *   - Firefox (Gecko): SHOWS A PERMISSION PROMPT.
 * So `ensurePersisted` is called after sign-in or session restore (never in a
 * write path, never awaited by one) and asks at most once per page load — but
 * NOT on Gecko, where an unprompted call would pop a permission dialog on top
 * of the app at sign-in. There, `requestPersistence` is offered behind an
 * explicit button (a user gesture), and nothing asks on its own.
 *
 * Why the engine is told apart by the user agent and not by
 * `navigator.permissions.query({ name: 'persistent-storage' })`: that query
 * reads 'prompt' in Chromium too (meaning "not granted yet", even though
 * Chromium will never show one), and throws in Safari, so its state cannot
 * tell a prompting engine from a silent one. The UA test matches `Firefox/`,
 * which Gecko on desktop and Android both carry; Firefox for iOS says
 * `FxiOS/`, runs WebKit, does not prompt, and so is (correctly) not matched.
 *
 * Every read here is wrapped: an API this browser does not have, or one that
 * throws, reads as `null` — UNKNOWN — never as 0 or as "fine"
 * (`absence-reported-as-health`).
 */

import { offlineStorage } from './offline-storage'

/**
 * How long an unsent change may wait before the app says so: 24 h, after
 * Square's offline mode (upload within 24 h). Confirmed by the founder,
 * 2026-09-29 — decided, not provisional.
 */
export const UNSENT_NUDGE_AFTER_MS = 24 * 60 * 60 * 1000

export interface StorageHealth {
  /** true: the browser will not clear this site's data on its own; false: it may; null: unknown. */
  persisted: boolean | null
  /** Bytes this site uses, from `navigator.storage.estimate()`; null: unknown. */
  usage: number | null
  /** Bytes this site may use; null: unknown. */
  quota: number | null
  /** This session's changes still waiting to send; null: the queue could not be read. */
  pending: number | null
  /** This session's changes parked as "not sent"; null: the queue could not be read. */
  parked: number | null
  /** When the oldest of those (waiting or parked) was made; null: none, or unknown. */
  oldestUnsentAt: Date | null
}

export type EnsurePersistedResult =
  | 'unsupported'
  | 'already'
  | 'asked'
  | 'asked-before'
  | 'needs-a-tap'
  | 'unknown'

let askedThisPageLoad = false

/** Test hook: forget that this page load already asked. */
export function resetPersistRequestForTests(): void {
  askedThisPageLoad = false
}

function storageManager(): StorageManager | null {
  try {
    const s = typeof navigator !== 'undefined' ? navigator.storage : undefined
    return s ?? null
  } catch {
    return null
  }
}

/** Does asking for persistent storage show a permission prompt here? (Gecko: yes.) */
export function persistShowsAPrompt(): boolean {
  try {
    return /\bFirefox\/\d/.test(navigator.userAgent)
  } catch {
    return false
  }
}

/** Is this site's storage marked persistent? null when the browser cannot say. */
export async function readPersisted(): Promise<boolean | null> {
  const s = storageManager()
  if (!s || typeof s.persisted !== 'function') return null
  try {
    return await s.persisted()
  } catch {
    return null
  }
}

/**
 * After sign-in or session restore: ask the browser, once per page load, to
 * keep this site's storage — where asking is silent. Fire-and-forget; never
 * call it from a write path.
 */
export async function ensurePersisted(): Promise<EnsurePersistedResult> {
  const s = storageManager()
  if (!s || typeof s.persist !== 'function' || typeof s.persisted !== 'function')
    return 'unsupported'
  const already = await readPersisted()
  if (already === true) return 'already'
  if (persistShowsAPrompt()) return 'needs-a-tap'
  if (askedThisPageLoad) return 'asked-before'
  askedThisPageLoad = true
  try {
    await s.persist()
    return 'asked'
  } catch {
    return 'unknown'
  }
}

/**
 * The explicit ask, for a button the person taps (Firefox shows its prompt).
 * Resolves true when granted, false when refused, null when unknown.
 */
export async function requestPersistence(): Promise<boolean | null> {
  const s = storageManager()
  if (!s || typeof s.persist !== 'function') return null
  askedThisPageLoad = true
  try {
    return await s.persist()
  } catch {
    return null
  }
}

/** Everything the banner needs, each part independently null when unknown. */
export async function readStorageHealth(): Promise<StorageHealth> {
  const health: StorageHealth = {
    persisted: await readPersisted(),
    usage: null,
    quota: null,
    pending: null,
    parked: null,
    oldestUnsentAt: null,
  }

  const s = storageManager()
  if (s && typeof s.estimate === 'function') {
    try {
      const e = await s.estimate()
      health.usage = typeof e.usage === 'number' ? e.usage : null
      health.quota = typeof e.quota === 'number' ? e.quota : null
    } catch {
      /* unknown stays null */
    }
  }

  try {
    // The session's own view (ADR 0241): another person's or house's changes
    // are not this session's to count.
    const visible = await offlineStorage.getPendingMutations()
    health.parked = visible.filter((m) => !!m.parked).length
    health.pending = visible.length - health.parked
    let oldest: number | null = null
    for (const m of visible) {
      const t = new Date(m.timestamp).getTime()
      if (Number.isFinite(t) && (oldest === null || t < oldest)) oldest = t
    }
    health.oldestUnsentAt = oldest === null ? null : new Date(oldest)
  } catch {
    /* unknown stays null */
  }

  return health
}

/** Has the oldest unsent change waited longer than the nudge threshold? */
export function unsentWaitedTooLong(health: StorageHealth, now = Date.now()): boolean {
  if (!health.oldestUnsentAt) return false
  return now - health.oldestUnsentAt.getTime() > UNSENT_NUDGE_AFTER_MS
}
