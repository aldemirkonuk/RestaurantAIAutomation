/**
 * Unsaved recipe drafts, kept for the session (round-19 residual of D1).
 *
 * The sheet is keyed by its drink, so opening another drink drops the sheet's
 * state. Without this store, going A -> B -> A lost what was typed for A with
 * nothing said. Each editing sheet writes its unsaved draft here as it
 * changes, and a sheet opening for the same person, house and drink takes it
 * back. A draft belongs to exactly one key, so it can only ever return to the
 * drink it was typed for.
 *
 * Memory only, not sessionStorage: a reload or a closed tab is covered by the
 * leave-page warning below, and a shared bar tablet does not keep one
 * person's lines on disk for the next.
 *
 * While any draft is unsaved, leaving the page (reload, close, typing another
 * address) asks the browser to warn first. In-app navigation needs no warning:
 * the draft stays here and is back when the drink is opened again.
 */
import type { DraftRow } from './LineRow';

export type KeptDraft = {
  rows: DraftRow[];
  /** The version the draft was seeded from; a save still names it, so the 409 guard decides. */
  openedFrom: string | null;
  dirty: boolean;
  setAside: DraftRow[] | null;
};

const kept = new Map<string, KeptDraft>();

export const draftKey = (userId: string | null | undefined, rid: string | null | undefined, cocktailId: string) =>
  `${userId ?? ''}|${rid ?? ''}|${cocktailId}`;

function warn(e: BeforeUnloadEvent) {
  e.preventDefault();
  // Older browsers show the prompt only when returnValue is set.
  e.returnValue = '';
}

let guarding = false;
function guard() {
  if (typeof window === 'undefined') return;
  if (kept.size > 0 && !guarding) {
    window.addEventListener('beforeunload', warn);
    guarding = true;
  } else if (kept.size === 0 && guarding) {
    window.removeEventListener('beforeunload', warn);
    guarding = false;
  }
}

export function takeDraft(key: string): KeptDraft | null {
  return kept.get(key) ?? null;
}

export function keepDraft(key: string, d: KeptDraft) {
  kept.set(key, d);
  guard();
}

export function dropDraft(key: string) {
  if (kept.delete(key)) guard();
}

/** Every unsaved draft. Tests start from none. */
export function forgetDrafts() {
  kept.clear();
  guard();
}
