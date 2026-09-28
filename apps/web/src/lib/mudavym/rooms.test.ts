/**
 * The one rooms table.
 */

import { describe, expect, it } from 'vitest';
import {
  INTERNAL_PATHS,
  ROOM_FOOT,
  ROOM_GROUPS,
  isCurrentRoom,
  roomNameFor,
  visibleFoot,
  visibleGroups,
} from './rooms';

const ALL = [...ROOM_GROUPS.flatMap((g) => g.rooms), ...ROOM_FOOT];

describe('the internal tools never appear in the rooms', () => {
  it.each(INTERNAL_PATHS)('%s is in no room', (p) => {
    expect(ALL.some((r) => r.path === p || r.path.startsWith(`${p}/`))).toBe(false);
  });

  it('names the four the founder named', () => {
    expect([...INTERNAL_PATHS].sort()).toEqual(['/dev-sandbox', '/dev/truth', '/simpos', '/studio']);
  });
});

describe('a room is hidden only where the gateway or the route refuses', () => {
  const on = { connections: true };
  const names = (role: 'owner' | 'manager' | 'staff' | null) => [
    ...visibleGroups(role, on).flatMap((g) => g.rooms.map((r) => r.name)),
    ...visibleFoot(role, on).map((r) => r.name),
  ];

  it('an owner sees every room, The desk included', () => {
    expect(names('owner')).toEqual(ALL.map((r) => r.name));
  });

  it('a manager sees all but The desk', () => {
    expect(names('manager')).not.toContain('The desk');
    expect(names('manager')).toContain('Vendor prices');
    expect(names('manager')).toContain('Connections');
  });

  it('staff do not see Vendor prices (the gateway refuses them), Connections or The desk', () => {
    const s = names('staff');
    expect(s).not.toContain('Vendor prices');
    expect(s).not.toContain('Connections');
    expect(s).not.toContain('The desk');
    // Receipts has no gateway refusal behind it, so it is not hidden.
    expect(s).toContain('Receipts & Credits');
  });

  it('Connections is absent while its page flag is off (its route redirects)', () => {
    expect(visibleFoot('owner', { connections: false }).map((r) => r.name)).not.toContain('Connections');
  });
});

describe('the header names the page by its room, or not at all', () => {
  it('names rooms, records and the cellar registers', () => {
    expect(roomNameFor('/')).toBe('Dashboard');
    expect(roomNameFor('/orders')).toBe('Orders');
    expect(roomNameFor('/documents/123')).toBe('Document');
    expect(roomNameFor('/wines')).toBe('Wines');
    expect(roomNameFor('/documents-reports')).toBe('Documents & Reports');
  });

  it('prints nothing for a route the table does not name — never a title-cased slug', () => {
    expect(roomNameFor('/sommelier')).toBeNull();
    expect(roomNameFor('/dev/truth')).toBeNull();
  });

  it("marks the cellar's registers as standing in Cellar", () => {
    const cellar = ALL.find((r) => r.path === '/cellar')!;
    expect(isCurrentRoom('/whiskey', cellar)).toBe(true);
    expect(isCurrentRoom('/orders', cellar)).toBe(false);
  });
});
