/**
 * The page's words for a read that failed (COMMS-W33, founder: "A: keep, say
 * when"): the server's own reason, never the HTTP client's; and when what is
 * still on screen was read.
 */

import { describe, expect, it } from 'vitest';
import { EM, failedReadWords, failedReadsSentence, fmtAsOf, fmtWhen, readAgainFailed } from './cm-format';

/**
 * The same wall-clock time `n` calendar days back. Subtracting n × 86,400,000
 * ms instead lands an hour off across a clock change: on 1 Nov 2026 in the
 * suite's zone (America/New_York, `src/__tests__/setup.ts`), 20:43 less two
 * days of milliseconds read 21:43 on 30 Oct.
 */
const daysAgo = (n: number, h: number, m: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

const today = (h: number, m: number) => daysAgo(0, h, m);

describe('failedReadWords', () => {
  it('says the server’s words without their full stop', () => {
    expect(failedReadWords({ response: { status: 500, data: { message: 'Internal server error.' } } })).toBe('Internal server error');
    expect(failedReadWords({ response: { status: 400, data: { message: ['a', 'b'] } } })).toBe('a, b');
  });
  it('never prints the HTTP client’s "status code"', () => {
    const axios500 = Object.assign(new Error('Request failed with status code 500'), { isAxiosError: true, response: { status: 500, data: {} } });
    expect(failedReadWords(axios500)).toBe('it answered with an error');
    const offline = Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
    expect(failedReadWords(offline)).toBe('no answer — check the connection');
    expect(failedReadWords(new TypeError('x is undefined'))).toBe('something went wrong reading it');
  });
});

describe('when a read was last answered', () => {
  it('today is a time; another day carries its date', () => {
    expect(fmtAsOf(today(20, 43))).toBe('at 20:43');
    expect(fmtAsOf(daysAgo(2, 20, 43))).toMatch(/^on \d{1,2} \w+ at 20:43$/);
    expect(fmtAsOf(0)).toBe('at a time that was not recorded');
  });
  it('a read that cannot be read again says when, with or without a subject', () => {
    expect(readAgainFailed('boom', today(9, 5), false)).toBe(
      'Could not be read again (boom). This is as it was at 09:05; there may be more or fewer now.',
    );
    expect(readAgainFailed('boom', today(9, 5), true, 'the drafted letters')).toBe(
      'The drafted letters could not be read again (boom). At 09:05 there were none; there may be some now.',
    );
  });
});

describe('the banner sentence', () => {
  it('names nothing when nothing failed', () => {
    expect(failedReadsSentence([])).toBe('');
  });
  it('a refresh that failed says when what is on screen is from', () => {
    expect(
      failedReadsSentence([
        { name: 'the conversation book', stale: true, at: today(20, 43) },
        { name: 'the replies the house has written', stale: true, at: today(20, 44) },
      ]),
    ).toBe(
      'Part of this page could not be read again just now: the conversation book and the replies the house has written. What you see is as it was at 20:43.',
    );
  });
  it('a first read that failed does not claim there is nothing', () => {
    expect(
      failedReadsSentence([
        { name: 'the conversation book', stale: false, at: 0 },
        { name: 'the letters waiting for a manager', stale: true, at: today(8, 0) },
        { name: 'the drafted letters', stale: false, at: 0 },
      ]),
    ).toBe(
      'Part of this page could not be read: the conversation book, the letters waiting for a manager and the drafted letters. What you see is as it was at 08:00. That does not mean there is nothing there.',
    );
  });
});

describe('fmtWhen: as few words as still place a moment (r36 mail gap 13)', () => {
  // 14 Nov 2026, 10:00 in Istanbul (UTC+3).
  const now = new Date('2026-11-14T07:00:00Z');

  it('today is the time, in the zone given', () => {
    expect(fmtWhen('2026-11-14T06:05:00Z', { zone: 'Europe/Istanbul', now })).toBe('09:05');
  });

  it('another day this year is the date, with no year', () => {
    expect(fmtWhen('2026-11-13T09:00:00Z', { zone: 'Europe/Istanbul', now })).toBe('13 Nov');
  });

  it('another year says the year, so last year never reads as this year', () => {
    expect(fmtWhen('2025-11-14T09:00:00Z', { zone: 'Europe/Istanbul', now })).toBe('14 Nov 2025');
  });

  it('withTime adds the time to an earlier day, so a thread\'s letters of one day can be told apart', () => {
    expect(fmtWhen('2026-11-13T09:00:00Z', { zone: 'Europe/Istanbul', now, withTime: true })).toBe('13 Nov, 12:00');
    expect(fmtWhen('2025-11-14T21:30:00Z', { zone: 'Europe/Istanbul', now, withTime: true })).toBe('15 Nov 2025, 00:30');
    // Today is still the time alone.
    expect(fmtWhen('2026-11-14T06:05:00Z', { zone: 'Europe/Istanbul', now, withTime: true })).toBe('09:05');
  });

  it("'today' is the house's day, not the browser's or UTC's", () => {
    // 22:30 UTC on 13 Nov is already 14 Nov, 01:30 in Istanbul: today there.
    expect(fmtWhen('2026-11-13T22:30:00Z', { zone: 'Europe/Istanbul', now })).toBe('01:30');
    // In New York it is still 13 Nov, and "now" there is 14 Nov 02:00: another day.
    expect(fmtWhen('2026-11-13T22:30:00Z', { zone: 'America/New_York', now })).toBe('13 Nov');
  });

  it('a zone the browser does not know reads in the browser\'s own, never throws', () => {
    expect(() => fmtWhen('2026-11-13T09:00:00Z', { zone: 'Mars/Olympus', now })).not.toThrow();
    expect(fmtWhen('2026-11-13T09:00:00Z', { zone: 'Mars/Olympus', now })).toBe(
      fmtWhen('2026-11-13T09:00:00Z', { zone: null, now }),
    );
    // The browser's own zone (the suite's New York), not UTC: 09:00 UTC is 04:00 there.
    expect(fmtWhen('2026-11-13T09:00:00Z', { zone: 'Mars/Olympus', now, withTime: true })).toBe('13 Nov, 04:00');
  });

  it('"today" is the day of the `now` given, so the words do not depend on when the test runs', () => {
    const later = new Date('2031-03-02T12:00:00Z');
    expect(fmtWhen('2031-03-02T09:00:00Z', { zone: 'UTC', now: later })).toBe('09:00');
    expect(fmtWhen('2031-03-01T09:00:00Z', { zone: 'UTC', now: later })).toBe('1 Mar');
  });

  it('nothing, or not a time, is the em dash', () => {
    expect(fmtWhen(null)).toBe(EM);
    expect(fmtWhen('soon')).toBe(EM);
  });
});
