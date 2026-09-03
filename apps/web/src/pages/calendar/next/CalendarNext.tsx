/**
 * CalendarNext — the Mudavym redesign of `/calendar`, behind
 * `mudavym_design_calendar` (ADR 0044 p4 wave).
 *
 * The founder's verdict, quoted from 06-pages/MAKEOVER-VERDICTS.md:
 *
 *   `/calendar` — **KEEP.** *"I really prefer the new version. That's for
 *   sure."* The one page named in the founder's opening as unreservedly liked.
 *
 * A KEEP is the hardest brief: nothing to fix, so the only way to spend the
 * work is to make the page mean what the house means. The structural idea that
 * does it: **the day is the unit of record, and deliveries are the spine.**
 * Month, Week, Day and Agenda are four magnifications of one book, every view
 * sorts deliveries to the top and gives them the seal rule, and a delivery that
 * arrived is *ruled off* with the house double rule — a day whose whole
 * delivery account is settled is ruled off as a day, under a dry-pressed seal.
 * (The dashboard's SalesCalendar set that grid voice; this page keeps the
 * voice and does not import a line of it.)
 *
 * Kept from the shipping page, all of it: Month / Week / Day / Agenda, drag to
 * move or resize, click an empty slot to create, full event editing, custom
 * event types, vendor links, and the command-palette deep link
 * `/calendar?openModal=true[&date=…]` — which this page also fixes: the legacy
 * hands `date=today` straight to `new Date()`, producing an Invalid Date
 * (CalendarPage.tsx:236, reached from quickActions.ts:81).
 *
 * Deliberately NOT built: the meeting-memo prompt. It asks for notes and
 * discards them (calendar.md §10) and there is no documents upload path to
 * persist them to; collecting into a void is the exact fault ADR 0020 names.
 *
 * Both grounds ship: warm paper by default, Warm Charcoal under the app's dark
 * theme or an explicit `ground="charcoal"`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Wordmark } from '@/components/mudavym';
import { animate, settle, turn } from '@/lib/mudavym';
import {
  EM,
  addDays,
  addMonths,
  countPhrase,
  dayKey,
  ensureFraunces,
  parseDayKey,
  periodLabel,
  sinceOrUntil,
  startOfWeek,
  type CalView,
} from './cal-format';
import { isDelivery, useCalendarNextData, type CalEvent } from './useCalendarNextData';
import MonthLedger, { DayLedger } from './MonthLedger';
import TimeGrid from './TimeGrid';
import AgendaRoll from './AgendaRoll';
import EventSheet, { type SheetTarget } from './EventSheet';
import './calendar-next.css';

const VIEWS: Array<{ key: CalView; label: string; hint: string }> = [
  { key: 'month', label: 'Month', hint: 'm' },
  { key: 'week', label: 'Week', hint: 'w' },
  { key: 'day', label: 'Day', hint: 'd' },
  { key: 'agenda', label: 'Agenda', hint: 'a' },
];

export interface CalendarNextProps {
  /** Force the Warm Charcoal ground regardless of app theme (ADR 0042). */
  ground?: 'charcoal';
}

