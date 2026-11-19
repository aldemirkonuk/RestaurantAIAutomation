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
 * the same rooms table the rail does through the palette (sketch 119 §"the
 * shared pieces"), which this page opens from one field instead of listing
 * every room (c3 need 18): one primary, one field.
 */

import { Link, useLocation } from 'react-router-dom';
import { roomFor, type ShellRole, type RoomFlags } from '../../lib/mudavym/rooms';

/** The window event the command palette listens for (CommandProvider). */
const PALETTE_OPEN_EVENT = 'wineops:command-open';

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

export interface HouseNotFoundProps {
  /** Kept for the caller; the palette, not this page, lists the rooms now. */
  role: ShellRole;
  flags: RoomFlags;
}

export function HouseNotFound(_props: HouseNotFoundProps) {
  const { pathname } = useLocation();
  const nearest = roomFor(pathname);
  const primary = nearest && nearest.path !== '/' ? { to: nearest.path, label: `Go to ${nearest.name}` } : { to: '/', label: 'Back to Dashboard' };

  return (
    <div className="mdv-404 mudavym">
      <p className="mdv-404__eyebrow">404 &middot; not found</p>
      <h1 className="mdv-404__headline">That page isn&apos;t in the book.</h1>
      <p className="mdv-404__body">
        {nearest
          ? `${nearest.name} is the nearest room this path stands in, but nothing here answers for it.`
          : 'Nothing in the house answers for this path.'}{' '}
        <code className="mdv-404__path">{pathname}</code>
      </p>
      <Link to={primary.to} className="mdv-404__primary">
        {primary.label}
      </Link>
      <button type="button" className="mdv-404__find" onClick={() => window.dispatchEvent(new Event(PALETTE_OPEN_EVENT))}>
        <span>Find a room or an action</span>
        <kbd className="mdv-404__kbd" aria-hidden="true">
          {isMac() ? '\u2318 K' : 'Ctrl K'}
        </kbd>
      </button>
    </div>
  );
}

export default HouseNotFound;
