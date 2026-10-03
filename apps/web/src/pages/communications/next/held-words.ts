/**
 * Words a person left a sheet holding (COMMS-W34, founder 2026-10-01:
 * "Approve (Recommended)").
 *
 * One Escape or a stray click outside used to throw away an edited drafted
 * letter or a half-written template without a word, and "Write a letter" kept
 * its words where nothing showed it. The house already had the answer — the
 * Stub (sketch 103 · 1b, accepted 2026-09-06): the sheet leaves, and the words
 * stay on the row it was opened from, with Resume and Discard.
 *
 * The page owns the words (the Stub's contract: the caller keeps the draft, the
 * primitive owns the ceremony). They live in this page's memory only, so the
 * stub says they are kept until the page is left — never that they are saved.
 */

import { useCallback, useRef, useState } from 'react';

export interface Held<T> {
  words: T;
  /** Discarded from its stub; Put it back clears this inside the stub's ten seconds. */
  discarded: boolean;
  /** New for every hold, so a later hold draws a fresh stub instead of a spent one. */
  n: number;
}

export function useHeldWords<T>() {
  const [held, setHeld] = useState<Record<string, Held<T>>>({});
  const count = useRef(0);
  const hold = useCallback((key: string, words: T) => {
    count.current += 1;
    const n = count.current;
    setHeld((h) => ({ ...h, [key]: { words, discarded: false, n } }));
  }, []);
  const mark = useCallback(
    (key: string, discarded: boolean) =>
      setHeld((h) => (h[key] ? { ...h, [key]: { ...h[key], discarded } } : h)),
    [],
  );
  const drop = useCallback(
    (key: string) =>
      setHeld((h) => {
        if (!(key in h)) return h;
        const rest = { ...h };
        delete rest[key];
        return rest;
      }),
    [],
  );
  return {
    get: (key: string): Held<T> | undefined => held[key],
    /** The words to reopen with — never a hold that was discarded. */
    words: (key: string): T | null => (held[key] && !held[key].discarded ? held[key].words : null),
    hold,
    discard: (key: string) => mark(key, true),
    restore: (key: string) => mark(key, false),
    drop,
  };
}

/** The held words as the stub quotes them: subject, then the letter's opening. */
export function heldLine(first: string, rest: string, max = 120): string {
  const line = [first.trim(), rest.trim().replace(/\s+/g, ' ')].filter(Boolean).join(' — ');
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

const paragraphs = (body: string) =>
  body
    .split(/\n\s*\n/)
    .map((p) => p.trim().replace(/\s+/g, ' '))
    .filter(Boolean);

/**
 * On a drafted letter, the stub quotes what the person CHANGED (founder,
 * 2026-10-01: "Quote the change (Recommended)") — the opening usually reads
 * exactly as the draft, so it hid what "Discard my changes" throws away. A new
 * subject, then the first paragraph that is not the draft's; when no paragraph
 * differs (only the recipient changed, or one was taken out), the opening.
 */
export function changedLine(
  held: { subject: string; body: string },
  drafted: { subject: string; body: string },
  max = 120,
): string {
  const subject = held.subject.trim() !== drafted.subject.trim() ? held.subject : '';
  const was = paragraphs(drafted.body);
  const now = paragraphs(held.body);
  const first = now.find((p, i) => p !== was[i]) ?? '';
  return subject || first ? heldLine(subject, first, max) : heldLine(held.subject, held.body, max);
}
