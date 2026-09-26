/**
 * HeldBand — wines below par that the house is holding for the digest.
 *
 * Founder, 2026-09-26, round 8 (ADR 0149): built into the Mudavym day-book
 * before the cutover, because the legacy page (`pages/Notifications.tsx:925-
 * 983`) was the only screen that showed this queue.
 *
 * WHAT IT DOES THAT THE LEGACY STRIP DID NOT. The legacy strip had no actions
 * at all: a count, eight wine chips and "+N more" that could not be opened,
 * with the reason only in a hover `title` (unreachable by keyboard, touch and
 * screen readers), and it VANISHED when the queue was empty — so "nothing is
 * held" and "the strip failed to mount" looked the same. Here:
 *   - the reason is written on every line, in words;
 *   - every held wine can be listed ("Show all"), not only the first eight;
 *   - it says WHEN the held wines will be told — or that they will not be,
 *     when the digest is off — from the gateway's own reading of the house's
 *     preferences, and says so when that could not be read;
 *   - each wine opens in inventory (`/inventory?wine=`, the deep link
 *     `InventoryCommandPage.tsx` already honours), and the settings that
 *     cause the hold are one link away (`/settings?tab=notifications`);
 *   - the empty queue is a stated fact, and a failed read says it is a
 *     failed read.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: send a held alert now, or dismiss one.
 * Neither exists in the gateway or on the legacy page; a "send now" would be a
 * new outbound act, which is the founder's call (reported, not built).
 *
 * The calm idiom (HouseBand): the card is dashed — a held alert is something
 * the house chose NOT to send, and must be visually incapable of looking like
 * something that was.
 */

import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Hourglass, RotateCw, Settings2, TriangleAlert } from 'lucide-react';
import type { HeldLowStockCrossing } from '@/services/api/notifications';
import { MONO, SANS, SERIF, stampOf, timeAgo } from './nt-format';
import type { HeldVM } from './useHeldLowStock';
import { reasonWords, whenTold } from './nt-held';

const DASHED = '1.5px dashed var(--seal-ring)';

/** How many lines show before "Show all". */
export const HELD_FIRST = 5;

const BUTTON =
  'nt-ink inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal';

function HeldLine({ h }: { h: HeldLowStockCrossing }) {
  const name = h.wine_name ?? 'Unnamed wine';
  const critical = h.level === 'critical';
  return (
    <li className="nt-line flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
      <div className="min-w-0">
        <p className="inline-flex flex-wrap items-baseline gap-2 text-[13px]" style={{ color: 'var(--ink-1)' }}>
          <span className="font-semibold">{name}</span>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: critical ? 'var(--seal-deep)' : 'var(--ink-4)',
            }}
          >
            {critical ? 'Critical' : 'Low'}
          </span>
        </p>
        <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--ink-4)' }}>
          {reasonWords(h.reason)}{' '}
          <time dateTime={h.held_at} title={stampOf(h.held_at)} style={{ fontFamily: MONO }}>
            {timeAgo(h.held_at)}
          </time>
        </p>
      </div>
      {h.wine_name && (
        <Link
          to={`/inventory?wine=${encodeURIComponent(h.wine_name)}`}
          aria-label={`Find ${h.wine_name} in inventory`}
          className={BUTTON}
          style={{ border: '1px solid var(--paper-2)', color: 'var(--ink-2)' }}
        >
          Find it in inventory
          <ArrowRight size={12} strokeWidth={1.75} aria-hidden />
        </Link>
      )}
    </li>
  );
}

export interface HeldBandProps {
  held: HeldVM & { refresh: () => void };
}

