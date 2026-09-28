/**
 * hp-format — the house type stack and the small formatters `/help` needs.
 *
 * Copied from `pages/profile/next/pf-format.ts` rather than imported across
 * pages (each Mudavym page stands alone; page directories do not import from
 * one another). Fraunces is loaded idempotently under the same element id
 * every rebuilt page uses, so two pages mounted in one session add one
 * stylesheet, not two.
 */

const LINK_ID = 'mudavym-fraunces';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

export const EM = '—';

export function ensureFraunces(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(LINK_ID)) return;
  const link = document.createElement('link');
  link.id = LINK_ID;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..680;1,9..144,300..680&display=swap';
  document.head.appendChild(link);
}

/**
 * "3 minutes ago" / "yesterday, 14:02" / "9 Sep" — a relative-enough reading
 * of an ISO timestamp, for the honesty rule that a probe or a cron's last run
 * is DATED, never described as a present-tense "live" (help.md §9 honesty
 * trap 3: "Live" in present tense is untrue; say "answered on <date>").
 * `null`/unparseable input is said in words, never rendered as a blank.
 */
export function fmtAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'never recorded';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return 'an unreadable timestamp';
  const ms = now.getTime() - t.getTime();
  if (ms < 0) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'moments ago';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
  const sameYear = t.getFullYear() === now.getFullYear();
  return t.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  });
}

/** A floor, per ADR 0051: a capped list reads `20+`, never a bare `20`. */
export function fmtFloor(n: number, cap: number): string {
  return n >= cap ? `${cap}+` : String(n);
}

/** Milliseconds as a person reads them: `84 ms`, `1.3 s`. */
export function fmtLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'not timed';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Copied from `pages/profile/next/pf-format.ts:37-50` — the same extraction
 * every next-page hook uses to turn an axios error into the message a page
 * can print, and to tell a role refusal (403) apart from a broken read.
 */
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

/** `1190cec4` from a full SHA; the literal `unknown` stays `unknown`. */
export function shortCommit(commit: string | null | undefined): string {
  if (!commit) return 'unknown';
  const v = commit.trim();
  if (!v || v === 'unknown') return 'unknown';
  return v.length > 8 ? v.slice(0, 8) : v;
}
