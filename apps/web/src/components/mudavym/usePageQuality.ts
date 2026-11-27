/**
 * Looks at each held photo once, off the click path (r110 g2). The answer is
 * cached by the File itself, so a reorder, a turn or a re-render never runs
 * it again. Advisory only: nothing here can stop Read.
 */

import { useEffect, useState } from 'react';
import { checkFile, type PageQuality } from '../../lib/pageQuality';

const cache = new WeakMap<File, PageQuality | null>();
const inflight = new WeakSet<File>();

type Idle = (cb: () => void) => void;
const later: Idle = (cb) => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (typeof ric === 'function') ric(cb);
  else setTimeout(cb, 0);
};

export function usePageQuality(files: File[]): (file: File) => PageQuality | null {
  const [, tick] = useState(0);
  useEffect(() => {
    let live = true;
    for (const f of files) {
      if (cache.has(f) || inflight.has(f)) continue;
      inflight.add(f);
      later(() => {
        void checkFile(f).then((q) => {
          cache.set(f, q);
          inflight.delete(f);
          if (live) tick((n) => n + 1);
        });
      });
    }
    return () => {
      live = false;
    };
  }, [files]);
  return (file) => cache.get(file) ?? null;
}
