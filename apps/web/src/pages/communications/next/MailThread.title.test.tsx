/**
 * What a thread with no subject is called in its own header (r110 mail-gap g6):
 * the first letter's first words, at most 60 characters, an ellipsis when cut,
 * and a quiet "no subject line" after them. The rendered header is proved in
 * MailTab.thread.test.tsx.
 */
import { describe, expect, it } from 'vitest';
import { firstWords, threadHeading } from './mail-format';

describe('firstWords', () => {
  it('keeps a short letter whole, with its lines run together', () => {
    expect(firstWords('Six cases,\n  as every week.')).toBe('Six cases, as every week.');
  });
  it('drops a leading Subject line', () => {
    expect(firstWords('Subject: Order\nPlease send six cases')).toBe('Please send six cases');
  });
  it('cuts a long letter at a word, within 60 characters, with an ellipsis', () => {
    const out = firstWords('Merhaba, haftalık siparişimizi bu hafta altı koli olarak değiştirmek istiyoruz, lütfen onaylayın');
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('…')).toBe(true);
    expect(out).toBe('Merhaba, haftalık siparişimizi bu hafta altı koli olarak…');
  });
  it('a letter of exactly 60 characters is not cut', () => {
    const sixty = 'a'.repeat(30) + ' ' + 'b'.repeat(29);
    expect(firstWords(sixty)).toBe(sixty);
  });
  it('a single unbroken run is cut hard and still ends in an ellipsis within 60', () => {
    const out = firstWords('x'.repeat(200));
    expect(out).toBe('x'.repeat(59) + '…');
  });
  it('nothing in, nothing out', () => {
    expect(firstWords(null)).toBe('');
    expect(firstWords('  \n ')).toBe('');
  });
});

describe('threadHeading', () => {
  it('keeps a real subject, with no quiet note', () => {
    expect(threadHeading('Order 118', 'Aegean Foods', 'Hello')).toEqual({ title: 'Order 118', quiet: null });
  });
  it('a blank subject takes the first letter\'s words and says so quietly', () => {
    expect(threadHeading('  ', 'Aegean Foods', 'Six cases, as every week.')).toEqual({
      title: 'Six cases, as every week.',
      quiet: 'no subject line',
    });
  });
  it('with no words to take, the person names it', () => {
    expect(threadHeading(null, 'Aegean Foods', '')).toEqual({
      title: 'A letter from Aegean Foods, with no subject line',
      quiet: null,
    });
  });
});