export function HeldBand({ held }: HeldBandProps) {
  const [showAll, setShowAll] = useState(false);
  const listId = useId();

  return (
    <section aria-labelledby="nt-held" className="mb-6" aria-busy={held.state === 'loading'}>
      <h2
        id="nt-held"
        className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em]"
        style={{ fontFamily: MONO, color: 'var(--ink-4)' }}
      >
        <Hourglass size={12} strokeWidth={1.75} aria-hidden />
        Held for the digest
      </h2>

      {held.state === 'loading' && (
        <>
          <div className="nt-skel mt-2 h-9" aria-hidden />
          <p className="sr-only">Reading the low-stock wines held for the digest.</p>
        </>
      )}

      {held.state === 'unreadable' && (
        <div
          role="alert"
          className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl px-3.5 py-2.5"
          style={{ border: '1px solid var(--paper-2)', background: 'var(--paper-1)' }}
        >
          <span className="inline-flex items-start gap-2 text-[12px]" style={{ color: 'var(--ink-2)' }}>
            <TriangleAlert size={13} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
            {held.failure.forbidden
              ? `This account is not allowed to read the held low-stock wines (${held.failure.status ?? 'refused'}). This is not a claim that none are waiting.`
              : `The held low-stock wines could not be read (${held.failure.message}). This is not a claim that none are waiting.`}
          </span>
          {!held.failure.forbidden && (
            <button
              type="button"
              onClick={held.refresh}
              className={BUTTON}
              style={{
                border: '1px solid var(--seal-ring)',
                background: 'transparent',
                color: 'var(--seal-deep)',
                cursor: 'pointer',
              }}
            >
              <RotateCw size={12} strokeWidth={1.75} aria-hidden />
              Try again
            </button>
          )}
        </div>
      )}

      {held.state === 'ready' && held.view.held.length === 0 && (
        <p className="mt-2 text-[12px] italic" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
          No wine is waiting to be told about. When one drops below par and the house holds the
          alert for the digest, it is listed here.
        </p>
      )}

      {held.state === 'ready' && held.view.held.length > 0 && (() => {
        const { held: rows, summary, digest } = held.view;
        const shown = showAll ? rows : rows.slice(0, HELD_FIRST);
        const hidden = rows.length - shown.length;
        return (
          <div className="mt-2 rounded-xl px-3.5 py-3" style={{ border: DASHED, background: 'var(--paper-0)' }}>
            <p className="text-[15px]" style={{ fontFamily: SERIF, color: 'var(--ink-1)' }}>
              {summary.count} {summary.count === 1 ? 'wine is' : 'wines are'} below par and nobody
              has been told yet
              {summary.critical > 0 && (
                <span style={{ color: 'var(--seal-deep)' }}> · {summary.critical} critical</span>
              )}
            </p>
            <p className="mt-0.5 text-[12px]" style={{ fontFamily: SANS, color: 'var(--ink-2)' }}>
              {whenTold(digest)}
            </p>
            <ul
              id={listId}
              aria-label="Wines held for the digest"
              className="mt-2"
              style={{ borderTop: '1px solid var(--paper-2)', fontFamily: SANS }}
            >
              {shown.map((h) => (
                <HeldLine key={h.inventory_id} h={h} />
              ))}
            </ul>
            <div className="mt-2.5 flex flex-wrap items-center gap-2" style={{ fontFamily: SANS }}>
              {(hidden > 0 || showAll) && rows.length > HELD_FIRST && (
                <button
                  type="button"
                  aria-expanded={showAll}
                  aria-controls={listId}
                  onClick={() => setShowAll((s) => !s)}
                  className={BUTTON}
                  style={{
                    border: '1px solid var(--paper-2)',
                    background: 'transparent',
                    color: 'var(--ink-2)',
                    cursor: 'pointer',
                  }}
                >
                  {showAll ? `Show the first ${HELD_FIRST}` : `Show all ${rows.length}`}
                </button>
              )}
              <Link
                to="/settings?tab=notifications"
                className={BUTTON}
                style={{ border: '1px solid var(--seal-ring)', color: 'var(--seal-deep)' }}
              >
                <Settings2 size={12} strokeWidth={1.75} aria-hidden />
                Change when low stock tells you
              </Link>
            </div>
          </div>
        );
      })()}
    </section>
  );
}

export default HeldBand;
