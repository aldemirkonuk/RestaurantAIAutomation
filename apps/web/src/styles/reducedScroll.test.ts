/**
 * DD-r97-1: a reader who asked for less motion is not glided anywhere.
 * `html` is `scroll-behavior: auto` and only `smooth` inside
 * `prefers-reduced-motion: no-preference`; the scripted scrolls that used to
 * say `behavior: 'smooth'` ask `scrollBehavior()`, which is 'auto' under
 * reduce (MOTIONS.md:23, ADR 0112).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scrollBehavior } from '../lib/mudavym/motion';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('the global scroll rule', () => {
  const css = src('styles/globals.css');
  it('is auto by default and smooth only for no-preference', () => {
    expect(css).not.toMatch(/scroll-smooth/);
    expect(css).toMatch(/html\s*\{\s*scroll-behavior:\s*auto;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{\s*html\s*\{\s*scroll-behavior:\s*smooth;\s*\}\s*\}/);
  });
});

describe('scrollBehavior()', () => {
  const asks = (reduce: boolean) =>
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: reduce && q.includes('reduce'), media: q }) as MediaQueryList);
  afterEach(() => vi.restoreAllMocks());
  it("is 'auto' under reduce and 'smooth' otherwise", () => {
    asks(true);
    expect(scrollBehavior()).toBe('auto');
    vi.restoreAllMocks();
    asks(false);
    expect(scrollBehavior()).toBe('smooth');
  });
});

describe('the four scripted scrolls', () => {
  it.each([
    'pages/inventory/next/InventoryNext.tsx',
    'pages/orders/next/OrdersNext.tsx',
    'pages/profile/next/ProfileNext.tsx',
    'pages/receiving/next/RcManagerQueue.tsx',
  ])('%s asks scrollBehavior(), never a literal smooth', (f) => {
    const s = src(f);
    expect(s).not.toMatch(/behavior:\s*'smooth'/);
    expect(s).toMatch(/behavior:\s*scrollBehavior\(\)/);
  });
});
