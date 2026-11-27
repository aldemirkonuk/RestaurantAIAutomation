// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isStaleChunkError, lazyWithRefresh } from './lazyWithRefresh';

const reload = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  reload.mockReset();
  sessionStorage.clear();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, reload } });
});
afterEach(() => Object.defineProperty(window, 'location', { configurable: true, value: realLocation }));

// React's lazy keeps its loader on _init/_payload; calling it is how React asks for the file.
const load = (C: unknown) => {
  const l = C as { _init: (p: unknown) => unknown; _payload: unknown };
  try {
    l._init(l._payload);
  } catch (thrown) {
    return thrown;
  }
  return undefined;
};

describe('lazyWithRefresh', () => {
  it('knows a stale chunk by the three browsers\' words', () => {
    for (const m of ['Failed to fetch dynamically imported module', 'error loading dynamically imported module', 'Importing a module script failed'])
      expect(isStaleChunkError(new Error(m))).toBe(true);
    expect(isStaleChunkError(new Error('boom'))).toBe(false);
  });

  it('reloads once on a stale chunk, and not again', async () => {
    const C = lazyWithRefresh(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
    const first = load(C) as Promise<unknown>;
    await Promise.race([first, new Promise((r) => setTimeout(r, 20))]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('chunk_reload')).toBe('1');
    const again = lazyWithRefresh(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
    const p = load(again) as Promise<unknown>;
    await expect(p).rejects.toThrow(/dynamically imported/);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
