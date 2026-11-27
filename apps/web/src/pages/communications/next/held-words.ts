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

import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import type { MailAnswer } from './mail-format';
import type { HeldLetter } from './Compose/ComposeSheet';

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

/* ------------------------------------------------------------------------ *
 * A half-written reply stays on its own thread (r109 mail-gap g2).
 *
 * "Write a letter" holds its words under 'new'. A reply used to land there too,
 * so a torn reply left its thread showing nothing and "Write a reply" opened
 * empty. A reply is held under its thread instead, and in this tab's
 * sessionStorage under mail-reply:<userId>:<restaurantId>:<threadKey>, stamped,
 * for 24 hours. The session's call (DD-r107-22): sessionStorage. A server draft
 * would change what ADR 0230's drafts list means (those are Mudavym's letters);
 * localStorage would let the words outlive sign-out on a shared floor tablet.
 * Every read and write is guarded: with no storage the hold lives in memory.
 * ------------------------------------------------------------------------ */

export const REPLY_HOLD_PREFIX = 'mail-reply:';
export const REPLY_HOLD_MS = 24 * 60 * 60 * 1000;

export interface ReplyHold<W, A> {
  words: W;
  /** What the reply answers, so Resume opens the same thread's reply. */
  answer: A;
  /** The person the thread is with (the list row's key), so the row can say "Draft". */
  personKey: string | null;
  /** When the words were held (ms); a hold older than a day is dropped on read. */
  at: number;
}

const scopePrefix = (userId: string, restaurantId: string) => `${REPLY_HOLD_PREFIX}${userId}:${restaurantId}:`;

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The holds this person has in this house, in this tab. Holds of another person
 * or another house, a day-old hold and an unreadable one are removed as they are read.
 */
