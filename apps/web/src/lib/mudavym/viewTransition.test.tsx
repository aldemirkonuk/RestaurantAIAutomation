import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { runViewTransition, useViewTransitionNavigate, isPlainLeftClick } from './viewTransition';

type D = { startViewTransition?: unknown };
const doc = document as unknown as D;

function reduced(on: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: on && q.includes('reduce'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => reduced(false));
afterEach(() => {
  delete doc.startViewTransition;
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-mdv-reveal');
});

describe('runViewTransition', () => {
  it('just runs the update when the API is missing', () => {
    const update = vi.fn();
    runViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('just runs the update, never starting a transition, under prefers-reduced-motion', () => {
    reduced(true);
    const start = vi.fn();
    doc.startViewTransition = start;
    const update = vi.fn();
    runViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it('runs the update inside the transition and names, then clears, the shared elements', async () => {
    document.body.innerHTML = '<main class="mdv-shell__main"><h1>Old</h1></main><i class="mdv-rail__bar"></i>';
    let finish: () => void = () => {};
    doc.startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return { finished: new Promise<void>((r) => (finish = r)) };
    });
    const update = vi.fn();
    runViewTransition(update);
    const main = document.querySelector('.mdv-shell__main') as HTMLElement;
    const h1 = document.querySelector('h1') as HTMLElement;
    expect(update).toHaveBeenCalledTimes(1);
    expect(main.getAttribute('data-vt')).toBe('mdv-page');
    expect(document.querySelector('.mdv-rail__bar')?.getAttribute('data-vt')).toBe('mdv-rail-bar');
    expect(h1.getAttribute('data-vt')).toBe('mdv-title');
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(main.hasAttribute('data-vt')).toBe(false);
    expect(h1.hasAttribute('data-vt')).toBe(false);
  });

  it('a ground reveal sets the circle origin and names nothing', async () => {
    document.body.innerHTML = '<div class="mdv-shell__main"></div>';
    let finish: () => void = () => {};
    doc.startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return { finished: new Promise<void>((r) => (finish = r)) };
    });
    runViewTransition(() => {}, { origin: { x: 40, y: 60 } });
    const root = document.documentElement;
    expect(root.dataset.mdvReveal).toBe('circle');
    expect(root.style.getPropertyValue('--mdv-reveal-x')).toBe('40px');
    expect(document.querySelector('.mdv-shell__main')?.hasAttribute('data-vt')).toBe(false);
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(root.dataset.mdvReveal).toBeUndefined();
    expect(root.style.getPropertyValue('--mdv-reveal-x')).toBe('');
  });

  it('still runs the update once when startViewTransition throws', () => {
    doc.startViewTransition = () => {
      throw new Error('nope');
    };
    const update = vi.fn();
    runViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('useViewTransitionNavigate', () => {
  it('navigates (inside the transition when it exists)', () => {
    doc.startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve() };
    });
    let go: (to: string) => void = () => {};
    function Probe() {
      go = useViewTransitionNavigate();
      return <span data-testid="at">{useLocation().pathname}</span>;
    }
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/a']}>
        <Probe />
        <Routes><Route path="*" element={null} /></Routes>
      </MemoryRouter>,
    );
    act(() => go('/b'));
    expect(getByTestId('at').textContent).toBe('/b');
    expect(doc.startViewTransition).toHaveBeenCalledTimes(1);
  });
});

describe('isPlainLeftClick', () => {
  const e = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  it('accepts a plain left click and rejects modified or other-button clicks', () => {
    expect(isPlainLeftClick(e)).toBe(true);
    expect(isPlainLeftClick({ ...e, metaKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...e, button: 1 })).toBe(false);
  });
});
