/**
 * A reply carries the earlier letters again under its own words (r41 mail
 * audit, gap 3). In a 50-letter thread the newest letter is about 58 kB for
 * 1.2 kB of new words, and the thread reads as walls of repeated text. This
 * finds where a letter's own words end and the quoted letters begin, so the
 * thread can show the new words and fold the rest behind one tap.
 *
 * The stored letter is never changed: the reader keeps the text whole (it is
 * the record), the gateway sends it whole, and the fold is only how the page
 * draws it. Nothing is folded unless the cut is unambiguous:
 *
 *  - an attribution line ("On … wrote:", "… tarihinde … yazdı:", and the same
 *    verb in a few other languages), on one line or wrapped over two;
 *  - an Outlook separator ("-----Original Message-----") or an Outlook header
 *    block ("From: …" followed within three lines by "Sent:"/"Date:");
 *  - a run of lines quoted with ">" that lasts to the end of the letter.
 *
 * And never when the letter's own words would be empty (a letter that is only
 * a quote shows whole), nor when the writer answered between the quoted lines
 * (a ">" line followed later by an unquoted line): folding that would hide an
 * answer. A forwarded letter is the content being shared, so nothing under a
 * forwarded banner is folded.
 */

export interface QuotedSplit {
  /** The letter's own words, as stored, up to the cut. */
  said: string;
  /** The quoted earlier letters from the cut to the end, or null when nothing is folded. */
  quoted: string | null;
  /** Lines with words in `quoted` (0 when nothing is folded). */
  quotedLines: number;
}

/** The verb that ends an attribution line, in the languages the house's vendors write in. */
const ATTRIBUTION_END = /(?:\bwrote|\byazdı|\bschrieb|\ba écrit|\bescribió|\bscrisse|\bschreef|\bescreveu)\s*:\s*$/i;
/** An attribution is one short sentence; a long line ending in "wrote:" is the writer's own. */
const ATTRIBUTION_MAX = 300;
const OUTLOOK_SEPARATOR = /^\s*-{2,}\s*(?:original message|orijinal ileti|özgün ileti|ursprüngliche nachricht|message d'origine|mensaje original)\s*-{2,}\s*$/i;
const OUTLOOK_FROM = /^\s*(?:from|kimden|von|de)\s*:\s*\S/i;
const OUTLOOK_NEXT = /^\s*(?:sent|date|gönderildi|tarih|gesendet|envoyé|enviado)\s*:\s*\S/i;
const QUOTED = /^\s*>/;
/** A forwarded letter is what is being shared: nothing under its banner is folded. */
const FORWARDED = /^\s*(?:-{2,}\s*(?:forwarded message|iletilen mesaj|weitergeleitete nachricht|message transféré|mensaje reenviado)\s*-{2,}|begin forwarded message:)\s*$/i;

const hasWords = (s: string) => /\S/.test(s);

/** How many lines the attribution starting at `i` spans: 0 (none), 1, or 2 (wrapped). */
function attributionAt(lines: string[], i: number): 0 | 1 | 2 {
  const one = lines[i];
  if (QUOTED.test(one)) return 0;
  if (one.length <= ATTRIBUTION_MAX && ATTRIBUTION_END.test(one)) return 1;
  // Gmail wraps a long attribution: "On Mon, 13 Nov 2026 at 09:00, Bodega <a@b>\nwrote:".
  // The wrapped part is the verb alone (at most three words); a whole attribution
  // under the writer's last line is its own line, not the end of that one.
  const next = lines[i + 1];
  if (next === undefined || !hasWords(one) || QUOTED.test(next)) return 0;
  if (next.trim().split(/\s+/).length > 3) return 0;
  const two = `${one} ${next}`;
  return two.length <= ATTRIBUTION_MAX && ATTRIBUTION_END.test(two) ? 2 : 0;
}

/** True when lines before `i` hold words of the letter's own, not only an attribution. */
function ownWordsBefore(lines: string[], i: number): boolean {
  for (let k = 0; k < i; k++) {
    const span = attributionAt(lines, k);
    if (span > 0) {
      k += span - 1;
      continue;
    }
    if (hasWords(lines[k]) && !QUOTED.test(lines[k])) return true;
  }
  return false;
}

function outlookAt(lines: string[], i: number): boolean {
  if (OUTLOOK_SEPARATOR.test(lines[i])) return true;
  if (!OUTLOOK_FROM.test(lines[i])) return false;
  for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
    if (OUTLOOK_NEXT.test(lines[j])) return true;
  }
  return false;
}

/** True when the writer answered between quoted lines after `from`: an unquoted line with words after a ">" line. */
function answersInline(lines: string[], from: number): boolean {
  let seenQuote = false;
  for (let j = from; j < lines.length; j++) {
    if (QUOTED.test(lines[j])) seenQuote = true;
    else if (seenQuote && hasWords(lines[j])) return true;
  }
  return false;
}

function cutAt(lines: string[]): number | null {
  for (let i = 1; i < lines.length; i++) {
    if (FORWARDED.test(lines[i - 1])) return null;
    if (!ownWordsBefore(lines, i)) continue;
    const span = attributionAt(lines, i);
    if (span > 0 || outlookAt(lines, i)) {
      const after = i + Math.max(span, 1);
      if (!lines.slice(after).some(hasWords)) return null;
      if (answersInline(lines, after)) return null;
      return i;
    }
    if (QUOTED.test(lines[i])) {
      // A ">" run counts only when it lasts to the end of the letter.
      return lines.slice(i).every((l) => QUOTED.test(l) || !hasWords(l)) ? i : null;
    }
  }
  return null;
}

export function splitQuotedHistory(text: string): QuotedSplit {
  const lines = text.split(/\r?\n/);
  const cut = cutAt(lines);
  if (cut === null) return { said: text, quoted: null, quotedLines: 0 };
  const said = lines.slice(0, cut).join('\n').replace(/\s+$/, '');
  const tail = lines.slice(cut);
  return { said, quoted: tail.join('\n'), quotedLines: tail.filter(hasWords).length };
}

export function quotedToggleWords(open: boolean, lines: number): string {
  const n = lines === 1 ? '1 line' : `${lines} lines`;
  return open ? `Hide the earlier letters it quotes (${n})` : `Show the earlier letters it quotes (${n})`;
}
