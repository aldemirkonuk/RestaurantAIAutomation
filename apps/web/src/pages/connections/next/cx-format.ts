/**
 * Formatters for `/connections`.
 *
 * ONE RULE, EVERYWHERE: an unknown is an EM DASH, never a zero and never a
 * hopeful word. Every function here takes `null | undefined` and returns the
 * dash rather than throwing or defaulting, so a caller cannot accidentally
 * print `0` for "we did not find out".
 *
 * Prefixed `cx` rather than `cn`: `pages/calendar/next` already owns the `cn-`
 * class prefix and `lib/utils` exports a `cn()` classname helper, and a third
 * meaning of two letters is how a stylesheet starts leaking across pages.
 */

export const DASH = '—';

/** A count. `0` is a measurement and prints as `0`; absence prints as a dash. */
export function count(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  return new Intl.NumberFormat('en-GB').format(n);
}

/**
 * A count written out, for the ledger sentence.
 *
 * Up to twelve, because "Fourteen things can act" reads as a sentence and
 * "14 things can act" reads as a dashboard. Above that the numeral is clearer
 * than the word, which is the point at which prose stops helping.
 */
const WORDS = [
  'Nothing', 'One', 'Two', 'Three', 'Four', 'Five', 'Six',
  'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
];

export function spelled(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  return n >= 0 && n < WORDS.length ? WORDS[n] : count(n);
}

/** Lower-case form, for mid-sentence use. `Nothing` stays capitalised nowhere. */
export function spelledLower(n: number | null | undefined): string {
  const s = spelled(n);
  return s === DASH ? s : s.toLowerCase();
}

/**
 * When something last happened, in the house's voice.
 *
 * Relative up to a week because "7 minutes ago" is what a manager wants from a
 * live feed; absolute after, because "43 days ago" is arithmetic the reader has
 * to undo. An unparseable date is a dash, not today.
 */
export function when(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return DASH;
  const diff = Date.now() - t;
  if (diff < 0) return absolute(t);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return absolute(t);
}

function absolute(t: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(t));
}

/** A date with no time — for "connected on", "granted on". */
export function onDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? DASH : absolute(t);
}

/**
 * A card's printable expiry.
 *
 * Both halves must be present. A month with no year is not "01/—", it is an
 * unknown expiry, and printing half of it invites the reader to supply the
 * other half from imagination.
 */
export function expiry(
  month: number | null | undefined,
  year: number | null | undefined,
): string {
  if (!month || !year) return DASH;
  return `${String(month).padStart(2, '0')}/${String(year).slice(-2)}`;
}

/** A person's name, or the fact that the account is gone. Never "Unknown". */
export function personName(name: string | null | undefined): string {
  return name && name.trim() ? name : 'no longer with this house';
}

/**
 * The absolute URL of the iCal feed.
 *
 * Built from the gateway origin the bundle was configured with, because the
 * feed is fetched by Outlook and Apple Calendar, not by this browser — a
 * relative path would be uncopyable. Returns null rather than a half-URL when
 * the token is absent, so the row shows a dash instead of a link to nowhere.
 */
export function feedUrl(token: string | null | undefined): string | null {
  if (!token) return null;
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
  const origin = base.replace(/\/+$/, '');
  return `${origin}/api/v1/calendar/feed/${token}.ics`;
}

/** A short, legible form of a URL for a row's subtitle. */
export function shortUrl(url: string | null | undefined): string {
  if (!url) return DASH;
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}

/** The five probe outcomes, in the house's words rather than the protocol's. */
export function probeWord(status: string | null | undefined): string {
  switch (status) {
    case 'ok':
      return 'Answered';
    case 'unreachable':
      return 'Nothing answered';
    case 'refused':
      return 'Refused';
    case 'protocol_error':
      return 'Not this protocol';
    case 'unconfigured':
      return 'Not called';
    default:
      // Never probed is not a health state. It is the absence of one.
      return 'Never called';
  }
}

/**
 * The gateway's words, never ours.
 *
 * A message this file wrote would describe what we GUESS went wrong; the
 * gateway's message describes what did. Only the last-resort branch is ours,
 * and it says that it does not know.
 *
 * It lives here rather than in the data hook (moved 2026-09-04) because a
 * refused WRITE needs it as much as a refused read, and the page's own tests
 * mock the data hook wholesale — a sentence extractor imported from the mocked
 * module would be the mock's, so the test proving the refusal reaches the
 * operator would be testing the fixture. Axios hides the sentence in
 * `response.data.message` and puts "Request failed with status code 403" on
 * `.message`; printing the status code would be the empty-register failure
 * wearing different clothes (ADR 0020).
 */
export function readError(e: unknown): string {
  const err = e as {
    response?: { data?: { message?: string | string[] } };
    message?: string;
  };
  const raw = err?.response?.data?.message;
  if (Array.isArray(raw) && raw.length) return String(raw[0]);
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (err?.message) return err.message;
  return 'This register could not be read, and the reason did not come back with the failure.';
}
