/**
 * BookRow — one line of the day-book.
 *
 * The same component draws a line that still needs a hand and a line that has
 * been ruled off; `subdued` is the only difference, because that is the whole
 * Editorial idea the founder kept: the page quiets as it is worked, it does
 * not become a different page.
 *
 * Density (the Federation idea the founder kept) lives in the COLLAPSED line:
 * register · priority · title · the row's own message · how many duplicates
 * were folded into it · age. Expanding adds every fact the row actually
 * carries — and only those; a key the metadata does not hold is omitted
 * rather than printed as a zero.
 */

import type { ReactNode, Ref } from 'react';
import { Link } from 'react-router-dom';
import {
  AlarmClock,
  Archive,
  ChevronRight,
  CornerUpLeft,
  Stamp,
  Sunrise,
  Trash2,
} from 'lucide-react';
import type { Notification } from '@/services/api/notifications';
import type { FoldFreshness } from './nt-book';
import { DURATIONS, sleepsFor } from './nt-snooze';
import {
  EM,
  MONO,
  SANS,
  actionTargetOf,
  belowParFrom,
  factsFrom,
  iconForType,
  kindOf,
  plainText,
  stampOf,
  timeAgo,
} from './nt-format';

export interface BookRowProps {
  row: Notification;
  /** Duplicates the digest stacker folded into this line (0 when none). */
  folded: number;
  /**
   * The newest stamp inside the fold, when it is newer than the surviving
   * line's own. The stacker picks a below-par winner by highest wine count,
   * not by date (`lib/notificationStack.ts:59-65`), so the headline line can
   * be hours older than the news it stands for — measured at 5h20m on the
   * production book on 2026-09-03. The line says both rather than either.
   */
  fold?: FoldFreshness;
  open: boolean;
  onToggle: () => void;
  /** Ruled-off rendering: the line stays legible but stops asking. */
  subdued?: boolean;
  /** Keyboard cursor — j/k move it, and the line shows where it is. */
  selected?: boolean;
  rowRef?: Ref<HTMLLIElement>;
  onRuleOff?: () => void;
  onReopen?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  /** Put the line down for `ms`; it wakes on its own. Per browser. */
  onSnooze?: (ms: number) => void;
  /** Bring a sleeping line back now. */
  onWake?: () => void;
  /** Epoch ms this line is due back, when it is asleep. */
  asleepUntil?: number | null;
}

function Control({
  children,
  onClick,
  emphasis,
  icon: Icon,
}: {
  children: ReactNode;
  onClick: () => void;
  emphasis?: boolean;
  icon: typeof Archive;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="nt-ink inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
      style={{
        fontFamily: SANS,
        border: `1px solid ${emphasis ? 'var(--seal-ring)' : 'var(--paper-2)'}`,
        background: 'transparent',
        color: emphasis ? 'var(--seal-deep)' : 'var(--ink-2)',
        cursor: 'pointer',
      }}
    >
      <Icon size={12} strokeWidth={1.75} aria-hidden />
      {children}
    </button>
  );
}

