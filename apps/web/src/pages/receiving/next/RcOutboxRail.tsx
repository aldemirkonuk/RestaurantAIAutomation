/**
 * RcOutboxRail — what is queued on phones right now, and what was dropped.
 *
 * Shared across all three roles, because the outbox is a fact about the
 * building, not about a role. Two ledgers:
 *
 * 1. QUEUED — receipts saved on a phone that have not reached the server yet
 *    (`doorOutbox`'s pending-mutation queue), each named, with its attempt
 *    count out of 8 and the last error verbatim.
 * 2. DROPPED — the defect fix (v3.0-TECH-DEBT / motion canvas inv-09):
 *    `flushDoorOutbox` permanently discards a receipt on a 4xx or after 8
 *    attempts and the legacy page throws that `failed` count away, so a
 *    dropped receipt looks identical to a delivered one. Here every drop is
 *    pinned by name and stays until a person dismisses it. Nothing vanishes;
 *    the drop becomes a pin (turn, then the stamp landing).
 *
 * Honesty: a storage read that throws renders as "unknown", never as an
 * empty queue — and the empty state says what emptiness means.
 */

import { useEffect, useRef } from 'react';
import { animate, ink, stamp, turn, useReducedMotion } from '@/lib/mudavym/motion';
import { EM, MONO, SANS, SERIF, capStyle, fmtDate } from './rc-format';
import type { OutboxData } from './useReceivingNextData';

const timeShort = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

function PinnedDrop({
  label,
  droppedAt,
  exact,
  isNew,
  onDismiss,
}: {
  label: string;
  droppedAt: string;
  exact: boolean;
  isNew: boolean;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();

  // The pin travels in on `turn`, then lands on the house `stamp` — inv-09's
  // spec, verbatim. Only a pin arriving THIS session moves; a pin restored
  // from storage was already landed when you walked in.
  useEffect(() => {
    if (!isNew || reduced || !ref.current) return;
    const el = ref.current;
    const travel = animate(
      el,
      [
        { opacity: 0, transform: 'translateY(-8px) scale(0.96)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ],
      turn,
    );
    travel?.finished
      .then(() => {
        animate(el, [{ transform: 'scale(0.97)' }, { transform: 'scale(1)' }], stamp);
      })
      .catch(() => {});
  }, [isNew, reduced]);

  return (
    <div
      ref={ref}
      role="alert"
      style={{
        border: '1px solid var(--ink-1, #211C16)',
        borderRadius: 10,
        background: 'var(--paper-0, #FAF7F1)',
        padding: '10px 12px',
        fontFamily: SANS,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 8.5,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--paper-0, #FAF7F1)',
            background: 'var(--ink-1, #211C16)',
            borderRadius: 3,
            padding: '2px 6px',
          }}
        >
          Dropped — needs a person
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={`Dismiss the dropped receipt ${label}`}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            fontSize: 11,
            color: 'var(--ink-3, #7C7365)',
            textDecoration: 'underline',
            cursor: 'pointer',
            fontFamily: SANS,
          }}
        >
          Handled — unpin
        </button>
      </div>
      <p
        style={{
          fontFamily: SERIF,
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--ink-1, #211C16)',
          margin: '6px 0 0',
        }}
      >
        {label}
      </p>
      <p style={{ fontSize: 11, color: 'var(--ink-2, #4F473C)', margin: '3px 0 0', lineHeight: 1.5 }}>
        The server refused it or eight attempts failed, and the outbox gave up on{' '}
        {fmtDate(droppedAt)}. The count exists only on the phone that took it — re-enter it from
        the paper record, or the stock it booked never happened.
        {!exact && (
          <em>
            {' '}
            (A sync that same moment also delivered receipts, so the name above is the queue's best
            candidate, not a certainty.)
          </em>
        )}
      </p>
    </div>
  );
}

export function RcOutboxRail({ data }: { data: OutboxData }) {
  const { queued, drops, lastFlush, online, dismissDrop, flushNow } = data;
  const prevDropIds = useRef<Set<string>>(new Set(drops.map((d) => d.id)));
  const newIds = new Set(drops.filter((d) => !prevDropIds.current.has(d.id)).map((d) => d.id));
  useEffect(() => {
    prevDropIds.current = new Set(drops.map((d) => d.id));
  }, [drops]);

  return (
    <section aria-label="Door outbox" style={{ fontFamily: SANS }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <h2
          style={{
            fontFamily: SERIF,
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--ink-1, #211C16)',
            margin: 0,
          }}
        >
          On phones right now
        </h2>
        <span style={capStyle}>{online ? 'online' : 'offline — holding'}</span>
      </div>

      {/* dropped receipts first — the thing that must never be silent */}
      {drops.length > 0 && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
          {drops.map((d) => (
            <PinnedDrop
              key={d.id}
              label={d.label}
              droppedAt={d.droppedAt}
              exact={d.exact}
              isNew={newIds.has(d.id)}
              onDismiss={() => dismissDrop(d.id)}
            />
          ))}
        </div>
      )}

      {queued === null ? (
        <p style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
          The phone-side queue could not be read — what is waiting is unknown, not zero.
        </p>
      ) : queued.length === 0 ? (
        <p
          style={{
            fontSize: 12,
            color: 'var(--ink-3, #7C7365)',
            border: '1px dashed var(--paper-2, #EAE4D8)',
            borderRadius: 10,
            padding: '10px 12px',
          }}
        >
          Nothing queued on this device. A count taken at the door with no signal waits here and
          sends itself when the network returns.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {queued.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 10,
                border: '1px solid var(--paper-2, #EAE4D8)',
                borderRadius: 10,
                background: 'var(--paper-1, #F3EFE6)',
                padding: '8px 12px',
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontFamily: SERIF,
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--ink-1, #211C16)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.label}
                </span>
                <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-3, #7C7365)' }}>
                  saved {r.queuedAt ? timeShort.format(new Date(r.queuedAt)) : EM}
                  {r.lastError ? ` · last error: ${r.lastError}` : ''}
                </span>
              </span>
              <span
                title="Attempts made of the 8 the outbox allows before giving up"
                style={{
                  flex: 'none',
                  fontFamily: MONO,
                  fontSize: 11,
                  fontVariantNumeric: 'tabular-nums',
                  color: r.retryCount >= 6 ? 'var(--ink-1, #211C16)' : 'var(--ink-3, #7C7365)',
                  transition: `color ${ink.ms}ms ${ink.easing}`,
                }}
              >
                {r.retryCount}/8
              </span>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
          marginTop: 8,
        }}
      >
        <span style={{ fontSize: 10.5, color: 'var(--ink-3, #7C7365)', fontFamily: MONO }}>
          {lastFlush
            ? `last sync ${timeShort.format(new Date(lastFlush.at))} · sent ${lastFlush.sent} · failed ${lastFlush.failed}`
            : 'no sync attempted yet this visit'}
        </span>
        <button
          type="button"
          onClick={flushNow}
          data-ux-key="receiving-next:outbox-flush"
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            fontSize: 11,
            color: 'var(--seal-deep, #14515C)',
            textDecoration: 'underline',
            cursor: 'pointer',
            fontFamily: SANS,
            flex: 'none',
          }}
        >
          Sync now
        </button>
      </div>
    </section>
  );
}

export default RcOutboxRail;
