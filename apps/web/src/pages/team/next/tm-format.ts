/**
 * TeamNext formatting — unknowns are em dashes; a withheld figure says why in
 * words (labour tracking off is a state, not a zero).
 */

import { countryByName } from '@/lib/countries';
import { CURRENCY_NOT_RECORDED, currencyMinorUnits } from '@/lib/currency';

export const EM = '—';

/**
 * The mark a windowed figure carries. /team's one server-side window
 * (TEAM_SERVER_WINDOWS.BENCHMARK_SERVICES) bounds the SAMPLE a statistic is
 * computed over, not a count being reported, so its honest mark is a ceiling
 * — "over ≤200 services" — and never a floor. `GE` is kept alongside it for
 * the day a count on this page becomes windowed; using the wrong one would be
 * a precise-looking falsehood, which is the thing ADR 0051 clause 2 exists to
 * stop.
 */
export const GE = '≥';
export const LE = '≤';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif';

/* ── money, in the house's own currency and locale ─────────────────────────

   This was a US-dollar formatter pinned to the en-US locale, so a house in
   Türkiye read its labour cost in dollars (ADR 0215; the judge's census found it
   tracked nowhere). A figure now carries the house's currency, which the gateway
   sends WITH the money and only to the owner, and it is printed in the house's
   locale, derived by `Intl` from the house's country — `Türkiye` gives
   `tr-Latn-TR` and `₺12.346`, with no table of locales to keep.

   A house that has not stated a currency is shown the number and the words
   "currency not recorded" (ADR 0117 Q25): never a symbol nobody chose. */

export interface HouseMoneyLike {
  currency: string | null;
  country: string | null;
  readable: boolean;
}

/**
 * The house's locale, from its country: `Intl.Locale('und-TR').maximize()` is
 * `tr-Latn-TR`. `undefined` (the reader's own runtime locale) when the country
 * is unknown — never a hard-coded one.
 */
export function houseLocale(country: string | null | undefined): string | undefined {
  const code = countryByName(country ?? null)?.code;
  if (!code) return undefined;
  try {
    return new Intl.Locale(`und-${code}`).maximize().baseName;
  } catch {
    return undefined;
  }
}

function fmtMoney(
  v: number | null | undefined,
  money: HouseMoneyLike | null | undefined,
  whole: boolean,
): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return EM;
  const code =
    money?.readable && typeof money.currency === 'string' && /^[A-Z]{3}$/.test(money.currency)
      ? money.currency
      : null;
  const digits = whole ? 0 : (currencyMinorUnits(code) ?? 2);
  const locale = houseLocale(money?.country);
  const plain = () =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(v);
  if (!code) {
    return `${plain()} (${money && !money.readable ? 'currency could not be read' : CURRENCY_NOT_RECORDED})`;
  }
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(v);
  } catch {
    // A well-formed code Intl does not know still names the money.
    return `${plain()} ${code}`;
  }
}

/** A total, in whole units of the house's money — or the dash. */
export function fmtMoneyWhole(
  v: number | null | undefined,
  money: HouseMoneyLike | null | undefined,
): string {
  return fmtMoney(v, money, true);
}

/** A rate (an hourly wage), to the currency's own minor units — or the dash. */
export function fmtMoneyExact(
  v: number | null | undefined,
  money: HouseMoneyLike | null | undefined,
): string {
  return fmtMoney(v, money, false);
}

const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
const dayShort = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

export function fmtWeekday(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  return Number.isFinite(d.getTime()) ? weekday.format(d) : isoDate;
}

export function fmtDayShort(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  return Number.isFinite(d.getTime()) ? dayShort.format(d) : isoDate;
}

/**
 * Monday of the week containing `d`, as YYYY-MM-DD (schedules key on it).
 * Computed from the LOCAL calendar date but with UTC-only arithmetic — the
 * previous local-getters + toISOString mix returned the wrong day for ~5
 * evening hours in any west-of-UTC timezone (team-audit.md, BLOCKER 2; the
 * gateway's own mondayOf is UTC-only for the same reason).
 */
export function mondayOf(d: Date): string {
  const utcAnchor = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (utcAnchor.getUTCDay() + 6) % 7; // Mon=0
  utcAnchor.setUTCDate(utcAnchor.getUTCDate() - day);
  return utcAnchor.toISOString().slice(0, 10);
}

/**
 * Parse a coverage period like "17:00–23:00" (en-dash, hyphen or "to").
 * Returns null when the string doesn't carry two clock times — the caller
 * must then disable the one-tap assign and say why, never guess.
 */
export function parsePeriod(period: string): { start: string; end: string } | null {
  const m = period.match(/(\d{1,2}:\d{2})\s*(?:–|—|-|to)\s*(\d{1,2}:\d{2})/);
  return m ? { start: m[1], end: m[2] } : null;
}

