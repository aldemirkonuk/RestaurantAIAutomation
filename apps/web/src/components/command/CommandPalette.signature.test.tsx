/**
 * N-17: the command palette as the product's signature.
 *
 * What is pinned: the entrance is the `lift` spring and nothing else; one pill
 * (a clip-path, so it can slide across rows of different heights) follows the
 * highlighted row; rows stagger 14 ms each; Tab opens a row's actions; a search
 * that finds nothing ends on "Ask Mudavym"; recents carry a tile; the preview
 * pane exists only behind its flag; and the stylesheet draws the blur, the 55%
 * scrim and animates nothing but transform, opacity and clip-path.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommandPalette, PREVIEW_STORAGE_KEY } from './CommandPalette';
import { ToastProvider } from '../../contexts/ToastContext';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround';
import { lift, springs } from '../../lib/mudavym/motion';
import { ASK_AI_OPEN_EVENT } from '../askai/events';

vi.mock('../../contexts/AuthContext', async () => {
  const { createContext } = await import('react');
  return {
    AuthContext: createContext<unknown>(null),
    AuthProvider: ({ children }: { children: React.ReactNode }) => children,
    useAuth: () => ({ user: { userId: 'u1', name: 'Demo', role: 'manager' } }),
  };
});

const here = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(here, 'command-palette.css'), 'utf8');
const SRC = readFileSync(resolve(here, 'CommandPalette.tsx'), 'utf8');

function mountPalette(onClose = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastProvider>
            <CommandPalette open onClose={onClose} />
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const input = () => screen.getByRole('combobox');
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.mdv-item'));
const pill = () => document.querySelector<HTMLElement>('.mdv-palette__pill');

beforeEach(() => {
  resetMudavymShell();
  claimMudavymShell(Symbol('palette-test'), 'paper');
  localStorage.clear();
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  // jsdom has no layout: give every row a height and a place by its index.
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      const i = this.getAttribute('data-idx');
      return i === null ? 0 : Number(i) * 40;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute('data-idx') === null ? 0 : 36;
    },
  });
});
afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetTop;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
  delete (Element.prototype as unknown as Record<string, unknown>).animate;
  vi.restoreAllMocks();
});

describe('the lift', () => {
  it('is a spring that settles past 1 by a few percent and no more', () => {
    const peak = Math.max(...springs.lift.samples) - 1;
    expect(peak).toBeGreaterThan(0.005);
    expect(peak).toBeLessThan(0.05);
    expect(lift.easing.startsWith('linear(')).toBe(true);
  });

  it('is the one entrance the card runs: scale .97 to 1 on the lift token', () => {
    const animate = vi.fn(() => ({}) as Animation);
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
    mountPalette();
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, opts] = animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
    expect(String(frames[0].transform)).toContain('scale(0.97)');
    expect(frames[1].transform).toBe('none');
    expect(opts.easing).toBe(lift.easing);
    expect(opts.duration).toBe(lift.ms);
    expect(document.querySelector('.mdv-palette')?.getAttribute('data-motion')).toBe('lift');
  });
});

describe('the rows', () => {
  it('stagger by 14 ms from the first, and stop counting at ten', () => {
    mountPalette();
    const r = rows();
    expect(r.length).toBeGreaterThan(11);
    expect(r[0].style.getPropertyValue('--i')).toBe('0');
    expect(r[3].style.getPropertyValue('--i')).toBe('3');
    expect(r[11].style.getPropertyValue('--i')).toBe('10');
    expect(CSS).toMatch(/animation-delay:\s*calc\(var\(--i, 0\) \* 14ms\)/);
  });

  it('clamp a name to two lines', () => {
    expect(CSS).toMatch(/\.mdv-palette \.mdv-item__label \{[^}]*-webkit-line-clamp:\s*2/);
  });

  it('give a recent a small tile and the rest none', () => {
    localStorage.setItem('wineops.command.recents', JSON.stringify(['askai-open']));
    mountPalette();
    const thumbs = document.querySelectorAll('.mdv-palette__thumb');
    expect(thumbs.length).toBe(1);
    expect(thumbs[0].closest('.mdv-item')?.id).toBe('cmd-askai-open');
  });
});

describe('the one pill', () => {
  it('sits on the highlighted row and slides when the highlight moves', () => {
    mountPalette();
    const first = pill()!.style.clipPath;
    expect(first).toContain('0px');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    const second = pill()!.style.clipPath;
    expect(second).not.toBe(first);
    expect(second).toContain('40px');
    expect(document.querySelectorAll('.mdv-palette__pill').length).toBe(1);
  });

  it('is drawn with a clip, 8 px round, and moved only by transitioning clip-path', () => {
    expect(pill() ?? null).toBeNull();
    mountPalette();
    expect(pill()!.style.clipPath).toContain('round 8px');
    expect(SRC).toMatch(/transition: pillLive && !reduced \? `clip-path /);
    expect(SRC).not.toContain('transition-all');
  });
});

describe('Tab for actions', () => {
  it('says what Enter and Tab do on a row that goes somewhere', () => {
    mountPalette();
    const foot = document.querySelector('.mdv-ovl__foot')!;
    expect(foot.textContent).toContain('Enter to open');
    expect(foot.textContent).toContain('Tab for actions');
  });

  it('opens the row actions on Tab, copies the link on Enter, and says if it could not', async () => {
    const onClose = vi.fn();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mountPalette(onClose);
    fireEvent.keyDown(input(), { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Open in a new tab' })).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Copy link' })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => {
      fireEvent.keyDown(input(), { key: 'Enter' });
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toMatch(/^https?:\/\/[^/]+\//);
    expect(onClose).toHaveBeenCalled();
  });

  it('opens a new tab without opener on the first action', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mountPalette();
    fireEvent.keyDown(input(), { key: 'Tab' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^\//), '_blank', 'noopener');
  });

  it('closes the actions on Escape without closing the palette', () => {
    const onClose = vi.fn();
    mountPalette(onClose);
    fireEvent.keyDown(input(), { key: 'Tab' });
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('when nothing matches', () => {
  it('ends on Ask Mudavym, and Enter opens the Ask panel', () => {
    const asked = vi.fn();
    window.addEventListener(ASK_AI_OPEN_EVENT, asked);
    mountPalette();
    fireEvent.change(input(), { target: { value: 'zzqxjv' } });
    expect(screen.getByText(/Nothing here matches/)).toBeInTheDocument();
    const r = rows();
    expect(r.length).toBe(1);
    expect(r[0].textContent).toContain('Ask Mudavym');
    expect(r[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(asked).toHaveBeenCalledTimes(1);
    window.removeEventListener(ASK_AI_OPEN_EVENT, asked);
  });

  it('does not offer it while something matches', () => {
    mountPalette();
    fireEvent.change(input(), { target: { value: 'inventory' } });
    expect(rows().some((r) => r.id === 'cmd-askai-nomatch')).toBe(false);
  });
});

describe('the preview, behind its flag', () => {
  it('is not there by default', () => {
    mountPalette();
    expect(document.querySelector('.mdv-palette__preview')).toBeNull();
    expect(document.querySelector('.mdv-palette--preview')).toBeNull();
  });

  it('shows the highlighted row, in full, when the device switch is on', () => {
    localStorage.setItem(PREVIEW_STORAGE_KEY, '1');
    mountPalette();
    const aside = screen.getByLabelText('Preview of the highlighted row');
    const first = rows()[0];
    expect(aside.textContent).toContain(first.querySelector('.mdv-item__label')!.textContent!);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(aside.textContent).toContain(rows()[1].querySelector('.mdv-item__label')!.textContent!);
  });
});

describe('the stylesheet', () => {
  it('blurs the page behind at 14 px over a 55% scrim', () => {
    expect(CSS).toContain('backdrop-filter: blur(14px) saturate(1.2)');
    expect(CSS).toContain('rgba(23, 19, 15, 0.55)');
    expect(CSS).toContain('rgba(0, 0, 0, 0.55)');
  });

  it('animates only transform, opacity and clip-path, never "all"', () => {
    expect(CSS).not.toMatch(/transition:\s*all|transition-property:\s*all/);
    const keyframes = CSS.match(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})+[^}]*\}/g) ?? [];
    expect(keyframes.length).toBe(3);
    for (const k of keyframes) {
      const props = Array.from(k.matchAll(/([a-z-]+):/g)).map((m) => m[1]);
      for (const p of props) expect(['opacity', 'transform']).toContain(p);
    }
  });

  it('moves nothing under reduced motion: every animation lives in no-preference', () => {
    const outside = CSS.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*$/, '');
    expect(outside).not.toMatch(/animation:/);
    expect(SRC).toContain('pillLive && !reduced');
  });

  it('draws the field with no fill, a hairline under it', () => {
    expect(CSS).toMatch(/\.mdv-palette \.mdv-field input \{[^}]*background-color: transparent/);
    expect(CSS).toMatch(/\.mdv-palette \.mdv-field \{[^}]*border-bottom: 1px solid/);
  });
});
