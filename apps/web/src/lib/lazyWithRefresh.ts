import { lazy, type ComponentType } from 'react';

/**
 * A screen that is drawn only on a click or a rare branch, loaded when it is
 * first drawn instead of with the page around it.
 *
 * [2026-11-14, r41 inventory audit gap 1: /inventory downloaded the legacy
 * command page, the old menu scanner (with the whole wine database) and the
 * shelf map with every visit, though a house sees none of them until it asks.
 * The session's call: load them on demand, with the same stale-chunk recovery
 * App.tsx gives its routes. Rejected: importing App.tsx's private copy (App is
 * the entry; a page importing it is a cycle) and moving App's copy here in the
 * same PR (App.tsx is owned by many open chains; a follow-up can point it here).]
 *
 * After a deploy, the old file names are gone, so the first chunk read fails
 * with one of the browser messages below. The page then reloads once (the
 * `chunk_reload` mark is the one App.tsx uses, so the two never loop), and a
 * successful read clears the mark.
 */
export function isStaleChunkError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  const lower = message.toLowerCase();
  return (
    lower.includes('text/html') ||
    lower.includes('failed to fetch dynamically imported module') ||
    lower.includes('error loading dynamically imported module') ||
    lower.includes('importing a module script failed') ||
    lower.includes('loading chunk') ||
    lower.includes('chunkloaderror')
  );
}

const MARK = 'chunk_reload';

function readMark(): string | null {
  try {
    return sessionStorage.getItem(MARK);
  } catch {
    return '1';
  }
}

function writeMark(on: boolean) {
  try {
    if (on) sessionStorage.setItem(MARK, '1');
    else sessionStorage.removeItem(MARK);
  } catch {
    /* storage refused: no recovery reload, the error shows instead */
  }
}

export function lazyWithRefresh<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() =>
    factory().then(
      (mod) => {
        writeMark(false);
        return mod;
      },
      (err: unknown) => {
        if (isStaleChunkError(err) && !readMark()) {
          writeMark(true);
          window.location.reload();
          return new Promise<never>(() => {});
        }
        throw err;
      },
    ),
  );
}
