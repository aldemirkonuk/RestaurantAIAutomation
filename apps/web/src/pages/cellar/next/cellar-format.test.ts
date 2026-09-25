/**
 * The formatters that carry the house's record.
 *
 * The first test here pins a defect this pass CAUGHT IN TEST, not on screen:
 * `procurement_documents.doc_date` is a Postgres `date`, arrives as
 * `2026-03-02`, and `new Date(...)` parses it as UTC midnight — so rendering it
 * in any timezone west of UTC printed "1 Mar 2026" for an invoice dated the
 * 2nd. A date of record that silently moves by a day is the same fault as a
 * fabricated one, in a smaller coat.
 */

import { describe, expect, it } from 'vitest';
import {
  EM,
  acidityTicks,
  bodyTicks,
  composedTastingSentence,
  handlingSentence,
  matchNote,
  quoteSource,
  shortDate,
  tanninTicks,
} from './cellar-format';

describe('shortDate', () => {
  /**
   * THE PRECONDITION, ASSERTED — because without it every test below is a
   * no-op that passes with the fix deleted.
   *
   * The bug only shows in a zone WEST of UTC: `new Date('2026-03-02')` is
   * UTC midnight, so `2 Mar` renders as `1 Mar` in New York and as `2 Mar`
   * in UTC. `src/__tests__/setup.ts:12` pins `process.env.TZ` to
   * `America/New_York` before anything touches `Date`, for exactly this
   * reason. CI sets no TZ of its own (`.github/workflows/ci.yml` has none),
   * so that setup line is the only thing standing between this file and a
   * suite of assertions that cannot fail.
   *
   * Measured 2026-09-03, both directions: with the `timeZone: 'UTC'` override
   * deleted from `shortDate`, `TZ=UTC pnpm vitest run cellar-format.test.ts`
   * fails with `expected '1 Mar 2026' to be '2 Mar 2026'` — the pin reaches
   * `toLocaleDateString`, and a shell `TZ` does not override it. This test
   * fails loudly if that ever stops being true, rather than going quiet.
   */
  it('is running in a zone where the bug is observable at all', () => {
    const offsetMinutes = new Date('2026-03-02T00:00:00Z').getTimezoneOffset();
    expect(
      offsetMinutes,
      'the suite must run west of UTC (src/__tests__/setup.ts pins America/New_York) ' +
        'or every date assertion in this file passes with the fix deleted',
    ).toBeGreaterThan(0);
  });

  it('holds a calendar date on the day the document says, in any timezone', () => {
    // `doc_date` is a `date` column: no instant, no zone, no shifting.
    expect(shortDate('2026-03-02')).toBe('2 Mar 2026');
    expect(shortDate('2026-01-01')).toBe('1 Jan 2026');
    expect(shortDate('2026-12-31')).toBe('31 Dec 2026');
  });

  it('does not simply render every date in UTC — an instant still moves', () => {
    // The pair that proves the override is targeted rather than blanket: a
    // late-evening UTC instant belongs to the PREVIOUS day in New York, and
    // must render as that day, because "when did we last sell it" is a
    // question about the reader's evening.
    expect(shortDate('2026-03-02T02:00:00Z')).toBe('1 Mar 2026');
    expect(shortDate('2026-03-02')).toBe('2 Mar 2026');
  });

  it('renders an instant in the reader’s own timezone', () => {
    // `created_at` is a `timestamptz`: "when did we last sell it" is a question
    // about the reader's evening, so this one is deliberately local.
    const at = '2026-09-01T22:11:00Z';
    expect(shortDate(at)).toBe(
      new Date(at).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    );
  });

  it('is the em dash for absent or unparseable input, never today', () => {
    expect(shortDate(null)).toBe(EM);
    expect(shortDate(undefined)).toBe(EM);
    expect(shortDate('')).toBe(EM);
    expect(shortDate('not a date')).toBe(EM);
  });
});

describe('quoteSource', () => {
  it('speaks the /vendor-prices vocabulary', () => {
    expect(quoteSource('rep_message')).toBe('a rep’s message');
    expect(quoteSource('invoice')).toBe('an invoice');
  });

  it('shows a value it does not recognise verbatim rather than bucketing it', () => {
    // `source_type` has no CHECK constraint, so renaming an unknown value would
    // be inventing provenance.
    expect(quoteSource('edi_feed')).toBe('“edi_feed”');
    expect(quoteSource(null)).toBe('an unstated source');
  });
});

