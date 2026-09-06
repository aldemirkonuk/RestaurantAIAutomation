/**
 * ProfileNext formatting + the page's small shared vocabulary.
 *
 * House rule (ADR 0020): an unknown renders as an em dash. It is never a zero,
 * never a blank field that reads as "empty", and never a cached value quietly
 * standing in for a server one.
 */

export const EM = '—';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SANS = '"Plus Jakarta Sans", "DM Sans", system-ui, sans-serif';

/**
 * Fraunces — the house serif, injected once and idempotently.
 *
 * Copied from `pages/dashboard/next/fonts.ts` rather than imported: pages do
 * not reach across into each other's directories (p4 brief), and `index.html`
 * is a shared file this page may not touch. Georgia carries the text until (or
 * if ever) the webfont lands, so nothing here can break the page.
 */
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

/** The message the gateway actually sent, or the transport failure verbatim. */
export function apiMessage(err: unknown, fallback = 'unknown error'): string {
  const res = (err as { response?: { data?: { message?: unknown } }; message?: unknown })
    ?.response?.data?.message;
  if (typeof res === 'string' && res.trim()) return res;
  if (Array.isArray(res) && typeof res[0] === 'string') return res[0];
  const msg = (err as { message?: unknown })?.message;
  if (typeof msg === 'string' && msg.trim()) return msg;
  return fallback;
}

/** True when the gateway refused on authorisation grounds, not on data. */
export function isForbidden(err: unknown): boolean {
  return (err as { response?: { status?: number } })?.response?.status === 403;
}

/** Role as the product says it. Unknown role is the dash, never "Staff". */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return EM;
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/** "12 August 2026", or the dash. Connection dates are facts of record. */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return EM;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return EM;
  return new Date(t).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Spelled small numbers — the standing line is prose, not a dashboard. */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

export function countWord(n: number): string {
  return WORDS[n] ?? String(n);
}

/** "12 August 2026, 14:05", or the dash. Used for a session's own timestamps. */
export function fmtMoment(iso: string | null | undefined): string {
  if (!iso) return EM;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return EM;
  return new Date(t).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * What this browser is, from its own user-agent string.
 *
 * Deliberately a matcher, not a parser: it names a browser and a platform ONLY
 * when it recognises one, and returns `null` otherwise — which the page renders
 * as an em dash. A user-agent is a claim the browser makes about itself, and
 * guessing "Windows" from an unmatched string would be inventing a device.
 */
export function describeDevice(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser =
    /\bEdg\//.test(ua) ? 'Edge'
    : /\bOPR\//.test(ua) ? 'Opera'
    : /\bFirefox\//.test(ua) ? 'Firefox'
    : /\bChrome\//.test(ua) ? 'Chrome'
    : /\bSafari\//.test(ua) && /\bVersion\//.test(ua) ? 'Safari'
    : null;
  const platform =
    /\biPhone\b/.test(ua) ? 'iPhone'
    : /\biPad\b/.test(ua) ? 'iPad'
    : /\bAndroid\b/.test(ua) ? 'Android'
    : /\bMac OS X\b/.test(ua) ? 'macOS'
    : /\bWindows NT\b/.test(ua) ? 'Windows'
    : /\bLinux\b/.test(ua) ? 'Linux'
    : null;
  if (browser && platform) return `${browser} on ${platform}`;
  return browser ?? platform;
}

/**
 * The plan as the product says it. The column is free text with a default of
 * `pilot` (baseline_from_production.sql:3582), so this titlecases what it is
 * given and never substitutes a friendlier word — an unrecognised tier is shown
 * as it is stored, and an absent one is the dash.
 */
export function planLabel(tier: string | null | undefined): string {
  if (!tier || !tier.trim()) return EM;
  const t = tier.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * A comma- or space-separated scope list, as typed, reduced to the slugs the
 * gateway's DTO will accept. Invalid entries are dropped HERE and counted by the
 * caller, so the operator is told what was discarded instead of discovering it
 * as a 400.
 */
export function parseScopes(input: string): { scopes: string[]; rejected: string[] } {
  const parts = input
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const scopes: string[] = [];
  const rejected: string[] = [];
  for (const p of parts) {
    if (/^[a-z0-9][a-z0-9._:-]*$/.test(p) && p.length <= 64) {
      if (!scopes.includes(p)) scopes.push(p);
    } else {
      rejected.push(p);
    }
  }
  return { scopes, rejected };
}
