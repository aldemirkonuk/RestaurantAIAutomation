/**
 * MonthLedger — the month as a page of the book, and one day opened.
 *
 * The day is the unit of record: every cell is a ledger day, every event a
 * ruled line in it, and clicking a day opens that day's ledger underneath on
 * the `settle` 0fr→1fr expansion the founder named as a favourite.
 *
 * Deliveries are the spine — they carry the seal rule and sort to the top of
 * the day; a delivery that arrived is **ruled off** with the house double
 * rule, and a day whose whole delivery account is settled is ruled off as a
 * day, with the die pressed dry (no wax — the ceremony is rationed to the one
 * irreversible act on this page, which is deleting).
 *
 * Dragging a ribbon onto another day moves the event (PATCH eventDate). An
 * occurrence of a repeating series is deliberately NOT draggable: the gateway
 * has no per-occurrence route, so a drag would silently move the whole series.
 */

import { useState } from 'react';
import { Seal } from '../../../components/mudavym';
import { EM, clock, longDay, sinceOrUntil, span } from './cal-format';
import { isDelivery, type CalEvent, type CalendarData } from './useCalendarNextData';
import { DayRecordMark, SkyMark } from './SkyMark';
import { addDays, dayKey, parseDayKey, startOfWeek } from './cal-format';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_RIBBONS = 3;

/**
 * Why this particular cell carries no forecast.
 *
 * One sentence per reason, and never an empty node: a cell that simply omits
 * the sky reads as fair weather down the whole column. The page-level notice
 * carries the gateway's full sentence; this is the cell-sized version of it.
 */
export function skyAbsence(data: CalendarData, day: string, today: string): string | null {
  const w = data.weather;
  if (w.isLoading) return 'Reading the forecast.';
  if (w.isError) return `The forecast register could not be read (${w.errorMessage}).`;
  const win = w.window;
  if (!win) return null;
  if (win.refusal) return win.refusal;
  if (day < today) return 'No forecast was kept for this day.';
  if (win.horizonDays !== null) {
    return `Beyond ${win.issuer}'s ${win.horizonDays}-day forecast.`;
  }
  return `${win.issuer} published nothing for this day.`;
}

export interface MonthLedgerProps {
  data: CalendarData;
  cursor: Date;
  selected: string | null;
  onSelect: (day: string | null) => void;
  onOpenEvent: (event: CalEvent) => void;
  onCreateAt: (day: string) => void;
}

