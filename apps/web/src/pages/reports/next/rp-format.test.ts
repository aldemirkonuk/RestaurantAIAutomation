/**
 * `pct` — a signed change the engine returns as a 0–1 fraction.
 *
 * The analytics walk on 2026-10-03 (A-020) read `rp-seasonality.trendPerDayPct
 * = 0.20689655` off production — slope ÷ |mean|, so +20.7% a day — and the page
 * printed it as "+0.21%", because this helper assumed the engine had already
 * multiplied by 100. Every case below fails on that helper.
 */

import { describe, expect, it } from 'vitest';
import { EM, READING, UNFILED, categoryLabel, failureLine, failureOf, failureReason, money, moneyIn, pct, shortLabels } from './rp-format';


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
    // A lira house writes its money the Turkish way (r29 walk, finding 4):
    // "₺4,302" and "₺112,736.56" were English grouping beside /inventory's "₺545,10".
    expect(money(1234, 'full', 'TRY')).toBe('₺1.234');
    expect(money(4302, 'full', 'TRY')).toBe('₺4.302');
    expect(money(112736.56, 'table', 'TRY')).toBe('₺112.736,56');
    expect(money(1234.5, 'full', 'USD')).toBe('$1,234.5');
    // Compact keeps the page's English suffix with the house's marks: the
    // Turkish compact form "₺12,3 B" (bin) reads as billions on this page.
    expect(money(12345, 'compact', 'TRY')).toBe('₺12,3K');
    expect(money(12345678, 'compact', 'TRY')).toBe('₺12,3M');
    expect(money(12345, 'compact', 'EUR')).toBe('€12.3K');
    expect(money(4.5, 'table', 'GBP')).toBe('£4.50');
  });

  it('prints a bare number when no currency is recorded or read', () => {
    expect(money(1234, 'full', undefined)).toBe('1,234');
    expect(money(1234, 'full', null)).toBe('1,234');
    expect(money(12345, 'compact', 'not-a-code')).toBe('12.3K');
    expect(money(4.5, 'table', null)).toBe('4.50');
  });

  it('prints the dash, never $ or a bare figure, while the currency is still being read', () => {
    expect(money(1234, 'full', READING)).toBe(EM);
    expect(money(12345, 'compact', READING)).toBe(EM);
    expect(moneyIn(READING)(4.5, 'table')).toBe(EM);
    expect(moneyIn(READING)(0)).toBe(EM);
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
      'The cashflow register could not be read (Mudavym could not be reached from this device). Nothing below is claimed.',
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

describe('a failed read says what happened, never the transport’s sentence (r28 gap 17)', () => {
  const http = (status: number, data: unknown = {}) => ({
    message: `Request failed with status code ${status}`,
    response: { status, data },
  });

  it.each([
    [http(502), 'Mudavym’s side failed while reading it'],
    [http(500, { message: 'column wine_consumption_log.qty does not exist' }), 'Mudavym’s side failed while reading it'],
    [http(404), 'Mudavym did not find it'],
    [http(429), 'too many reads were asked for at once; it can be read again in a minute'],
    [http(400), 'Mudavym refused the request'],
    [new Error('Network Error'), 'Mudavym could not be reached from this device'],
    [new Error('timeout of 30000ms exceeded'), 'Mudavym took too long to answer'],
    [new Error('canceled'), 'the request was stopped before it was answered'],
  ])('%#: the line carries no status code and no client words', (err, words) => {
    const line = failureLine('till register', failureOf(err)!);
    expect(line).toBe(`The till register could not be read (${words}). Nothing below is claimed.`);
    expect(line).not.toMatch(/status code|Network Error|timeout of|ms exceeded|canceled|wine_consumption_log/);
  });

  it('a 500’s thrown message is never said as the gateway’s sentence', () => {
    expect(failureOf(http(500, { message: 'relation "pos_checks" does not exist' }))!.said).toBeUndefined();
  });

  it('a refusal the gateway words on purpose is still said', () => {
    const f = failureOf(http(503, { message: 'The till could not be read whole.' }))!;
    expect(failureLine('till register', f)).toBe('The till register could not be read. The till could not be read whole. Nothing below is claimed.');
  });

  it('keeps a reason that is not the transport’s, as the export shelf hands it', () => {
    expect(failureReason({ status: 500, message: 'permission denied' })).toBe('permission denied');
    expect(failureReason({ status: null, message: '' })).toBe('Mudavym could not be reached from this device');
  });
});

describe('a sentence with no category (r28 gap 20)', () => {
  it('is not filed under Sales, and an unknown key is said plainly', () => {
    expect(categoryLabel(UNFILED)).toBe('Not filed');
    expect(categoryLabel('')).toBe('Not filed');
    expect(categoryLabel('sales')).toBe('Sales');
    expect(categoryLabel('price_watch')).toBe('Price watch');
  });
});
