/**
 * The rail's room hints — the one line beside a room when the pointer rests on
 * it or the keyboard lands on it (founder, 2026-10-01).
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomsList } from './HouseRail';

function renderRail() {
  return render(
    <MemoryRouter initialEntries={['/orders']}>
      <RoomsList role="owner" flags={{ connections: true }} />
    </MemoryRouter>,
  );
}

const hint = () => screen.queryByTestId('room-hint');

describe('the room hint', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('appears after the pointer rests on Dashboard, in the founder\'s words', () => {
    renderRail();
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Dashboard' }));
    expect(hint()).toBeNull(); // not while the pointer is only passing
    act(() => vi.advanceTimersByTime(320));
    expect(hint()).toHaveTextContent('Dashboard');
    expect(hint()).toHaveTextContent('The overall look, in one glance.');
  });

  it('never appears for a pointer that only passes through', () => {
    renderRail();
    const link = screen.getByRole('link', { name: 'Orders' });
    fireEvent.mouseEnter(link);
    act(() => vi.advanceTimersByTime(150));
    fireEvent.mouseLeave(link);
    act(() => vi.advanceTimersByTime(500));
    expect(hint()).toBeNull();
  });

  it('leaves when the pointer leaves, and on Escape', () => {
    renderRail();
    const link = screen.getByRole('link', { name: 'Receiving' });
    fireEvent.mouseEnter(link);
    act(() => vi.advanceTimersByTime(320));
    expect(hint()).toHaveTextContent('Check a delivery in at the door.');
    fireEvent.mouseLeave(link);
    expect(hint()).toBeNull();

    fireEvent.mouseEnter(link);
    act(() => vi.advanceTimersByTime(320));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(hint()).toBeNull();
  });

  it('is not drawn on a touch screen, where a tap fires mouseenter too', () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ ...mm(q), matches: q === '(hover: none)' })) as typeof window.matchMedia;
    try {
      renderRail();
      fireEvent.mouseEnter(screen.getByRole('link', { name: 'Dashboard' }));
      act(() => vi.advanceTimersByTime(500));
      expect(hint()).toBeNull();
    } finally {
      window.matchMedia = mm;
    }
  });

  it('gives every link the same line as its accessible description', () => {
    renderRail();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAccessibleDescription(
      'The overall look, in one glance.',
    );
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAccessibleDescription(
      'How things work, and how to turn tips back on.',
    );
  });
});
