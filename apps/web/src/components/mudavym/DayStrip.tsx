/**
 * DayStrip — one month of days, as a selector. The house's day strip.
 *
 * ── Why this is house-level and not a page's own ────────────────────────────
 * Two pages had grown one each, and they had already drifted. `/recommendations`
 * drew `Ribbon.tsx` over a 21-behind / 7-ahead window with four record states
 * and a hatch for "no record at all"; `/notifications` drew `DayRail.tsx` over
 * the last fourteen days with no record states at all, no keyboard map, and a
 * bar whose height was a proportion of the busiest day on screen. Same object,
 * two contracts, one of them missing the rule the other exists to enforce. The
 * founder's call, 2026-09-04: one shared day strip, per-page slots for what a
 * day carries. `DayRail.tsx` is deleted; this replaces it.
 *
 * ── The four states, and the one this component exists for ──────────────────
 *   'yes'      a record landed — the day is measured
 *   'none'     the source was read, and this day held nothing. HATCHED.
 *   'unknown'  the source could not be read, or does not cover this day —
 *              nothing may be claimed about it, so nothing is drawn
 *   future     the day has not happened. Rendered EMPTY, never hatched: an
 *              absence of records is not a fact about a day that has not
 *              arrived, and the cell's own title says exactly that.
 *
 * A page cannot override the future rule. `records` supplied for a day after
 * `today` is ignored and the cell is drawn future, because the one way this
 * component fails is a page deciding that tomorrow held nothing.
 *
 * ── The window is a calendar month ─────────────────────────────────────────
 * The founder, 2026-09-04, replacing the rolling 21+7: a full calendar month,
 * the one containing today by default, with previous/next controls. A rolling
 * window has no name — "the last three weeks" is not a thing a person can say
 * to a colleague — and a month is the unit every other record in the house is
 * already kept in.
 *
 * ── Width ──────────────────────────────────────────────────────────────────
 * 31 cells on one line. The cell floor is `--mdv-ds-min` (30px, see
 * `day-strip.css`); above it the cells share the line equally, and below it the
 * strip scrolls horizontally rather than shrinking the day number out of
 * legibility. Measured against the two page shells this strip is mounted in —
 * the numbers are in `.planning/06-pages/recommendations.md` §1b.
 *
 * ── The keyboard, in one place ─────────────────────────────────────────────
 * ← → move a day · ↑ ↓ move a week · Home/End the ends of the month · Enter or
 * Space selects the focused day (a second press clears it) · Escape clears.
 * Roving tabindex, so the strip is ONE stop on the page's tab order, and the
 * focus ring is always drawn. Movement clamps inside the rendered month; the
 * month buttons are how you leave it, so an arrow key can never silently
 * change what the page is reading.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  DAY_LETTER,
  fmtLongDay,
  localToday,
  monthDays,
  monthLabel,
  monthOf,
  recordWords,
  shiftMonth,
  type DayRecords,
} from './dayStripDates';
import './day-strip.css';

/** What one day carries. Everything here is the PAGE's, except the rules. */
export interface DayStripDay {
  /** Defaults to `unknown` — nothing is claimed about a day nobody described. */
  records?: DayRecords;
  /** Ruled out by hand: the number is struck and the border goes dashed. */
  struck?: boolean;
  /** One clause the page adds to the cell's title, before the records sentence. */
  says?: string;
  /** Drawn under the number. Marks, never a figure — the figure goes in `says`. */
  mark?: ReactNode;
}

export interface DayStripProps {
  /** The month on screen, `YYYY-MM`. Controlled. */
  month: string;
  onMonth: (month: string) => void;
  /** date → what that day carries. A date absent from it carries nothing. */
  days: Record<string, DayStripDay>;
  /** The selected day, `YYYY-MM-DD`, or null for "the whole book". */
  selected: string | null;
  onSelect: (date: string | null) => void;
  /** The group's accessible name — the page's own words for what selecting does. */
  label: string;
  /**
   * Today, `YYYY-MM-DD`, in the PAGE's own convention.
   * `/recommendations` keys days by the gateway's UTC business date;
   * `/notifications` keys them by the reader's local day. Neither is wrong and
   * neither is this component's to choose, so it is passed in. Defaults to the
   * reader's local today.
   */
  today?: string;
  /** Right of the month controls. */
  aside?: ReactNode;
  /** Under the strip — the page's legend, notes, and selected-day head. */
  children?: ReactNode;
}

/* ── the strip ───────────────────────────────────────────────────────────── */