export default function CalendarNext({ ground }: CalendarNextProps) {
  const [view, setView] = useState<CalView>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const headRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const data = useCalendarNextData(view, cursor, { q, type: typeFilter });

  /**
   * What the page is allowed to say about reminders, in one line.
   *
   * It used to say "Reminders set here live in this browser only — there is no
   * server-side reminder job", which was true and is not any more (ADR 0109).
   * The replacement is not a fixed sentence either: the cron serves only
   * opted-in tenants and only while the process is alive, so the line is drawn
   * from `GET /calendar/reminders/status` and says "unknown" when the job
   * cannot be read rather than asserting that reminders are being sent.
   */
  const reminderLine = (() => {
    const job = data.reminderJob;
    if (job.isLoading) return `Reading the reminder job${EM}`;
    if (job.isError || !job.status) return 'The reminder job could not be read.';
    if (!job.status.armed) return 'The reminder job is built but not switched on.';
    if (job.status.served === false) return 'No reminders are sent for this restaurant.';
    if (job.status.served === null) return 'Whether reminders are sent here is unknown.';
    if (!job.status.ledgerReadable) return 'Reminders are sent by the server; its ledger is unreadable.';
    if (!job.status.lastRun) return 'Reminders are sent by the server; it has not run here yet.';
    return `Reminders are sent by the server — last run ${sinceOrUntil(job.status.lastRun.startedAt)}.`;
  })();

  useEffect(() => {
    ensureFraunces();
  }, []);

  /* One quiet entrance for the opening line — settle, 6px, once. */
  useEffect(() => {
    if (headRef.current) {
      animate(
        headRef.current,
        [
          { opacity: 0, transform: 'translateY(6px)' },
          { opacity: 1, transform: 'none' },
        ],
        { easing: settle.easing, ms: 420 },
      );
    }
  }, []);

  /* "Show the working" — the page turns when the magnification changes. */
  useEffect(() => {
    if (stageRef.current) {
      animate(
        stageRef.current,
        [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'none' },
        ],
        turn,
      );
    }
  }, [view]);

  /* ── the command-palette deep link ────────────────────────────────────── */
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('openModal') !== 'true') return;
    const raw = params.get('date');
    // `date=today` is what quickActions.ts:81 and Dashboard.tsx:778 actually
    // send; the legacy page feeds it to `new Date()` and gets Invalid Date.
    const day =
      !raw || raw === 'today'
        ? dayKey(new Date())
        : /^\d{4}-\d{2}-\d{2}/.test(raw)
          ? raw.slice(0, 10)
          : dayKey(new Date());
    setCursor(parseDayKey(day));
    setSelected(day);
    setSheet({ mode: 'create', date: day, startTime: null });
    setParams(
      (prev) => {
        prev.delete('openModal');
        prev.delete('date');
        return prev;
      },
      { replace: true },
    );
    // once, on arrival — a later param change is the user's own navigation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── keyboard: parity with the shipping page (NEW-399) ────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || sheet) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case 't':
          setCursor(new Date());
          break;
        case 'm':
          setView('month');
          break;
        case 'w':
          setView('week');
          break;
        case 'd':
          setView('day');
          break;
        case 'a':
          setView('agenda');
          break;
        case 'n':
          e.preventDefault();
          setSheet({ mode: 'create', date: selected ?? dayKey(cursor), startTime: null });
          break;
        case 'ArrowLeft':
          step(-1);
          break;
        case 'ArrowRight':
          step(1);
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, view, cursor, selected]);

  function step(delta: number) {
    setSelected(null);
    setCursor((c) => {
      if (view === 'month') return addMonths(c, delta);
      if (view === 'week') return addDays(startOfWeek(c), delta * 7);
      return addDays(c, delta);
    });
  }

  const openEvent = (event: CalEvent) => setSheet({ mode: 'edit', event });

  /* ── the standing line: only what the page actually knows ─────────────── */
  const standing = useMemo(() => {
    if (!data.hasEvents) {
      if (data.isLoading) return 'Reading the book…';
      return `${EM} The book has not been read.`;
    }
    const deliveries = data.shown.filter(isDelivery);
    const ruled = deliveries.filter(data.isRuledOff).length;
    if (data.shown.length === 0) return 'Nothing is written against this period.';
    const parts = [
      countPhrase(deliveries.length, 'delivery', 'deliveries'),
      countPhrase(data.shown.length - deliveries.length, 'other entry', 'other entries'),
    ].filter(Boolean);
    const tail = ruled > 0 ? ` ${ruled} ruled off.` : '';
    return `${parts.join(' and ')}.${tail}`;
  }, [data.hasEvents, data.isLoading, data.shown, data.isRuledOff]);

  const typesPresent = useMemo(
    () => Array.from(new Set(data.events.map((e) => e.type))).sort(),
    [data.events],
  );

  return (
    <div className="mudavym cn-page" data-ground={ground}>
      <div className="cn-shell">
        <header ref={headRef} className="cn-head">
          <div>
            <Wordmark size={13} />
            <p className="cn-eyebrow" style={{ marginTop: 6 }}>
              The book · {data.start} → {data.end}
            </p>
            <h1 className="cn-period">{periodLabel(view, cursor)}</h1>
            <p className="cn-standing">{standing}</p>
          </div>
          <div className="cn-stack">
            <div className="cn-tabs" role="group" aria-label="Magnification">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  className="cn-tab cn-ink"
                  aria-pressed={view === v.key}
                  onClick={() => {
                    // A day picked on the month is the day you meant; carry it
                    // into the finer magnifications rather than dropping the
                    // operator back on the first of the month.
                    if (selected && (v.key === 'day' || v.key === 'week')) {
                      setCursor(parseDayKey(selected));
                    }
                    if (v.key !== 'month') setSelected(null);
                    setView(v.key);
                  }}
                  title={`${v.label} (${v.hint})`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <div className="cn-row">
              <button type="button" className="cn-btn cn-ink" onClick={() => step(-1)} aria-label="Previous period">
                ‹
              </button>
              <button type="button" className="cn-btn cn-ink" onClick={() => setCursor(new Date())}>
                Today
              </button>
              <button type="button" className="cn-btn cn-ink" onClick={() => step(1)} aria-label="Next period">
                ›
              </button>
              <button
                type="button"
                className="cn-btn cn-ink"
                data-primary="true"
                onClick={() =>
                  setSheet({ mode: 'create', date: selected ?? dayKey(cursor), startTime: null })
                }
              >
                New event
              </button>
            </div>
          </div>
        </header>

        <div className="cn-row" style={{ marginBottom: 12 }}>
          <input
            className="cn-input"
            style={{ maxWidth: 260 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search this period"
            aria-label="Search the entries in this period"
          />
          <select
            className="cn-input"
            style={{ maxWidth: 200 }}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Filter by type"
          >
            <option value="">Every type</option>
            {typesPresent.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        {data.noRestaurant && (
          <p role="status" className="cn-notice">
            No restaurant is active, so there is no book to open. Pick a restaurant and the calendar
            will read.
          </p>
        )}

        {data.forbidden && (
          <p role="status" className="cn-notice">
            The gateway answered <strong>403</strong> for this restaurant&apos;s calendar. Your
            account cannot read it — this is a permission answer, not an empty schedule.
          </p>
        )}

        {data.isError && !data.forbidden && (
          <div role="alert" className="cn-notice">
            <span>
              {data.hasEvents
                ? `The book could not be refreshed (${data.errorMessage}) — what is drawn below is the last answer, not the present.`
                : `The calendar register could not be read (${data.errorMessage}). Nothing below is claimed: the days keep their places and their entries are unknown.`}
            </span>
            <button type="button" className="cn-btn cn-ink" onClick={data.refetch}>
              Try again
            </button>
          </div>
        )}

        {data.isLoading && !data.hasEvents && (
          <p role="status" className="cn-quiet">
            Reading the entries for {data.start} → {data.end}…
          </p>
        )}

        {data.hiddenByFilter > 0 && (
          <p className="cn-quiet">
            {data.hiddenByFilter} {data.hiddenByFilter === 1 ? 'entry is' : 'entries are'} held back
            by the filter — they are in the book, just not on this screen.
          </p>
        )}

        {data.truncated && (
          <p className="cn-quiet">
            The gateway returned the first page of this window
            {data.windowTotal !== null ? ` — ${data.windowTotal} entries exist` : ''}. What is drawn
            below is not the whole period; narrow the view to see the rest.
          </p>
        )}

        {!data.ordersKnown && (
          <p className="cn-quiet">
            The orders book has not answered, so a delivery can only be ruled off by its own status
            — not by its linked order arriving.
          </p>
        )}

        <div ref={stageRef}>
          {view === 'month' && (
            <MonthLedger
              data={data}
              cursor={cursor}
              selected={selected}
              onSelect={setSelected}
              onOpenEvent={openEvent}
              onCreateAt={(day) => setSheet({ mode: 'create', date: day, startTime: null })}
            />
          )}
          {(view === 'week' || view === 'day') && (
            <>
              <TimeGrid
                data={data}
                cursor={cursor}
                days={view === 'week' ? 7 : 1}
                onOpenEvent={openEvent}
                onCreateAt={(day, hour) =>
                  setSheet({ mode: 'create', date: day, startTime: `${String(hour).padStart(2, '0')}:00` })
                }
              />
              {view === 'day' && (
                <DayLedger
                  day={dayKey(cursor)}
                  data={data}
                  onOpenEvent={openEvent}
                  onCreateAt={(day) => setSheet({ mode: 'create', date: day, startTime: null })}
                />
              )}
            </>
          )}
          {view === 'agenda' && <AgendaRoll data={data} onOpenEvent={openEvent} />}
        </div>

        <footer style={{ marginTop: 36 }}>
          <div className="cn-rule2" />
          <div className="cn-head" style={{ marginBottom: 0 }}>
            <Wordmark size={14} />
            <p className="cn-meta" style={{ margin: 0, textAlign: 'right' }}>
              A double rule means the account is ruled off. {reminderLine}
            </p>
          </div>
        </footer>
      </div>

      {sheet && <EventSheet data={data} target={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}
