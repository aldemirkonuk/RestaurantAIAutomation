/**
 * The rooms rail — a quiet rail of words (sketch 119 D, in sketch 106 A's
 * grammar): *Ask Mudavym.* first, the five groups, then Settings, Connections,
 * The desk and Help in the foot. Tucks to a strip on ⌘\ (the person's choice,
 * remembered with the counter's).
 *
 * It reads the ONE rooms table (`lib/mudavym/rooms.ts`) — the phone's Rooms
 * sheet reads the same one, so the two can never list different rooms.
 */

import { Link, useLocation } from 'react-router-dom';
import { openAskAi } from '../askai/events';
import {
  isCurrentRoom,
  visibleFoot,
  visibleGroups,
  type RoomFlags,
  type ShellRole,
} from '../../lib/mudavym/rooms';

export interface RoomsListProps {
  role: ShellRole;
  flags: RoomFlags;
  onNavigate?: () => void;
}

/** The rooms as a list — the rail's body and the phone sheet's. */
export function RoomsList({ role, flags, onNavigate }: RoomsListProps) {
  const { pathname } = useLocation();
  const groups = visibleGroups(role, flags);
  const foot = visibleFoot(role, flags);
  return (
    <>
      {groups.map((g) => (
        <div key={g.name} className="mdv-rail__group">
          <span className="mdv-rail__sect">{g.name}</span>
          <ul>
            {g.rooms.map((r) => {
              const here = isCurrentRoom(pathname, r);
              return (
                <li key={r.path}>
                  <Link
                    to={r.path}
                    className="mdv-rail__room"
                    aria-current={here ? 'page' : undefined}
                    onClick={onNavigate}
                  >
                    {r.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <ul className="mdv-rail__foot">
        {foot.map((r) => (
          <li key={r.path}>
            <Link
              to={r.path}
              className="mdv-rail__room"
              aria-current={isCurrentRoom(pathname, r) ? 'page' : undefined}
              onClick={onNavigate}
            >
              {r.name}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export interface HouseRailProps extends RoomsListProps {
  tucked: boolean;
  onToggle: () => void;
  /** "⌘" on a Mac, "Ctrl" elsewhere. */
  mod: string;
}

export function HouseRail({ role, flags, tucked, onToggle, mod }: HouseRailProps) {
  if (tucked) {
    return (
      <nav className="mdv-rail mudavym mdv-rail--strip" aria-label="The rooms, tucked">
        <button type="button" className="mdv-rail__stripbtn" onClick={onToggle} aria-label="Open the rooms">
          <span>Rooms · {mod}\</span>
        </button>
      </nav>
    );
  }
  return (
    <nav className="mdv-rail mudavym" aria-label="The rooms">
      <button type="button" className="mdv-rail__ask" onClick={() => openAskAi()}>
        Ask Mudavym.
        <kbd className="mdv-kbd">{mod}⇧K</kbd>
      </button>
      <div className="mdv-rail__scroll">
        <RoomsList role={role} flags={flags} />
      </div>
      <button type="button" className="mdv-rail__tuck" onClick={onToggle}>
        Tuck the rooms
        <kbd className="mdv-kbd">{mod}\</kbd>
      </button>
    </nav>
  );
}

export default HouseRail;
