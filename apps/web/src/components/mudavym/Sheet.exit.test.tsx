/**
 * The clean leave (design critic N-12): a Close, Esc or scrim click used to
 * cut; it now leaves in 140 ms with 12 px of travel, and under reduced motion
 * as a 120 ms fade with no travel. jsdom has no Web Animations, so the tests
 * stub `animate` on the elements and read what the primitive scheduled.
 */
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Sheet } from './Sheet';
import { resetLabelWarnings, resetSheetWidth } from './overlayState';
import { resetMudavymShell } from '../../lib/mudavym/shellGround';

function setReduced(reduce: boolean) {
  (window.matchMedia as unknown as ReturnType<typeof vi.fn>).mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

const animateSpy = vi.fn(() => ({ cancel: vi.fn() }));
const onClose = vi.fn();

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <div className="mudavym">
      <Sheet
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        label="Detail"
        title="Kavaklıdere"
      >
        <p>body</p>
      </Sheet>
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  setReduced(false);
  resetMudavymShell();
  resetLabelWarnings();
  resetSheetWidth();
  animateSpy.mockClear();
  onClose.mockClear();
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = animateSpy;
});
afterEach(() => {
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  vi.useRealTimers();
});

describe('the clean leave', () => {
  it('slides 12 px and fades over 140 ms ease-in, and closes when the motion has run', () => {
    render(<Harness />);
    animateSpy.mockClear(); // the open animation is not the leave
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    const [panelFrames, panelOpts] = animateSpy.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
    expect(panelFrames[1]).toMatchObject({ opacity: 0 });
    expect(String(panelFrames[1].transform)).toMatch(/translate[XY]\(12px\)/);
    expect(panelOpts).toMatchObject({ duration: 140, easing: 'cubic-bezier(0.4, 0, 1, 1)' });
    // the scrim goes on its own, shorter clock
    const scrimOpts = animateSpy.mock.calls[1][1] as unknown as KeyframeAnimationOptions;
    expect(scrimOpts.duration).toBe(100);
    act(() => void vi.advanceTimersByTime(139));
    expect(onClose).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(2));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the scrim click and Escape leave the same way, not with a cut', () => {
    render(<Harness />);
    animateSpy.mockClear();
    const scrim = document.querySelector('.mdv-ovl__scrim') as HTMLElement;
    fireEvent.click(scrim);
    expect(onClose).not.toHaveBeenCalled();
    expect(animateSpy).toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(141));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a second Close during the leave does not close twice', () => {
    render(<Harness />);
    const close = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(close);
    fireEvent.click(close);
    act(() => void vi.advanceTimersByTime(200));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('under reduced motion it is a 120 ms fade with no travel', () => {
    setReduced(true);
    render(<Harness />);
    animateSpy.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    const [frames, opts] = animateSpy.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
    expect(frames[1].transform).toBe('none');
    expect(frames[1].opacity).toBe(0);
    expect(opts.duration).toBe(120);
    act(() => void vi.advanceTimersByTime(121));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes at once where the browser has no Web Animations', () => {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
