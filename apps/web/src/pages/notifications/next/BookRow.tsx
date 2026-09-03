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

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ChevronRight, CornerUpLeft, Inbox, Stamp, Trash2 } from 'lucide-react';
import type { Notification } from '@/services/api/notifications';
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
  timeAgo,
} from './nt-format';

export interface BookRowProps {
  row: Notification;
  /** Duplicates the digest stacker folded into this line (0 when none). */
  folded: number;
  open: boolean;
  onToggle: () => void;
  /** Ruled-off rendering: the line stays legible but stops asking. */
  subdued?: boolean;
  onRuleOff?: () => void;
  onReopen?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  onSetAside?: () => void;
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
  open,
  onToggle,
  subdued = false,
  onRuleOff,
  onReopen,
  onArchive,
  onDelete,
  onSetAside,
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
      className="nt-line nt-ink"
      data-subdued={subdued ? 'true' : 'false'}
      style={{ borderLeft: `2px solid ${urgent && !subdued ? 'var(--seal)' : 'transparent'}` }}
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
        <span
          className="shrink-0"
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--ink-4)',
          }}
        >
          {timeAgo(row.timestamp ?? row.createdAt)}
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
              {onSetAside && (
                <Control onClick={onSetAside} icon={Inbox}>
                  Set aside
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
          </div>
        </div>
      </div>
    </li>
  );
}

export default BookRow;
