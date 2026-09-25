/**
 * The day line — sketch 119 §E, built as a PAGE ELEMENT (the founder's pick
 * of 2026-09-21: D is the shell; E's day line rides on the dashboard and the
 * receiving page as their own first line, not chrome). GATED like the shell
 * (`useMudavymDesign('shell')`) — a page mounts this only under the same
 * gate that renders the rest of the house chrome around it.
 *
 * REDUCED SCOPE, drawn as a row of ticks rather than the sketch's pixel-timed
 * band-with-DOM-measured-labels — see `lib/mudavym/dayRead.ts` and
 * `house-day.types.ts` for the full reasoning (three registers this session;
 * `deliveryExpected`, `shifts` and `market` are not built; the real
 * no-overlap label layout is named by the sketch's own README as its own
 * follow-up, distinct from what a first build costs). What IS built here is
 * every honesty rule the sketch states for whichever surface renders it:
 *
 *   - hours unset → say so IN WORDS, and the ticks still draw;
 *   - offline → "will read on return", and the ticks shown are marked as
 *     from the last read, never as live;
 *   - a register that did not answer is a named failure with "Read again",
 *     never a silently shorter list;
 *   - never "N of 6" for a register this build does not read — "N of 3";
 *   - now is marked among the ticks by the DEVICE's clock (hollow offline),
 *     so what is behind the house and what is still ahead read apart.
 */

import { Link } from 'react-router-dom';
import { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../../contexts/AuthContext';
import { useMudavymDesign } from '../../lib/mudavym/useMudavymDesign';
import { useHouseDay } from '../../lib/mudavym/useHouseDay';
import {
  allTicks,
  dayClockOf,
  dayHead,
  hoursSentence,
  unreadRegisters,
  type HouseDayRead,
} from '../../lib/mudavym/dayRead';
import './day-line.css';

function HoursLine({ read }: { read: HouseDayRead }) {
  const sentence = hoursSentence(read.hours);
  if (sentence) {
    return <p className="mdv-dayline__hours">{sentence}</p>;
  }
  const words = read.hours.windows
    .map((w) => `${dayClockOf(w.startAt, read.house.timezone)}–${dayClockOf(w.endAt, read.house.timezone)}`)
    .join(', ');
  return <p className="mdv-dayline__hours">{read.hours.windows.length ? `Open ${words}` : 'Closed today'}</p>;
}

/**
 * The device's clock, re-read every 30 s. The NOW mark is the device's; the
 * ticks are the house's readings (sketch 119 §E, "Wall clock against
 * readings"), so now keeps moving while offline even though the ticks do not.
 */
function useDeviceNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function DayLineBody({
  read,
  offline,
  now,
  readNow,
}: {
  read: HouseDayRead;
  offline: boolean;
  now: number;
  readNow: () => void;
}) {
  const ticks = allTicks(read.registers);
  const unread = unreadRegisters(read.registers);
  // Where now falls among the ticks: every tick at or before it is behind
  // the house's day, every one after it is still ahead.
  const firstAhead = ticks.findIndex((t) => new Date(t.at).getTime() > now);
  const cut = firstAhead === -1 ? ticks.length : firstAhead;
  const nowClock = dayClockOf(new Date(now).toISOString(), read.house.timezone);

  const tickItem = (t: (typeof ticks)[number]) => (
    <li key={`${t.register}-${t.id}`}>
      {t.href ? (
        <Link to={t.href} className="mdv-dayline__tick">
          <span className="mdv-dayline__tickat">{dayClockOf(t.at, read.house.timezone)}</span>
          <span className="mdv-dayline__ticklabel">{t.label}</span>
        </Link>
      ) : (
        <span className="mdv-dayline__tick">
          <span className="mdv-dayline__tickat">{dayClockOf(t.at, read.house.timezone)}</span>
          <span className="mdv-dayline__ticklabel">{t.label}</span>
        </span>
      )}
    </li>
  );

  return (
    <>
      <div className="mdv-dayline__top">
        <div>
          <p className="mdv-dayline__eyebrow">Today</p>
          <HoursLine read={read} />
        </div>
        <p className="mdv-dayline__head">
          {offline
            ? `from ${dayClockOf(read.readAt, read.house.timezone)} · offline · will read on return`
            : `read ${dayClockOf(read.readAt, read.house.timezone)}`}
          {' · '}
          {dayHead(read.registers)}
        </p>
      </div>
      {ticks.length > 0 ? (
        <ul className="mdv-dayline__ticks" data-stale={offline || undefined}>
          {ticks.slice(0, cut).map(tickItem)}
          <li
            className="mdv-dayline__now"
            data-offline={offline || undefined}
            aria-label={`now, ${nowClock} by this device's clock${offline ? ', offline' : ''}`}
          >
            <span className="mdv-dayline__tickat">{nowClock}</span>
            <span className="mdv-dayline__nowword">{offline ? 'now · offline' : 'now'}</span>
          </li>
          {ticks.slice(cut).map(tickItem)}
        </ul>
      ) : (
        <p className="mdv-dayline__quiet">
          {unread.length > 0
            ? 'Nothing on the line from the registers that answered.'
            : 'Nothing on the line yet today.'}
        </p>
      )}
      {unread.length > 0 && (
        <p className="mdv-dayline__unread">
          {unread.map((r) => (r.state === 'refused' ? r.sentence : r.state === 'unreadable' ? r.sentence : '')).join(' ')}
          {!offline && (
            <>
              {' '}
              <button type="button" className="mdv-link" onClick={readNow}>
                Read again
              </button>
            </>
          )}
        </p>
      )}
    </>
  );
}

export function DayLine() {
  const auth = useContext(AuthContext);
  const shellOn = useMudavymDesign('shell');
  const houseId = auth?.activeRestaurantId ?? null;
  const state = useHouseDay(houseId, shellOn && Boolean(auth));
  const now = useDeviceNow();

  if (!shellOn) return null;

  return (
    <section className="mdv-dayline mudavym" aria-label="The day">
      {state.last ? (
        <DayLineBody read={state.last} offline={state.offline} now={now} readNow={state.readNow} />
      ) : state.offline ? (
        <p className="mdv-dayline__quiet">Offline. The day line will read on return.</p>
      ) : state.failure ? (
        <p className="mdv-dayline__unread">
          {state.failure.sentence}{' '}
          <button type="button" className="mdv-link" onClick={state.readNow}>
            Read again
          </button>
        </p>
      ) : (
        <p className="mdv-dayline__quiet" aria-live="polite">
          Reading the day…
        </p>
      )}
    </section>
  );
}

export default DayLine;
