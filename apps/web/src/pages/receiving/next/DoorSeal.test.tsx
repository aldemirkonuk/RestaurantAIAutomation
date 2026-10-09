/**
 * DoorSeal without a thumb (F-319). A screen reader, VoiceOver, TalkBack and
 * voice control press a button with a bare click (`detail === 0`), and a
 * keyboard user may hold the key the way the thumb holds. Neither is a
 * one-press seal.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DoorSeal } from './DoorSeal';

const button = () => screen.getByRole('button', { name: 'Hold to seal' });

describe('DoorSeal without a pointer', () => {
  it('a screen-reader click arms, and a second one seals', async () => {
    const onSeal = vi.fn();
    render(<DoorSeal onSeal={onSeal} />);

    fireEvent.click(button()); // detail 0: no pointer, no key behind it
    expect(onSeal).not.toHaveBeenCalled();
    expect(button()).toHaveTextContent('Press again to seal');

    fireEvent.click(button());
    await waitFor(() => expect(onSeal).toHaveBeenCalledTimes(1));
  });

  it('a thumb or mouse click is never a confirm — the pointer has to hold', () => {
    const onSeal = vi.fn();
    render(<DoorSeal onSeal={onSeal} />);

    fireEvent.click(button(), { detail: 1 });
    fireEvent.click(button(), { detail: 1 });
    expect(onSeal).not.toHaveBeenCalled();
    expect(button()).not.toHaveTextContent('Press again to seal');
  });

  it('a screen-reader click on a disabled seal explains itself', () => {
    const onSeal = vi.fn();
    render(<DoorSeal onSeal={onSeal} disabled disabledHint="Count every line first." />);

    fireEvent.click(button());
    fireEvent.click(button());
    expect(onSeal).not.toHaveBeenCalled();
    expect(screen.getByText('Count every line first.')).toBeInTheDocument();
  });

  it('Enter then Enter seals once, and the key click is not counted again', async () => {
    const user = userEvent.setup();
    const onSeal = vi.fn();
    render(<DoorSeal onSeal={onSeal} />);

    button().focus();
    await user.keyboard('{Enter}');
    expect(onSeal).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSeal).toHaveBeenCalledTimes(1));
  });

  it('a tapped Space arms but does not seal', async () => {
    const user = userEvent.setup();
    const onSeal = vi.fn();
    render(<DoorSeal onSeal={onSeal} />);

    button().focus();
    await user.keyboard(' ');
    expect(onSeal).not.toHaveBeenCalled();
    expect(button()).toHaveTextContent('Press again to seal');
  });

  it('holding Space for the hold time seals, and shows how far it has gone', () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
    });
    try {
      const onSeal = vi.fn();
      render(<DoorSeal onSeal={onSeal} holdMs={600} />);
      const meter = screen.getByRole('progressbar');

      button().focus();
      fireEvent.keyDown(button(), { key: ' ', code: 'Space' });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(onSeal).not.toHaveBeenCalled();
      expect(Number(meter.getAttribute('aria-valuenow'))).toBeGreaterThan(0);

      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(onSeal).toHaveBeenCalledTimes(1);
      fireEvent.keyUp(button(), { key: ' ', code: 'Space' });
      expect(onSeal).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('letting go of the key early seals nothing and empties the fill', () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
    });
    try {
      const onSeal = vi.fn();
      render(<DoorSeal onSeal={onSeal} holdMs={600} />);

      button().focus();
      fireEvent.keyDown(button(), { key: ' ', code: 'Space' });
      act(() => {
        vi.advanceTimersByTime(200);
      });
      fireEvent.keyUp(button(), { key: ' ', code: 'Space' });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(onSeal).not.toHaveBeenCalled();
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    } finally {
      vi.useRealTimers();
    }
  });

  it('the button is described by its status line', () => {
    render(<DoorSeal onSeal={vi.fn()} />);
    const id = button().getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)).toHaveAttribute('aria-live', 'polite');
  });
});