export function readReplyHolds<W, A>(userId: string, restaurantId: string, now = Date.now()): Record<string, ReplyHold<W, A>> {
  const out: Record<string, ReplyHold<W, A>> = {};
  const s = store();
  if (!s) return out;
  try {
    const mine = scopePrefix(userId, restaurantId);
    const keys: string[] = [];
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (k && k.startsWith(REPLY_HOLD_PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      let keep: ReplyHold<W, A> | null = null;
      if (k.startsWith(mine) && k.length > mine.length) {
        try {
          const v = JSON.parse(s.getItem(k) ?? 'null') as ReplyHold<W, A> | null;
          if (v && typeof v.at === 'number' && now - v.at < REPLY_HOLD_MS && v.at <= now && v.words && v.answer) keep = v;
        } catch {
          keep = null;
        }
      }
      if (keep) out[k.slice(mine.length)] = keep;
      else s.removeItem(k);
    }
  } catch {
    /* storage blocked: the holds live in this page's memory only */
  }
  return out;
}

export function writeReplyHold<W, A>(userId: string, restaurantId: string, threadKey: string, hold: ReplyHold<W, A>): void {
  try {
    store()?.setItem(scopePrefix(userId, restaurantId) + threadKey, JSON.stringify(hold));
  } catch {
    /* storage blocked or full: the hold lives in memory */
  }
}

export function clearReplyHold(userId: string, restaurantId: string, threadKey: string): void {
  try {
    store()?.removeItem(scopePrefix(userId, restaurantId) + threadKey);
  } catch {
    /* nothing to clear */
  }
}

/** Every held reply in this tab, for every person and house: called at sign-out and at a house switch. */
export function forgetReplyHolds(): void {
  const s = store();
  if (!s) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (k && k.startsWith(REPLY_HOLD_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => s.removeItem(k));
  } catch {
    /* storage blocked: nothing was written */
  }
}

export interface HeldReply<W, A> extends ReplyHold<W, A> {
  discarded: boolean;
  n: number;
}

export interface ReplyHolds<W, A> {
  get: (threadKey: string) => HeldReply<W, A> | undefined;
  /** The people with a reply held (not discarded). */
  people: ReadonlySet<string>;
  hold: (threadKey: string, words: W, answer: A, personKey: string | null) => void;
  /** Resume: the words leave the stub for the sheet, and stay in storage until the reply is queued or discarded. */
  take: (threadKey: string) => HeldReply<W, A> | null;
  discard: (threadKey: string) => void;
  restore: (threadKey: string) => void;
  /** A queued reply (202), or a sheet closed with nothing to keep. */
  clear: (threadKey: string) => void;
}

/** The replies held on their threads. With no person or house known, they live in memory only. */
export function useReplyHolds<W, A>(userId: string | null | undefined, restaurantId: string | null | undefined): ReplyHolds<W, A> {
  const scope = userId && restaurantId ? { userId, restaurantId } : null;
  const scopeKey = scope ? `${scope.userId}:${scope.restaurantId}` : '';
  const count = useRef(0);
  const load = useCallback((): Record<string, HeldReply<W, A>> => {
    if (!scope) return {};
    const read = readReplyHolds<W, A>(scope.userId, scope.restaurantId);
    const out: Record<string, HeldReply<W, A>> = {};
    for (const [k, v] of Object.entries(read)) {
      count.current += 1;
      out[k] = { ...v, discarded: false, n: count.current };
    }
    return out;
  }, [scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState<{ scope: string; held: Record<string, HeldReply<W, A>> }>(() => ({ scope: scopeKey, held: load() }));
  // A house switch or another person: the last scope's holds are not this one's.
  const held = state.scope === scopeKey ? state.held : null;
  useEffect(() => {
    if (state.scope !== scopeKey) setState({ scope: scopeKey, held: load() });
  }, [scopeKey, state.scope, load]);
  const current = held ?? {};
  const put = useCallback(
    (threadKey: string, h: ReplyHold<W, A> | null) => {
      if (!scope) return;
      if (h) writeReplyHold(scope.userId, scope.restaurantId, threadKey, h);
      else clearReplyHold(scope.userId, scope.restaurantId, threadKey);
    },
    [scopeKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const edit = (fn: (h: Record<string, HeldReply<W, A>>) => Record<string, HeldReply<W, A>>) =>
    setState((s) => ({ scope: scopeKey, held: fn(s.scope === scopeKey ? s.held : {}) }));
  const people = new Set<string>();
  for (const h of Object.values(current)) if (!h.discarded && h.personKey) people.add(h.personKey);
  const strip = ({ words, answer, personKey, at }: HeldReply<W, A>): ReplyHold<W, A> => ({ words, answer, personKey, at });
  return {
    get: (k) => current[k],
    people,
    hold: (k, words, answer, personKey) => {
      count.current += 1;
      const h: HeldReply<W, A> = { words, answer, personKey, at: Date.now(), discarded: false, n: count.current };
      put(k, strip(h));
      edit((m) => ({ ...m, [k]: h }));
    },
    take: (k) => {
      const h = current[k];
      if (!h || h.discarded) return null;
      edit((m) => {
        const rest = { ...m };
        delete rest[k];
        return rest;
      });
      return h;
    },
    discard: (k) => {
      put(k, null);
      edit((m) => (m[k] ? { ...m, [k]: { ...m[k], discarded: true } } : m));
    },
    restore: (k) => {
      const h = current[k];
      if (h) put(k, strip(h));
      edit((m) => (m[k] ? { ...m, [k]: { ...m[k], discarded: false } } : m));
    },
    clear: (k) => {
      put(k, null);
      edit((m) => {
        if (!(k in m)) return m;
        const rest = { ...m };
        delete rest[k];
        return rest;
      });
    },
  };
}

/** The page's held replies, for the thread's stub and the person row's "Draft". Null outside the page. */
export const ReplyHoldsContext = createContext<ReplyHolds<HeldLetter, MailAnswer> | null>(null);
