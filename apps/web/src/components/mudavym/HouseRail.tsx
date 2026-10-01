/**
 * The rooms rail — a quiet rail of words (sketch 119 D, in sketch 106 A's
 * grammar): *Ask Mudavym.* first, the five groups, then Settings, Connections,
 * The desk and Help in the foot. Tucks to a strip on ⌘\ (the person's choice,
 * remembered with the counter's).
 *
 * It reads the ONE rooms table (`lib/mudavym/rooms.ts`) — the phone's Rooms
 * sheet reads the same one, so the two can never list different rooms.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { openAskAi } from '../askai/events';
import {
  isCurrentRoom,
  visibleFoot,
  visibleGroups,
  type Room,
  type RoomFlags,
  type ShellRole,
} from '../../lib/mudavym/rooms';

/**
 * The room's one-line description, beside the rail (founder, 2026-10-01: the
 * legacy sidebar's hover hints were lost in the rebuild — "when cursor comes on
 * /dashboard -> it appears and says overall look in one glance").
 *
 * Portalled to <body> with fixed positioning because `.mdv-rail__scroll`
 * scrolls, which clips anything drawn outside it — the legacy NavTooltip's
 * reason too. It carries `.mudavym` itself to have the tokens at all.
 *
 * aria-hidden: each link already carries the same words as its accessible
 * description, so announcing the hint as well would say it twice.
 */
interface RoomHintState {
  name: string;
  description: string;
  /** Viewport coords of the rail's right edge and the link's vertical centre. */
  x: number;
  y: number;
}

const HINT_HALF_HEIGHT = 30;
/** Long enough that the hint doesn't strobe while the pointer travels down the rail. */
const HINT_DELAY_MS = 320;

function RoomHint({ name, description, x, y }: RoomHintState) {
  const top = Math.min(Math.max(y, HINT_HALF_HEIGHT + 8), window.innerHeight - HINT_HALF_HEIGHT - 8);
  return createPortal(
    <div aria-hidden className="mudavym mdv-railhint" data-testid="room-hint" style={{ top, left: x + 8 }}>
      <p className="mdv-railhint__name">{name}</p>
      <p className="mdv-railhint__desc">{description}</p>
    </div>,
    document.body,
  );
}

function useRoomHint() {
  const [hint, setHint] = useState<RoomHintState | null>(null);
  const timer = useRef<number | null>(null);
  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const close = () => {
    clearTimer();
    setHint(null);
  };
  /** A pointer rests (after a short delay) or the keyboard lands (at once). */
  const open = (anchor: HTMLElement, room: Room, immediate: boolean) => {
    clearTimer();
    const show = () => {
      const rect = anchor.getBoundingClientRect();
      // Beside the rail, not over its edge: the link stops short of the rail's
      // own padding, so measure from the rail when there is one.
      const edge = anchor.closest('.mdv-rail')?.getBoundingClientRect().right ?? rect.right;
      setHint({ name: room.name, description: room.description, x: edge, y: rect.top + rect.height / 2 });
    };
    if (immediate) show();
    else timer.current = window.setTimeout(show, HINT_DELAY_MS);
  };
  // Dismissable without moving (WCAG 1.4.13), and never left floating beside a
  // row that scrolled away under it. The timer ref is stable, so the cleanup
  // reads it directly rather than closing over a per-render helper.
  const shown = hint !== null;
  useEffect(() => {
    if (!shown) return;
    const dismiss = () => setHint(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [shown]);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return { hint, open, close };
}

/** A touch screen has no hover; a tap there fires mouseenter too, so it is refused here. */
function canHover(): boolean {
  return !window.matchMedia?.('(hover: none)').matches;
}

export interface RoomsListProps {
  role: ShellRole;
  flags: RoomFlags;
  onNavigate?: () => void;
}

interface RoomLinkProps {
  room: Room;
  here: boolean;
  descId: string;
  onNavigate?: () => void;
  onRest: (anchor: HTMLElement, room: Room, immediate: boolean) => void;
  onLeave: () => void;
}

function RoomLink({ room, here, descId, onNavigate, onRest, onLeave }: RoomLinkProps) {
  return (
    <li>
      <Link
        to={room.path}
        className="mdv-rail__room"
        aria-current={here ? 'page' : undefined}
        aria-describedby={descId}
        onClick={() => {
          onLeave();
          onNavigate?.();
        }}
        onMouseEnter={(e) => {
          if (canHover()) onRest(e.currentTarget, room, false);
        }}
        onMouseLeave={onLeave}
        onFocus={(e) => {
          // A mouse click focuses the link too; only a keyboard landing opens it.
          if (e.currentTarget.matches(':focus-visible')) onRest(e.currentTarget, room, true);
        }}
        onBlur={onLeave}
      >
        {room.name}
      </Link>
      <span id={descId} hidden>
        {room.description}
      </span>
    </li>
  );
}

/** The rooms as a list — the rail's body and the phone sheet's. */
export function RoomsList({ role, flags, onNavigate }: RoomsListProps) {
  const { pathname } = useLocation();
  const groups = visibleGroups(role, flags);
  const foot = visibleFoot(role, flags);
  // The rail and the phone sheet can both be mounted; ids stay unique per list.
  const uid = useId();
  const { hint, open, close } = useRoomHint();
  const link = (r: Room) => (
    <RoomLink
      key={r.path}
      room={r}
      here={isCurrentRoom(pathname, r)}
      descId={`${uid}-desc-${r.path}`}
      onNavigate={onNavigate}
      onRest={open}
      onLeave={close}
    />
  );
  return (
    <>
      {groups.map((g) => (
        <div key={g.name} className="mdv-rail__group">
          <span className="mdv-rail__sect">{g.name}</span>
          <ul>{g.rooms.map(link)}</ul>
        </div>
      ))}
      <ul className="mdv-rail__foot">{foot.map(link)}</ul>
      {hint && <RoomHint {...hint} />}
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
