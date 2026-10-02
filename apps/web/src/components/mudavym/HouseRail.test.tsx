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
const link = (name: string) => screen.getByRole('link', { name });

/**
 * A keyboard landing, as jsdom can draw one. Measured 2026-10-01 under jsdom
 * 29.1.1, whose `:focus-visible` comes from @asamuzakjp/dom-selector 7.1.1.
 * That engine judges it from the last key or mouse event it saw on the window,
 * read inside the link's own onFocus:
 * - `fireEvent.focus` never matches, because `document.activeElement` does not move;
 * - a bare `el.focus()` matches only while no key or mouse event has been
 *   seen yet, so it passes or fails by test order;
 * - two `userEvent.tab()` presses onto a fresh link did not match (not pursued);
 * - a Tab keydown on <body>, then `el.focus()`, matches whatever came
 *   before. That is the recipe used here;
 * - a mousedown on the link, then `el.focus()`, never matches. That is
 *   the mouse half (`pointerFocuses`).
 * One trap: once anything computes the link's style, its `:focus-visible`
 * stays false for the rest of the test. `getByRole` does this for every
 * link it filters, and so does `toHaveAccessibleDescription`. So these tests
 * find the link by its text (`textLink`).
 */
function keyboardLands(el: HTMLElement) {
  fireEvent.keyDown(document.body, { key: 'Tab' });
  act(() => el.focus());
}

/** A room link found without computing any style on it (see `keyboardLands`). */
const textLink = (name: string) => screen.getByText(name, { selector: 'a' });

/** A mouse press focusing the link. */
function pointerFocuses(el: HTMLElement) {
  fireEvent.mouseDown(el);
  act(() => el.focus());
}

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
    expect(hint()).toHaveTextContent('Check deliveries in at the door, and decide on the short ones.');
    fireEvent.mouseLeave(link);
    expect(hint()).toBeNull();

    fireEvent.mouseEnter(link);
    act(() => vi.advanceTimersByTime(320));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(hint()).toBeNull();
  });

  it('waits the whole delay: absent at 300 ms, there at 320 ms', () => {
    renderRail();
    fireEvent.mouseEnter(link('Calendar'));
    act(() => vi.advanceTimersByTime(300));
    expect(hint()).toBeNull();
    act(() => vi.advanceTimersByTime(20));
    expect(hint()).toHaveTextContent('Deliveries, tastings and meetings, by day.');
  });

  it('closes on a scroll, whether the page scrolls or the rail', () => {
    renderRail();
    const calendar = link('Calendar');
    fireEvent.mouseEnter(calendar);
    act(() => vi.advanceTimersByTime(320));
    expect(hint()).not.toBeNull();
    fireEvent.scroll(window);
    expect(hint()).toBeNull();

    // A scroll inside the rail does not bubble, so the listener has to catch
    // it on the way down.
    fireEvent.mouseLeave(calendar);
    fireEvent.mouseEnter(calendar);
    act(() => vi.advanceTimersByTime(320));
    expect(hint()).not.toBeNull();
    fireEvent.scroll(calendar.closest('ul')!);
    expect(hint()).toBeNull();
  });

  it('shows at once when the keyboard lands, and leaves with the focus', () => {
    renderRail();
    const team = textLink('Team');
    keyboardLands(team);
    // No timer has run: a keyboard landing is never made to wait.
    expect(hint()).toHaveTextContent('Who works here, their roles and their hours.');
    act(() => team.blur());
    expect(hint()).toBeNull();
  });

  it('does not open for the focus a mouse press gives', () => {
    renderRail();
    pointerFocuses(textLink('Team'));
    act(() => vi.advanceTimersByTime(500));
    expect(hint()).toBeNull();
  });

  it('closes when the room is clicked, and stays closed', () => {
    renderRail();
    const reports = link('Reports');
    fireEvent.mouseEnter(reports);
    act(() => vi.advanceTimersByTime(320));
    expect(hint()).not.toBeNull();
    fireEvent.click(reports);
    expect(hint()).toBeNull();
    act(() => vi.advanceTimersByTime(500));
    expect(hint()).toBeNull();
  });

  it('is hidden from assistive tech, since the link already carries the line', () => {
    renderRail();
    fireEvent.mouseEnter(link('Dashboard'));
    act(() => vi.advanceTimersByTime(320));
    expect(hint()).toHaveAttribute('aria-hidden', 'true');
  });

  it("keeps the keyboard's hint when the pointer leaves another room", () => {
    renderRail();
    keyboardLands(textLink('Receiving'));
    const vendors = textLink('Vendors');
    const receivingLine = 'Check deliveries in at the door, and decide on the short ones.';
    expect(hint()).toHaveTextContent(receivingLine);

    // The pointer only passes through Vendors: Receiving's hint never moves.
    fireEvent.mouseEnter(vendors);
    act(() => vi.advanceTimersByTime(150));
    fireEvent.mouseLeave(vendors);
    expect(hint()).toHaveTextContent(receivingLine);

    // The pointer rests on Vendors long enough to take the hint, then leaves.
    // The keyboard still holds Receiving, so its hint comes back.
    fireEvent.mouseEnter(vendors);
    act(() => vi.advanceTimersByTime(320));
    expect(hint()).toHaveTextContent('The people you buy from, and how to reach them.');
    fireEvent.mouseLeave(vendors);
    expect(hint()).toHaveTextContent(receivingLine);
  });

  it('stays dismissed: Escape cancels a pending hint, and leaving a room brings nothing back', () => {
    renderRail();
    keyboardLands(textLink('Receiving'));
    const vendors = textLink('Vendors');
    fireEvent.mouseEnter(vendors); // Vendors' hint is on its delay
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(hint()).toBeNull();
    act(() => vi.advanceTimersByTime(500));
    expect(hint()).toBeNull(); // the pending one went too
    fireEvent.mouseLeave(vendors);
    expect(hint()).toBeNull(); // the keyboard still holds Receiving, but it was dismissed
  });

  it("keeps the pointer's hint waiting out its delay when the keyboard leaves first", () => {
    renderRail();
    const receiving = textLink('Receiving');
    keyboardLands(receiving);
    fireEvent.mouseEnter(textLink('Vendors')); // Vendors' hint is on its delay
    act(() => vi.advanceTimersByTime(100));
    act(() => receiving.blur());
    expect(hint()).toBeNull(); // not drawn early because the keyboard let go
    act(() => vi.advanceTimersByTime(220));
    expect(hint()).toHaveTextContent('The people you buy from, and how to reach them.');
  });

  it('goes with a room that leaves the rail under the pointer', () => {
    const rail = (connections: boolean) => (
      <MemoryRouter initialEntries={['/orders']}>
        <RoomsList role="owner" flags={{ connections }} />
      </MemoryRouter>
    );
    const { rerender } = render(rail(true));

    // The hint is showing when the room goes.
    fireEvent.mouseEnter(textLink('Connections'));
    act(() => vi.advanceTimersByTime(320));
    expect(hint()).toHaveTextContent('The till, payments, mail and other services that act here.');
    rerender(rail(false));
    expect(screen.queryByText('Connections', { selector: 'a' })).toBeNull();
    expect(hint()).toBeNull();

    // The hint is still on its delay when the room goes.
    rerender(rail(true));
    fireEvent.mouseEnter(textLink('Connections'));
    act(() => vi.advanceTimersByTime(150));
    rerender(rail(false));
    act(() => vi.advanceTimersByTime(500));
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
      'Guides, questions people ask, and how to reach a person.',
    );
  });
});
