/**
 * How a measure is printed — ADR 0207, sketch 117.
 *
 * One rule above the rest: a figure appears ONLY when the gateway answered it.
 * A refusal is words with its count (`too few — 2 of 5`), never a dash that
 * reads as zero and never a blank that reads as clean.
 */

import type { MeasureKey, MeasureResult, Money, WindowTally } from './scorecard-types';

export function fmtHours(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  if (whole >= 48) return `${Math.round(h / 24)} d`;
  return mins === 0 ? `${whole} h` : `${whole} h ${String(mins).padStart(2, '0')}`;
}

/** A money figure in its currency; a bare amount when none is recorded — never a guessed dollar. */
export function fmtMoney(amount: number, currency: string | null): string {
  if (!currency) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** The figure, split into its large part and the denominator beside it. */
export interface Figure {
  big: string;
  small: string;
  /** False when the line is a refusal — rendered in italic words, not numerals. */
  scored: boolean;
}

function moneyFigure(money: Money[]): Figure {
  if (money.length === 1) {
    const m = money[0];
    return {
      big: fmtMoney(m.allowed, m.currency),
      small: `of ${fmtMoney(m.asked, m.currency)}`,
      scored: true,
    };
  }
  return {
    big: money.map((m) => fmtMoney(m.allowed, m.currency)).join(' · '),
    small: `of ${money.map((m) => fmtMoney(m.asked, m.currency)).join(' · ')}`,
    scored: true,
  };
}

export function figureOf(key: MeasureKey, t: WindowTally & { minimum?: number }): Figure {
  switch (t.outcome) {
    case 'could_not_read':
      return { big: 'did not answer', small: '', scored: false };
    case 'not_collected':
      return { big: 'not collected', small: '', scored: false };
    case 'too_few':
      if (t.sample === 0) return { big: 'nothing to score', small: '', scored: false };
      return {
        big: 'too few',
        small: t.minimum ? `${t.sample} of ${t.minimum}` : `${t.sample}`,
        scored: false,
      };
    case 'answered':
      if (key === 'replyTime')
        return {
          big: fmtHours(t.value as number),
          small: `median · ${t.sample}`,
          scored: true,
        };
      if (key === 'credits' && t.money) return moneyFigure(t.money);
      return { big: String(t.hits), small: `of ${t.sample}`, scored: true };
  }
}

const ROW_NOUN: Record<MeasureKey, [string, string]> = {
  onTime: ['order', 'orders'],
  linesAsOrdered: ['line', 'lines'],
  priceAsAgreed: ['invoiced line', 'invoiced lines'],
  replyTime: ['message', 'messages'],
  credits: ['claim', 'claims'],
};

/** "14 orders" — the link's words, whose count equals the rows it opens. */
export function rowsLabel(m: Pick<MeasureResult, 'key' | 'rows'>): string {
  const [one, many] = ROW_NOUN[m.key];
  return `${m.rows} ${m.rows === 1 ? one : many}`;
}

export function windowLabel(fromIso: string, toIso: string): string {
  const f = new Date(fromIso);
  const t = new Date(toIso);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  return `${fmt(f)} – ${fmt(t)}`;
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
