import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SwipeToConfirm } from './SwipeToConfirm';

/**
 * r102 motion-1: the swipe-up confirm animates compositor properties only.
 * The fill is a scaleY layer (not a height) and the handle a translateY (not
 * a bottom), so a drag frame never triggers layout; the tuck rides transform.
 */
function setup() {
  const onConfirm = vi.fn();
  render(<SwipeToConfirm label="Swipe up to confirm" assertion="Confirms the invoice." onConfirm={onConfirm} />);
  const handle = screen.getByRole('button', { name: /Swipe up to confirm/ });
  (handle as any).setPointerCapture = () => {};
  return { handle, fill: screen.getByTestId('swipe-fill'), onConfirm };
}

describe('SwipeToConfirm moves on transform, not layout', () => {
  it('drags: the fill scales from its bottom and the handle translates, 1:1 with the finger', () => {
    const { handle, fill } = setup();
    fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 152, pointerId: 1 }); // half of the 96px travel
    expect(fill.style.transform).toBe('scaleY(0.5)');
    expect(fill.style.transformOrigin).toBe('bottom');
    expect(fill.style.height).toBe('100%');
    expect(handle.style.bottom).toBe('0px');
    expect(handle.style.transform).toContain('translateY(-48px)');
  });

  it('an early release tucks back on a transform transition', () => {
    const { handle, fill } = setup();
    fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 170, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(fill.style.transform).toBe('scaleY(0)');
    expect(fill.style.transition).toContain('transform');
    expect(handle.style.transition).toContain('transform');
    expect(handle.style.transition).not.toContain('bottom');
  });

  it('completing snaps the handle to the top of the travel with no transition, and confirms once', () => {
    const { handle, fill, onConfirm } = setup();
    fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 100, pointerId: 1 });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(fill.style.transform).toBe('scaleY(1)');
    expect(handle.style.transform).toContain('translateY(-96px)');
    expect(handle.style.transition).toBe('none');
  });
});
