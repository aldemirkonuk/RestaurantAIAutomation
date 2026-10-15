/**
 * The rooms rail — a quiet rail of words (sketch 119 D, in sketch 106 A's
 * grammar): *Ask Mudavym.* first, the five groups, then Settings, Connections,
 * The desk and Help in the foot. Tucks to a strip on ⌘\ (the person's choice,
 * remembered with the counter's).
 *
 * It reads the ONE rooms table (`lib/mudavym/rooms.ts`) — the phone's Rooms
 * sheet reads the same one, so the two can never list different rooms.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
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

/** A link that wants its hint: where to draw it, and what to say. */
interface HintHolder {
  anchor: HTMLElement;
  room: Room;
}

/** How a link lets go of its hint. */
type Release = 'pointer' | 'focus' | 'gone';

/**
 * Two things can hold a hint: the link the pointer rests on, and the link
 * the keyboard landed on. Each link lets go only of what it holds. A pointer
 * leaving one link never takes away the hint of a link the keyboard still
 * holds; that hint comes back. A link that leaves the page lets go of
 * everything it held, because no mouseleave or blur will ever come from it.
 */
function useRoomHint() {
  const [hint, setHint] = useState<RoomHintState | null>(null);
  /** The link whose hint is drawn now. A ref, so a release can test it without waiting for a render. */
  const drawnFor = useRef<HTMLElement | null>(null);
  const hovered = useRef<HintHolder | null>(null);
  const focused = useRef<HintHolder | null>(null);
  const timer = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const draw = useCallback((holder: HintHolder | null) => {
    drawnFor.current = holder?.anchor ?? null;
    if (!holder) {
      setHint(null);
      return;
    }
    const { anchor, room } = holder;
    const rect = anchor.getBoundingClientRect();
    // Beside the rail, not over its edge: the link stops short of the rail's
    // own padding, so measure from the rail when there is one.
    const edge = anchor.closest('.mdv-rail')?.getBoundingClientRect().right ?? rect.right;
    setHint({ name: room.name, description: room.description, x: edge, y: rect.top + rect.height / 2 });
  }, []);

  /** The pointer rests: the hint follows after a short delay. */
  const rest = useCallback(
    (anchor: HTMLElement, room: Room) => {
      clearTimer();
      hovered.current = { anchor, room };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        draw(hovered.current);
      }, HINT_DELAY_MS);
    },
    [clearTimer, draw],
  );

  /** The keyboard lands: the hint shows at once. */
  const land = useCallback(
    (anchor: HTMLElement, room: Room) => {
      clearTimer();
      focused.current = { anchor, room };
      draw(focused.current);
    },
    [clearTimer, draw],
  );

  const release = useCallback(
    (anchor: HTMLElement, how: Release) => {
      if (how !== 'focus' && hovered.current?.anchor === anchor) {
        hovered.current = null;
        clearTimer();
      }
      if (how !== 'pointer' && focused.current?.anchor === anchor) focused.current = null;
      // Another link's hint, or none at all (dismissed, or never drawn), stays as it is.
      if (drawnFor.current !== anchor) return;
      // Fall back to whatever still holds a hint. The keyboard's holder comes
      // first. The pointer's holder counts only once its delay has run.
      draw(focused.current ?? (timer.current === null ? hovered.current : null));
    },
    [clearTimer, draw],
  );

  /** Escape, a scroll or a click: the hint goes, and nothing brings it back until a link is reached again. */
  const dismiss = useCallback(() => {
    clearTimer();
    draw(null);
  }, [clearTimer, draw]);

  // Dismissable without moving (WCAG 1.4.13), and never left floating beside a
  // row that scrolled away under it.
  const shown = hint !== null;
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [shown, dismiss]);
  // No timer outlives the list: only `rest` starts one, for a link of this
  // list, and that link's 'gone' release clears it when the list unmounts.
  return { hint, rest, land, release, dismiss };
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
  onRest: (anchor: HTMLElement, room: Room) => void;
  onLand: (anchor: HTMLElement, room: Room) => void;
  onRelease: (anchor: HTMLElement, how: Release) => void;
  onDismiss: () => void;
}

function RoomLink({ room, here, descId, onNavigate, onRest, onLand, onRelease, onDismiss }: RoomLinkProps) {
  const ref = useRef<HTMLAnchorElement>(null);
  // A room can leave the rail under a resting pointer (a role or a page flag
  // changes). No mouseleave or blur will come from it, so it lets go here.
  useEffect(() => {
    const anchor = ref.current;
    return () => {
      if (anchor) onRelease(anchor, 'gone');
    };
  }, [onRelease]);
  return (
    <li>
      <Link
        ref={ref}
        to={room.path}
        className="mdv-rail__room"
        aria-current={here ? 'page' : undefined}
        aria-describedby={descId}
        onClick={() => {
          onDismiss();
          onNavigate?.();
        }}
        onMouseEnter={(e) => {
          if (canHover()) onRest(e.currentTarget, room);
        }}
        onMouseLeave={(e) => onRelease(e.currentTarget, 'pointer')}
        onFocus={(e) => {
          // A mouse click focuses the link too; only a keyboard landing opens it.
          if (e.currentTarget.matches(':focus-visible')) onLand(e.currentTarget, room);
        }}
        onBlur={(e) => onRelease(e.currentTarget, 'focus')}
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
  const { hint, rest, land, release, dismiss } = useRoomHint();
  const link = (r: Room) => (
    <RoomLink
      key={r.path}
      room={r}
      here={isCurrentRoom(pathname, r)}
      descId={`${uid}-desc-${r.path}`}
      onNavigate={onNavigate}
      onRest={rest}
      onLand={land}
      onRelease={release}
      onDismiss={dismiss}
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
