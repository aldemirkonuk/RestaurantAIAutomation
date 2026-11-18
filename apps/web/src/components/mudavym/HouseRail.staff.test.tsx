/**
 * Staff open the rooms list to the seven rooms a shift uses; the other rooms
 * sit behind one "More rooms" row. Nothing is removed: owner and manager see the
 * five groups as before, and a staff member standing in a folded room sees it
 * open (design need N-11, the staff nav).
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RoomsList } from './HouseRail';
import { staffRooms, visibleGroups } from '../../lib/mudavym/rooms';

const FLAGS = { connections: false };

function mount(role: 'owner' | 'manager' | 'staff', path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RoomsList role={role} flags={FLAGS} />
    </MemoryRouter>,
  );
}

describe('staff rooms list', () => {
  it('names the seven daily rooms outside the fold, in the rail order', () => {
    const { daily } = staffRooms(visibleGroups('staff', FLAGS));
    expect(daily.map((r) => r.name)).toEqual([
      'Dashboard',
      'Notifications',
      'Calendar',
      'Orders',
      'Receiving',
      'Inventory',
      'Team',
    ]);
  });

  it('shows staff the daily rooms and folds the rest behind one row', () => {
    mount('staff');
    const more = screen.getByText('More rooms').closest('details') as HTMLDetailsElement;
    expect(more.open).toBe(false);
    expect(within(more).getByText('Reports')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Receiving' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy();
  });

  it('loses no room: daily plus folded equals what staff may enter', () => {
    const groups = visibleGroups('staff', FLAGS);
    const { daily, rest } = staffRooms(groups);
    const all = groups.flatMap((g) => g.rooms.map((r) => r.path)).sort();
    const split = [...daily.map((r) => r.path), ...rest.flatMap((g) => g.rooms.map((r) => r.path))].sort();
    expect(split).toEqual(all);
  });

  it('opens the fold when staff stand in a folded room', () => {
    mount('staff', '/reports');
    const more = screen.getByText('More rooms').closest('details') as HTMLDetailsElement;
    expect(more.open).toBe(true);
  });

  it('leaves owner and manager with the five named groups and no fold', () => {
    for (const role of ['owner', 'manager'] as const) {
      const { unmount } = mount(role);
      expect(screen.queryByText('More rooms')).toBeNull();
      expect(screen.getByText('The books')).toBeTruthy();
      unmount();
    }
  });
});
