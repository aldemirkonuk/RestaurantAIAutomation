/**
 * The Mudavym app shell — sketch 119 direction D, "the counter" (the founder's
 * pick of 2026-09-21; ADR 0149 row 5, the shell rebuilt as house chrome).
 *
 *   desktop   the house header · the rooms rail (left) · the page · the counter (right)
 *   phone     the house header · the page · four doors (Counter · Rooms · Search · Ask)
 *
 * GATED, THREE LAYERS (`useMudavymDesign('shell')`, read in DashboardLayout):
 * the browser override `mudavym.design.shell`, then the house flag
 * `mudavym_design_shell` (OFF by default, migration 20260921114300), then
 * false. Off, the legacy `Sidebar` layout renders exactly as it did.
 * [2026-09-25: `shell` is in `LIVE_PAGES` (ADR 0149 row 36's bracket, founder
 * Q2/Q4 of 2026-09-22) — on for every house in code, whatever its row says;
 * the column is no longer read, and "off" is reachable only through the
 * browser override.]
 *
 * WHAT THE SHELL KEEPS FROM THE LEGACY LAYOUT, AND WHAT IT DROPS
 * --------------------------------------------------------------
 * Kept: `CommandProvider` (⌘K, ⌘⇧K), `AskAiSurface` (the ⌘⇧K panel), and the
 * guidance layer (`SetupNudgeBanner`, `PageTipStrip`, `GuidanceLiveRegion`) —
 * the guidance layer is sketch 106's fork 11, a separate call, so it rides
 * along unchanged rather than being decided here.
 * Dropped: the floating "Wine Agent" button (ADR 0149 row 33, ADR 0145 — `/ask`
 * and the ⌘⇧K panel are the two doors) and the legacy mobile top bar (the
 * house header is the only bar).
 *
 * THE BOUNDARY SITS UNDER THE SHELL
 * ---------------------------------
 * A second `ErrorBoundary` wraps the routed page, keyed by the route, so a page
 * that crashes leaves the rooms, the counter, the bell and the search standing;
 * the outer one in App.tsx still guards the shell itself.
 *
 * THE GROUND
 * ----------
 * Every shell region carries `.mudavym` and reads the house tokens only; no
 * ground is hard-coded here (a peer lane makes the ground follow the person,
 * ADR 0169). The page column keeps the legacy layout's own `bg-gray-50`, which
 * is the legacy PAGES' ground, not the shell's — a rebuilt page paints its own
 * `.mudavym` root over it exactly as it does today.
 */

import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AuthContext } from '../../contexts/AuthContext';
import { CommandProvider } from '../command/CommandProvider';
import { AskAiSurface } from '../askai/AskAiSurface';
import { GuidanceProvider } from '../../guidance/GuidanceProvider';
import { PageTipStrip } from '../../guidance/components/PageTipStrip';
import { SetupNudgeBanner } from '../../guidance/components/SetupNudgeBanner';
import { GuidanceLiveRegion } from '../../guidance/announce';
import { ErrorBoundary } from '../ErrorBoundary';
import { HouseErrorScreen } from './HouseErrorScreen';
import { HouseHeader } from './HouseHeader';
import { HouseRail, RoomsList } from './HouseRail';
import { HouseCounter, CounterBody } from './HouseCounter';
import { HouseDoors } from './HouseDoors';
import { CounterActSheet, type CounterActTarget } from './CounterActSheet';
import { Sheet } from './Sheet';
import { HouseShellContext } from './houseShellContext';
import { ShellPaletteContext, counterPaletteRows, roomPaletteRows } from './shellPalette';
import { useMudavymShell } from '../../lib/mudavym/shellGround';
import { useHouseCounter } from '../../lib/mudavym/useHouseCounter';
import { actsWaiting, clockOf } from '../../lib/mudavym/counterRead';
import { bindHouseSaid } from '../../lib/mudavym/houseSaid';
import { roomNameFor } from '../../lib/mudavym/rooms';
import { useShellRoleFlags } from '../../lib/mudavym/shellRoleFlags';
import {
  counterWidthFor,
  readShellPrefs,
  rememberCounterWidth,
  writeShellPrefs,
  type ShellPrefs,
} from '../../lib/mudavym/counterPrefs';
import './sheet.css';
import './house-shell.css';

