import { describe, expect, it } from 'vitest';
import { quotedToggleWords, splitQuotedHistory } from './quoted-history';

/**
 * r41 mail audit, gap 3: where a letter's own words end and the earlier
 * letters it quotes begin. A cut is made only when it is unambiguous, and
 * never when it would hide words the writer added.
 */

const folds = (text: string) => splitQuotedHistory(text);

describe('splitQuotedHistory: where the cut falls', () => {
  it('a letter that quotes nothing is drawn whole', () => {
    const text = 'Prices attached.\n\nDelivery Tuesday.';
    expect(folds(text)).toEqual({ said: text, quoted: null, quotedLines: 0 });
  });

  it('Gmail: the attribution line and the ">" lines under it are folded', () => {
    const r = folds('Yes, 40 cases.\n\nOn Mon, 13 Nov 2026 at 09:00, Bodega <b@example.com> wrote:\n> Can you do 40?\n>\n> Thanks');
    expect(r.said).toBe('Yes, 40 cases.');
    expect(r.quoted).toBe('On Mon, 13 Nov 2026 at 09:00, Bodega <b@example.com> wrote:\n> Can you do 40?\n>\n> Thanks');
    expect(r.quotedLines).toBe(4);
  });

  it('Gmail: an attribution wrapped over two lines is one cut', () => {
    const r = folds('Yes.\n\nOn Mon, 13 Nov 2026 at 09:00, Bodega Wines and Spirits <orders@example.com>\nwrote:\n> Can you do 40?');
    expect(r.said).toBe('Yes.');
    expect(r.quoted?.startsWith('On Mon, 13 Nov 2026')).toBe(true);
  });

  it('the writer\'s last line directly above a whole attribution stays theirs', () => {
    const r = folds('Yes, 40.\nOn Mon, 13 Nov 2026 at 09:00, Bodega <b@example.com> wrote:\n> Can you do 40?');
    expect(r.said).toBe('Yes, 40.');
    expect(r.quotedLines).toBe(2);
  });

  it('Turkish Gmail: "… tarihinde … şunu yazdı:" is a cut', () => {
    const r = folds('Tamam, salı.\n\n13 Kas 2026 Pzt, 09:00 tarihinde Bodega <b@example.com> şunu yazdı:\n> Salı olur mu?');
    expect(r.said).toBe('Tamam, salı.');
    expect(r.quotedLines).toBe(2);
  });

  it('Outlook: the "Original Message" separator is a cut, and the unquoted letter under it is folded', () => {
    const r = folds('Confirmed.\r\n\r\n-----Original Message-----\r\nFrom: Kitchen\r\nSent: Monday\r\nCan you deliver 40?');
    expect(r.said).toBe('Confirmed.');
    expect(r.quoted).toBe('-----Original Message-----\nFrom: Kitchen\nSent: Monday\nCan you deliver 40?');
    expect(r.quotedLines).toBe(4);
  });

  it('Outlook: a "From:" header with "Sent:" within three lines is a cut', () => {
    const r = folds('Confirmed.\n\nFrom: Kitchen <k@example.com>\nTo: Bodega\nSent: Monday 13 November 2026 09:00\nSubject: 40 cases\n\nCan you deliver 40?');
    expect(r.said).toBe('Confirmed.');
    expect(r.quotedLines).toBe(5);
  });

  it('a "From:" line in the writer\'s own words, with no "Sent:" under it, is not a cut', () => {
    const text = 'Delivery note:\nFrom: our Izmir depot\nTo be collected Tuesday.\nRegards';
    expect(folds(text).quoted).toBeNull();
  });

  it('a run of ">" lines to the end of the letter is folded with no attribution', () => {
    const r = folds('Agreed.\n> Can you do 40?\n> Thanks');
    expect(r).toEqual({ said: 'Agreed.', quoted: '> Can you do 40?\n> Thanks', quotedLines: 2 });
  });

  it('the letter\'s own words keep their inner blank lines and lose only trailing space', () => {
    expect(folds('Line one.\n\nLine two.  \n\n> quoted').said).toBe('Line one.\n\nLine two.');
  });
});