describe('matchNote', () => {
  it('says a loose match is loose', () => {
    expect(matchNote('contains')).toMatch(/would match too/);
  });
  it('says nothing at all when there was no match to describe', () => {
    expect(matchNote(null)).toBeNull();
  });
});

/**
 * "The wine's own detail" — ADR 0160 sec110 Owed #4/#11, sketch 121. Checked
 * against sketch 121's own three worked examples (`sketch-121-cellar-b-
 * plus.html`'s `wineRecord()`): body "Full" → 5 ticks, acidity "Medium-high"
 * → 4 ticks, tannin "High" → 5 ticks.
 */
describe('structure ticks', () => {
  it('matches sketch 121\'s own three examples exactly', () => {
    expect(bodyTicks('full')).toBe(5);
    expect(acidityTicks('medium-high')).toBe(4);
    expect(tanninTicks('high')).toBe(5);
  });

  it('is case-insensitive — production stores these as plain lowercase, but nothing should depend on that', () => {
    expect(bodyTicks('Full')).toBe(5);
    expect(acidityTicks('Medium-High')).toBe(4);
  });

  it('places the bottom and top of a scale at 1 and 5, never 0 or off the bar', () => {
    expect(bodyTicks('light')).toBe(1);
    expect(tanninTicks('none')).toBe(1);
    expect(tanninTicks('high')).toBe(5);
  });

  it('scales a 6-step vocabulary (tannin) onto the same 5-tick bar as a 5-step one (body) proportionally', () => {
    // medium-low is index 2 of 6 -> round((3/6)*5) = round(2.5) = 3 (banker's
    // rounding is not in play here — Math.round(2.5) is 3 in JS).
    expect(tanninTicks('medium-low')).toBe(3);
  });

  it('returns null, never a guessed position, for a word outside the known scale', () => {
    // 13 production rows carry these for tannin — real words, not on this bar.
    expect(tanninTicks('firm')).toBeNull();
    expect(tanninTicks('grippy')).toBeNull();
    expect(bodyTicks(null)).toBeNull();
    expect(bodyTicks('')).toBeNull();
  });
});

describe('handlingSentence', () => {
  const FULL = { servingTempCelsius: 17, glassType: 'Bordeaux', decantingRecommended: true, agingPotentialYears: 8 };

  it('composes all four parts, in sketch 121\'s own order, when every field is recorded', () => {
    expect(handlingSentence(FULL)).toBe('17 °C · Bordeaux glass · decant · ageing potential 8 years');
  });

  it('says "no decanting" rather than omitting the segment when the library recorded false', () => {
    expect(handlingSentence({ ...FULL, decantingRecommended: false })).toContain('no decanting');
  });

  it('is whole or not at all — missing exactly one of the four still returns null, never three of four', () => {
    expect(handlingSentence({ ...FULL, agingPotentialYears: null })).toBeNull();
    expect(handlingSentence({ ...FULL, servingTempCelsius: null })).toBeNull();
    expect(handlingSentence({ ...FULL, glassType: null })).toBeNull();
    expect(handlingSentence({ ...FULL, decantingRecommended: null })).toBeNull();
  });

  it('singularises "1 year"', () => {
    expect(handlingSentence({ ...FULL, agingPotentialYears: 1 })).toContain('ageing potential 1 year');
    expect(handlingSentence({ ...FULL, agingPotentialYears: 1 })).not.toContain('1 years');
  });
});

describe('composedTastingSentence', () => {
  it('composes from body, acidity and sweetness together', () => {
    expect(composedTastingSentence('full', 'high', 'dry')).toBe(
      'A full-bodied wine with high acidity and a dry character.',
    );
  });

  it('is whole or not at all — two of three is not enough to compose a sentence', () => {
    expect(composedTastingSentence(null, 'high', 'dry')).toBeNull();
    expect(composedTastingSentence('full', null, 'dry')).toBeNull();
    expect(composedTastingSentence('full', 'high', null)).toBeNull();
  });
});
