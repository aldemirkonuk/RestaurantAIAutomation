/**
 * INV-W31: failures in the house's words. A sentence written for a person is
 * kept; anything written for an operator falls back to plain status words;
 * a write whose server failed or never answered is said as unknown.
 */
import { describe, expect, it } from 'vitest';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { SAFE_RETRY, failureReason, plainText, writeFailure } from './iv-failure';

function answered(status: number, message?: unknown): AxiosError {
  const response = { status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: message === undefined ? {} : { message } } as AxiosResponse;
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', undefined, {}, response);
}
const silent = () => new AxiosError('Network Error', 'ERR_NETWORK', undefined, {}, undefined);

const WORDS = { refused: 'Nothing moved', act: 'the bottles moved', check: 'Look first.' };

describe('failureReason (INV-W31)', () => {
  it('says the server failed for any 5xx, whatever its body says', () => {
    expect(failureReason(answered(500, 'Insufficient stock'))).toBe('the server failed before it could answer');
    expect(failureReason(answered(503))).toBe('the server failed before it could answer');
  });

  it('says no answer came back when the request went out and nothing returned', () => {
    expect(failureReason(silent())).toBe('no answer came back');
  });

  it('keeps a server sentence written for a person, lower-cased to sit after a dash', () => {
    expect(failureReason(answered(400, 'The book holds fewer bottles than that.'))).toBe('the book holds fewer bottles than that');
    expect(failureReason(answered(409, ['This order was approved a moment ago']))).toBe('this order was approved a moment ago');
  });

  it('drops operator text and says the status in plain words', () => {
    expect(failureReason(answered(400, ['quantityChange must be an integer number']))).toBe('the server did not accept it as sent');
    expect(failureReason(answered(400, 'new row for relation "restaurant_inventory" violates check constraint'))).toBe('the server did not accept it as sent');
    expect(failureReason(answered(403, 'Forbidden resource'))).toBe('this account is not allowed to do that in this house');
    expect(failureReason(answered(404, 'Cannot POST /inventory-ledger/transactions'))).toBe('the server could not find it; re-read the page');
    expect(failureReason(answered(400, 'Failed to transfer stock'))).toBe('the server did not accept it as sent');
    expect(failureReason(answered(429, 'ThrottlerException: Too Many Requests'))).toBe('too many requests just now; wait a minute, then try again');
    expect(failureReason(answered(401))).toBe('the sign-in has lapsed; sign in again, then try once more');
    expect(failureReason(answered(413))).toBe('it is too large to send');
    expect(failureReason(answered(422))).toBe('the server did not accept it as sent');
    expect(failureReason(answered(409))).toBe('it clashes with a change made a moment ago; re-read the page');
    expect(failureReason(answered(418))).toBe('the server turned it down');
  });

  it('never shows the transport wording', () => {
    for (const e of [answered(400), answered(500), silent()]) {
      expect(failureReason(e)).not.toMatch(/status code|Network Error|gateway/i);
    }
  });

  it('says a throw on this device stopped before it was sent, keeping a plain message', () => {
    expect(failureReason(new Error('No restaurant ID available'))).toBe('it stopped on this device before it was sent');
    expect(failureReason(new Error('the write-off is not complete'))).toBe('the write-off is not complete');
    expect(failureReason("Cannot read properties of undefined (reading 'id')")).toBe('it stopped on this device before it was sent');
  });
});

describe('plainText (INV-W31)', () => {
  it('keeps an acronym at the start as written', () => {
    expect(plainText('VAT is missing on this invoice.')).toBe('VAT is missing on this invoice');
  });

  it('refuses a dump longer than a sentence', () => {
    expect(plainText(`The ${'very '.repeat(40)}long reason`)).toBeNull();
  });

  it('refuses snake_case, URLs and empty text', () => {
    expect(plainText('restaurant_inventory is locked')).toBeNull();
    expect(plainText('See https://example.com')).toBeNull();
    expect(plainText('   ')).toBeNull();
    expect(plainText(42)).toBeNull();
  });
});

describe('writeFailure (INV-W31)', () => {
  it('says a 5xx write is unknown, with what to check, and never "Nothing moved"', () => {
    const f = writeFailure(answered(502), WORDS);
    expect(f).toEqual({ unknown: true, text: 'The server failed before it could answer, so it is not known whether the bottles moved. Look first.' });
  });

  it('says an unanswered write is unknown', () => {
    expect(writeFailure(silent(), WORDS)).toEqual({ unknown: true, text: 'No answer came back, so it is not known whether the bottles moved. Look first.' });
  });

  it('says a refusal as nothing happened, with the reason', () => {
    expect(writeFailure(answered(400, ['qty must be positive']), WORDS)).toEqual({ unknown: false, text: 'Nothing moved — qty must be positive.' });
    expect(writeFailure(answered(403), WORDS)).toEqual({ unknown: false, text: 'Nothing moved — this account is not allowed to do that in this house.' });
  });

  it('says a throw on this device as nothing happened', () => {
    expect(writeFailure(new Error('No restaurant ID available'), WORDS)).toEqual({ unknown: false, text: 'Nothing moved — it stopped on this device before it was sent.' });
  });

  it('names safe retries plainly', () => {
    expect(SAFE_RETRY).toBe('Trying again is safe: it is recorded once.');
  });
});
