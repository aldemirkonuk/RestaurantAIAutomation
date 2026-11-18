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
import './house-rooms-more.css';
import {
  isCurrentRoom,
  staffRooms,
  visibleFoot,
  visibleGroups,
  type Room,
  type RoomFlags,
  type RoomGroup,
  type ShellRole,
} from '../../lib/mudavym/rooms';

export interface RoomsListProps {
  role: ShellRole;
  flags: RoomFlags;
  onNavigate?: () => void;
}

function RoomLink({ room, pathname, onNavigate }: { room: Room; pathname: string; onNavigate?: () => void }) {
  return (
    <li>
      <Link
        to={room.path}
        className="mdv-rail__room"
        aria-current={isCurrentRoom(pathname, room) ? 'page' : undefined}
        onClick={onNavigate}
      >
        {room.name}
      </Link>
    </li>
  );
}

function Group({ group, pathname, onNavigate }: { group: RoomGroup; pathname: string; onNavigate?: () => void }) {
  return (
    <div className="mdv-rail__group">
      <span className="mdv-rail__sect">{group.name}</span>
      <ul>
        {group.rooms.map((r) => (
          <RoomLink key={r.path} room={r} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </ul>
    </div>
  );
}

/** The rooms as a list — the rail's body and the phone sheet's. Staff get the
 *  seven rooms a shift uses, the rest folded behind "More rooms". */
export function RoomsList({ role, flags, onNavigate }: RoomsListProps) {
  const { pathname } = useLocation();
  const groups = visibleGroups(role, flags);
  const foot = visibleFoot(role, flags);
  const split = role === 'staff' ? staffRooms(groups) : null;
  return (
    <>
      {split ? (
        <>
          <Group group={{ name: 'Your shift', rooms: split.daily }} pathname={pathname} onNavigate={onNavigate} />
          {split.rest.length > 0 && (
            <details
              className="mdv-rail__more"
              open={split.rest.some((g) => g.rooms.some((r) => isCurrentRoom(pathname, r)))}
            >
              <summary className="mdv-rail__sect mdv-rail__more-summary">More rooms</summary>
              {split.rest.map((g) => (
                <Group key={g.name} group={g} pathname={pathname} onNavigate={onNavigate} />
              ))}
            </details>
          )}
        </>
      ) : (
        groups.map((g) => <Group key={g.name} group={g} pathname={pathname} onNavigate={onNavigate} />)
      )}
      <ul className="mdv-rail__foot">
        {foot.map((r) => (
          <RoomLink key={r.path} room={r} pathname={pathname} onNavigate={onNavigate} />
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
