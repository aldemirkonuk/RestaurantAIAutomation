/**
 * Warm start for /reports (r108 g8): a reload or a new tab paints this house's
 * last read while the page reads again.
 *
 * What is kept, and where:
 *  - Only a WHOLE successful register read (every source it reads answered).
 *    Never a failed read, a held-back register, or a 403: those never reach
 *    the writer (`useReportsNextData`).
 *  - sessionStorage only, never localStorage: it is gone when the tab closes,
 *    so money read on a shared device does not outlive the session.
 *  - Keyed by (user, house, role in that house, the register's read). Another
 *    person, another house or another role never sees an entry: the whole store
 *    belongs to one owner, and a read under any other owner drops it.
 *  - At most 15 minutes old, at most 400,000 characters in all, oldest out.
 *  - Cleared at sign-out and at a house switch (`forgetHouseReads`, AuthContext).
 *
 * Cost: the store is parsed once per page load and mirrored in memory (a
 * session store is one tab's, so the mirror cannot go stale); each read is
 * serialised once when it lands, and the store is written back once per idle
 * moment, not once per register.
 *
 * Every access is in try/catch: a private window, a full or blocked store, or a
 * value that does not parse is simply no warm start, and the page reads as it
 * always did.
 */

/** Every key this module writes starts with this; `forgetWarm` removes them all. */
export const WARM_PREFIX = 'mdv-warm:reports:';
export const WARM_KEY = `${WARM_PREFIX}v1`;
export const WARM_MAX_AGE_MS = 15 * 60_000;
export const WARM_MAX_CHARS = 400_000;

/** Whose reads these are. All three must match for an entry to be seen. */
export interface WarmOwner {
  userId: string;
  restaurantId: string;
  role: string;
}

export interface WarmEntry {
  /** When the read landed (ms since the epoch). */
  at: number;
  data: unknown;
}

/** One kept read: its JSON text (what is stored and measured) and, once parsed, its value. */
interface Kept {
  at: number;
  text: string;
  data?: unknown;
  parsed: boolean;
}

interface Mirror {
  owner: WarmOwner;
  entries: Map<string, Kept>;
}

/** undefined: not read from the store yet this page load; null: nothing kept. */
let mirror: Mirror | null | undefined;
let pending: ReturnType<typeof setTimeout> | null = null;

function session(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export const sameOwner = (a: WarmOwner, b: WarmOwner) =>
  a.userId === b.userId && a.restaurantId === b.restaurantId && a.role === b.role;

function loaded(): Mirror | null {
  if (mirror !== undefined) return mirror;
  mirror = null;
  try {
    const raw = session()?.getItem(WARM_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { owner?: WarmOwner; entries?: Record<string, { at?: unknown; t?: unknown }> };
    const o = s?.owner;
    if (!o || typeof o.userId !== 'string' || typeof o.restaurantId !== 'string' || typeof o.role !== 'string') return null;
    const entries = new Map<string, Kept>();
    for (const [k, e] of Object.entries(s.entries ?? {}))
      if (e && typeof e.at === 'number' && typeof e.t === 'string') entries.set(k, { at: e.at, text: e.t, parsed: false });
    mirror = { owner: o, entries };
  } catch {
    mirror = null;
  }
  return mirror;
}

function drop(): void {
  mirror = null;
  if (pending !== null) clearTimeout(pending);
  pending = null;
  try {
    session()?.removeItem(WARM_KEY);
  } catch {
    /* no store: nothing to drop */
  }
}

/** The register read keyed `key` for `owner`, if one younger than 15 minutes is kept. */
export function warmRead(owner: WarmOwner | null, key: string, now = Date.now()): WarmEntry | undefined {
  if (!owner) return undefined;
  const m = loaded();
  if (!m) return undefined;
  if (!sameOwner(m.owner, owner)) {
    // Another person, house or role: never theirs to see, and not kept for later.
    drop();
    return undefined;
  }
  const e = m.entries.get(key);
  if (!e || now - e.at > WARM_MAX_AGE_MS || now < e.at) return undefined;
  if (!e.parsed) {
    try {
      e.data = JSON.parse(e.text);
      e.parsed = true;
    } catch {
      m.entries.delete(key);
      return undefined;
    }
  }
  return { at: e.at, data: e.data };
}

/** Write the mirror back to the store now: entries past 15 minutes go, then the oldest until it fits. */
export function flushWarm(now = Date.now()): void {
  if (pending !== null) clearTimeout(pending);
  pending = null;
  const m = mirror;
  const store = session();
  if (!m || !store) return;
  try {
    for (const [k, e] of m.entries) if (now - e.at > WARM_MAX_AGE_MS) m.entries.delete(k);
    const byAge = [...m.entries.keys()].sort((a, b) => m.entries.get(a)!.at - m.entries.get(b)!.at);
    const text = () =>
      JSON.stringify({
        owner: m.owner,
        entries: Object.fromEntries([...m.entries].map(([k, e]) => [k, { at: e.at, t: e.text }])),
      });
    let out = text();
    while (out.length > WARM_MAX_CHARS && byAge.length > 0) {
      m.entries.delete(byAge.shift() as string);
      out = text();
    }
    if (m.entries.size === 0) {
      drop();
      return;
    }
    store.setItem(WARM_KEY, out);
  } catch {
    // A full store or a value that cannot be written: no warm start next time.
    drop();
  }
}

/** Keep `data` as `owner`'s read `key`; written back to the store at the next idle moment. */
export function warmWrite(owner: WarmOwner | null, key: string, data: unknown, now = Date.now()): void {
  if (!owner || !session()) return;
  let text: string;
  try {
    text = JSON.stringify(data);
  } catch {
    return;
  }
  if (typeof text !== 'string' || text.length > WARM_MAX_CHARS) return;
  const m = loaded();
  if (!m || !sameOwner(m.owner, owner)) mirror = { owner, entries: new Map() };
  mirror!.entries.set(key, { at: now, text, data, parsed: true });
  if (pending === null) pending = setTimeout(() => flushWarm(), 250);
}

/** Forget every warm read: at sign-out and at a house switch. */
export function forgetWarm(): void {
  drop();
  const store = session();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(WARM_PREFIX)) keys.push(k);
    }
    for (const k of keys) store.removeItem(k);
  } catch {
    /* no store: nothing kept */
  }
  // Read afresh from the (now empty) store next time.
  mirror = undefined;
}

/**
 * "Read at 14:02, reading again" — said while a kept read is on screen, on the
 * reader's own clock like the page's date line. A read again that fails takes
 * the kept one off the screen (it is placeholder data), so there is no
 * "could not be read again" case to word.
 */
export function warmWords(at: number): string {
  const time = new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `Read at ${time}, reading again`;
}
