/**
 * `pct` — a signed change the engine returns as a 0–1 fraction.
 *
 * The analytics walk on 2026-10-03 (A-020) read `rp-seasonality.trendPerDayPct
 * = 0.20689655` off production — slope ÷ |mean|, so +20.7% a day — and the page
 * printed it as "+0.21%", because this helper assumed the engine had already
 * multiplied by 100. Every case below fails on that helper.
 */

import { describe, expect, it } from 'vitest';
import { EM, failureLine, failureOf, money, moneyIn, pct, shortLabels } from './rp-format';

describe('pct — a 0–1 fraction, printed as a signed percentage', () => {
  it('multiplies by 100: the measured trend reads +20.7%, not +0.21%', () => {
    expect(pct(0.20689655)).toBe('+20.7%');
    expect(pct(0.20689655, 2)).toBe('+20.69%');
  });

  it('keeps the sign of a fall', () => {
    expect(pct(-0.004)).toBe('-0.4%');
    expect(pct(1200 / 900 - 1)).toBe('+33.3%');
  });

  it('prints a change that rounds to zero unsigned, never "-0.0%"', () => {
    expect(pct(0.0004)).toBe('0.0%');
    expect(pct(-0.0004)).toBe('0.0%');
    expect(pct(0)).toBe('0.0%');
    expect(pct(-0.00004, 2)).toBe('0.00%');
  });

  it('prints an unknown as the dash, never as a zero', () => {
    expect(pct(null)).toBe(EM);
    expect(pct(undefined)).toBe(EM);
    expect(pct(Number.NaN)).toBe(EM);
    expect(pct('not a number')).toBe(EM);
  });
});

describe('money — in the house’s currency, never an assumed $ (audit G5)', () => {
  it('prints the house’s own mark', () => {
    expect(money(1234, 'full', 'TRY')).toBe('₺1,234');
    expect(money(12345, 'compact', 'EUR')).toBe('€12.3K');
    expect(money(4.5, 'table', 'GBP')).toBe('£4.50');
  });

  it('prints a bare number when no currency is recorded or read', () => {
    expect(money(1234)).toBe('1,234');
    expect(money(1234, 'full', null)).toBe('1,234');
    expect(money(12345, 'compact', 'not-a-code')).toBe('12.3K');
    expect(money(4.5, 'table')).toBe('4.50');
  });

  it('keeps an unknown as the dash', () => {
    expect(money(null, 'full', 'USD')).toBe(EM);
    expect(moneyIn('USD')(undefined)).toBe(EM);
    expect(moneyIn('USD')(310, 'compact')).toBe('$310');
  });
});

describe('a refusal is said in the gateway’s words (audit G11)', () => {
  const refusal = (message: unknown, status = 503) => ({
    message: `Request failed with status code ${status}`,
    response: { status, data: { statusCode: status, message } },
  });

  it('prints the whole-read sentence, without the log detail, instead of the status code', () => {
    const f = failureOf(
      refusal(
        'The purchase orders in this window could not be read whole: the database refused one of its pages (page 1: 57014 canceling statement due to statement timeout). Nothing is reported from part of it.',
      ),
    )!;
    expect(failureLine('cashflow register', f)).toBe(
      'The cashflow register could not be read. The purchase orders in this window could not be read whole: the database refused one of its pages. Nothing is reported from part of it.',
    );
  });

  it('a bare transport error still says what it can, and Nest’s generic words are not a sentence', () => {
    expect(failureLine('cashflow register', failureOf(new Error('Network Error'))!)).toBe(
      'The cashflow register could not be read (Network Error). Nothing below is claimed.',
    );
    expect(failureOf(refusal('Internal server error', 500))!.said).toBeUndefined();
  });
});

describe('shortLabels', () => {
  it('never draws two different names under the same label', () => {
    const names = [
      'Local Check Brut',
      'Local Check Barolo',
      'Local Check Rioja',
      'Local Check Rosé',
      'Local Check Riesling',
      'Ana',
    ];
    const got = shortLabels(names, 14);
    expect(new Set(got).size).toBe(names.length);
    for (const l of got) expect(l.length).toBeLessThanOrEqual(14);
    expect(got[5]).toBe('Ana');
    // The shared words go; what tells them apart stays.
    expect(got[1]).toBe('…Barolo');
    expect(got[0]).toBe('…Brut');
    expect(shortLabels(['Domaine Leflaive Puligny 2019', 'Domaine Leflaive Puligny 2020'], 14)).toEqual([
      '…2019',
      '…2020',
    ]);
  });

  it('cuts a lone long name at the end, as before', () => {
    expect(shortLabels(['Château Margaux Grand Vin'], 14)).toEqual(['Château Marga…']);
  });

  it('numbers names that are identical outright', () => {
    expect(shortLabels(['Ben', 'Ben'], 12)).toEqual(['Ben', 'Ben 2']);
  });
});
