/**
 * hp-format — the house type stack and the small formatters `/help` needs.
 *
 * Copied from `pages/settings/next` rather than imported across pages (each
 * Mudavym page stands alone). Fraunces is loaded idempotently under the same
 * element id every rebuilt page uses, so two pages in one session add one
 * stylesheet, not two.
 */

const LINK_ID = 'mudavym-fraunces';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

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

/** `1190cec4` from a full SHA; the literal `unknown` stays `unknown`. */
export function shortCommit(commit: string | null | undefined): string {
  if (!commit) return 'unknown';
  const v = commit.trim();
  if (!v || v === 'unknown') return 'unknown';
  return v.length > 8 ? v.slice(0, 8) : v;
}

/** Milliseconds as a person reads them: `84 ms`, `1.3 s`. */
export function fmtLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'not timed';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * "up since 14:02 today" / "up since 9 Sep, 14:02" — an ISO time made
 * readable next to `now`. An unparseable value is said to be unparseable
 * rather than rendered as a date the gateway never sent.
 */
export function fmtSince(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'boot time not reported';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return 'boot time unreadable';
  const time = t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const sameDay =
    t.getFullYear() === now.getFullYear() &&
    t.getMonth() === now.getMonth() &&
    t.getDate() === now.getDate();
  if (sameDay) return `up since ${time} today`;
  const day = t.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `up since ${day}, ${time}`;
}

/** `14:31:05` — the clock reading a check was taken at. */
export function fmtClock(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
