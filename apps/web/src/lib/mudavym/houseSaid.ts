/**
 * "The house said" — the counter's session log (sketch 119 D; the founder's
 * pick of 2026-09-21: it CLEARS on reload).
 *
 * Client-only confirmations and failures of THIS sitting — what the house
 * sealed, refused, or could not be read — newest first. It is module state and
 * nothing else: no localStorage, no table. A reload starts it empty, which is
 * the decision, not a gap. The bell's book is the house's record; this is the
 * person's own sitting.
 */

import { useSyncExternalStore } from 'react';

export type SaidKind = 'sealed' | 'refused' | 'not_read' | 'kept';

export interface SaidEntry {
  id: number;
  kind: SaidKind;
  /** ISO time the page learned it — the device's clock. */
  at: string;
  text: string;
  /** What is NOT claimed, or the refusal's own sentence. */
  sub?: string;
}

/** The log keeps this many; older lines fall off the end of the sitting. */
export const SAID_KEEP = 20;

let entries: SaidEntry[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function houseSaid(kind: SaidKind, text: string, sub?: string): void {
  seq += 1;
  entries = [{ id: seq, kind, at: new Date().toISOString(), text, sub }, ...entries].slice(
    0,
    SAID_KEEP,
  );
  emit();
}

export function getHouseSaid(): SaidEntry[] {
  return entries;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useHouseSaid(): SaidEntry[] {
  return useSyncExternalStore(subscribe, getHouseSaid, getHouseSaid);
}

/** Whose sitting the log is: `<person>@<house>`, or null before anyone is. */
let owner: string | null = null;

/**
 * The log is one person's sitting in one house. When the person or the house
 * changes without a reload (a sign-out and a sign-in on a shared till, a
 * branch switch), the log starts again — otherwise the next person would read
 * "Order to Kermit Lynch sealed" as if the house had said it to them, or one
 * house's seals would sit under another's name. The first binding keeps what
 * was already written (it is the same sitting that is just being named).
 */
export function bindHouseSaid(key: string | null): void {
  if (key === owner) return;
  const previous = owner;
  owner = key;
  if (previous !== null && entries.length > 0) {
    entries = [];
    emit();
  }
}

/** Tests only — module state would otherwise leak across specs. */
export function resetHouseSaid(): void {
  entries = [];
  seq = 0;
  owner = null;
  emit();
}
