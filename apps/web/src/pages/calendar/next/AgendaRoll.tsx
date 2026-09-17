/**
 * AgendaRoll — the same book, unrolled: every day from the cursor forward that
 * has something written against it, in order. Days with nothing on them are
 * absent rather than drawn empty, because an agenda is a list of what exists.
 *
 * The window is finite and named (ninety days, `rangeFor('agenda')`), so the
 * end of the roll is the end of the window and not the end of the schedule —
 * the closing line says which.
 */

import { EM, longDay, relDay, span } from './cal-format';
import { LinkLine } from './MonthLedger';
import { isDelivery, type CalEvent, type CalendarData } from './useCalendarNextData';

export interface AgendaRollProps {
  data: CalendarData;
  onOpenEvent: (e: CalEvent) => void;
}

export default function AgendaRoll({ data, onOpenEvent }: AgendaRollProps) {
  const days = Array.from(data.byDay.keys())
    .filter((k) => k >= data.start && k <= data.end)
    .sort();

  if (days.length === 0) {
    return (
      <p className="cn-quiet">
        {data.hasEvents
          ? 'Nothing is written in the next ninety days.'
          : `${EM} The book has not answered yet.`}
      </p>
    );
  }

  return (
    <div>
      {days.map((key) => {
        const events = data.byDay.get(key) ?? [];
        return (
          <div key={key} className="cn-agenda-day">
            <div className="cn-agenda-key">
              {relDay(key)}
              <small>{longDay(key)}</small>
            </div>
            <div>
              {events.map((e) => (
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
              ))}
            </div>
          </div>
        );
      })}
      <p className="cn-quiet" style={{ marginTop: 12 }}>
        The roll ends at {data.end} because that is the window this page asked for — not because
        the schedule does.
      </p>
    </div>
  );
}
