/**
 * The ribbon — the day strip above the docket, as a SELECTOR.
 *
 * The founder liked the day strip and asked for "a calendar strip that we can
 * select and see that is highly advanced and elegant looking". The decision
 * (2026-09-03) was to keep sketch 094b's docket as the spine and put 094a's
 * strip above it as a ribbon rather than the axis: selecting a day narrows the
 * docket to the entries that touch it, and selecting nothing leaves the whole
 * book standing. The docket never disappears behind the calendar.
 *
 * Three marks, and one absence:
 *   a solid bar     entries whose first impression landed on that day
 *   an outlined bar something that falls due on it (a goal deadline, a wake)
 *   a hatch         NO RECORD AT ALL — never a bar of zero
 *   a strike        the day is out of the analysis, by the manager's own hand
 *
 * The day-exclusion control lives here rather than in a side list, because on
 * a strip the day IS the object: you rule out the Tuesday you were shut by
 * striking the Tuesday. The write is the one that already existed
 * (`POST /analytics/exclusions/:rid`), and it still asks for a reason before
 * it acts — a standing instruction about the house's own averages is not a
 * thing to store from a single click.
 *
 * Keyboard: ← → move a day, ↑ ↓ move a week, Home/End the ends of the strip,
 * Enter or Space selects the focused day, Escape clears the selection. Roving
 * tabindex, so the strip is one stop on the page's tab order and the focus
 * ring is always visible on a paper gap.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, CircleSlash, Info } from 'lucide-react';
import { EM } from './rec-format';
import {
  barHeight,
  fmtLongDay,
  recordWords,
  type DayCell,
  type PosVM,
} from './rec-days';

/** Why a day is ruled out. Descriptor labels — nothing here describes a tenant. */
const EXCLUSION_REASONS: Array<{ id: string; label: string }> = [
  { id: 'closed', label: 'Closed' },
  { id: 'private_event', label: 'Private event' },
  { id: 'pos_outage', label: 'Till was down' },
  { id: 'other', label: 'Another reason' },
];

export interface RibbonProps {
  days: DayCell[];
  selected: string | null;
  onSelect: (date: string | null) => void;
  /** The POS window behind the record marks — undefined asked, null unreadable. */
  pos: PosVM;
  posProblem: string | null;
  /** undefined = the exclusion store has not been read yet. */
  exclusionsReadable: boolean | undefined;
  exclusionsProblem: string | null;
  onExclude: (date: string, reason: string) => void;
  onInclude: (date: string) => void;
  /** Standing entries with no first-fired date — said, never hidden. */
  undated: number;
  /** How many entries the current selection leaves standing. */
  matching: number;
}

