/**
 * The day rail — the founder's day-strip, turned from a layout into a
 * selector.
 *
 * WHY A RAIL AND NOT AN AXIS. The first pass drew the day-strip as a vertical
 * hour axis with the day's lines hung off it, and argued against building it:
 * notification times cluster, so the axis is knots and emptiness, and it
 * spends the page on the one dimension every row already states in five
 * characters. The founder liked it anyway, and he was right about something
 * the argument missed — this book IS keyed by day, by its own producer.
 * Measured on the production register (2026-09-03): 237 distinct `group_key`
 * values, of which the twenty commonest are `low_stock_digest:2026-08-16`,
 * `…:2026-08-17`, `…:2026-08-18` and so on, eight rows apiece, one key per
 * calendar day. The house writes a page a day. So the day belongs on the
 * page — as the thing you pick, not as the thing you scroll.
 *
 * WHY IT IS HONEST. Selecting a day sends `dateFrom`/`dateTo` to the register
 * (`GetNotificationsQueryDto`, applied as `gte`/`lte` on `created_at`), so the
 * count that comes back is the REGISTER'S count for that day, not this
 * screen's. The little figures on the unselected cells are the opposite —
 * they can only count rows already loaded — so they are labelled "on this
 * screen" and never dressed up as totals.
 */

import { CalendarDays } from 'lucide-react';
import type { DayCell } from './nt-book';
import { EM, MONO, SANS } from './nt-format';

export interface DayRailProps {
  cells: DayCell[];
  /** `YYYY-MM-DD`, or null for "every day the book holds". */
  selected: string | null;
  onSelect: (day: string | null) => void;
  /** The register's own total once a day is selected; null when unknown. */
  selectedTotal: number | null;
  /** True while the register is being read — the rail must not look settled. */
  busy: boolean;
}

export function DayRail({ cells, selected, onSelect, selectedTotal, busy }: DayRailProps) {
  const peak = cells.reduce((m, c) => Math.max(m, c.onScreen), 0);

  return (
    <section aria-labelledby="nt-days" className="mb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="nt-days"
          className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em]"
          style={{ fontFamily: MONO, color: 'var(--ink-4)' }}
        >
          <CalendarDays size={12} strokeWidth={1.75} aria-hidden />
          The last fortnight
        </h2>
        <p className="text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
          {selected ? (
            <>
              Reading{' '}
              <span style={{ fontFamily: MONO, color: 'var(--ink-2)' }}>{selected}</span> — the
              register holds{' '}
              <span style={{ fontFamily: MONO, color: 'var(--ink-1)' }}>
                {busy ? EM : (selectedTotal ?? EM)}
              </span>{' '}
              lines for that day.
            </>
          ) : (
            'The figures below count the lines on this screen, not the register’s totals. Pick a day to read that day from the register.'
          )}
        </p>
      </div>

      <ol className="mt-2 flex flex-wrap gap-1.5" role="list">
        <li>
          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-pressed={selected === null}
            className="nt-ink h-[46px] rounded-lg px-3 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
            style={{
              fontFamily: SANS,
              border: `1px solid ${selected === null ? 'var(--seal-ring)' : 'var(--paper-2)'}`,
              background: selected === null ? 'var(--seal-tint)' : 'transparent',
              color: selected === null ? 'var(--seal-deep)' : 'var(--ink-2)',
              fontWeight: selected === null ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            Every day
          </button>
        </li>
        {cells.map((c) => {
          const on = selected === c.key;
          // The bar is a proportion of the busiest day ON SCREEN — a shape, not
          // a figure. The figure is printed underneath it.
          const height = peak > 0 ? Math.round((c.onScreen / peak) * 14) : 0;
          return (
            <li key={c.key}>
              <button
                type="button"
                onClick={() => onSelect(on ? null : c.key)}
                aria-pressed={on}
                aria-label={`${c.key}: ${c.onScreen} lines on this screen, ${c.open} still open`}
                className="nt-ink flex h-[46px] w-[38px] flex-col items-center justify-between rounded-lg px-1 pb-1 pt-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
                style={{
                  border: `1px solid ${on ? 'var(--seal-ring)' : 'var(--paper-2)'}`,
                  background: on ? 'var(--seal-tint)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <span
                  className="text-[9px] uppercase tracking-[0.1em]"
                  style={{
                    fontFamily: MONO,
                    color: c.isToday ? 'var(--seal-deep)' : 'var(--ink-4)',
                    fontWeight: c.isToday ? 600 : 400,
                  }}
                >
                  {c.weekday}
                  {c.day}
                </span>
                <span
                  aria-hidden
                  className="w-full rounded-sm"
                  style={{
                    height: Math.max(height, c.onScreen > 0 ? 2 : 1),
                    background:
                      c.open > 0
                        ? 'var(--seal)'
                        : c.onScreen > 0
                          ? 'var(--ink-4)'
                          : 'var(--paper-2)',
                    opacity: c.onScreen > 0 ? 1 : 0.6,
                  }}
                />
                <span
                  className="text-[9.5px]"
                  style={{
                    fontFamily: MONO,
                    fontVariantNumeric: 'tabular-nums',
                    color: c.onScreen > 0 ? 'var(--ink-2)' : 'var(--ink-4)',
                  }}
                >
                  {c.onScreen}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default DayRail;