/** Below this the shell is the phone's: no rail, no column, four doors. */
export const PHONE_BELOW_PX = 768;

/**
 * The phone's shell sheets open at the MID detent (sketch 119 D, F9: "a mid
 * detent … the page visible above it"), and may be lowered to peek. `full`
 * is left out: it would run under the header and over the four doors.
 * Module-level so the Sheet's detent key never changes between renders.
 */
const PHONE_DETENTS = ['peek', 'half'] as const;

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1440 : window.innerWidth;
}

function useViewportWidth(): number {
  const [w, setW] = useState(viewportWidth);
  useEffect(() => {
    const onResize = () => setW(viewportWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

function modKey(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  const p = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  return /mac|iphone|ipad|ipod/i.test(p) ? '⌘' : 'Ctrl ';
}

export function HouseShell({ children }: { children?: ReactNode } = {}) {
  const auth = useContext(AuthContext);
  const { pathname } = useLocation();
  const userId = auth?.user?.userId ?? null;
  const houseId = auth?.activeRestaurantId ?? null;
  // The role IN THIS HOUSE (ADR 0162) and the room-visibility flags — one
  // hook so this and anything mounted inside the outlet (the in-app 404)
  // read identical values.
  const { role, flags } = useShellRoleFlags();
  const counter = useHouseCounter(houseId, Boolean(auth));
  const pageShell = useMudavymShell();
  const vw = useViewportWidth();
  const phone = vw < PHONE_BELOW_PX;
  const [mod] = useState(modKey);

  // "The house said" is one person's sitting in one house: a sign-out and a
  // sign-in on a shared till, or a branch switch, starts it again.
  useEffect(() => {
    bindHouseSaid(userId && houseId ? `${userId}@${houseId}` : null);
  }, [userId, houseId]);

  const [prefs, setPrefs] = useState<ShellPrefs>(() => readShellPrefs(userId));
  useEffect(() => {
    setPrefs(readShellPrefs(userId));
  }, [userId]);

  const width = counterWidthFor(pathname, vw, prefs);

  const toggleCounter = useCallback(() => {
    setPrefs((p) => {
      const next = rememberCounterWidth(p, pathname, width === 'open' ? 'tucked' : 'open');
      writeShellPrefs(userId, next);
      return next;
    });
  }, [pathname, width, userId]);

  const toggleRail = useCallback(() => {
    setPrefs((p) => {
      const next = { ...p, railTucked: !p.railTucked };
      writeShellPrefs(userId, next);
      return next;
    });
  }, [userId]);

  // ⌘\ tucks the rooms (sketch 119 D; the key the rail's own foot names).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        toggleRail();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleRail]);

  const [target, setTarget] = useState<CounterActTarget | null>(null);
  const [phoneCounter, setPhoneCounter] = useState(false);
  const [phoneRooms, setPhoneRooms] = useState(false);

  // A route change closes the phone's sheets — the page they were over is gone.
  useEffect(() => {
    setPhoneRooms(false);
    setPhoneCounter(false);
  }, [pathname]);

  const waiting = counter.last ? actsWaiting(counter.last.registers) : counter.failure ? null : false;

  const openAct = useCallback((t: CounterActTarget) => {
    setPhoneCounter(false);
    setTarget(t);
  }, []);

  const toggle = (
    <button
      type="button"
      className="mdv-hdr__counter"
      onClick={phone ? () => setPhoneCounter((o) => !o) : toggleCounter}
      aria-pressed={phone ? phoneCounter : width === 'open'}
      aria-label={
        waiting === true
          ? 'The counter — acts wait on you'
          : waiting === null
            ? 'The counter — a register was not read'
            : 'The counter'
      }
    >
      <span className="mdv-hdr__countertext">Counter</span>
      {waiting === true && <span className="mdv-hdr__counterdot" aria-hidden />}
      {waiting === null && <span className="mdv-hdr__counterdot mdv-hdr__counterdot--hollow" aria-hidden />}
    </button>
  );

  const headerGround = pageShell.on ? pageShell.ground : undefined;

  // The ⌘K palette's two shell sections (sketch 119 D): the counter first,
  // then the rooms from the same table the rail reads.
  const palette = useMemo(
    () => ({
      counter: counterPaletteRows(counter.last, counter.failure, openAct, counter.readNow),
      rooms: roomPaletteRows(role, flags),
    }),
    [counter.last, counter.failure, counter.readNow, openAct, role, flags],
  );

  return (
    <HouseShellContext.Provider value={true}>
      <ShellPaletteContext.Provider value={palette}>
      <CommandProvider>
        <GuidanceProvider>
          <div
            className="mdv-shell"
            data-phone={phone ? 'true' : undefined}
            data-offline={counter.offline ? 'true' : undefined}
          >
            <HouseHeader shell name={roomNameFor(pathname)} ground={headerGround} trailing={toggle} />
            {counter.offline && (
              // The strip under the header (sketch 119 D, offline). It claims
              // only what the shell itself does: the counter keeps its last
              // read, dated, and reads again when the device is back. What a
              // PAGE does offline is that page's to say.
              <div className="mdv-shell__offline mudavym" role="status">
                Offline.{' '}
                {counter.last
                  ? `The counter shows its read from ${clockOf(counter.last.readAt)}`
                  : 'The counter has not been read'}{' '}
                and reads again when this device is back online.
              </div>
            )}
            <div className="mdv-shell__body">
              {!phone && (
                <HouseRail
                  role={role}
                  flags={flags}
                  tucked={prefs.railTucked}
                  onToggle={toggleRail}
                  mod={mod}
                />
              )}
              <div className="mdv-shell__page bg-gray-50" id="main-content">
                <SetupNudgeBanner />
                <PageTipStrip />
                <GuidanceLiveRegion />
                <main className="mdv-shell__main">
                  <ErrorBoundary key={pathname} fallback={(info) => <HouseErrorScreen {...info} />}>
                    {children ?? <Outlet />}
                  </ErrorBoundary>
                </main>
              </div>
              {!phone && (
                <HouseCounter state={counter} onOpen={openAct} width={width} onToggle={toggleCounter} />
              )}
            </div>
            {phone && (
              <>
                <HouseDoors
                  waiting={waiting}
                  counterOpen={phoneCounter}
                  roomsOpen={phoneRooms}
                  onCounter={() => {
                    setPhoneRooms(false);
                    setPhoneCounter((o) => !o);
                  }}
                  onRooms={() => {
                    setPhoneCounter(false);
                    setPhoneRooms((o) => !o);
                  }}
                />
                <Sheet
                  open={phoneCounter}
                  onClose={() => setPhoneCounter(false)}
                  label="The counter: what waits on you, register by register. Nothing here writes; leaving changes nothing."
                  title="On the counter"
                  closeLabel="Close"
                  className="mdv-shell__phonesheet"
                  detents={PHONE_DETENTS}
                >
                  <div className="mudavym mdv-counter mdv-counter--sheet">
                    <CounterBody state={counter} onOpen={openAct} />
                  </div>
                </Sheet>
                <Sheet
                  open={phoneRooms}
                  onClose={() => setPhoneRooms(false)}
                  label="The rooms of the house. Choosing one leaves this page."
                  eyebrow={role ? `${role} · this house` : 'this house'}
                  title="Rooms"
                  closeLabel="Close"
                  className="mdv-shell__phonesheet"
                  detents={PHONE_DETENTS}
                >
                  <div className="mudavym mdv-rail mdv-rail--sheet">
                    <RoomsList role={role} flags={flags} onNavigate={() => setPhoneRooms(false)} />
                  </div>
                </Sheet>
              </>
            )}
            <CounterActSheet
              target={target}
              read={counter.last}
              onClose={() => setTarget(null)}
              onChanged={counter.readNow}
            />
            {/* Ask Mudavym — opened by ⌘⇧K, which CommandProvider registers, by
                the rail's first row, and by the phone's Ask door. */}
            <AskAiSurface />
          </div>
        </GuidanceProvider>
      </CommandProvider>
      </ShellPaletteContext.Provider>
    </HouseShellContext.Provider>
  );
}

export default HouseShell;
