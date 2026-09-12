/**
 * LogsNext — the Mudavym redesign of `/logs`, behind `mudavym_design_logs`
 * (ADR 0133, the new-pages wave).
 *
 * The founder's verdict, verbatim (MAKEOVER-VERDICTS.md): KEEP — *"That's
 * fine, the new version. I like it."*
 *
 * WHAT IT IS. The house's ledger of what happened, across six registers: the
 * till, the agents, the stock ledger, the paper that arrived, the audit trail
 * and — along a thread — the platform's event store. Read-only; it writes
 * nothing. Its one act is the pivot: any correlation id on the page turns the
 * feed into a thread, and a thread reads like a ledger page — one
 * correlation, its entries in order, ruled off under a double rule.
 *
 * WHAT IT KEEPS FROM ADR 0086, every clause: a register that could not be
 * read is NAMED and shows an em dash, never a count; a register that was not
 * read for this view says so; an undated row prints "not recorded", never
 * "Invalid Date"; a whole-request failure is a failure, not a quiet house;
 * and a gateway that sends neither field makes the page claim nothing.
 *
 * WHAT IT ADDS, the two things the page doc said it lacked (§9):
 *
 *   1. THE WINDOW IS MARKED. "The first 100" is printed as a floor, every
 *      register count carries `≥` while rows remain beyond the window, and the
 *      cap is declared in `LOGS_SERVER_WINDOWS` under
 *      `scripts/check_windowed_figures.py`. The gateway now says whether more
 *      exists, exactly, and the page walks it a page at a time.
 *   2. THE TIMELINE HAS A WAY OUT. A row's register decides where it leads —
 *      the document, the receipts, the stock ledger, the till log, the orders
 *      — and a register with no page of its own says so in words. Never a dead
 *      control.
 *
 * Overlays: one, the entry sheet (`EventSheet.tsx`, Sheet 440). The thread
 * is not an overlay; it is the page, turned.
 *
 * Motions: `MOTIONS.md` in this directory, mirrored in 06-pages/logs.md §1b.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Wordmark } from '@/components/mudavym';
import { useAuth } from '@/contexts/AuthContext';
import { animate, ink, settle, springs, tally, turn, useReducedMotion } from '@/lib/mudavym/motion';
import { useMudavymDesign } from '@/lib/mudavym/useMudavymDesign';
import { EventSheet } from './EventSheet';
import {
  EM,
  GE,
  MONO,
  SANS,
  SERIF,
  describeOf,
  displaySources,
  ensureFraunces,
  fmtClock,
  fmtStamp,
  groupByDay,
  labelOf,
  linkOutFor,
  listSources,
  nameOf,
  orderForThread,
  threadSpan,
  word,
  type LinkContext,
  type TimelineEvent,
} from './lg-format';
import { LOGS_SERVER_WINDOWS, useLogsNextData, type LogsNextData } from './useLogsNextData';

/* ── figures arrive on the tally spring; an unknown never counts ────────── */

function tallyAt(t: number): number {
  const s = springs.tally.samples;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const pos = t * (s.length - 1);
  const i = Math.floor(pos);
  return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (pos - i);
}

