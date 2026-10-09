/**
 * TimeGrid — the week and the day, at the magnification where hours matter.
 * One component serves both: a day is a week with a single column.
 *
 * Three gestures on one pointer model:
 *  - drag a block            → move it (another hour, another day);
 *    a finger must first hold still on it for HOLD_MS, so a swipe that only
 *    meant to scroll the week never moves an entry (F-200);
 *  - drag its bottom handle  → resize it (a later end time);
 *  - click an empty slot     → open the sheet on that hour.
 *
 * The drag is deliberately UN-EASED: the block tracks the finger with no
 * interpolation, because easing between 15-minute snaps would draw times the
 * operator never chose. Only the settle back into the grid after a commit is a
 * token motion (`tuck`, the spring for things that moved under a finger).
 *
 * Honesty: an event the gateway sent with no `event_time` cannot be placed on
 * an hour, so it sits in the all-day strip with an em dash for its time. It is
 * never drawn at midnight and never at "09:00 by default".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { tuck } from '../../../lib/mudavym/motion';
import {
  EM,
  addDays,
  clock,
  dayKey,
  fromMinutes,
  parseDayKey,
  snapMinutes,
  startOfWeek,
  toMinutes,
} from './cal-format';
import { isDelivery, type CalEvent, type CalendarData } from './useCalendarNextData';

const HOUR_PX = 44;
const START_HOUR = 6;
const END_HOUR = 24;
const START_MIN = START_HOUR * 60;
const END_MIN = END_HOUR * 60;
const DEFAULT_MINUTES = 60;
/** How long a finger holds on a block before it picks the block up. */
export const HOLD_MS = 450;
/** A finger that strays further than this before the hold ends is scrolling. */
const HOLD_SLOP_PX = 8;

type DragMode = 'move' | 'resize';
interface Drag {
  id: string;
  mode: DragMode;
  dMin: number;
  dDay: number;
}

export interface TimeGridProps {
  data: CalendarData;
  cursor: Date;
  days: 1 | 7;
  onOpenEvent: (e: CalEvent) => void;
  onCreateAt: (day: string, hour: number) => void;
}

/** Where an event sits on the hour ruler, or null when it has no recorded time. */
export function placed(e: CalEvent): { start: number; end: number } | null {
  if (e.allDay) return null;
  const start = toMinutes(e.startTime);
  if (start === null) return null;
  const rawEnd = toMinutes(e.endTime);
  const end = rawEnd !== null && rawEnd > start ? rawEnd : start + DEFAULT_MINUTES;
  return { start, end };
}