export function Ribbon({
  event,
  ruled,
  onOpen,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  event: CalEvent;
  ruled: boolean;
  onOpen: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  dragging?: boolean;
}) {
  const movable = !event.isOccurrence && !!onDragStart;
  return (
    <button
      type="button"
      className="cn-ribbon cn-ink"
      data-spine={isDelivery(event)}
      data-ruled={ruled}
      data-dragging={dragging || undefined}
      draggable={movable}
      onDragStart={movable ? onDragStart : undefined}
      onDragEnd={movable ? onDragEnd : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      title={
        event.isOccurrence
          ? `${event.title} — an occurrence of a repeating event; open it to edit the series`
          : event.title
      }
    >
      {!event.allDay && event.startTime && <span className="cn-ribbon-time">{clock(event.startTime)}</span>}
      {event.title}
    </button>
  );
}

/** What the page can honestly say about an event's vendor and order links. */
export function LinkLine({ event, data }: { event: CalEvent; data: CalendarData }) {
  const bits: string[] = [];

  if (event.providerId) {
    if (!data.providersKnown) bits.push(`vendor ${EM} the vendor book has not answered`);
    else {
      const p = data.providersById?.get(event.providerId);
      bits.push(p ? p.name : 'vendor no longer in the book');
    }
  }

  if (event.orderId) {
    if (!data.ordersKnown) bits.push(`order ${EM} the orders book has not answered`);
    else {
      const o = data.ordersById?.get(event.orderId);
      bits.push(o ? `order ${o.orderNumber ?? o.id.slice(0, 8)} · ${o.status}` : 'order not in the book');
    }
  }

  if (event.isOccurrence) bits.push('occurrence of a repeating event');
  if (bits.length === 0) return null;
  return <span className="cn-meta">{bits.join(' · ')}</span>;
}

export function DayLedger({
  day,
  data,
  onOpenEvent,
  onCreateAt,
}: {
  day: string;
  data: CalendarData;
  onOpenEvent: (e: CalEvent) => void;
  onCreateAt: (day: string) => void;
}) {
  const all = data.byDay.get(day) ?? [];
  const sky = data.weather.byDay?.get(day) ?? null;
  const record = data.record.byDay?.get(day) ?? null;
  const deliveries = all.filter(isDelivery);
  const rest = all.filter((e) => !isDelivery(e));
  const ruledOffCount = deliveries.filter(data.isRuledOff).length;
  const dayRuledOff = deliveries.length > 0 && ruledOffCount === deliveries.length;
  const orderLinked = all.some((e) => e.orderId);

  const line = (e: CalEvent) => (
    <button
      key={e.id}
      type="button"
      className="cn-line cn-ink"
      data-spine={isDelivery(e)}
      data-ruled={data.isRuledOff(e)}
      onClick={() => onOpenEvent(e)}
    >
      <span className="cn-when">{span(e.startTime, e.endTime, e.allDay)}</span>
      <span className="cn-entry">
        <b>{e.title}</b>
        <LinkLine event={e} data={data} />
      </span>
    </button>
  );

  return (
    <div className="cn-ledger">
      <div className="cn-head" style={{ marginBottom: 6 }}>
        <div>
          <span className="cn-eyebrow">The day</span>
          <h2 className="cn-h3">{longDay(day)}</h2>
        </div>
        <button type="button" className="cn-btn cn-ink" onClick={() => onCreateAt(day)}>
          Add to this day
        </button>
      </div>

      {/* The sky over this day, or the record it holds — whichever side of
          today it falls on. Attribution travels with the mark (ADR 0111 §2). */}
      <div className="cn-row" style={{ gap: 12, marginBottom: 6 }}>
        {record ? (
          <DayRecordMark day={record} />
        ) : (
          <SkyMark reading={sky} absence={skyAbsence(data, day, dayKey(new Date()))} />
        )}
        {sky && record && <SkyMark reading={sky} absence={null} />}
      </div>
      {record && (
        <p className="cn-meta" style={{ margin: '0 0 8px' }}>
          {record.line}
        </p>
      )}
      {!record && sky && (
        <p className="cn-meta" style={{ margin: '0 0 8px' }}>
          {sky.shortForecast ? `${sky.shortForecast}. ` : ''}
          {sky.issuer}
          {sky.issuerDetail ? ` ${sky.issuerDetail}` : ''}, issued{' '}
          {sinceOrUntil(sky.issuedAt)}.
        </p>
      )}

      {all.length === 0 && (
        <p className="cn-quiet" style={{ margin: 0 }}>
          Nothing is written against this day.
        </p>
      )}

      {deliveries.length > 0 && (
        <>
          <p className="cn-eyebrow" style={{ margin: '8px 0 2px' }}>
            Deliveries
          </p>
          {deliveries.map(line)}
          {dayRuledOff ? (
            <>
              <div className="cn-rule2" />
              <p className="cn-meta cn-row" style={{ margin: 0 }}>
                <Seal size={16} pressed />
                Ruled off — every delivery on this day arrived.
              </p>
            </>
          ) : (
            <p className="cn-meta" style={{ margin: '6px 0 0' }}>
              {ruledOffCount > 0
                ? `${ruledOffCount} of ${deliveries.length} ruled off — the day is still open.`
                : 'The day is still open.'}
            </p>
          )}
        </>
      )}

      {rest.length > 0 && (
        <>
          <p className="cn-eyebrow" style={{ margin: '12px 0 2px' }}>
            Also on the day
          </p>
          {rest.map(line)}
        </>
      )}

      {orderLinked && !data.ordersKnown && (
        <p className="cn-quiet" style={{ margin: '10px 0 0' }}>
          The orders book has not answered, so an order-linked line can only be ruled off by the
          calendar&apos;s own status — not by the delivery actually landing.
        </p>
      )}
    </div>
  );
}

export default function MonthLedger({
  data,
  cursor,
  selected,
  onSelect,
  onOpenEvent,
  onCreateAt,
}: MonthLedgerProps) {
  const [dragged, setDragged] = useState<CalEvent | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const weeks = Math.ceil((last.getDate() + ((first.getDay() + 6) % 7)) / 7);
  const today = dayKey(new Date());

  const drop = (target: string) => {
    const event = dragged;
    setDragged(null);
    setOver(null);
    if (!event || event.date === target) return;
    const shift = event.endDate
      ? Math.round((parseDayKey(target).getTime() - parseDayKey(event.date).getTime()) / 86_400_000)
      : 0;
    data.update.mutate({
      id: event.seriesId,
      patch: {
        eventDate: target,
        ...(event.endDate ? { eventDateEnd: dayKey(addDays(parseDayKey(event.endDate), shift)) } : {}),
      },
    });
  };

  return (
    <>
      <div className="cn-grid" aria-hidden>
        {WEEKDAYS.map((w) => (
          <p key={w} className="cn-weekday">
            {w}
          </p>
        ))}
      </div>
      <div className="cn-grid" role="grid" aria-label={`Month ledger — ${cursor.getFullYear()}`}>
        {Array.from({ length: weeks * 7 }, (_, i) => {
          const d = addDays(gridStart, i);
          const key = dayKey(d);
          const events = data.byDay.get(key) ?? [];
          const outside = d.getMonth() !== cursor.getMonth();
          const shown = events.slice(0, MAX_RIBBONS);
          // Left of today the cell holds the record; right of it, the forecast.
          // That axis is the whole structural idea of the overlay (ADR 0111 §2).
          const past = key < today;
          const sky = data.weather.byDay?.get(key) ?? null;
          const record = data.record.byDay?.get(key) ?? null;
          return (
            <div
              key={key}
              className="cn-cell cn-ink"
              role="gridcell"
              tabIndex={0}
              data-outside={outside}
              data-today={key === today}
              data-selected={selected === key}
              data-shut={record?.recorded?.excluded || undefined}
              data-dropzone={over === key || undefined}
              aria-label={`${longDay(key)} — ${events.length === 0 ? 'nothing written' : `${events.length} entries`}`}
              onClick={() => onSelect(selected === key ? null : key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(selected === key ? null : key);
                }
              }}
              onDragOver={(e) => {
                if (!dragged) return;
                e.preventDefault();
                setOver(key);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(key);
              }}
            >
              <span className="cn-daynum">{d.getDate()}</span>
              {past ? (
                record ? (
                  <DayRecordMark day={record} />
                ) : (
                  <SkyMark reading={sky} absence={skyAbsence(data, key, today)} />
                )
              ) : (
                <SkyMark reading={sky} absence={skyAbsence(data, key, today)} />
              )}
              {shown.map((ev) => (
                <Ribbon
                  key={ev.id}
                  event={ev}
                  ruled={data.isRuledOff(ev)}
                  dragging={dragged?.id === ev.id}
                  onOpen={() => onOpenEvent(ev)}
                  onDragStart={() => setDragged(ev)}
                  onDragEnd={() => {
                    setDragged(null);
                    setOver(null);
                  }}
                />
              ))}
              {events.length > shown.length && (
                <span className="cn-meta">+{events.length - shown.length} more</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="cn-expand" data-open={!!selected}>
        <div>
          {selected && (
            <DayLedger day={selected} data={data} onOpenEvent={onOpenEvent} onCreateAt={onCreateAt} />
          )}
        </div>
      </div>
    </>
  );
}
