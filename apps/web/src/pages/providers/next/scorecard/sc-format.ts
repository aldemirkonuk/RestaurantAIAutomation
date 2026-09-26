/**
 * How a measure is printed — ADR 0207, sketch 117.
 *
 * One rule above the rest: a figure appears ONLY when the gateway answered it.
 * A refusal is words with its count (`too few — 2 of 5`), never a dash that
 * reads as zero and never a blank that reads as clean.
 */

import { SC } from './sc-copy';
import type { HouseClock, MeasureKey, MeasureResult, Money, WindowTally } from './scorecard-types';

/**
 * The house's formats (ADR 0207 question 7): its locale and zone as the gateway
 * read them. When the house names none, `undefined` — the reader's own — never
 * a pinned locale.
 */
export interface Formats {
  locale: string | undefined;
  zone: string | undefined;
}

export function formatsOf(house: HouseClock | null | undefined): Formats {
  return { locale: house?.locale ?? undefined, zone: house?.zone ?? undefined };
}

const READER: Formats = { locale: undefined, zone: undefined };

export function fmtHours(h: number): string {
  const D = SC.duration;
  if (h < 1) return D.minutes(Math.max(1, Math.round(h * 60)));
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  if (whole >= 48) return D.days(Math.round(h / 24));
  return mins === 0 ? D.hours(whole) : D.hoursMinutes(whole, String(mins).padStart(2, '0'));
}

/** A money figure in its currency, in the house's format; a bare amount when none is recorded — never a guessed dollar. */
export function fmtMoney(amount: number, currency: string | null, f: Formats = READER): string {
  const bare = new Intl.NumberFormat(f.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!currency) return bare.format(amount);
  try {
    return new Intl.NumberFormat(f.locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${bare.format(amount)} ${currency}`;
  }
}

/** The figure, split into its large part and the count beside it. */
export interface Figure {
  big: string;
  small: string;
  /** False when the line is a refusal — rendered in italic words, not numerals. */
  scored: boolean;
}

function moneyFigure(money: Money[], f: Formats): Figure {
  const amounts = money.map((m) => SC.figure.money(fmtMoney(m.allowed, m.currency, f), fmtMoney(m.asked, m.currency, f)));
  return {
    big: money.map((m) => m.percent ?? fmtMoney(m.allowed, m.currency, f)).join(' · '),
    small: amounts.join(' · '),
    scored: true,
  };
}

/**
 * Percent with count (question 3): the gateway's percent large, the count
 * beside it — "86%  12 of 14". A refusal is words with its count.
 */
export function figureOf(key: MeasureKey, t: WindowTally & { minimum?: number }, f: Formats = READER): Figure {
  switch (t.outcome) {
    case 'could_not_read':
      return { big: SC.figure.didNotAnswer, small: '', scored: false };
    case 'not_collected':
      return { big: SC.figure.notCollected, small: '', scored: false };
    case 'too_few':
      if (t.sample === 0) return { big: SC.figure.nothingToScore, small: '', scored: false };
      return {
        big: SC.figure.tooFew,
        small: t.minimum ? SC.figure.ofMinimum(t.sample, t.minimum) : `${t.sample}`,
        scored: false,
      };
    case 'answered':
      if (key === 'replyTime')
        return {
          big: fmtHours(t.value as number),
          small: SC.figure.median(t.sample),
          scored: true,
        };
      if (key === 'credits' && t.money) return moneyFigure(t.money, f);
      return {
        big: t.percent ?? String(t.hits),
        small: SC.figure.of(t.hits as number, t.sample),
        scored: true,
      };
  }
}

/** "14 orders" — the link's words, whose count equals the rows it opens. */
export function rowsLabel(m: Pick<MeasureResult, 'key' | 'rows'>): string {
  const [one, many] = SC.rowNoun[m.key];
  return `${m.rows} ${m.rows === 1 ? one : many}`;
}

function dayMonth(iso: string, f: Formats): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return new Intl.DateTimeFormat(f.locale, { day: '2-digit', month: '2-digit', timeZone: f.zone }).format(d);
}

/** The window's two ends, all numerals, in the house's order and on its clock. */
export function windowLabel(fromIso: string, toIso: string, f: Formats = READER): string {
  return `${dayMonth(fromIso, f)} – ${dayMonth(toIso, f)}`;
}

/** An entry's day, all numerals, in the house's order and on its clock. */
export function dayLabel(iso: string, f: Formats = READER): string {
  return dayMonth(iso, f);
}
