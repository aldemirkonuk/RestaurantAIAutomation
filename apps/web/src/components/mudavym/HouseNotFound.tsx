/**
 * The in-app 404 (sketch 119, "the shared pieces"): for an unknown tail
 * under a path prefix the host already serves — the host's own real 404
 * (ADR 0158, `404.html`) answers a machine reading a path outside the
 * crawlable prefixes at all; this answers a signed-in person who is inside
 * the shell already and typed or followed a dead link within it.
 *
 * Mounted at the `*` route NESTED under `DashboardLayout` (ShellCatchAll),
 * so it renders inside the shell's chrome — the header still names the room
 * closest to where the person is, the rail and the counter stand. It reads
 * the same rooms table the rail does (sketch 119 §"the shared pieces":
 * "the palette drawn open, reading one rooms table with the rail / the
 * rooms popover / the 404"); internal tools are never offered here either.
 */

import { Link, useLocation } from 'react-router-dom';
import { visibleGroups, roomFor, type ShellRole, type RoomFlags } from '../../lib/mudavym/rooms';

export interface HouseNotFoundProps {
  role: ShellRole;
  flags: RoomFlags;
}

export function HouseNotFound({ role, flags }: HouseNotFoundProps) {
  const { pathname } = useLocation();
  const nearest = roomFor(pathname);
  const groups = visibleGroups(role, flags);

  return (
    <div className="mdv-404 mudavym">
      <p className="mdv-404__eyebrow">404 &middot; not found</p>
      <h1 className="mdv-404__headline">There is no page at {pathname}.</h1>
      <p className="mdv-404__body">
        {nearest
          ? `${nearest.name} is the nearest room this path stands in, but nothing here answers for it.`
          : 'Nothing in the house answers for this path.'}
      </p>
      <div className="mdv-404__links">
        <Link to="/" className="mdv-link mdv-404__home">
          Back to Dashboard
        </Link>
        {nearest && nearest.path !== '/' && (
          <Link to={nearest.path} className="mdv-link">
            Go to {nearest.name}
          </Link>
        )}
      </div>
      <nav aria-label="Rooms of the house" className="mdv-404__rooms">
        {groups.map((g) => (
          <div key={g.name} className="mdv-404__group">
            <span className="mdv-404__groupname">{g.name}</span>
            <ul>
              {g.rooms.map((r) => (
                <li key={r.path}>
                  <Link to={r.path}>{r.name}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}

export default HouseNotFound;
