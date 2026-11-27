/**
 * Starts the Ask panel's and the palette's downloads before they are asked for
 * (perf-p9-5): on pointer or focus reaching a button marked `data-preload="ask"`
 * or `data-preload="palette"`, and once on idle after the page has loaded.
 * Returns the cleanup.
 */
import { preloadAskPanel } from '../askai/LazyAskPanel';
import { preloadCommandPalette } from '../command/LazyCommandPalette';

const PRELOAD = { ask: preloadAskPanel, palette: preloadCommandPalette } as const;

export function preloadOnIntent(): () => void {
  const onIntent = (e: Event) => {
    const el = e.target instanceof Element ? e.target.closest('[data-preload]') : null;
    const key = el?.getAttribute('data-preload');
    if (key === 'ask' || key === 'palette') PRELOAD[key]();
  };
  document.addEventListener('pointerover', onIntent);
  document.addEventListener('focusin', onIntent);

  const idle = () => {
    preloadAskPanel();
    preloadCommandPalette();
  };
  let handle: number | undefined;
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (h: number) => void;
  };
  if (w.requestIdleCallback) handle = w.requestIdleCallback(idle, { timeout: 4000 });
  else handle = window.setTimeout(idle, 2000);

  return () => {
    document.removeEventListener('pointerover', onIntent);
    document.removeEventListener('focusin', onIntent);
    if (handle !== undefined) {
      if (w.cancelIdleCallback) w.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    }
  };
}
