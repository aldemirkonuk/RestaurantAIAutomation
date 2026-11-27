/**
 * The rail's Communications room says how many people wait on the house (DD-r108-44,
 * mail-fix). Only the count's read is mocked; the room table and the Link are real.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomsList } from './HouseRail';

const waiting = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../pages/communications/next/useMailWaiting', () => ({
  SIDEBAR_WAITING_ON: 'the house',
  useMailWaiting: () => waiting.n,
}));

const FLAGS = {} as never;
const draw = () =>
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <RoomsList role="owner" flags={FLAGS} />
    </MemoryRouter>,
  );

describe('the rail count on Communications', () => {
  beforeEach(() => {
    waiting.n = 0;
  });

  it('draws the count and names it for a screen reader', () => {
    waiting.n = 6;
    draw();
    expect(screen.getByRole('link', { name: 'Communications, 6 waiting on the house' })).toBeInTheDocument();
    expect(screen.getByTestId('rail-waiting')).toHaveTextContent('6');
  });

  it('draws no number and keeps the plain name at zero, with the slot still reserved', () => {
    draw();
    expect(screen.getByRole('link', { name: 'Communications' })).toBeInTheDocument();
    expect(screen.getByTestId('rail-waiting')).toHaveTextContent('');
    expect(screen.getByTestId('rail-waiting').className).toContain('mdv-rail__count');
  });
});

describe('the phone Rooms sheet', () => {
  it('carries the same count, because it draws the same list', () => {
    waiting.n = 2;
    render(
      <MemoryRouter initialEntries={['/communications']}>
        <RoomsList role="manager" flags={FLAGS} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Communications, 2 waiting on the house' });
    expect(link.getAttribute('aria-current')).toBe('page');
  });
});
