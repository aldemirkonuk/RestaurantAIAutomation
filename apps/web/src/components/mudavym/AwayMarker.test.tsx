/**
 * The Away marker (ADR 0218): a quiet mark on a name, the date the person is
 * back, and one sentence on what Away does — and nothing at all when the
 * person is not away.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { AwayMarker } from './AwayMarker';
import { awayExplanation, awayState } from './awayWords';
import { splitByMyAreas } from '../../services/api/areas';

const W = { from: '2026-09-21', until: '2026-09-28' };

describe('awayState', () => {
  it('is now inside the window, soon before it, none after it or without one', () => {
    expect(awayState(W, '2026-09-21')).toBe('now');
    expect(awayState(W, '2026-09-28')).toBe('now');
    expect(awayState(W, '2026-09-20')).toBe('soon');
    expect(awayState(W, '2026-09-29')).toBe('none');
    expect(awayState(null, '2026-09-21')).toBe('none');
  });
});

describe('AwayMarker', () => {
  it('draws the name alone, unchanged, when the person is not away', () => {
    const { container } = render(<AwayMarker name="Ayşe" window={null} today="2026-09-21" />);
    expect(container.textContent).toBe('Ayşe');
    expect(container.querySelector('.mdv-away')).toBeNull();
  });

  it('dims the name — never strikes it — and says when they are back', () => {
    const { container } = render(
      <AwayMarker name="Ayşe" personLabel="Ayşe" window={W} today="2026-09-22" locale="en-GB" />,
    );
    const mark = container.querySelector('.mdv-away');
    expect(mark?.getAttribute('data-away')).toBe('now');
    expect(screen.getByRole('button', { name: /^Away until 28 Sept?$/ })).toBeTruthy();
    expect(container.querySelector('s, del')).toBeNull();
  });

  it('opens one sentence on tap, dates only, and closes it again', () => {
    render(<AwayMarker name="Ayşe" personLabel="Ayşe" window={W} today="2026-09-22" locale="en-GB" />);
    const note = screen.getByRole('button', { name: /^Away until 28 Sept?$/ });
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(note);
    expect(note.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('note').textContent).toBe(
      awayExplanation(W, { personLabel: 'Ayşe', locale: 'en-GB' }),
    );
    expect(screen.getByRole('note').textContent).toMatch(/^Away 21 Sept? to 28 Sept?\. Most alerts skip Ayşe/);
    fireEvent.click(note);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('marks an upcoming window without dimming the name', () => {
    const { container } = render(
      <AwayMarker name="Ayşe" window={W} today="2026-09-19" locale="en-GB" />,
    );
    expect(container.querySelector('.mdv-away')?.getAttribute('data-away')).toBe('soon');
    expect(screen.getByRole('button', { name: /^Away from 21 Sept?$/ })).toBeTruthy();
  });

  it('draws no button when it sits inside a control that is itself a button', () => {
    const { container } = render(
      <AwayMarker name="Ayşe" window={W} today="2026-09-22" locale="en-GB" interactive={false} />,
    );
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toMatch(/Away until 28 Sept?/);
  });

  it('speaks to the person themselves as "you"', () => {
    expect(awayExplanation(W, { self: true, locale: 'en-GB' })).toMatch(/skip you on these days; your area/);
    expect(awayExplanation(W, { self: true, locale: 'en-GB' })).toMatch(
      /A note or message sent to you waits until you are back, and your recommendations email pauses\./,
    );
  });

  it('says the lead is alerted with the area, never after it (round-2 answer 2)', () => {
    const words = awayExplanation(W, { personLabel: 'Ayşe', locale: 'en-GB' });
    expect(words).toMatch(/rest of the area, its lead included, then the owners and managers/);
    expect(words).not.toMatch(/then its lead/);
    expect(words).toMatch(/sent to them waits until they are back, and their recommendations email pauses/);
    // Dates only: no reason, ever.
    expect(words).not.toMatch(/because|reason|sick|holiday/i);
  });
});

describe('splitByMyAreas — focus, not filter', () => {
  const items = [
    { id: 1, area: 'kitchen' as const },
    { id: 2, area: null },
    { id: 3, area: 'bar' as const },
  ];
  it('puts a staff member’s areas first and keeps the rest of the house below', () => {
    const { yours, rest } = splitByMyAreas(items, (i) => i.area, { role: 'staff', areas: ['bar'] });
    expect(yours.map((i) => i.id)).toEqual([3]);
    expect(rest.map((i) => i.id)).toEqual([1, 2]);
  });
  it('changes nothing for owners, managers, or a person in no area', () => {
    for (const viewer of [
      { role: 'owner' as const, areas: ['bar' as const] },
      { role: 'manager' as const, areas: ['bar' as const] },
      { role: 'staff' as const, areas: [] },
    ]) {
      const { yours, rest } = splitByMyAreas(items, (i) => i.area, viewer);
      expect(yours).toEqual([]);
      expect(rest.map((i) => i.id)).toEqual([1, 2, 3]);
    }
  });
});
