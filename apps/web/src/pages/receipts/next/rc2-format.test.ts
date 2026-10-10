/**
 * The page's words for money and failure (walk-through W23-W25, 2026-10-01).
 * EVERY value below is SYNTHETIC.
 */
import { describe, expect, it } from 'vitest';
import { cellText, failureReason, fmtMoney, lineFigure, moneyName, parseCell, sentence, serverMessage } from './rc2-format';

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

describe('parseCell — a line correction reads by the house marks (F-1021)', () => {
  it('reads "1.250" as 1250 in a house that groups with "."', () => {
    expect(parseCell('1.250', '.')).toBe(1250);
    expect(parseCell('1.250', ',')).toBe(1.25);
  });

  it('accepts "1.250,00" and "45,50", which a bare Number() refused', () => {
    expect(parseCell('1.250,00', '.')).toBe(1250);
    expect(parseCell('₺1.250,00', '.')).toBe(1250);
    expect(parseCell('45,50', '.')).toBe(45.5);
    expect(parseCell('$12.50', ',')).toBe(12.5);
  });

  it('keeps blank as null and junk as invalid', () => {
    expect(parseCell('  ', '.')).toBeNull();
    expect(parseCell('—', '.')).toBeNull();
    expect(parseCell('twelve', '.')).toBe('invalid');
    expect(parseCell('1.2.3', '.')).toBe('invalid');
  });

  it('shows the box in the house decimal mark, and it reads back the same', () => {
    expect(cellText(1.25, '.')).toBe('1,25');
    expect(cellText(1.25, ',')).toBe('1.25');
    expect(cellText(null, '.')).toBe('');
    expect(parseCell(cellText(1250.5, '.'), '.')).toBe(1250.5);
  });

  it('prints both sides of a correction in house marks, with the money', () => {
    const shown = new Intl.NumberFormat().formatToParts(1234567).find((p) => p.type === 'group')?.value;
    const house = shown === ',' ? '.' : ',';
    const from = lineFigure(1250, 'TRY', true, house);
    const to = lineFigure(1.25, 'TRY', true, house);
    expect(from).toContain('₺');
    expect(from).toContain(`1${house}250`);
    expect(to).toContain(`1${house === '.' ? ',' : '.'}25`);
    expect(from).not.toBe(to);
    expect(lineFigure(null, 'TRY', true, house)).toBe('—');
  });
});
