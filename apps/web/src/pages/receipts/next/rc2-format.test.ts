/**
 * The page's words for money and failure (walk-through W23-W25, 2026-10-01).
 * EVERY value below is SYNTHETIC.
 */
import { describe, expect, it } from 'vitest';
import { failureReason, fmtMoney, moneyName, sentence, serverMessage } from './rc2-format';

describe('fmtMoney — the sign, where the money has one of its own (W25)', () => {
  it('prints ₺ for the lira instead of the bare code', () => {
    expect(fmtMoney(11186.4, 'TRY')).toContain('₺');
    expect(fmtMoney(11186.4, 'TRY')).not.toContain('TRY');
    expect(fmtMoney(-180, 'TRY')).not.toContain('TRY');
  });

  it('keeps the code for a money whose narrow sign is shared', () => {
    expect(fmtMoney(12, 'SEK')).toContain('SEK');
    expect(fmtMoney(12, 'ARS')).toContain('ARS');
  });

  it('never narrows another dollar to the US dollar\'s bare "$"', () => {
    expect(fmtMoney(12, 'CAD')).not.toMatch(/^-?\$/);
  });
});

describe('moneyName (W23)', () => {
  it('names the money first and its code after', () => {
    expect(moneyName('TRY')).toBe('Turkish lira (TRY)');
    expect(moneyName('QQQ')).toBe('QQQ');
  });
});

describe('serverMessage — failure in the house\'s words (W24)', () => {
  it('says no answer came back, never "(Network Error)"', () => {
    const e = Object.assign(new Error('Network Error'), { request: {}, code: 'ERR_NETWORK' });
    expect(serverMessage(e, 'This document could not be read.')).toBe(
      'This document could not be read: no answer came back. Check the connection, then try again.',
    );
  });

  it("prints the server's own sentence without the status code", () => {
    expect(serverMessage({ response: { status: 409, data: { message: 'Already verified.' } } }, 'x')).toBe(
      'Already verified.',
    );
  });

  it('says a refusal with no reason in words', () => {
    expect(serverMessage({ response: { status: 500, data: {} } }, 'x')).toBe(
      'Mudavym refused it and gave no reason.',
    );
  });

  it('ends a sentence that came without its full stop', () => {
    expect(sentence('Stale document')).toBe('Stale document.');
    expect(sentence('Done.')).toBe('Done.');
  });
});

describe('failureReason — why a read failed, as a clause (W26)', () => {
  it('says no answer came back for a transport failure', () => {
    const e = Object.assign(new Error('Network Error'), { request: {}, code: 'ERR_NETWORK' });
    expect(failureReason(e)).toBe('no answer came back');
  });

  it("uses the server's sentence, without its full stop", () => {
    const e = Object.assign(new Error('Request failed with status code 409'), {
      response: { status: 409, data: { message: 'Restaurant access denied.' } },
    });
    expect(failureReason(e)).toBe('Restaurant access denied');
  });

  it('names a refusal that gave no reason', () => {
    const e = Object.assign(new Error('Request failed with status code 500'), { response: { status: 500 } });
    expect(failureReason(e)).toBe('refused, with no reason given');
  });

  it("never prints the client library's own words", () => {
    expect(failureReason(new Error('boom'))).toBe('the reason is not known');
  });
});
