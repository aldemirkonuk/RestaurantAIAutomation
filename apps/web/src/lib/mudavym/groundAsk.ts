/**
 * groundAsk — WHEN the one-time theme question is allowed to appear.
 *
 * The question itself lives in `components/mudavym/GroundFirstChoice.tsx`; this
 * module only answers "may it show now?". Design review round 2 (N-08, P0-1,
 * 2026-11-18): the question used to open on every full load until Save, with a
 * scrim over a floor worker's first screen. Now:
 *
 *   - it waits for the person's FIRST COMPLETED TASK (a successful save they
 *     started themselves; the same fact holds the staff home's tour banner back,
 *     so it is written once for anyone), so the first thing anyone sees is their own work;
 *   - "Not now" (or Escape, or a click outside) is remembered for 30 days;
 *   - both facts live on the ACCOUNT, in the same `user_preferences.preferences`
 *     blob the ground itself rides (`groundAsk: { firstTaskAt, snoozedUntil }`),
 *     so a second device or a cleared browser does not ask again. No column, no
 *     migration, no gateway change (see `GroundChoiceSync.tsx`).
 *
 * A read that has not come back, or failed, is NOT an answer: the gate stays
 * closed until the account has said what it holds (CLAUDE.md §9).
 */

import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';

/** "Not now" is remembered for this long. */
export const GROUND_ASK_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

/** A person's tap or key press counts as "they started it" for this long. */
export const GESTURE_WINDOW_MS = 5000;

/** The shape stored on the account. Both fields are ISO timestamps. */
export interface GroundAskRecord {
  firstTaskAt?: string;
  snoozedUntil?: string;
}

export interface GroundAskGate {
  /** The account has answered; until then nothing may ask. */
  known: boolean;
  firstTaskAt: string | null;
  snoozedUntil: string | null;
}

const EMPTY: GroundAskGate = { known: false, firstTaskAt: null, snoozedUntil: null };

let gate: GroundAskGate = EMPTY;
let writer: ((record: GroundAskRecord) => Promise<unknown>) | null = null;
const listeners = new Set<() => void>();

function set(next: GroundAskGate): void {
  gate = next;
  listeners.forEach((l) => l());
}

function toTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** The pure rule: asked only after a first task, and not while snoozed. */
export function groundAskDue(g: GroundAskGate, now: number = Date.now()): boolean {
  if (!g.known) return false;
  if (toTime(g.firstTaskAt) === null) return false;
  const until = toTime(g.snoozedUntil);
  return until === null || until <= now;
}

function record(g: GroundAskGate): GroundAskRecord {
  const out: GroundAskRecord = {};
  if (g.firstTaskAt) out.firstTaskAt = g.firstTaskAt;
  if (g.snoozedUntil) out.snoozedUntil = g.snoozedUntil;
  return out;
}

/** Send the WHOLE record: the client's optimistic merge of preferences is
 *  shallow, so a partial would wipe the sibling field until the refetch. */
function persist(): void {
  const send = writer;
  if (!send) return;
  void send(record(gate)).catch(() => {
    // Best effort. A write that did not land only means it may ask once more.
  });
}

export function registerGroundAskWriter(next: ((record: GroundAskRecord) => Promise<unknown>) | null): void {
  writer = next;
}

/** The account answered. Merged with what this page already knows, so a
 *  refetch that raced our own write cannot un-snooze or un-note anything. */
export function applyAccountGroundAsk(raw: unknown): void {
  const r = raw && typeof raw === 'object' ? (raw as GroundAskRecord) : {};
  const theirs = {
    firstTaskAt: typeof r.firstTaskAt === 'string' ? r.firstTaskAt : null,
    snoozedUntil: typeof r.snoozedUntil === 'string' ? r.snoozedUntil : null,
  };
  const later = (a: string | null, b: string | null) =>
    (toTime(a) ?? -Infinity) >= (toTime(b) ?? -Infinity) ? a : b;
  const earlier = (a: string | null, b: string | null) =>
    a === null ? b : b === null ? a : (toTime(a) ?? Infinity) <= (toTime(b) ?? Infinity) ? a : b;
  set({
    known: true,
    firstTaskAt: earlier(theirs.firstTaskAt, gate.firstTaskAt),
    snoozedUntil: later(theirs.snoozedUntil, gate.snoozedUntil),
  });
}

/** A different person (or nobody) is on this tab. */
export function resetGroundAsk(): void {
  set(EMPTY);
}

/** A person finished something. Only the first one is written. */
export function noteGroundTaskDone(now: number = Date.now()): void {
  if (!gate.known || gate.firstTaskAt) return;
  set({ ...gate, firstTaskAt: new Date(now).toISOString() });
  persist();
}

/** "Not now": quiet for 30 days. */
export function snoozeGroundAsk(now: number = Date.now()): void {
  set({ ...gate, snoozedUntil: new Date(now + GROUND_ASK_SNOOZE_MS).toISOString() });
  persist();
}

export function getGroundAskGate(): GroundAskGate {
  return gate;
}

export function useGroundAskGate(): GroundAskGate {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => gate,
    () => gate,
  );
}

/**
 * The key `useUserPreferences` puts on its write. A preferences write is the
 * app remembering something (a tip snoozed, a theme chosen, a filter kept), not
 * a task the person set out to do, so it never counts as the first task even
 * though a tap is right behind it. (r62 walk: tapping "Later" on a page tip
 * wrote `firstTaskAt` 56 ms after the snooze.)
 */
export const USER_PREFERENCES_MUTATION_KEY = ['user-preferences'] as const;

/**
 * Watch for the first completed task: a mutation that SUCCEEDED and that a
 * person started with a tap or a key press just before. Background writes
 * (anything the app sends on its own) have no gesture behind them, and a
 * preferences write has one but is not a task, so neither counts. Returns the unsubscribe.
 */
export function watchFirstTask(client: QueryClient, target: Window | null = typeof window === 'undefined' ? null : window): () => void {
  if (!target) return () => {};
  let lastGestureAt = -Infinity;
  const mark = () => {
    lastGestureAt = Date.now();
  };
  target.addEventListener('pointerdown', mark, true);
  target.addEventListener('keydown', mark, true);
  const unsubscribe = client.getMutationCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    if (event.mutation.options.mutationKey?.[0] === USER_PREFERENCES_MUTATION_KEY[0]) return;
    const submittedAt = event.mutation.state.submittedAt;
    if (submittedAt - lastGestureAt > GESTURE_WINDOW_MS) return;
    // The gesture may follow the submit by a hair in a test clock; only a
    // submit with NO gesture shortly before it is a background write.
    if (lastGestureAt === -Infinity) return;
    noteGroundTaskDone();
  });
  return () => {
    target.removeEventListener('pointerdown', mark, true);
    target.removeEventListener('keydown', mark, true);
    unsubscribe();
  };
}

export function resetGroundAskForTests(): void {
  gate = EMPTY;
  writer = null;
}