export default function TimeGrid({ data, cursor, days, onOpenEvent, onCreateAt }: TimeGridProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const originRef = useRef<{ x: number; y: number; colWidth: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const holdRef = useRef<{ timer: ReturnType<typeof setTimeout>; stop: () => void } | null>(null);
  useEffect(() => () => holdRef.current?.stop(), []);

  const columns =
    days === 7
      ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i))
      : [new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())];
  const keys = columns.map(dayKey);
  const today = dayKey(new Date());
  const template = `56px repeat(${columns.length}, minmax(0, 1fr))`;

  /** Commit whatever the drag ended on. Held in a ref so the window listeners
   *  are installed once per gesture rather than once per pointermove. */
  const commit = useCallback(
    (finished: Drag) => {
      if (finished.dMin === 0 && finished.dDay === 0) return;
      const event = data.events.find((x) => x.id === finished.id);
      const p = event ? placed(event) : null;
      if (!event || !p) return;
      if (finished.mode === 'resize') {
        const end = Math.min(END_MIN, Math.max(p.start + 15, p.end + finished.dMin));
        if (end === p.end) return;
        data.update.mutate({ id: event.seriesId, patch: { eventTimeEnd: fromMinutes(end) } });
        return;
      }
      const start = Math.min(END_MIN - 15, Math.max(START_MIN, p.start + finished.dMin));
      const end = Math.min(END_MIN, start + (p.end - p.start));
      const shift = (key: string) => dayKey(addDays(parseDayKey(key), finished.dDay));
      data.update.mutate({
        id: event.seriesId,
        patch: {
          eventDate: shift(event.date),
          // A multi-day entry keeps its length when it moves.
          ...(event.endDate && finished.dDay ? { eventDateEnd: shift(event.endDate) } : {}),
          eventTime: fromMinutes(start),
          eventTimeEnd: fromMinutes(end),
        },
      });
    },
    [data],
  );
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const dragging = drag !== null;

  // Window-level listeners: a fast pointer leaves the block behind, and the
  // gesture must still finish (and commit) rather than sticking mid-air.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (ev: PointerEvent) => {
      const origin = originRef.current;
      const cur = dragRef.current;
      if (!origin || !cur) return;
      const dMin = snapMinutes(((ev.clientY - origin.y) / HOUR_PX) * 60, 15);
      const dDay = cur.mode === 'move' ? Math.round((ev.clientX - origin.x) / origin.colWidth) : 0;
      if (dMin === cur.dMin && dDay === cur.dDay) return;
      setDrag({ ...cur, dMin, dDay });
    };
    const onUp = () => {
      const cur = dragRef.current;
      originRef.current = null;
      setDrag(null);
      if (cur) commitRef.current(cur);
    };
    // A cancelled gesture (the browser took it for a scroll) saves nothing.
    const onCancel = () => {
      originRef.current = null;
      setDrag(null);
    };
    // Once a block is picked up by a finger, the page must not scroll under it.
    const holdPage = (ev: TouchEvent) => ev.preventDefault();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('touchmove', holdPage, { passive: false });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('touchmove', holdPage);
    };
  }, [dragging]);

  const beginDrag = (e: React.PointerEvent, event: CalEvent, mode: DragMode) => {
    // An occurrence has no row of its own: the gateway exposes no
    // `events/:id/occurrence` route, so dragging one would silently move the
    // whole series. The sheet says so; the grid simply does not offer it.
    if (event.isOccurrence) return;
    e.stopPropagation();
    if (mode === 'resize') e.preventDefault();
    const rect = bodyRef.current?.getBoundingClientRect();
    const colWidth = rect ? (rect.width - 56) / columns.length : 1;
    const x = e.clientX;
    const y = e.clientY;
    const pickUp = () => {
      originRef.current = { x, y, colWidth: colWidth || 1 };
      setDrag({ id: event.id, mode, dMin: 0, dDay: 0 });
    };
    // A mouse, a pen, or a finger on the resize handle picks up at once. A
    // finger on the block itself is most likely scrolling the week: it picks
    // up only after holding still for HOLD_MS (F-200).
    if (e.pointerType !== 'touch' || mode === 'resize') {
      pickUp();
      return;
    }
    holdRef.current?.stop();
    const pointerId = e.pointerId;
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (Math.abs(ev.clientX - x) > HOLD_SLOP_PX || Math.abs(ev.clientY - y) > HOLD_SLOP_PX) stop();
    };
    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) stop();
    };
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      holdRef.current = null;
    };
    const timer = setTimeout(() => {
      stop();
      pickUp();
    }, HOLD_MS);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    holdRef.current = { timer, stop };
  };

  return (
    <div className="cn-time">
      <div className="cn-time-head" style={{ gridTemplateColumns: template }}>
        <span />
        {columns.map((d) => (
          <span key={dayKey(d)} data-today={dayKey(d) === today}>
            {d.toLocaleDateString('en-US', { weekday: 'short' })}{' '}
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{d.getDate()}</span>
          </span>
        ))}
      </div>

      {/* all-day, and anything the gateway sent without a time */}
      <div className="cn-allday" style={{ gridTemplateColumns: template }}>
        <span className="cn-hour" style={{ height: 'auto', borderTop: 0, paddingTop: 6 }}>
          all day
        </span>
        {keys.map((key) => (
          <div key={key}>
            {(data.byDay.get(key) ?? [])
              // A timed entry that runs past midnight sits on the hour ruler
              // only on its first day; on the days it carries on into, it is a
              // ribbon up here.
              .filter((e) => !placed(e) || e.date !== key)
              .map((e) => {
                const carried = e.date !== key;
                return (
                  <button
                    key={e.id}
                    type="button"
                    className="cn-ribbon cn-ink"
                    data-spine={isDelivery(e)}
                    data-ruled={data.isRuledOff(e)}
                    onClick={() => onOpenEvent(e)}
                    title={
                      carried
                        ? `${e.title} — carries on from ${parseDayKey(e.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
                        : e.allDay
                          ? e.title
                          : `${e.title} — no time recorded`
                    }
                  >
                    {!e.allDay && !carried && <span className="cn-ribbon-time">{EM}</span>}
                    {e.title}
                  </button>
                );
              })}
          </div>
        ))}
      </div>

      <div className="cn-time-body" ref={bodyRef} style={{ gridTemplateColumns: template }}>
        <div className="cn-hours">
          {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
            <div key={i} className="cn-hour">
              {String(START_HOUR + i).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {keys.map((key) => (
          <div key={key} className="cn-col">
            {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
              // Pointer affordance only; the keyboard route to the same sheet
              // is the header's "New event" and the day ledger's "Add to this
              // day", both real buttons.
              <div
                key={i}
                className="cn-slot"
                aria-hidden
                onClick={() => onCreateAt(key, START_HOUR + i)}
              />
            ))}
            {(data.byDay.get(key) ?? []).map((e) => {
              const p = placed(e);
              if (!p || e.date !== key) return null;
              const d = drag && drag.id === e.id ? drag : null;
              const resizing = d?.mode === 'resize';
              const start = d && !resizing ? p.start + d.dMin : p.start;
              const end = resizing
                ? Math.max(p.start + 15, p.end + d.dMin)
                : start + (p.end - p.start);
              const top = ((start - START_MIN) / 60) * HOUR_PX;
              const height = Math.max(22, ((end - start) / 60) * HOUR_PX);
              return (
                <div
                  key={e.id}
                  className="cn-block"
                  data-spine={isDelivery(e)}
                  data-ruled={data.isRuledOff(e)}
                  data-dragging={d ? true : undefined}
                  style={{
                    top,
                    height,
                    transform: d && d.dDay ? `translateX(${d.dDay * 100}%)` : undefined,
                    // tuck — the block settling back into the grid after a
                    // commit. Suppressed while the finger is down, where the
                    // motion must be un-eased.
                    transition: d ? 'none' : `top ${tuck.ms}ms ${tuck.easing}, height ${tuck.ms}ms ${tuck.easing}`,
                  }}
                  onPointerDown={(ev) => beginDrag(ev, e, 'move')}
                >
                  <button
                    type="button"
                    className="cn-block-open"
                    onClick={() => onOpenEvent(e)}
                  >
                    <span className="cn-ribbon-time">{d ? fromMinutes(start) : clock(e.startTime)}</span>
                    <span style={{ fontWeight: 600 }}>{e.title}</span>
                  </button>
                  {!e.isOccurrence && (
                    <button
                      type="button"
                      className="cn-handle"
                      aria-label={`Resize ${e.title}`}
                      onPointerDown={(ev) => beginDrag(ev, e, 'resize')}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
