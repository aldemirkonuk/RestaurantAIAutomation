/**
 * Pure helpers for the consent page — everything here is computed from what
 * the gateway sent or from the URL, and nothing here composes a privacy
 * sentence of its own (ADR 0118 D16: the copy is the server's).
 */

import type {
  IntegrationCatalogEntry,
  IntegrationConnection,
} from '../../../services/api/integrations';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const SANS = '"DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const EM = '—';

/* ── Fraunces ─────────────────────────────────────────────────────────────
   The house header injects the serif for every page it renders on, and it
   never renders here (NO_CHROME), so this page loads Fraunces for itself. The
   element id is the one every other injector uses (`HouseHeader.tsx`,
   `Sheet.tsx:71`, `pages/dashboard/next/fonts.ts:10`), so between them the
   document carries at most one link. */
const FRAUNCES_LINK_ID = 'mudavym-fraunces';

export function ensureFraunces(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FRAUNCES_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = FRAUNCES_LINK_ID;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..680;1,9..144,300..680&display=swap';
  document.head.appendChild(link);
}

/* ── Where Cancel goes ──────────────────────────────────────────────────── */

/**
 * A same-site path or null. `//evil.test` is a valid URL to a foreign origin,
 * so a leading double slash is refused as well. The gateway applies the same
 * rule to the path it stores on the state row (`safeReturnPath`); this is the
 * client half, so an off-site value is never even sent.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

/**
 * Settings by default; `/connections` once that route exists on this house
 * (ADR 0114 — with its flag off the route redirects to `/profile`, so sending
 * a reader there would land them on their own account instead of the till).
 */
export function defaultReturnPath(connectionsOn: boolean): '/settings' | '/connections' {
  return connectionsOn ? '/connections' : '/settings';
}

export function resolveReturnPath(
  raw: string | null | undefined,
  connectionsOn: boolean,
): string {
  return safeReturnPath(raw) ?? defaultReturnPath(connectionsOn);
}

/** The words for the place Cancel returns to, so the control can say where. */
export function returnWords(path: string): string {
  const pathname = path.split(/[?#]/)[0];
  if (pathname === '/profile' || pathname.startsWith('/profile/')) return 'your profile';
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return 'Settings';
  if (pathname === '/connections' || pathname.startsWith('/connections/')) return 'Connections';
  return 'where you came from';
}

/* ── What the gateway said when it refused or broke ─────────────────────── */

export interface ReadFailure {
  status: number | null;
  message: string;
}

export function readFailure(e: unknown, fallback: string): ReadFailure {
  const err = e as {
    response?: { status?: number; data?: { message?: string | string[] } };
    message?: string;
  } | null;
  const status = typeof err?.response?.status === 'number' ? err.response.status : null;
  const fromBody = err?.response?.data?.message;
  const message = Array.isArray(fromBody)
    ? fromBody.join(' ')
    : typeof fromBody === 'string' && fromBody.trim()
      ? fromBody
      : typeof err?.message === 'string' && err.message.trim()
        ? err.message
        : fallback;
  return { status, message };
}

/** "refused (403)" reads differently from "could not be read (500)". */
export function failureWords(f: ReadFailure): string {
  if (f.status === 403) return `refused (403): ${f.message}`;
  if (f.status === 401) return `not signed in (401): ${f.message}`;
  if (f.status === null) return `could not be read (no answer from the gateway): ${f.message}`;
  return `could not be read (${f.status}): ${f.message}`;
}

/* ── The page's verdict on what to draw ─────────────────────────────────── */

export type CatalogRead =
  | { state: 'loading' }
  | { state: 'unreadable'; failure: ReadFailure }
  | { state: 'ready'; entries: IntegrationCatalogEntry[]; readAt: Date };

export type Verdict =
  | { kind: 'no-id' }
  | { kind: 'loading' }
  | { kind: 'refused'; failure: ReadFailure }
  | { kind: 'unreadable'; failure: ReadFailure }
  | { kind: 'unknown'; id: string; offered: string[] }
  | { kind: 'unavailable'; entry: IntegrationCatalogEntry; reason: string }
  | { kind: 'ready'; entry: IntegrationCatalogEntry };

/**
 * The catalogue the server returns decides whether an id is real — nothing
 * else. There is deliberately no client-side list of ids here (the legacy
 * page carried `VALID_IDS` until 2026-09-04, and `gmail_send` shipped with a
 * Connect button that led to "Unknown integration" because of it).
 */
export function verdictFor(id: string | undefined, catalog: CatalogRead): Verdict {
  if (!id) return { kind: 'no-id' };
  if (catalog.state === 'loading') return { kind: 'loading' };
  if (catalog.state === 'unreadable') {
    return catalog.failure.status === 403
      ? { kind: 'refused', failure: catalog.failure }
      : { kind: 'unreadable', failure: catalog.failure };
  }
  const entry = catalog.entries.find((c) => c.id === id) ?? null;
  if (!entry) {
    return { kind: 'unknown', id, offered: catalog.entries.map((c) => c.id) };
  }
  if (!entry.available) {
    return {
      kind: 'unavailable',
      entry,
      reason: entry.unavailableReason ?? 'This deployment did not say why.',
    };
  }
  return { kind: 'ready', entry };
}

/* ── The data-handling record, only the lines the gateway answered ──────── */

export function dataHandlingLines(
  entry: IntegrationCatalogEntry,
): Array<{ term: string; detail: string }> {
  const dh = entry.dataHandling;
  if (!dh) return [];
  const pairs: Array<[string, string | undefined]> = [
    ['What we read', dh.reads],
    ['What we never read', dh.doesNotRead],
    ['Where it lands', dh.landsIn],
    ['Who can see it', dh.visibleTo],
    // The fifth answer arrived on 2026-09-05; an older gateway sends four and
    // the page shows four rather than inventing a fifth.
    ['How long it is kept', dh.keptFor],
  ];
  return pairs
    .filter((p): p is [string, string] => typeof p[1] === 'string' && p[1].trim().length > 0)
    .map(([term, detail]) => ({ term, detail }));
}

/* ── Whether this person already holds the grant ────────────────────────── */

export type Standing =
  | { state: 'loading' }
  | { state: 'unreadable'; failure: ReadFailure }
  | { state: 'none' }
  | { state: 'held'; account: string | null; since: string | null };

export function standingFor(
  id: string,
  read:
    | { state: 'loading' }
    | { state: 'unreadable'; failure: ReadFailure }
    | { state: 'ready'; rows: IntegrationConnection[] },
): Standing {
  if (read.state !== 'ready') return read;
  const row = read.rows.find((c) => c.integrationId === id && c.connected) ?? null;
  if (!row) return { state: 'none' };
  return { state: 'held', account: row.account, since: row.connectedAt };
}

/* ── Dates and provenance ───────────────────────────────────────────────── */

/** `2026-09-11` from an ISO string, or the em dash when there is none. */
export function isoDay(iso: string | null | undefined): string {
  if (!iso || iso.length < 10) return EM;
  return iso.slice(0, 10);
}

/** `14:02:11` — the moment a register was read, for the provenance line. */
export function clockOf(d: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** "three scopes" — a count word for the masthead. */
export function scopeCountWords(n: number): string {
  const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const word = n >= 0 && n < words.length ? words[n] : String(n);
  return `${word} ${n === 1 ? 'scope' : 'scopes'}`;
}