export function DayStrip(props: DayStripProps) {
  const { month, onMonth, days, selected, onSelect, label } = props;
  const today = props.today ?? localToday();
  const dates = useMemo(() => monthDays(month), [month]);

  /** The roving focus starts on today when today is in view, else on the 1st. */
  const homeIdx = useMemo(() => {
    const i = dates.indexOf(today);
    return i >= 0 ? i : 0;
  }, [dates, today]);
  const [focusIdx, setFocusIdx] = useState(homeIdx);
  const stripRef = useRef<HTMLDivElement | null>(null);

  // The month changing is a new set of cells; the old index would point at a
  // different day, so it goes home rather than staying put by number.
  useEffect(() => setFocusIdx(homeIdx), [homeIdx, month]);

  // A selection made elsewhere (a link, a clear) moves the roving focus with
  // it, so the keyboard never starts from a day the eye is not on.
  useEffect(() => {
    if (!selected) return;
    const i = dates.indexOf(selected);
    if (i >= 0) setFocusIdx(i);
  }, [selected, dates]);

  const move = (next: number) => {
    const i = Math.max(0, Math.min(dates.length - 1, next));
    setFocusIdx(i);
    stripRef.current?.querySelector<HTMLButtonElement>(`[data-idx="${i}"]`)?.focus();
  };

  const onKey = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    switch (ev.key) {
      case 'ArrowRight':
        ev.preventDefault();
        move(focusIdx + 1);
        break;
      case 'ArrowLeft':
        ev.preventDefault();
        move(focusIdx - 1);
        break;
      case 'ArrowDown':
        ev.preventDefault();
        move(focusIdx + 7);
        break;
      case 'ArrowUp':
        ev.preventDefault();
        move(focusIdx - 7);
        break;
      case 'Home':
        ev.preventDefault();
        move(0);
        break;
      case 'End':
        ev.preventDefault();
        move(dates.length - 1);
        break;
      case 'Enter':
      case ' ':
      case 'Spacebar': {
        /* Handled here rather than left to the button's native activation:
           Space would otherwise scroll the page under the strip, and a keyboard
           contract that is half explicit and half inherited is one refactor
           away from losing the half nobody wrote down. `preventDefault` on
           keydown also suppresses the synthetic click a button fires for
           Enter/Space, so the day toggles once, not twice. */
        ev.preventDefault();
        const d = dates[focusIdx];
        if (d) onSelect(selected === d ? null : d);
        break;
      }
      case 'Escape':
        if (selected) {
          ev.preventDefault();
          onSelect(null);
        }
        break;
    }
  };

  return (
    <div className="mdv-ds">
      <div className="mdv-ds-head">
        <div className="mdv-ds-months">
          <button
            type="button"
            className="mdv-ds-mo"
            onClick={() => onMonth(shiftMonth(month, -1))}
            aria-label={`Show ${monthLabel(shiftMonth(month, -1))}`}
          >
            <ChevronLeft size={13} aria-hidden="true" />
          </button>
          <span className="mdv-ds-mo-label" data-testid="mdv-ds-month">
            {monthLabel(month)}
          </span>
          <button
            type="button"
            className="mdv-ds-mo"
            onClick={() => onMonth(shiftMonth(month, 1))}
            aria-label={`Show ${monthLabel(shiftMonth(month, 1))}`}
          >
            <ChevronRight size={13} aria-hidden="true" />
          </button>
          {monthOf(today) !== month && (
            <button type="button" className="mdv-ds-quiet" onClick={() => onMonth(monthOf(today))}>
              Back to this month
            </button>
          )}
        </div>
        {props.aside}
      </div>

      <div
        className="mdv-ds-strip"
        role="group"
        aria-label={label}
        ref={stripRef}
        onKeyDown={onKey}
      >
        {dates.map((date, i) => {
          const day = days[date] ?? {};
          const isFuture = date > today;
          // A page cannot say a future day held nothing. See the header note.
          const records: DayRecords = isFuture ? 'unknown' : (day.records ?? 'unknown');
          const title = [
            fmtLongDay(date),
            day.says ?? null,
            recordWords(records, isFuture),
            day.struck ? 'out of the analysis' : null,
          ]
            .filter(Boolean)
            .join(' — ');
          return (
            <button
              key={date}
              type="button"
              data-idx={i}
              data-testid="mdv-ds-day"
              className="mdv-ds-day"
              data-records={isFuture ? 'future' : records}
              data-struck={day.struck ? 'true' : undefined}
              data-today={date === today ? 'true' : undefined}
              aria-pressed={selected === date}
              tabIndex={i === focusIdx ? 0 : -1}
              title={title}
              aria-label={title}
              onFocus={() => setFocusIdx(i)}
              onClick={() => onSelect(selected === date ? null : date)}
            >
              <span className="mdv-ds-wd" aria-hidden="true">
                {DAY_LETTER[new Date(`${date}T12:00:00Z`).getUTCDay()]}
              </span>
              <span className="mdv-ds-n" aria-hidden="true">
                {Number(date.substring(8, 10))}
              </span>
              <span className="mdv-ds-mark" aria-hidden="true">
                {day.mark}
              </span>
            </button>
          );
        })}
      </div>

      {props.children}
    </div>
  );
}

export default DayStrip;