/* ── week arithmetic ─────────────────────────────────────────────────────────
   Every date here is parsed with an explicit `T00:00:00`, which JS reads as
   LOCAL time; a bare `YYYY-MM-DD` reads as UTC and lands on the previous day
   west of Greenwich. `mondayOf` above does its own UTC-only arithmetic for the
   same reason from the other direction — see its note. */

export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function dayNum(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  return Number.isFinite(d.getTime()) ? String(d.getDate()) : isoDate;
}

/** Today on the LOCAL calendar. `toISOString()` here would be tomorrow east of
    Greenwich for part of every evening. */
export function todayIso(now = new Date()): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function fmtWeekRange(weekStart: string): string {
  return `${fmtDayShort(weekStart)} ${EM} ${fmtDayShort(addDays(weekStart, 6))}`;
}

/** "17:00" → "5p", "17:30" → "5:30p". The legacy desk's clock, unchanged. */
export function fmtTime(t: string): string {
  const [h, m] = t.split(':').map((n) => parseInt(n, 10));
  if (!Number.isFinite(h)) return t;
  const suffix = h >= 12 ? 'p' : 'a';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hh}:${String(m).padStart(2, '0')}${suffix}` : `${hh}${suffix}`;
}

/** Hours a shift spans; an end before its start is an overnight, not a negative. */
export function shiftHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
  let diff = eh * 60 + em - (sh * 60 + sm);
  if (diff < 0) diff += 1440;
  return diff / 60;
}

/**
 * Hours WORKED on a shift: its span minus its breaks (4857 Art. 68 — a break is
 * not working time). The gateway counts the same way (`pay-rules.ts`), so the
 * grid and the week's figure agree.
 */
export function workedHours(
  start: string,
  end: string,
  breaks: ReadonlyArray<{ duration_min?: number | null }> | null | undefined,
): number {
  const mins = (breaks ?? []).reduce((n, b) => {
    const d = Number(b?.duration_min);
    return Number.isFinite(d) && d > 0 ? n + d : n;
  }, 0);
  return Math.max(0, shiftHours(start, end) - mins / 60);
}

/**
 * The Turkish week (4857 Art. 63). Over it is a flag to REVIEW, never a price:
 * whether an hour over 45 is overtime pay depends on agreements and consent
 * Mudavym does not hold (ADR 0215). It was 40, the US week.
 */
export const WEEKLY_REVIEW_HOURS = 45;

export function fmtHours(h: number | null): string {
  if (h === null || !Number.isFinite(h)) return EM;
  return `${Math.round(h * 10) / 10}h`;
}

/* ── who this row is ─────────────────────────────────────────────────────────

   THE PLACEHOLDER IS NOT A NAME.

   `team_members.display_name` is NOT NULL (baseline `:5632`), and the gateway's
   backfill fills it from the linked account. Until 2026-09-04 that lookup asked
   `public.users` for an `avatar_url` it has never had, so PostgREST answered
   42703, the identity map came back empty, and the backfill wrote the literal
   below into the column for every row it created. The demo tenant's three
   roster rows carried it (measured 2026-09-04: 3 of 3, with `email: null`),
   because fixing a read does not rename rows already written. Eleven rows
   across eight houses were repaired in production the same day
   (`scripts/repair_team_member_names.py`), and this resolution stays: a house
   restored from an older backup reproduces exactly one more of these, and the
   page must show it as "no name on file" rather than as somebody's name.

   So the page resolves a name from what it can actually stand behind: the
   linked account first, then a stored name that is not the placeholder, and
   otherwise the truth — no name on file. It never prints the placeholder. */

export const ROSTER_PLACEHOLDER = 'Team member';

export interface ResolvedName {
  /** What to render. Never invented, never the placeholder. */
  text: string;
  /** False when nobody has entered a name and no account supplies one. */
  known: boolean;
  /** Where it came from, or why there is none. Rendered, not hidden in a title. */
  source: string;
}

export interface NameableMember {
  display_name?: string | null;
  email?: string | null;
  linkedUser?: { name?: string; email?: string } | null;
}

export function resolveName(m: NameableMember): ResolvedName {
  const linked = m.linkedUser?.name?.trim();
  const stored = m.display_name?.trim();
  if (stored && stored !== ROSTER_PLACEHOLDER) {
    return { text: stored, known: true, source: 'on the roster' };
  }
  if (linked) {
    return { text: linked, known: true, source: 'from the linked account' };
  }
  const mail = m.linkedUser?.email?.trim() || m.email?.trim();
  if (mail) return { text: mail, known: true, source: 'the only identifier on file' };
  return {
    text: 'No name on file',
    known: false,
    source:
      'the roster row was created from the access record and carries the gateway placeholder',
  };
}

/** Initials for the roster mark, or a dash when there is no name to shorten. */
export function initialsOf(name: ResolvedName): string {
  if (!name.known) return EM;
  return name.text
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