function Tally({ value, floor }: { value: number | null; floor: boolean }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<number | null>(value);
  const from = useRef<number | null>(null);
  const raf = useRef(0);

  useEffect(() => {
    cancelAnimationFrame(raf.current);
    if (value === null) {
      from.current = null;
      setShown(null);
      return;
    }
    const start = from.current ?? 0;
    from.current = value;
    if (reduced || start === value) {
      setShown(value);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const p = tallyAt((now - t0) / tally.ms);
      setShown(start + (value - start) * p);
      if (p < 1) raf.current = requestAnimationFrame(step);
      else setShown(value);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, reduced]);

  if (shown === null) return <span className="lg-figure">{EM}</span>;
  return (
    <span className="lg-figure">
      {floor ? <span className="lg-figure__floor">{GE} </span> : null}
      {String(Math.round(shown))}
    </span>
  );
}

/**
 * The page's only stylesheet. Durations and easings are interpolated FROM the
 * tokens, so what runs on screen is the token and not a copy of it. Secondary
 * text is `--ink-4` (6.05:1 on paper, 7.46:1 on charcoal); `--ink-3` is kept
 * for the mono eyebrows at 9–10px bold where it was measured to hold.
 */
const PAGE_CSS = `
.mudavym .lg-root { min-height: 100vh; background: var(--paper-0); color: var(--ink-1); font-family: ${SANS}; }
.mudavym .lg-wrap { max-width: 1040px; margin: 0 auto; padding: 26px 18px 72px; }
.mudavym .lg-ink, .mudavym .lg-ink * { transition: border-color ${ink.ms}ms ${ink.easing}, background-color ${ink.ms}ms ${ink.easing}, color ${ink.ms}ms ${ink.easing}, opacity ${ink.ms}ms ${ink.easing}; }
.mudavym .lg-rule { border-top: 1px solid var(--ink-1); border-bottom: 1px solid var(--ink-1); height: 3px; opacity: 0.5; margin: 16px 0 18px; }
.mudavym .lg-eyebrow { font-family: ${MONO}; font-size: 9.5px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-3); margin: 0; }
.mudavym .lg-eyebrow--seal { color: var(--seal-deep); }
.mudavym .lg-strip { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin: 0 0 18px; padding: 0; list-style: none; }
@media (min-width: 720px) { .mudavym .lg-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (min-width: 980px) { .mudavym .lg-strip { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
.mudavym .lg-cell { display: block; width: 100%; text-align: left; padding: 9px 11px 8px; border: 0; border-left: 2px solid transparent; border-radius: 8px; background: var(--paper-1); color: var(--ink-1); cursor: pointer; font: inherit; }
.mudavym .lg-cell:hover { background: var(--paper-2); }
.mudavym .lg-cell[aria-pressed="true"] { border-left-color: var(--seal); background: var(--seal-tint); }
.mudavym .lg-cell[aria-disabled="true"] { cursor: default; opacity: 0.72; }
.mudavym .lg-cell[aria-disabled="true"]:hover { background: var(--paper-1); }
.mudavym .lg-cell:focus-visible, .mudavym .lg-open:focus-visible, .mudavym .lg-follow:focus-visible, .mudavym .lg-out:focus-visible, .mudavym .lg-btn:focus-visible, .mudavym .lg-input:focus-visible { outline: 2px solid var(--seal); outline-offset: 2px; border-radius: 6px; }
.mudavym .lg-figure { font-family: ${MONO}; font-size: 20px; font-weight: 500; font-variant-numeric: tabular-nums; line-height: 1.1; display: block; margin-top: 3px; }
.mudavym .lg-figure__floor { color: var(--ink-4); font-size: 14px; }
.mudavym .lg-cell__state { display: block; font-size: 10.5px; line-height: 1.4; color: var(--ink-4); margin-top: 2px; min-height: 15px; }
.mudavym .lg-search { display: flex; gap: 8px; align-items: stretch; margin: 0 0 6px; }
.mudavym .lg-input { flex: 1 1 auto; min-width: 0; height: 36px; padding: 0 11px; border: 1px solid var(--paper-2); border-radius: 8px; background: var(--paper-1); color: var(--ink-1); font-family: ${MONO}; font-size: 12px; }
.mudavym .lg-input::placeholder { color: var(--ink-4); font-family: ${SANS}; }
.mudavym .lg-input:hover { border-color: var(--seal-ring); }
.mudavym .lg-btn { height: 36px; padding: 0 14px; border: 1px solid var(--paper-2); border-radius: 8px; background: var(--paper-1); color: var(--ink-1); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.mudavym .lg-btn:hover { border-color: var(--seal-ring); background: var(--paper-2); }
.mudavym .lg-btn--seal { background: var(--seal); border-color: var(--seal); color: var(--paper-0); }
.mudavym .lg-btn--seal:hover { background: var(--seal-deep); border-color: var(--seal-deep); }
.mudavym .lg-btn[disabled] { opacity: 0.6; cursor: default; }
.mudavym .lg-hint { font-size: 11px; color: var(--ink-4); margin: 0 0 16px; }
.mudavym .lg-band { border: 1px solid var(--paper-2); border-left: 2px solid var(--ink-1); border-radius: 10px; padding: 12px 14px; margin: 0 0 16px; font-size: 13px; line-height: 1.55; }
.mudavym .lg-band--quiet { border-left-color: var(--paper-2); color: var(--ink-2); }
.mudavym .lg-band strong { font-family: ${SERIF}; font-weight: 600; font-size: 15px; }
.mudavym .lg-band p { margin: 0; }
.mudavym .lg-band p + p { margin-top: 4px; }
.mudavym .lg-skel { height: 11px; border-radius: 4px; background: var(--paper-2); margin: 8px 0; }
.mudavym .lg-day { margin: 18px 0 4px; }
.mudavym .lg-list { list-style: none; margin: 0; padding: 0; }
.mudavym .lg-row { display: grid; grid-template-columns: 74px 52px minmax(0, 1fr); gap: 10px; align-items: baseline; padding: 8px 6px 8px 8px; border-top: 1px solid var(--paper-2); border-left: 2px solid transparent; }
.mudavym .lg-row:hover { background: var(--paper-1); }
.mudavym .lg-row[data-thread="true"] { grid-template-columns: 30px 74px 52px minmax(0, 1fr); }
@media (min-width: 720px) { .mudavym .lg-row { grid-template-columns: 74px 52px minmax(0, 1fr) auto; } .mudavym .lg-row[data-thread="true"] { grid-template-columns: 30px 74px 52px minmax(0, 1fr) auto; } }
.mudavym .lg-clock { font-family: ${MONO}; font-size: 11px; color: var(--ink-4); font-variant-numeric: tabular-nums; white-space: nowrap; }
.mudavym .lg-clock--none { color: var(--ink-4); font-style: italic; font-family: ${SANS}; }
.mudavym .lg-mark { font-family: ${MONO}; font-size: 9.5px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--seal-deep); white-space: nowrap; }
.mudavym .lg-index { font-family: ${MONO}; font-size: 10px; color: var(--ink-4); }
.mudavym .lg-open { display: block; width: 100%; text-align: left; padding: 0; border: 0; background: none; color: var(--ink-1); font: inherit; font-size: 13.5px; line-height: 1.4; cursor: pointer; }
.mudavym .lg-open:hover { color: var(--seal-deep); }
.mudavym .lg-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; margin-top: 1px; font-size: 11px; color: var(--ink-4); }
.mudavym .lg-follow { border: 0; background: none; padding: 0; font: inherit; font-family: ${MONO}; font-size: 10.5px; color: var(--seal-deep); cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mudavym .lg-follow:hover { text-decoration: underline; }
.mudavym .lg-out { font-size: 12px; color: var(--seal-deep); text-decoration: none; white-space: nowrap; }
.mudavym .lg-out:hover { text-decoration: underline; }
.mudavym .lg-noway { font-size: 11px; color: var(--ink-4); white-space: nowrap; }
.mudavym .lg-thread { margin: 6px 0 0; }
.mudavym .lg-thread__id { font-family: ${MONO}; font-size: 15px; word-break: break-all; margin: 2px 0 0; }
.mudavym .lg-double { border-top: 1px solid var(--ink-1); border-bottom: 1px solid var(--ink-1); height: 3px; opacity: 0.5; margin: 10px 0 8px; }
.mudavym .lg-foot { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; justify-content: space-between; margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--paper-2); font-size: 12px; color: var(--ink-2); }
.mudavym .lg-foot p { margin: 0; }
.mudavym .lg-page-foot { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; border-top: 1px solid var(--paper-2); margin-top: 40px; padding-top: 14px; font-size: 11px; color: var(--ink-4); }
.mudavym .lg-page-foot p { margin: 0; max-width: 720px; }
.mudavym .lg-sheet { padding: 4px 16px 16px; }
.mudavym .lg-facts { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 6px 12px; margin: 0; font-size: 12.5px; }
.mudavym .lg-facts dt { font-family: ${MONO}; font-size: 9.5px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-3); padding-top: 3px; }
.mudavym .lg-facts dd { margin: 0; min-width: 0; word-break: break-word; }
.mudavym .lg-facts__note { color: var(--ink-4); font-style: italic; }
.mudavym .lg-facts .lg-follow { display: block; margin-top: 4px; font-family: ${SANS}; font-size: 12px; }
.mudavym .lg-payload { margin: 0; font-family: ${MONO}; font-size: 11.5px; line-height: 1.5; background: var(--paper-1); border-radius: 8px; padding: 8px 10px; }
.mudavym .lg-payload__line { display: grid; grid-template-columns: minmax(80px, 34%) minmax(0, 1fr); gap: 8px; padding: 3px 0; border-top: 1px solid var(--paper-2); }
.mudavym .lg-payload__line:first-child { border-top: 0; }
.mudavym .lg-payload dt { color: var(--ink-4); }
.mudavym .lg-payload dd { margin: 0; white-space: pre-wrap; word-break: break-word; }
@media (prefers-reduced-motion: reduce) {
  .mudavym .lg-ink, .mudavym .lg-ink * { transition: none !important; }
}
`;

/* ── state bands ──────────────────────────────────────────────────────────── */

function Loading() {
  return (
    <div className="lg-band lg-band--quiet" role="status">
      <p>
        <strong>Reading six registers.</strong>
      </p>
      <p>The till, the agents, the stock ledger, the paper, the audit trail — and the event store when a thread is followed.</p>
      <div aria-hidden>
        <div className="lg-skel" style={{ width: '62%' }} />
        <div className="lg-skel" style={{ width: '48%' }} />
        <div className="lg-skel" style={{ width: '71%' }} />
      </div>
    </div>
  );
}

function Unreadable({ data }: { data: LogsNextData }) {
  const f = data.failure;
  if (f?.forbidden) {
    return (
      <div className="lg-band" role="alert">
        <p>
          <strong>This house’s timeline was refused to your account.</strong>
        </p>
        <p>
          The gateway answered {f.status ?? EM}: {f.message}. Nothing below is a count of anything. Ask an owner of
          this house, or switch to a house you belong to from the header.
        </p>
      </div>
    );
  }
  return (
    <div className="lg-band" role="alert">
      <p>
        <strong>The timeline could not be read.</strong>
      </p>
      <p>
        No register was reached, so this is a failure, not a quiet house. The gateway said:{' '}
        <span style={{ fontFamily: MONO }}>{f?.message ?? 'no message'}</span>
        {f?.status ? ` (${f.status})` : ''}.
      </p>
      <p>
        <button type="button" className="lg-btn lg-ink" onClick={data.refetch} style={{ marginTop: 6 }}>
          Try again
        </button>
      </p>
    </div>
  );
}

/* ── the register strip ───────────────────────────────────────────────────── */

interface StripProps {
  data: LogsNextData;
  active: string | null;
  onToggle: (source: string) => void;
  threadOn: boolean;
}

function RegisterStrip({ data, active, onToggle, threadOn }: StripProps) {
  const sources = useMemo(() => displaySources(data.sourcesQueried), [data.sourcesQueried]);
  const requestFailed = data.state === 'unreadable';
  const loaded = data.events?.length ?? 0;
  // A floor while rows remain beyond the window, or while the gateway did not
  // say and the window is full. Exact only when the gateway said "no more".
  const floor =
    data.hasMore === true || (data.hasMore === null && loaded >= LOGS_SERVER_WINDOWS.TIMELINE);
  const readCount =
    data.sourcesQueried === null ? null : data.sourcesQueried.length - (data.failedSources?.length ?? 0);
  // `sources` is the display list (string[] — it also names a register the
  // gateway sent that this page's SOURCE_ORDER union does not know, on
  // purpose), so membership against the narrower TimelineSource[] is checked
  // with `===`, not `.includes`, to avoid a false narrowing of `s`.
  const skipped = data.sourcesQueried === null ? [] : sources.filter((s) => !data.sourcesQueried!.some((q) => q === s));

  return (
    <div>
      <ul className="lg-strip" aria-label="Registers">
        {sources.map((s) => {
          const failed = data.failedSources?.includes(s as never) ?? false;
          const wasSkipped = !failed && skipped.includes(s);
          const unknown = failed || wasSkipped || requestFailed || data.state === 'loading';
          const count = data.counts ? (data.counts[s] ?? 0) : null;
          const stateWord = failed
            ? 'could not be read'
            : wasSkipped
              ? threadOn
                ? 'not read for this view'
                : 'read only along a thread'
              : requestFailed
                ? 'not reached'
                : data.state === 'loading'
                  ? 'reading'
                  : data.counts && data.sourcesQueried === null
                    ? 'rows on this page'
                    : count === 0
                      ? 'nothing on this page'
                      : floor
                        ? 'on this page, at least'
                        : 'on this page';
          const pressed = active === s;
          return (
            <li key={s}>
              <button
                type="button"
                className="lg-cell lg-ink"
                aria-pressed={pressed}
                aria-disabled={unknown ? 'true' : undefined}
                title={describeOf(s)}
                onClick={() => {
                  if (!unknown) onToggle(s);
                }}
              >
                <span className="lg-eyebrow">{labelOf(s)}</span>
                <Tally value={unknown ? null : count} floor={!unknown && floor && (count ?? 0) > 0} />
                <span className="lg-cell__state">{stateWord}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {/* Presence is stated, not assumed: only when the gateway reported which registers it read. */}
      {!requestFailed && readCount !== null ? (
        <p className="lg-hint">
          Read {readCount} of {sources.length} registers
          {skipped.length > 0 ? ` · not read: ${listSources(skipped)}` : ''}
          {active ? ` · showing ${nameOf(active)} only` : ''}
        </p>
      ) : (
        <p className="lg-hint">{active ? `Showing ${nameOf(active)} only` : ' '}</p>
      )}
    </div>
  );
}

/* ── a row ────────────────────────────────────────────────────────────────── */

interface RowProps {
  e: TimelineEvent;
  index?: number;
  link: LinkContext;
  onOpen: (e: TimelineEvent) => void;
  onFollow: (id: string) => void;
  showDate?: boolean;
}

function Row({ e, index, link, onOpen, onFollow, showDate }: RowProps) {
  const out = linkOutFor(e, link);
  const undated = !e.occurredAt;
  return (
    <li className="lg-row lg-ink" data-thread={index !== undefined ? 'true' : undefined}>
      {index !== undefined ? <span className="lg-index">{String(index).padStart(2, '0')}</span> : null}
      <span className={`lg-clock${undated ? ' lg-clock--none' : ''}`} title={undated ? 'This row records no timestamp' : undefined}>
        {showDate ? fmtStamp(e.occurredAt) : fmtClock(e.occurredAt)}
      </span>
      <span className="lg-mark">{labelOf(e.source)}</span>
      <div style={{ minWidth: 0 }}>
        <button type="button" className="lg-open lg-ink" onClick={() => onOpen(e)}>
          {e.summary}
        </button>
        <div className="lg-meta">
          {e.correlationId ? (
            <button
              type="button"
              className="lg-follow lg-ink"
              aria-label={`Follow thread ${e.correlationId}`}
              title={`Follow thread ${e.correlationId}`}
              onClick={() => onFollow(e.correlationId as string)}
            >
              {e.correlationId}
            </button>
          ) : (
            <span>no thread</span>
          )}
        </div>
      </div>
      {out ? (
        <Link to={out.to} className="lg-out lg-ink">
          {out.label}
        </Link>
      ) : (
        <span className="lg-noway">no page of its own</span>
      )}
    </li>
  );
}

/* ── the window, at the foot of the list ──────────────────────────────────── */

function WindowFoot({ data, shown, threadOn }: { data: LogsNextData; shown: number; threadOn: boolean }) {
  const loaded = data.events?.length ?? 0;
  const failed = data.failedSources ?? [];
  const what = threadOn ? 'this thread holds' : 'the registers hold';
  let sentence: string;
  if (data.stalled) {
    sentence = `Older entries exist, but the last page holds no dated entry to page from — the feed cannot walk past this point. ${loaded} entries are on the page.`;
  } else if (data.hasMore === true) {
    sentence = `Showing the first ${loaded} entries · older entries exist${
      data.window !== null ? ` — the gateway reads ${data.window} at a time` : ''
    }.`;
  } else if (data.hasMore === false) {
    sentence = `All ${loaded} entries ${what} are on the page.`;
  } else {
    sentence = `Showing the first ${loaded} entries · whether older entries exist was not reported by this gateway.`;
  }
  return (
    <div className="lg-foot" aria-live="polite">
      <div>
        <p>{sentence}</p>
        {shown !== loaded ? <p>{shown} of them match the register you chose.</p> : null}
        {failed.length > 0 ? (
          <p>
            Every count is a floor: {listSources(failed)} could not be read, so the feed is missing whatever{' '}
            {failed.length === 1 ? 'that register holds' : 'those registers hold'}.
          </p>
        ) : null}
      </div>
      {data.hasMore === true && !data.stalled ? (
        <button type="button" className="lg-btn lg-ink" onClick={data.readMore} disabled={data.readingMore}>
          {data.readingMore ? 'Reading older entries…' : 'Read older entries'}
        </button>
      ) : null}
    </div>
  );
}

/* ── the page ─────────────────────────────────────────────────────────────── */

export interface LogsNextProps {
  /** Force the Warm Charcoal ground regardless of app theme (ADR 0042). */
  ground?: 'paper' | 'charcoal';
}

export default function LogsNext({ ground }: LogsNextProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const correlationId = searchParams.get('correlationId')?.trim() || null;
  const [draft, setDraft] = useState(correlationId ?? '');
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [open, setOpen] = useState<TimelineEvent | null>(null);
  const { activeRestaurantId } = useAuth();
  const documentPageOn = useMudavymDesign('document');
  const data = useLogsNextData(correlationId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const headRef = useRef<HTMLElement | null>(null);
  const ledgerRef = useRef<HTMLElement | null>(null);
  const firstPaint = useRef(true);

  useEffect(() => {
    ensureFraunces();
  }, []);

  // lg-arrive — the opening, once.
  useEffect(() => {
    if (!headRef.current) return;
    animate(headRef.current, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], settle);
  }, []);

  // lg-turn — the page turns when a thread is entered or left. "Show the
  // working" is exactly what following a thread is.
  useEffect(() => {
    if (firstPaint.current) {
      firstPaint.current = false;
      return;
    }
    if (!ledgerRef.current) return;
    animate(ledgerRef.current, [{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], turn);
  }, [correlationId]);

  // The URL is the one source of truth for the thread; the input mirrors it.
  useEffect(() => {
    setDraft(correlationId ?? '');
  }, [correlationId]);

  // `/` puts the cursor in the thread box, from anywhere on the page that is
  // not already a field. The house header owns the command chord.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== '/' || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      ev.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const follow = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams);
      const trimmed = id.trim();
      if (trimmed) next.set('correlationId', trimmed);
      else next.delete('correlationId');
      setSearchParams(next);
      setOpen(null);
      setActiveSource(null);
    },
    [searchParams, setSearchParams],
  );

  const leave = useCallback(() => follow(''), [follow]);

  const link: LinkContext = useMemo(
    () => ({
      documentPageOn,
      posLogAvailable: !import.meta.env.PROD,
      restaurantId: activeRestaurantId,
    }),
    [documentPageOn, activeRestaurantId],
  );

  const events = data.events;
  const visible = useMemo(
    () => (events ? (activeSource ? events.filter((e) => e.source === activeSource) : events) : null),
    [events, activeSource],
  );
  const days = useMemo(() => (visible ? groupByDay(visible) : []), [visible]);
  const thread = useMemo(() => (visible && correlationId ? orderForThread(visible) : null), [visible, correlationId]);
  const span = useMemo(() => (thread ? threadSpan(thread) : null), [thread]);
  const someFailed = (data.failedSources?.length ?? 0) > 0;

  return (
    <div className="mudavym" data-ground={ground}>
      <style>{PAGE_CSS}</style>
      <div className="lg-root">
        <div className="lg-wrap">
          {/* ── The opening — Fraunces speaks ─────────────────────────── */}
          <header ref={headRef}>
            <Wordmark size={13} />
            <h1 style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.1, margin: '4px 0 0' }}>
              Logs<span style={{ color: 'var(--seal)' }}>.</span>
            </h1>
            <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 15, color: 'var(--ink-2)', margin: '6px 0 0' }}>
              What the house recorded, across six registers.
            </p>
            <p style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--ink-2)', margin: '8px 0 0', maxWidth: 680 }}>
              Every entry is a row one of the house’s registers wrote — the till, the agents, the stock ledger, the
              paper that arrived, the audit trail and, along a thread, the platform’s event store. A register that
              could not be read is named. A count taken inside the window is a floor. Any correlation id on the page
              turns the feed into a thread.
            </p>
          </header>

          <div className="lg-rule" aria-hidden />

          {/* ── The registers ──────────────────────────────────────────── */}
          <RegisterStrip
            data={data}
            active={activeSource}
            onToggle={(s) => setActiveSource((cur) => (cur === s ? null : s))}
            threadOn={!!correlationId}
          />

          {/* ── The thread box ─────────────────────────────────────────── */}
          <form
            className="lg-search"
            role="search"
            onSubmit={(ev) => {
              ev.preventDefault();
              follow(draft);
            }}
          >
            <input
              ref={inputRef}
              className="lg-input lg-ink"
              value={draft}
              onChange={(ev) => setDraft(ev.target.value)}
              placeholder="Follow a correlation id"
              aria-label="Correlation id"
              spellCheck={false}
              autoComplete="off"
            />
            <button type="submit" className="lg-btn lg-btn--seal lg-ink">
              Follow
            </button>
            {correlationId ? (
              <button type="button" className="lg-btn lg-ink" onClick={leave}>
                Leave the thread
              </button>
            ) : null}
          </form>
          <p className="lg-hint">
            Press <span style={{ fontFamily: MONO }}>/</span> to jump here. A thread reads every register that
            carries the id, the event store included.
          </p>

          {/* ── The ledger ─────────────────────────────────────────────── */}
          <main ref={ledgerRef} key={correlationId ?? '__feed'} aria-label={correlationId ? 'One thread' : 'The feed'}>
            {data.state === 'loading' ? <Loading /> : null}
            {data.state === 'unreadable' ? <Unreadable data={data} /> : null}

            {data.state === 'ready' && someFailed ? (
              <div className="lg-band" role="alert">
                <p>
                  <strong>
                    {data.failedSources!.length === 1
                      ? 'One register could not be read'
                      : `${word(data.failedSources!.length)} registers could not be read`}
                    :
                  </strong>{' '}
                  {listSources(data.failedSources!)}. Every count on this page is a floor — the feed is missing whatever{' '}
                  {data.failedSources!.length === 1 ? 'that register holds' : 'those registers hold'}.
                </p>
              </div>
            ) : null}

            {data.state === 'ready' && visible && visible.length === 0 ? (
              <div className="lg-band lg-band--quiet" role="status">
                <p>
                  <strong>
                    {correlationId
                      ? 'No entry carries this correlation id.'
                      : activeSource
                        ? `Nothing from ${nameOf(activeSource)} on this page.`
                        : 'No entries.'}
                  </strong>
                </p>
                <p>
                  {someFailed
                    ? 'The registers that could be read hold nothing for this view; the ones that failed are named above.'
                    : correlationId
                      ? 'The registers that were read hold no row with this id. A thread is only as complete as the rows that carry it.'
                      : activeSource
                        ? 'Other registers have rows on this page — choose another, or clear the choice.'
                        : 'The registers answered and hold nothing for this house yet.'}
                </p>
              </div>
            ) : null}

            {data.state === 'ready' && thread && span && thread.length > 0 ? (
              <section className="lg-thread" aria-labelledby="lg-thread-heading">
                <p className="lg-eyebrow lg-eyebrow--seal">One thread</p>
                <h2 id="lg-thread-heading" className="lg-thread__id">
                  {correlationId}
                </h2>
                <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 14, color: 'var(--ink-2)', margin: '4px 0 10px' }}>
                  {thread.length === 1 ? 'One entry' : `${thread.length} entries`} across {word(span.registers)}{' '}
                  {span.registers === 1 ? 'register' : 'registers'}
                  {span.first && span.last
                    ? span.first === span.last
                      ? `, at ${fmtStamp(span.first)}`
                      : `, from ${fmtStamp(span.first)} to ${fmtStamp(span.last)}`
                    : ', none of them dated'}
                  .
                </p>
                <ol className="lg-list">
                  {thread.map((e, i) => (
                    <Row key={`${e.source}:${e.id}`} e={e} index={i + 1} link={link} onOpen={setOpen} onFollow={follow} showDate />
                  ))}
                </ol>
                <div className="lg-double" aria-hidden />
                <p className="lg-eyebrow">Ruled off · {thread.length === 1 ? 'one entry' : `${thread.length} entries`}</p>
              </section>
            ) : null}

            {data.state === 'ready' && !correlationId && visible && visible.length > 0
              ? days.map((d) => (
                  <section key={d.key ?? '__undated'} aria-label={d.heading}>
                    <p className="lg-eyebrow lg-day">{d.heading}</p>
                    <ul className="lg-list">
                      {d.events.map((e) => (
                        <Row key={`${e.source}:${e.id}`} e={e} link={link} onOpen={setOpen} onFollow={follow} />
                      ))}
                    </ul>
                  </section>
                ))
              : null}

            {data.state === 'ready' && events ? (
              <WindowFoot data={data} shown={visible?.length ?? 0} threadOn={!!correlationId} />
            ) : null}
          </main>

          <footer className="lg-page-foot">
            <Wordmark size={13} />
            <p>
              A register shown as an em dash reported nothing, which is not the same as reporting none. A count with
              the floor mark was taken inside a window; the window is stated at the foot of the list. Nothing on this
              page is written by it.
            </p>
          </footer>
        </div>
      </div>

      <EventSheet event={open} onClose={() => setOpen(null)} onFollow={follow} link={link} />
    </div>
  );
}
