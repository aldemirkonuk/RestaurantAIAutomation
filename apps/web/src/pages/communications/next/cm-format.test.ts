/**
 * The page's words for a read that failed (COMMS-W33, founder: "A: keep, say
 * when"): the server's own reason, never the HTTP client's; and when what is
 * still on screen was read.
 */

import { describe, expect, it } from 'vitest';
import { failedReadWords, failedReadsSentence, fmtAsOf, fmtWhen, readAgainFailed } from './cm-format';

const today = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

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
    expect(fmtAsOf(today(20, 43) - 2 * 86_400_000)).toMatch(/^on \d{1,2} \w+ at 20:43$/);
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

describe('fmtWhen on the house clock (F-903)', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  it('a letter from last October carries its year; one from this year does not', () => {
    expect(fmtWhen('2025-10-10T09:00:00Z', 'Europe/Istanbul', now)).toBe('10 Oct 2025');
    expect(fmtWhen('2026-03-04T09:00:00Z', 'Europe/Istanbul', now)).toBe('4 Mar');
  });
  it('names the house day, not the device or UTC one', () => {
    // 22:30 UTC on Oct 8 is 01:30 on Oct 9 in Istanbul.
    expect(fmtWhen('2026-10-08T22:30:00Z', 'Europe/Istanbul', now)).toBe('9 Oct');
    expect(fmtWhen('2026-10-08T22:30:00Z', 'America/Detroit', now)).toBe('8 Oct');
  });
  it('says the time for the house’s today', () => {
    expect(fmtWhen('2026-10-09T22:30:00Z', 'Europe/Istanbul', now)).toBe('01:30');
  });
  it('an unknown zone or a missing moment never throws', () => {
    expect(fmtWhen(null, 'Europe/Istanbul', now)).toBe('—');
    expect(fmtWhen('2025-01-02T12:00:00Z', 'Not/AZone', now)).toMatch(/2025/);
  });
});