describe('splitQuotedHistory: what is never folded', () => {
  it('a letter that is only a quote is drawn whole', () => {
    expect(folds('> Can you do 40?\n> Thanks').quoted).toBeNull();
    expect(folds('On Mon, Bodega <b@example.com> wrote:\n> Can you do 40?').quoted).toBeNull();
  });

  it('answers written between quoted lines are not hidden', () => {
    expect(folds('See below.\n> Can you do 40?\nYes, 40.\n> And Tuesday?\nTuesday works.').quoted).toBeNull();
    expect(folds('See below.\n\nOn Mon, Bodega <b@example.com> wrote:\n> Can you do 40?\nYes, 40.').quoted).toBeNull();
  });

  it('an attribution with nothing under it is not a cut', () => {
    expect(folds('Thanks.\nOn Mon, Bodega <b@example.com> wrote:\n\n').quoted).toBeNull();
  });

  it('a forwarded message is the content being shared, not a quote', () => {
    const text = 'FYI.\n\n---------- Forwarded message ---------\nFrom: Bodega\nDate: Mon, 13 Nov 2026\nSubject: Prices\n\nNew prices attached.';
    expect(folds(text).quoted).toBeNull();
    expect(folds('FYI\nBegin forwarded message:\n\nOn Mon, Bodega <b@example.com> wrote:\n> New prices').quoted).toBeNull();
  });

  it('a long line of the writer\'s own that ends in "wrote:" is not an attribution', () => {
    const long = `As the chef ${'very '.repeat(70)}clearly wrote:`;
    expect(folds(`Hello.\n${long}\nmore words of my own`).quoted).toBeNull();
  });
});

describe('quotedToggleWords', () => {
  it('says how many lines, and what the button does', () => {
    expect(quotedToggleWords(false, 1)).toBe('Show the earlier letters it quotes (1 line)');
    expect(quotedToggleWords(false, 12)).toBe('Show the earlier letters it quotes (12 lines)');
    expect(quotedToggleWords(true, 12)).toBe('Hide the earlier letters it quotes (12 lines)');
  });
});

/**
 * The audit's modelled thread: 50 letters of 1.2 kB of new words each, every
 * reply quoting all the earlier letters under a Gmail attribution. The page
 * draws each letter's own words; the quoted text is laid out only on a tap.
 */
export function modelledThread(n = 50, newChars = 1200): string[] {
  const letters: string[] = [];
  for (let k = 0; k < n; k++) {
    const own = Array.from({ length: Math.ceil(newChars / 60) }, (_, j) => `Letter ${k} line ${j}: ${'word '.repeat(10)}`.slice(0, 59)).join('\n');
    if (k === 0) {
      letters.push(own);
      continue;
    }
    const prev = letters[k - 1];
    const quoted = prev.split('\n').map((l) => `> ${l}`).join('\n');
    letters.push(`${own}\n\nOn Mon, 13 Nov 2026 at 09:${String(k % 60).padStart(2, '0')}, Bodega <b@example.com> wrote:\n${quoted}`);
  }
  return letters;
}

describe('the modelled 50-letter thread', () => {
  const letters = modelledThread();
  const drawnBefore = letters.reduce((s, t) => s + t.length, 0);
  const drawnAfter = letters.reduce((s, t) => s + splitQuotedHistory(t).said.length, 0);

  it('every reply folds to its own words', () => {
    letters.slice(1).forEach((t, k) => {
      const r = splitQuotedHistory(t);
      expect(r.quoted).not.toBeNull();
      expect(r.said.startsWith(`Letter ${k + 1} line 0`)).toBe(true);
      expect(r.said).not.toContain('> ');
    });
  });

  it('the page lays out the new words, not every earlier letter again', () => {
    // Before: every letter drawn whole. After: only each letter's own words.
    expect(drawnAfter).toBeLessThan(drawnBefore * 0.05);
    expect(splitQuotedHistory(letters[49]).said.length).toBeLessThan(1300);
  });
});
