/**
 * The popover's arrow and scale-from-origin enter (r58, N-09): an 8 px arrow
 * centred on the trigger, and the panel scaling 0.96 to 1 out of that point.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../lib/mudavym/motion', async (orig) => {
  const actual = await orig<typeof import('../../lib/mudavym/motion')>();
  return { ...actual, animate: vi.fn(actual.animate) };
});

import { Panel, Popover } from './Sheet';
import { animate } from '../../lib/mudavym/motion';

function setReduced(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function Anchored({ shape }: { shape: 'popover' | 'panel' }) {
  const ref = useRef<HTMLButtonElement>(null);
  const Cmp = shape === 'popover' ? Popover : Panel;
  return (
    <>
      <button ref={ref} type="button">
        bell
      </button>
      <Cmp open onClose={() => {}} label="Notifications" anchorRef={ref} width={300}>
        <p>body</p>
      </Cmp>
    </>
  );
}

beforeEach(() => {
  setReduced(false);
  vi.mocked(animate).mockClear();
  // The trigger sits 900 px across a 1200 px window, 40 px wide, 20 px from the top.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 900, y: 0, left: 900, right: 940, top: 0, bottom: 20, width: 40, height: 20, toJSON: () => ({}),
  } as DOMRect);
  Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
});

describe('popover arrow', () => {
  it('is centred on the trigger, 8 px, and the panel scales out of that point', () => {
    render(<Anchored shape="popover" />);
    const arrow = document.querySelector('.mdv-ovl__arrow') as HTMLElement;
    expect(arrow).toBeTruthy();
    // left = trigger right (940) - width 300 = 640; centre at 920 -> ax 280; arrow left = 640 + 280 - 4
    expect(arrow.style.left).toBe('916px');
    expect(arrow.style.top).toBe('26px');
    expect(arrow.getAttribute('aria-hidden')).toBe('true');
    expect((screen.getByRole('dialog') as HTMLElement).style.transformOrigin).toBe('280px 0');
  });

  it('enters from 0.96, and not at all under reduced motion', () => {
    render(<Anchored shape="popover" />);
    const frames = vi.mocked(animate).mock.calls.at(-1)?.[1] as Keyframe[];
    expect(String(frames[0].transform)).toContain('scale(0.96)');
    expect(frames[1].transform).toBe('none');
  });

  it('draws no animation under reduced motion', () => {
    setReduced(true);
    render(<Anchored shape="popover" />);
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector('.mdv-ovl__arrow')?.getAttribute('data-motion')).toBe('none');
    const css = readFileSync(join(__dirname, 'sheet.css'), 'utf8');
    expect(css).toMatch(/\.mdv-ovl__arrow\[data-motion='none'\]\s*\{\s*animation: none/);
  });

  it('is only a popover thing', () => {
    render(<Anchored shape="panel" />);
    expect(document.querySelector('.mdv-ovl__arrow')).toBeNull();
  });
});
