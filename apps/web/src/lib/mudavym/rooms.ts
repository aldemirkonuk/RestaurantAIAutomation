/**
 * The one rooms table — what the rail lists, what the phone's Rooms sheet
 * lists, and what the shell's header names the page by (sketch 119 D; the
 * grammar is sketch 106 A's: words only, grouped by where the work happens).
 *
 * WHAT IS NOT IN IT, ON PURPOSE
 * -----------------------------
 * The internal tools — `/studio`, `/simpos`, `/dev/truth`, `/dev-sandbox` —
 * never appear in the rooms (the founder's standing rule; App.tsx routes them
 * outside or beside the product). `INTERNAL_PATHS` names them so a test can
 * prove the table never grows one.
 *
 * WHO SEES A ROOM
 * ---------------
 * Hiding a row is not the boundary; the gateway is. So a room is hidden only
 * where the gateway refuses the person anyway (Vendor prices is owner/manager
 * at `vendor-intel.controller.ts`), or where the route itself is role-gated
 * (The desk, `/admin`, owner — App.tsx `ProtectedRoute requiredRole="owner"`),
 * or where the route does not exist for this house (Connections with its flag
 * off redirects to /profile, so a visible link would lead somewhere else —
 * the legacy Sidebar's rule).
 */

export type ShellRole = 'owner' | 'manager' | 'staff' | null;

export interface Room {
  name: string;
  path: string;
  /** Hidden below this role. `manager` admits owner and manager. */
  minRole?: 'manager' | 'owner';
  /** Shown only while this Mudavym page flag is on (its route redirects otherwise). */
  needsFlag?: 'connections';
}

export interface RoomGroup {
  name: string;
  rooms: Room[];
}

export const ROOM_GROUPS: readonly RoomGroup[] = [
  {
    name: 'The floor',
    rooms: [
      { name: 'Dashboard', path: '/' },
      { name: 'Notifications', path: '/notifications' },
      { name: 'Calendar', path: '/calendar' },
      { name: 'Recommendations', path: '/recommendations' },
    ],
  },
  {
    name: 'The door',
    rooms: [
      { name: 'Orders', path: '/orders' },
      { name: 'Receiving', path: '/receiving' },
      { name: 'Vendors', path: '/vendors' },
      { name: 'Promotions', path: '/promotions' },
      // The gateway refuses staff every /vendor-intel read (owner/manager).
      { name: 'Vendor prices', path: '/vendor-prices', minRole: 'manager' },
    ],
  },
  {
    name: 'The cellar',
    rooms: [
      { name: 'Inventory', path: '/inventory' },
      { name: 'Cellar', path: '/cellar' },
    ],
  },
  {
    name: 'The books',
    rooms: [
      { name: 'Receipts & Credits', path: '/receipts' },
      { name: 'Documents & Reports', path: '/documents-reports' },
      { name: 'Reports', path: '/reports' },
      { name: 'Logs', path: '/logs' },
    ],
  },
  {
    name: 'The people',
    rooms: [
      { name: 'Team', path: '/team' },
      { name: 'Communications', path: '/communications' },
    ],
  },
];

export const ROOM_FOOT: readonly Room[] = [
  { name: 'Settings', path: '/settings' },
  { name: 'Connections', path: '/connections', minRole: 'manager', needsFlag: 'connections' },
  { name: 'The desk', path: '/admin', minRole: 'owner' },
  { name: 'Help', path: '/help' },
];

/** Never a room. A test asserts none of these reaches the table. */
export const INTERNAL_PATHS: readonly string[] = ['/studio', '/simpos', '/dev/truth', '/dev-sandbox'];

/**
 * Names for routes that are not rooms but are pages a person stands on — the
 * cellar's registers (`pageNames.ts` CELLAR_BY_PATH, the titles the page
 * itself prints), the account's own page, and one record.
 */
const OTHER_NAMES: ReadonlyArray<[string, string]> = [
  ['/wines', 'Wines'],
  ['/beer', 'Beer'],
  ['/whiskey', 'Whiskey'],
  ['/cocktails', 'Cocktails'],
  ['/spirits', 'Spirits'],
  ['/non-alcoholic', 'Non-alcoholic'],
  ['/soft-drinks', 'Soft drinks'],
  ['/profile', 'Profile'],
];

/** One incoming document (`/documents/:id`, ADR 0104 D12) — a record, not a room. */
const DOCUMENT_RECORD = /^\/documents\/[^/]+/;

function roleAllows(role: ShellRole, min: Room['minRole']): boolean {
  if (!min) return true;
  if (min === 'owner') return role === 'owner';
  return role === 'owner' || role === 'manager';
}

export interface RoomFlags {
  connections: boolean;
}

export function roomVisible(room: Room, role: ShellRole, flags: RoomFlags): boolean {
  if (room.needsFlag === 'connections' && !flags.connections) return false;
  return roleAllows(role, room.minRole);
}

export function visibleGroups(role: ShellRole, flags: RoomFlags): RoomGroup[] {
  return ROOM_GROUPS.map((g) => ({
    name: g.name,
    rooms: g.rooms.filter((r) => roomVisible(r, role, flags)),
  })).filter((g) => g.rooms.length > 0);
}

export function visibleFoot(role: ShellRole, flags: RoomFlags): Room[] {
  return ROOM_FOOT.filter((r) => roomVisible(r, role, flags));
}

function allRooms(): Room[] {
  return [...ROOM_GROUPS.flatMap((g) => g.rooms), ...ROOM_FOOT];
}

function matches(pathname: string, path: string): boolean {
  if (path === '/') return pathname === '/' || pathname === '';
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** The room the person is standing in, by the longest matching path. */
export function roomFor(pathname: string): Room | null {
  let best: Room | null = null;
  for (const r of allRooms()) {
    if (matches(pathname, r.path) && (!best || r.path.length > best.path.length)) best = r;
  }
  return best;
}

/**
 * The name the shell's header prints. `null` for a route the table does not
 * name — the header then prints nothing rather than title-casing a slug,
 * which would invent copy (pageNames.ts's rule).
 */
export function roomNameFor(pathname: string): string | null {
  const room = roomFor(pathname);
  if (room) return room.name;
  for (const [path, name] of OTHER_NAMES) {
    if (matches(pathname, path)) return name;
  }
  if (DOCUMENT_RECORD.test(pathname)) return 'Document';
  return null;
}

/** Is `path` the room this pathname stands in? (Cellar's registers count as Cellar.) */
export function isCurrentRoom(pathname: string, room: Room): boolean {
  const here = roomFor(pathname);
  if (here) return here.path === room.path;
  if (room.path === '/cellar') {
    return OTHER_NAMES.slice(0, 7).some(([p]) => matches(pathname, p));
  }
  return false;
}