export function BookRow({
  row,
  folded,
  fold,
  open,
  onToggle,
  subdued = false,
  selected = false,
  rowRef,
  onRuleOff,
  onReopen,
  onArchive,
  onDelete,
  onSnooze,
  onWake,
  asleepUntil = null,
}: BookRowProps) {
  const facts = factsFrom(row);
  const wines = belowParFrom(row);
  const target = actionTargetOf(row);
  const urgent = row.priority === 'critical' || row.priority === 'high';
  const ink = subdued ? 'var(--ink-4)' : 'var(--ink-1)';
  const kind = kindOf(row.type);
  // The mark the register earns, drawn here — never the emoji the producer
  // once stored in the title (see `plainText` / `iconForType` in nt-format).
  const Mark = iconForType(row.type);
  const title = plainText(row.title);
  const message = plainText(row.message);

  return (
    <li
      ref={rowRef}
      className="nt-line nt-ink"
      data-subdued={subdued ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      style={{
        borderLeft: `2px solid ${
          selected ? 'var(--ink-1)' : urgent && !subdued ? 'var(--seal)' : 'transparent'
        }`,
        background: selected ? 'var(--paper-1)' : undefined,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-baseline gap-3 px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        <span
          className="inline-flex shrink-0 items-center gap-1"
          style={{
            fontFamily: MONO,
            fontSize: 8.5,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--ink-4)',
            border: '1px solid var(--paper-2)',
            borderRadius: 3,
            padding: '2px 5px',
          }}
        >
          <Mark size={10} strokeWidth={1.75} aria-hidden />
          {kind}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-[13px]"
            style={{ fontFamily: SANS, fontWeight: subdued ? 400 : 600, color: ink }}
          >
            {title || 'Untitled entry'}
          </span>
          <span
            className="block truncate text-[11.5px]"
            style={{ fontFamily: SANS, color: 'var(--ink-4)' }}
          >
            {message || 'No message was written on this line.'}
          </span>
        </span>
        {folded > 0 && (
          <span
            className="shrink-0"
            style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-4)' }}
          >
            +{folded} folded
          </span>
        )}
        {asleepUntil !== null && (
          <span
            className="shrink-0 inline-flex items-center gap-1"
            style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--seal-deep)' }}
          >
            <AlarmClock size={10} strokeWidth={1.75} aria-hidden />
            back in {sleepsFor(asleepUntil)}
          </span>
        )}
        <span
          className="shrink-0 text-right"
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--ink-4)',
          }}
        >
          {/*
            A folded line whose winner is older than its newest member shows
            the NEWEST first: that is the age of the news, and the winner's own
            age is drawn beneath it so neither is hidden.
          */}
          {fold?.winnerIsStale && fold.newestAt !== null ? (
            <>
              <span className="block" style={{ color: 'var(--ink-1)' }}>
                {timeAgo(new Date(fold.newestAt).toISOString())}
              </span>
              <span className="block text-[9px]">
                this line {timeAgo(row.timestamp ?? row.createdAt)}
              </span>
            </>
          ) : (
            timeAgo(row.timestamp ?? row.createdAt)
          )}
        </span>
        <span aria-hidden className="nt-chev shrink-0 leading-none" data-open={open}>
          <ChevronRight size={14} strokeWidth={1.75} />
        </span>
      </button>

      <div className="nt-expand" data-open={open}>
        <div>
          <div className="border-t px-3 py-3" style={{ borderColor: 'var(--paper-2)' }}>
            <p className="text-[12.5px]" style={{ fontFamily: SANS, color: 'var(--ink-2)' }}>
              {message || 'This line carries no message beyond its title.'}
            </p>

            {folded > 0 && (
              <p className="mt-1.5 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
                {folded} earlier {folded === 1 ? 'repeat is' : 'repeats are'} folded into this line.
                {fold?.newestAt !== null && fold?.newestAt !== undefined ? (
                  <>
                    {' '}
                    The newest of them was written{' '}
                    <span style={{ fontFamily: MONO, color: 'var(--ink-2)' }}>
                      {stampOf(new Date(fold.newestAt).toISOString())}
                    </span>
                    {fold.winnerIsStale
                      ? ' — later than the line standing for them, which is the one with the highest count rather than the latest date.'
                      : '.'}
                  </>
                ) : null}
              </p>
            )}

            {facts.length > 0 && (
              <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {facts.map((f) => (
                  <div key={f.label} className="flex justify-between gap-3 text-[11.5px]">
                    <dt style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>{f.label}</dt>
                    <dd
                      className="m-0 truncate"
                      style={{
                        fontFamily: MONO,
                        fontVariantNumeric: 'tabular-nums',
                        color: 'var(--ink-2)',
                      }}
                    >
                      {f.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {wines.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[11.5px]" style={{ fontFamily: SANS }}>
                  <caption className="sr-only">Wines this line says are below par</caption>
                  <thead>
                    <tr style={{ color: 'var(--ink-4)' }}>
                      <th className="py-1 text-left font-normal">Wine</th>
                      <th className="py-1 text-right font-normal">On hand</th>
                      <th className="py-1 text-right font-normal">Par</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wines.map((w, i) => (
                      <tr key={`${w.wineName}-${i}`} style={{ color: 'var(--ink-2)' }}>
                        <td className="truncate py-0.5 pr-3">{w.wineName}</td>
                        <td
                          className="py-0.5 text-right"
                          style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}
                        >
                          {w.currentStock ?? EM}
                        </td>
                        <td
                          className="py-0.5 text-right"
                          style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}
                        >
                          {w.threshold ?? EM}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {target ? (
                <Link
                  to={target.to}
                  className="nt-ink rounded px-2 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
                  style={{
                    fontFamily: SANS,
                    border: '1px solid var(--seal-ring)',
                    color: 'var(--seal-deep)',
                  }}
                >
                  {target.label} →
                </Link>
              ) : (
                <span className="text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
                  This line carries no link — it was written without one.
                </span>
              )}
              {onRuleOff && (
                <Control onClick={onRuleOff} emphasis icon={Stamp}>
                  Rule it off
                </Control>
              )}
              {onReopen && (
                <Control onClick={onReopen} icon={CornerUpLeft}>
                  Reopen
                </Control>
              )}
              {onWake && (
                <Control onClick={onWake} emphasis icon={Sunrise}>
                  Bring it back now
                </Control>
              )}
              {onArchive && (
                <Control onClick={onArchive} icon={Archive}>
                  Archive
                </Control>
              )}
              {onDelete && (
                <Control onClick={onDelete} icon={Trash2}>
                  Delete
                </Control>
              )}
            </div>

            {onSnooze && (
              <div
                className="mt-2.5 pt-2"
                style={{ borderTop: '1px solid var(--paper-2)' }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em]"
                    style={{ fontFamily: MONO, color: 'var(--ink-4)' }}
                  >
                    <AlarmClock size={11} strokeWidth={1.75} aria-hidden />
                    Put it down for
                  </span>
                  {DURATIONS.map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => onSnooze(d.ms)}
                      className="nt-ink rounded-full px-2.5 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
                      style={{
                        fontFamily: SANS,
                        border: '1px solid var(--paper-2)',
                        background: 'transparent',
                        color: 'var(--ink-2)',
                        cursor: 'pointer',
                      }}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <p
                  className="mt-1.5 text-[10.5px]"
                  style={{ fontFamily: SANS, color: 'var(--ink-4)' }}
                >
                  It comes back on its own the moment the register writes about this again — a
                  newer line or one more folded repeat — and in any case when the time is up.
                  Stored in this browser only: the server was not told, and another device still
                  shows it.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

export default BookRow;
