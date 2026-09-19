/**
 * The person's ground choice — ADR 0169.
 *
 * The founder, 2026-09-19: "I realized all pages will be charcoal however I
 * don't want it, I prefer the white look to be honest. People should have
 * the option to choose." This revises ADR 0149 row 6 (which retired the
 * light/dark toggle in favour of "charcoal everywhere, paper only where
 * declared"): the default is now PAPER, and a person may choose CHARCOAL for
 * themselves. See `.planning/decisions/0169-the-ground-is-white-by-default-and-each-person-chooses.md`.
 *
 * PER-DEVICE, NOT PER-ACCOUNT (ADR 0169 §Decision). The choice lives in
 * `localStorage` on this browser only; a person who chooses charcoal on their
 * phone and opens the house on a shared desk terminal sees paper there, and
 * that is today's known limit, not a bug — carrying it to the account would
 * need a migration, which ADR 0169 returns to the founder rather than adding
 * on its own say-so.
 *
 * WHERE THE CHOICE ACTUALLY REACHES THE PAGE. This module does not walk the
 * DOM setting `data-ground` on every `.mudavym` root — that would mean
 * editing every one of the ~20 `MUDAVYM_PAGES` (`lib/mudavym/shellGround.ts`'s
 * file header explains why the ground is a DOM fact the PAGE states, not a
 * prop threaded from above). Instead the choice is written ONCE, as
 * `data-mudavym-ground` on `<html>`, and `styles/mudavym.css` carries a rule
 * that reaches every `.mudavym` element which has NOT itself declared a
 * `data-ground` — so the header, the sidebar, every page body and every
 * overlay pick it up together, in one cascade. A surface that hardcodes its
 * own ground (the canonical document's `data-ground="paper"`, DoorNext's
 * `data-ground="charcoal"`) keeps doing exactly what it did before, unreached
 * by this attribute — the same way it was already unreached by the base
 * `.mudavym` selector.
 *
 * NO FLASH. `index.html` carries a synchronous, blocking twin of the write
 * below, inline in `<head>` before any stylesheet or script — it reads the
 * same `localStorage` key and sets the same attribute before the first paint,
 * so a charcoal choice never flashes paper first. Keep the two in sync by
 * hand; there is no bundler step that shares code into a static HTML file.
 */

import { useSyncExternalStore } from 'react';

export type GroundChoice = 'paper' | 'charcoal';

/** Exported for the blocking script comment in index.html and for tests —
 *  it is the one thing that MUST match between this file and that script. */
export const GROUND_CHOICE_STORAGE_KEY = 'mudavym.ground';

/** The attribute `<html>` carries once a choice has been applied. Read by
 *  `styles/mudavym.css`'s person's-choice rule. */
export const GROUND_CHOICE_ATTR = 'data-mudavym-ground';

/** ADR 0169 §Decision: paper, until a person says otherwise on this device. */
const DEFAULT_CHOICE: GroundChoice = 'paper';

function isGroundChoice(value: string | null): value is GroundChoice {
  return value === 'paper' || value === 'charcoal';
}

/** Read the stored choice. Never throws — storage can be blocked (a private
 *  window, a locked-down browser) and that degrades to the decided default
 *  rather than crashing the page it is asked from. */
function readStored(): GroundChoice {
  try {
    const raw = window.localStorage.getItem(GROUND_CHOICE_STORAGE_KEY);
    return isGroundChoice(raw) ? raw : DEFAULT_CHOICE;
  } catch {
    return DEFAULT_CHOICE;
  }
}

let current: GroundChoice = typeof window === 'undefined' ? DEFAULT_CHOICE : readStored();
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/**
 * The person's stored choice, read synchronously. Non-React call sites use
 * this — `lib/mudavym/shellGround.ts`'s DOM readers fall back to it when a
 * page has declared no ground of its own. A component should use
 * `useGroundChoice` instead, so it re-renders when the choice changes.
 */
export function getGroundChoice(): GroundChoice {
  return current;
}

/**
 * Set the choice for this device: persists it, reflects it on `<html>`
 * immediately (every mounted `.mudavym` surface that has not declared its own
 * ground repaints, via the cascade rule in `styles/mudavym.css`), and tells
 * every `useGroundChoice()` subscriber, in this tab and — through the
 * `storage` event — every other tab open on this device.
 */
export function setGroundChoice(choice: GroundChoice): void {
  current = choice;
  try {
    window.localStorage.setItem(GROUND_CHOICE_STORAGE_KEY, choice);
  } catch {
    // Best-effort persistence. The attribute below still governs this one
    // page view even when it cannot be remembered for the next one.
  }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute(GROUND_CHOICE_ATTR, choice);
  }
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent): void => {
    // Another tab on this device changed it. `e.key === null` means a full
    // `localStorage.clear()`, which also needs a re-read rather than being
    // ignored because it does not name our key.
    if (e.key !== null && e.key !== GROUND_CHOICE_STORAGE_KEY) return;
    const next = readStored();
    if (next === current) return;
    current = next;
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute(GROUND_CHOICE_ATTR, current);
    }
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** SSR/prerender snapshot — the decided default, never a guess at a browser
 *  that is not there (same shape as `shellGround.ts`'s `useMudavymShell`). */
function getServerSnapshot(): GroundChoice {
  return DEFAULT_CHOICE;
}

/** Tests only — `current` is module state and would otherwise leak across
 *  specs (same shape as `shellGround.ts`'s `resetMudavymShell`). Re-reads
 *  storage rather than hard-resetting to the default, so a test that seeds
 *  `localStorage` before importing/resetting sees its own seed. */
export function resetGroundChoiceForTests(): void {
  current = typeof window === 'undefined' ? DEFAULT_CHOICE : readStored();
  if (typeof document !== 'undefined') {
    document.documentElement.removeAttribute(GROUND_CHOICE_ATTR);
  }
}

/**
 * The person's ground choice, reactive: `[choice, setChoice]`. `setChoice`
 * persists to this device and applies immediately — see the module doc for
 * why that is enough to repaint every Mudavym surface on screen.
 */
export function useGroundChoice(): [GroundChoice, (choice: GroundChoice) => void] {
  const choice = useSyncExternalStore(subscribe, getGroundChoice, getServerSnapshot);
  return [choice, setGroundChoice];
}
