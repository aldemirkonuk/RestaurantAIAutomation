/**
 * The landing on a phone (design need N-11): the bar's button steps aside while
 * the dock shows the same one, so the page never offers two "Start free" at
 * once, and the platform cells are a snap carousel of 86% cards.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CTA, Landing } from './Landing';

const css = readFileSync(resolve(__dirname, 'landing.css'), 'utf8');

type Cb = (es: Array<Record<string, unknown>>) => void;
let observers: Array<{ cb: Cb; threshold: number | undefined; seen: Element[] }> = [];

beforeEach(() => {
  observers = [];
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private rec: { cb: Cb; threshold: number | undefined; seen: Element[] };
      constructor(cb: Cb, opts?: { threshold?: number }) {
        this.rec = { cb, threshold: opts?.threshold as number | undefined, seen: [] };
        observers.push(this.rec);
      }
      observe(el: Element) {
        this.rec.seen.push(el);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function bars(container: HTMLElement) {
  const bar = Array.from(container.querySelectorAll('.ld-bar nav a')).find((a) => !!a.textContent?.startsWith(CTA));
  const dock = container.querySelector('.ld-dock') as HTMLElement;
  return { bar: bar as HTMLElement, dock };
}

function scrollPastHero(container: HTMLElement) {
  const hero = observers.find((o) => o.threshold === 0 && o.seen.some((el) => el.tagName === 'A' && !!el.textContent?.startsWith(CTA) && !el.closest('.ld-bar, .ld-dock')));
  expect(hero).toBeTruthy();
  act(() => {
    hero!.cb([{ isIntersecting: false, boundingClientRect: { top: -40 }, target: hero!.seen[0] }]);
  });
}

describe('one Start free at a time on a phone', () => {
  it("hides the bar's button while the dock is showing, and shows it again when the dock steps away", () => {
    const { container } = render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
    const before = bars(container);
    expect(before.dock.classList.contains('is-on')).toBe(false);
    expect(before.bar.classList.contains('ld-bar-cta--docked')).toBe(false);
    scrollPastHero(container);
    const after = bars(container);
    expect(after.dock.classList.contains('is-on')).toBe(true);
    expect(after.bar.classList.contains('ld-bar-cta--docked')).toBe(true);
    // the closing section's own button comes into view: the dock steps aside, the bar's returns
    const close = observers.find((o) => o.seen.some((el) => el.classList.contains('ld-close')));
    expect(close).toBeTruthy();
    act(() => close!.cb([{ isIntersecting: true }]));
    expect(bars(container).dock.classList.contains('is-on')).toBe(false);
    expect(bars(container).bar.classList.contains('ld-bar-cta--docked')).toBe(false);
  });

  it('the hide applies under 960 px only, where the dock exists', () => {
    expect(css).toMatch(/@media \(max-width: 959px\) \{ \.ld-bar \.ld-bar-cta--docked \{ display: none; \} \}/);
    expect(css).toMatch(/@media \(min-width: 960px\) \{ \.ld-dock \{ display: none; \} \}/);
  });
});

describe('the platform as a snap carousel on a phone', () => {
  it('runs the cells in a row of 86% cards that snap, under 680 px', () => {
    const m = /@media \(max-width: 679px\) \{\s*\.ld-bento \{([^}]*)\}[^@]*?\.ld-bento > \.ld-cell \{([^}]*)\}/.exec(css);
    expect(m).not.toBeNull();
    expect(m![1]).toContain('grid-auto-flow: column');
    expect(m![1]).toContain('grid-auto-columns: 86%');
    expect(m![1]).toContain('overflow-x: auto');
    expect(m![1]).toContain('scroll-snap-type: x mandatory');
    expect(m![2]).toContain('scroll-snap-align: start');
  });
});
