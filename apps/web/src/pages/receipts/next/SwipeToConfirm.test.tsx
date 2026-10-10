/**
 * SwipeToConfirm without a thumb (F-345). A screen reader, VoiceOver,
 * TalkBack and voice control press a button with a bare click
 * (`detail === 0`). That press is a two-step confirm, the same one DoorSeal
 * and HoldToApprove take; a thumb or mouse click is never a confirm.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SwipeToConfirm } from './SwipeToConfirm';

const handle = () => screen.getByRole('button', { name: /Swipe up to confirm/ });

const renderSwipe = (props: Partial<React.ComponentProps<typeof SwipeToConfirm>> = {}) => {
  const onConfirm = vi.fn();
  render(
    <SwipeToConfirm
      label="Swipe up to confirm"
      assertion="Confirms the transcription."
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return onConfirm;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('SwipeToConfirm without a pointer', () => {
  it('a screen-reader click arms and mints, and a second one confirms with the seal', async () => {
    const onChallenge = vi.fn(() => Promise.resolve('tok-1'));
    const onConfirm = renderSwipe({ onChallenge });

    fireEvent.click(handle()); // detail 0: no pointer, no key behind it
    expect(onConfirm).not.toHaveBeenCalled();
    // The gesture began here, so the seal is minted before the second press.
    await waitFor(() => expect(onChallenge).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Press again to confirm')).toBeInTheDocument();

    fireEvent.click(handle());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('tok-1'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onChallenge).toHaveBeenCalledTimes(1);
  });

  it('says each step in a live status line the button is described by', () => {
    renderSwipe();
    const id = handle().getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    const status = document.getElementById(id!);
    expect(status).toHaveAttribute('aria-live', 'polite');

    fireEvent.click(handle());
    expect(status).toHaveTextContent('Press again to confirm');
  });

  it('a thumb or mouse click is never a confirm — the pointer has to travel', () => {
    const onConfirm = renderSwipe();

    fireEvent.click(handle(), { detail: 1 });
    fireEvent.click(handle(), { detail: 1 });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByText('Press again to confirm')).not.toBeInTheDocument();
  });

  it('a first press left alone lapses, so a later press arms again', () => {
    vi.useFakeTimers();
    const onConfirm = renderSwipe();

    fireEvent.click(handle());
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText('Press again to confirm')).not.toBeInTheDocument();

    fireEvent.click(handle());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Press again to confirm')).toBeInTheDocument();
  });

  it('a refused seal on the second press confirms nothing, and says so', async () => {
    const onConfirm = renderSwipe({ onChallenge: () => Promise.reject(new Error('refused')) });

    fireEvent.click(handle());
    fireEvent.click(handle());
    await screen.findByRole('alert');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a tapped Space does not arm: the key's own click is not a second path", () => {
    const onConfirm = renderSwipe();

    fireEvent.keyDown(handle(), { key: ' ' });
    fireEvent.keyUp(handle(), { key: ' ' });
    fireEvent.click(handle()); // the click a browser fires for Space's key-up
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByText('Press again to confirm')).not.toBeInTheDocument();
  });
});