export default function Ribbon(props: RibbonProps) {
  const { days, selected, onSelect } = props;
  const todayIdx = useMemo(() => Math.max(0, days.findIndex((d) => d.isToday)), [days]);
  const [focusIdx, setFocusIdx] = useState(todayIdx);
  const [askExclude, setAskExclude] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  // A selection made elsewhere (a link, a clear) moves the roving focus with
  // it, so the keyboard never starts from a day the eye is not on.
  useEffect(() => {
    if (!selected) return;
    const i = days.findIndex((d) => d.date === selected);
    if (i >= 0) setFocusIdx(i);
  }, [selected, days]);

  useEffect(() => {
    setAskExclude(false);
    setReason(null);
  }, [selected]);

  const cell = selected ? days.find((d) => d.date === selected) ?? null : null;

  const move = (next: number) => {
    const i = Math.max(0, Math.min(days.length - 1, next));
    setFocusIdx(i);
    const node = stripRef.current?.querySelector<HTMLButtonElement>(`[data-idx="${i}"]`);
    node?.focus();
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
        move(days.length - 1);
        break;
      case 'Escape':
        if (selected) {
          ev.preventDefault();
          onSelect(null);
        }
        break;
    }
  };

  /** What the strip is allowed to claim about records at all. */
  const recordsNote =
    props.pos === undefined
      ? 'Reading which days carry records…'
      : props.pos === null
        ? `The till window could not be read (${props.posProblem ?? 'no reason given'}), so no day below is marked as having no records. An unreadable window is not an empty one.`
        : !props.pos.connected
          ? 'No till is connected to this house, so nothing here knows which days carry records. No day is hatched — an absence of a POS is not an absence of trade.'
          : Object.keys(props.pos.byDay).length === 0
            ? `Not one day in this window carries a record. Either the house was shut throughout or the till read failed inside the gateway ${EM} the endpoint does not distinguish the two, so neither is claimed here.`
            : 'A hatched day carries no record at all. It is never drawn as a bar of zero — a closure read as a measurement is the fault this page exists to refuse.';

  return (
    <section className="rc-ribbon" aria-labelledby="rc-ribbon-h">
      <div className="rc-ribbon-head">
        <span className="rc-micro rc-ribbon-title" id="rc-ribbon-h">
          <CalendarRange size={12} aria-hidden="true" /> The days behind this book
        </span>
        {selected && (
          <button type="button" className="rc-quiet" onClick={() => onSelect(null)}>
            Show the whole book
          </button>
        )}
      </div>

      <div
        className="rc-strip"
        role="group"
        aria-label="Select a day to narrow the docket"
        ref={stripRef}
        onKeyDown={onKey}
      >
        {days.map((d, i) => {
          const fired = d.fired.length;
          const due = d.due.length;
          const title = `${fmtLongDay(d.date)} — ${fired} first fired · ${due} falls due · ${recordWords(d)}${
            d.excluded ? ` · out of the analysis (${d.excludedReason ?? 'no reason given'})` : ''
          }`;
          return (
            <button
              key={d.date}
              type="button"
              data-idx={i}
              data-testid="rc-day"
              className="rc-day"
              data-records={d.records}
              data-excluded={d.excluded ? 'true' : undefined}
              data-today={d.isToday ? 'true' : undefined}
              aria-pressed={selected === d.date}
              tabIndex={i === focusIdx ? 0 : -1}
              title={title}
              aria-label={title}
              onFocus={() => setFocusIdx(i)}
              onClick={() => onSelect(selected === d.date ? null : d.date)}
            >
              <span className="rc-day-wd" aria-hidden="true">{d.weekday}</span>
              <span className="rc-num rc-day-n" aria-hidden="true">{d.dayNum}</span>
              {d.monthLabel && <span className="rc-micro rc-day-mo" aria-hidden="true">{d.monthLabel}</span>}
              <span className="rc-day-bars" aria-hidden="true">
                {fired > 0 && (
                  <i className="rc-bar rc-bar-fired" style={{ height: `${barHeight(fired)}px` }} />
                )}
                {due > 0 && (
                  <i className="rc-bar rc-bar-due" style={{ height: `${barHeight(due)}px` }} />
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rc-legend" aria-hidden="true">
        <i><span className="rc-sw rc-sw-fired" />first fired</i>
        <i><span className="rc-sw rc-sw-due" />falls due</i>
        <i><span className="rc-sw rc-sw-none" />no records — not a zero</i>
        <i><span className="rc-sw rc-sw-out" />out of the analysis</i>
        <i><span className="rc-sw rc-sw-today" />today</i>
      </div>

      <p className="rc-why rc-ribbon-note" data-testid="rc-records-note">
        <Info size={11} aria-hidden="true" /> {recordsNote}
      </p>

      {/*
        What the strip cannot show, said whether or not it bites today. The
        forty-key cap is invisible until a house crosses it, and a limit that
        only announces itself once it has already distorted the picture is not
        a disclosure.
      */}
      <p className="rc-why" data-testid="rc-ribbon-limits">
        What this strip cannot draw: first-fired dates are recorded for at most forty rule
        keys and are absent for any rule with no impression row, so an entry without one sits
        on no day rather than on today; and no vendor cutoff exists anywhere in the product,
        so “falls due” is only ever a goal’s deadline or a snoozed entry waking.
      </p>

      {props.undated > 0 && (
        <p className="rc-why" data-testid="rc-undated">
          {props.undated} standing {props.undated === 1 ? 'entry has' : 'entries have'} no
          first-fired date, so {props.undated === 1 ? 'it is' : 'they are'} on no day of this
          strip. Impressions are recorded for at most forty rule keys, and a rule with no
          impression row has none {EM} it is withheld from a day rather than drawn on today.
        </p>
      )}

      {cell && (
        <div className="rc-dayhead" data-testid="rc-dayhead">
          <h2 className="rc-serif">{fmtLongDay(cell.date)}</h2>
          <p className="rc-micro">
            {cell.fired.length} first fired · {cell.due.length} falls due ·{' '}
            {cell.records === 'yes' && cell.revenue !== null
              ? `$${Math.round(cell.revenue).toLocaleString()} through the till`
              : recordWords(cell)}
          </p>
          <p className="rc-why">
            The docket below is narrowed to the {props.matching}{' '}
            {props.matching === 1 ? 'entry' : 'entries'} that touch this day — first fired on
            it, waking on it, or watched by a goal that falls due on it. Money through the
            till is not money at stake; the feed carries no figure for the second.
          </p>

          {cell.excluded ? (
            <div className="rc-row">
              <span className="rc-said">
                Out of the analysis — “{cell.excludedReason ?? 'no reason given'}”. Its numbers
                count toward no average, here or anywhere else.
              </span>
              <button
                type="button"
                className="rc-quiet"
                onClick={() => props.onInclude(cell.date)}
              >
                Count it again
              </button>
            </div>
          ) : props.exclusionsReadable === false ? (
            <p className="rc-said" role="status">
              The excluded-day store could not be read (
              {props.exclusionsProblem ?? 'no reason given'}), so this day cannot be ruled out
              from here. Every average below may still be counting days you meant to exclude.
            </p>
          ) : cell.isFuture ? (
            <p className="rc-said">
              A day that has not happened cannot be ruled out of an analysis of days that have.
            </p>
          ) : !askExclude ? (
            <div className="rc-row">
              <button
                type="button"
                className="rc-quiet"
                disabled={props.exclusionsReadable === undefined}
                onClick={() => setAskExclude(true)}
              >
                <CircleSlash size={11} aria-hidden="true" /> Rule this day out of the analysis
              </button>
              <span className="rc-said">
                A closure or an outage should not drag an average down.
              </span>
            </div>
          ) : (
            <div className="rc-menu rc-sheet" role="group" aria-label="Rule this day out">
              <span className="rc-micro">Why is this day not a normal day?</span>
              <div className="rc-row">
                {EXCLUSION_REASONS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="rc-quiet"
                    aria-pressed={reason === r.id}
                    onClick={() => setReason(r.id)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <p className="rc-said rc-sheet-promise">
                After this, {fmtLongDay(cell.date)} stops counting toward every baseline — on
                this page and everywhere else the analysis reads. Undo it from this strip.
              </p>
              <div className="rc-row">
                <button
                  type="button"
                  className="rc-act"
                  disabled={!reason}
                  onClick={() => {
                    if (!reason) return;
                    setAskExclude(false);
                    props.onExclude(cell.date, reason);
                  }}
                >
                  Rule it out
                </button>
                <button type="button" className="rc-quiet" onClick={() => setAskExclude(false)}>
                  Keep counting it
                </button>
                {!reason && (
                  <span className="rc-said">Pick a reason first {EM} it is stored with the day.</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
