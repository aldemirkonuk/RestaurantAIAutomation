/**
 * NoteDays — this page's slots on the house day strip.
 *
 * ── What this replaces, and why ────────────────────────────────────────────
 * `DayRail.tsx` is DELETED. It drew fourteen days of its own, with its own
 * markup, no keyboard map, no record states and a bar whose height was a
 * proportion of the busiest day on screen. `/recommendations` had grown a
 * second strip with a different contract, and only that one carried the rule
 * both pages needed — a day the source was READ for and that held nothing is
 * hatched, never drawn as a zero. Two strips, one of them missing the rule.
 * The founder's call, 2026-09-04: one shared strip
 * (`components/mudavym/DayStrip.tsx`), per-page slots for what a day carries.
 * This file is those slots.
 *
 * The rail's original argument survives intact and is worth keeping written
 * down: this book IS keyed by day, by its own producer. Measured on the
 * production register (2026-09-03), 237 distinct `group_key` values, of which
 * the twenty commonest are `low_stock_digest:2026-08-16`, `…:2026-08-17` and
 * so on, eight rows apiece — one key per calendar day. The house writes a page
 * a day, so the day belongs on the page: as the thing you pick, not the thing
 * you scroll.
 *
 * ── What the figures mean, still ───────────────────────────────────────────
 * Selecting a day sends `dateFrom`/`dateTo` to the register
 * (`GetNotificationsQueryDto`, applied as `gte`/`lte` on `created_at`), so the
 * count that comes back is the REGISTER'S count for that day. The little
 * figures on the unselected cells are the opposite — they can only count rows
 * already loaded — so they are labelled "on this screen" and never dressed up
 * as totals. The hatch is the one negative claim this page now makes, and
 * `nt-book.ts` `dayCells` documents exactly how far it is entitled to go.
 */

import { CalendarDays } from 'lucide-react';
import { DayStrip, type DayStripDay } from '@/components/mudavym';
import type { DayCell } from './nt-book';
import { EM, MONO, SANS } from './nt-format';

export interface NoteDaysProps {
  cells: DayCell[];
  month: string;
  onMonth: (month: string) => void;
  /** `YYYY-MM-DD`, or null for "every day the book holds". */
  selected: string | null;
  onSelect: (day: string | null) => void;
  /** The register's own total once a day is selected; null when unknown. */
  selectedTotal: number | null;
  /** True while the register is being read — the strip must not look settled. */
  busy: boolean;
  /** True when a type or status filter is narrowing what the hatch means. */
  filtered: boolean;
}

export function NoteDays(props: NoteDaysProps) {
  const { cells, selected, onSelect } = props;
  // The bar is a proportion of the busiest day ON SCREEN — a shape, not a
  // figure. The figure is in the cell's own title, in words.
  const peak = cells.reduce((m, c) => Math.max(m, c.onScreen), 0);

  const days: Record<string, DayStripDay> = {};
  for (const c of cells) {
    const height = peak > 0 ? Math.round((c.onScreen / peak) * 14) : 0;
    days[c.key] = {
      records: c.records,
      says: `${c.onScreen} ${c.onScreen === 1 ? 'line' : 'lines'} on this screen, ${c.open} still open`,
      mark:
        c.onScreen > 0 ? (
          <i
            style={{
              display: 'block',
              width: '100%',
              borderRadius: 2,
              height: Math.max(height, 2),
              background: c.open > 0 ? 'var(--seal)' : 'var(--ink-4)',
            }}
          />
        ) : null,
    };
  }

  return (
    <section aria-labelledby="nt-days">
      <h2
        id="nt-days"
        className="mb-1 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em]"
        style={{ fontFamily: MONO, color: 'var(--ink-4)' }}
      >
        <CalendarDays size={12} strokeWidth={1.75} aria-hidden />
        The day-book, by the month
      </h2>

      <DayStrip
        month={props.month}
        onMonth={props.onMonth}
        days={days}
        selected={selected}
        onSelect={onSelect}
        label="Select a day to read that day from the register"
        aside={
          selected ? (
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="nt-ink rounded-lg border px-3 py-1 text-[11px]"
              style={{
                fontFamily: SANS,
                borderColor: 'var(--paper-2)',
                color: 'var(--ink-2)',
                cursor: 'pointer',
              }}
            >
              Every day
            </button>
          ) : null
        }
      >
        <p className="mt-2 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
          {selected ? (
            <>
              Reading <span style={{ fontFamily: MONO, color: 'var(--ink-2)' }}>{selected}</span> —
              the register holds{' '}
              <span style={{ fontFamily: MONO, color: 'var(--ink-1)' }}>
                {props.busy ? EM : (props.selectedTotal ?? EM)}
              </span>{' '}
              lines for that day. Every other day is drawn blank while this filter is on: the
              register was asked about one day, so nothing is known about the rest.
            </>
          ) : (
            <>
              The figures in each cell count the lines on this screen, not the register’s
              totals — pick a day to read that day from the register. A hatched day is one the
              loaded pages cover and the house wrote nothing on
              {props.filtered ? ' of the kind you are filtering for' : ''}; a blank day is one
              these pages do not reach, and a day still ahead is neither.
            </>
          )}
        </p>
      </DayStrip>
    </section>
  );
}

export default NoteDays;
