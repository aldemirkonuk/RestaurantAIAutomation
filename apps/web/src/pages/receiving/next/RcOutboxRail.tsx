/**
 * RcOutboxRail — what is queued on phones right now, and what was dropped.
 *
 * Shared across all three roles, because the outbox is a fact about the
 * building, not about a role. Two ledgers:
 *
 * 1. QUEUED — receipts saved on a phone that have not reached the server yet
 *    (`doorOutbox`'s pending-mutation queue), each named, with its attempt
 *    attempt count (no ceiling since ADR 0241) and the last error verbatim.
 *    A receipt the server refused for good is PARKED in the same list as
 *    "Not sent" (ADR 0241 amendment, 2026-09-29 — the founder: "option 1, not
 *    sent."), with the refusal in plain words, "Send again" (refused only) and
 *    "Discard" (confirmed first: the count is not on the server).
 * 2. DROPPED — records written BEFORE that amendment, still shown and
 *    dismissable; nothing writes a new one. The original defect fix
 *    (v3.0-TECH-DEBT / motion canvas inv-09): until that amendment,
 *    `flushDoorOutbox` permanently discarded a receipt on a permanent 4xx
 *    refusal (and, before ADR 0241, after 8 attempts), deleting it from the
 *    queue, so the pending count fell exactly as it does on a delivery and a
 *    dropped receipt looked identical to a delivered one. That branch no
 *    longer exists: a refusal is parked (item 1). The drop records it wrote
 *    are still pinned here by name until a person dismisses them.
 *
 *    [Corrected 2026-09-29: a paragraph here pointed at `watchDoorOutbox(` in
 *    `DoorReceipt.tsx`. That page no longer exists and nothing in the web app
 *    calls `watchDoorOutbox` now; the door screen (`DoorNext.tsx`) re-reads
 *    the drop records and the not-sent count from storage on every pass. What
 *    is left to this rail alone is the QUEUE: each entry with its attempt
 *    count, last error or "Not sent" reason, and the actions it allows.]
 *
 * Honesty: a storage read that throws renders as "unknown", never as an
 * empty queue — and the empty state says what emptiness means.
 */

import { useEffect, useRef } from 'react';
import { animate, ink, stamp, turn, useReducedMotion } from '@/lib/mudavym/motion';
import { EM, MONO, SANS, SERIF, capStyle, fmtDate } from './rc-format';
import type { OutboxData, QueuedReceiptVM } from './useReceivingNextData';

const timeShort = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/**
 * Why a parked receipt was not sent, in words a porter can act on. The HTTP
 * status is kept on the entry; only the ones with a clear meaning are named,
 * and everything else says what is certain — the server refused it.
 */
function notSentReason(p: NonNullable<QueuedReceiptVM['parked']>): string {
  if (p.reason === 'unowned')
    return 'saved before the app recorded who took it, so it cannot be sent as anyone';
  switch (p.status) {
    case 403:
      return 'the server refused it: this account is not allowed to record deliveries';
    case 404:
      return 'the server refused it: it could not find this order';
    case 409:
      return 'the server refused it: it clashes with what is already recorded';
    default:
      return 'the server refused it';
  }
}

const linkButton = {
  background: 'none',
  border: 'none',
  padding: 0,
  fontSize: 11,
  textDecoration: 'underline',
  cursor: 'pointer',
  fontFamily: SANS,
} as const;

function PinnedDrop({
  label,
  droppedAt,
  tenantUnknown,
  isNew,
  onDismiss,
}: {
  label: string;
  droppedAt: string;
  /** Inherited from a pre-scoping key — restaurant never recorded. */
  tenantUnknown?: boolean;
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
            color: 'var(--ink-4, #665D50)',
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
        The server refused it, and the outbox gave up on{' '}
        {fmtDate(droppedAt)}. The count exists only on the phone that took it — re-enter it from
        the paper record, or the stock it booked never happened.
        {/* No "best candidate" hedge any more: the outbox writes the record
            from the flush that caused the drop, keyed on the queue id, so the
            name above is the order that was lost — not the closest match a
            before/after diff could find. */}
        {tenantUnknown && (
          <em>
            {' '}
            (Pinned before this page recorded which restaurant a drop belonged to, so it is shown
            here without being claimed as this restaurant's.)
          </em>
        )}
      </p>
    </div>
  );
}

export function RcOutboxRail({ data }: { data: OutboxData }) {
  const { queued, drops, lastFlush, online, dismissDrop, flushNow, resend, discard } = data;
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
              tenantUnknown={d.tenantUnknown}
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
            color: 'var(--ink-4, #665D50)',
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
              data-ux-key={r.parked ? 'receiving-next:outbox-not-sent' : undefined}
              style={{
                border: r.parked
                  ? '1px solid var(--ink-1, #211C16)'
                  : '1px solid var(--paper-2, #EAE4D8)',
                borderRadius: 10,
                background: 'var(--paper-1, #F3EFE6)',
                padding: '8px 12px',
              }}
            >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 10,
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
                <span
                  style={{
                    display: 'block',
                    fontSize: 10.5,
                    color: 'var(--ink-4, #665D50)',
                  }}
                >
                  saved {r.queuedAt ? timeShort.format(new Date(r.queuedAt)) : EM}
                  {r.parked
                    ? ` · ${notSentReason(r.parked)}`
                    : r.lastError
                      ? ` · last error: ${r.lastError}`
                      : ''}
                </span>
              </span>
              {r.parked ? (
                // Parked: nothing will send it on its own, so an attempt count
                // ("0 tries" on an unowned one) would say it is still trying.
                <span
                  style={{
                    flex: 'none',
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
                  Not sent
                </span>
              ) : (
                <span
                  title="Attempts made so far. The outbox keeps trying until the server takes it or refuses it for good (ADR 0241)"
                  style={{
                    flex: 'none',
                    fontFamily: MONO,
                    fontSize: 11,
                    fontVariantNumeric: 'tabular-nums',
                    color: r.retryCount >= 6 ? 'var(--ink-1, #211C16)' : 'var(--ink-4, #665D50)',
                    transition: `color ${ink.ms}ms ${ink.easing}`,
                  }}
                >
                  {r.retryCount} {r.retryCount === 1 ? 'try' : 'tries'}
                </span>
              )}
            </div>
            {r.parked && (
              <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
                {r.parked.reason === 'refused' && (
                  <button
                    type="button"
                    onClick={() => resend(r.id)}
                    data-ux-key="receiving-next:outbox-send-again"
                    aria-label={`Send ${r.label} again`}
                    style={{ ...linkButton, color: 'var(--seal-deep, #14515C)' }}
                  >
                    Send again
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Discard ${r.label}? The count is not on the server — it exists only on this phone. Keep the paperwork.`,
                      )
                    )
                      discard(r.id);
                  }}
                  data-ux-key="receiving-next:outbox-discard"
                  aria-label={`Discard ${r.label}`}
                  style={{ ...linkButton, color: 'var(--ink-4, #665D50)' }}
                >
                  Discard
                </button>
              </div>
            )}
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
        {/* Three states, and the middle one is the fix (F4). `flushDoorOutbox`
            returns {sent:0, failed:0} without touching the network when the
            device is offline, and stamping that as a sync printed
            "last sync 14:32 · sent 0 · failed 0" directly under this rail's own
            header reading "offline — holding". A non-attempt now says so. */}
        <span style={{ fontSize: 10.5, color: 'var(--ink-4, #665D50)', fontFamily: MONO }}>
          {lastFlush === null
            ? 'no sync attempted yet this visit'
            : lastFlush.attempted
              ? `last sync ${timeShort.format(new Date(lastFlush.at))} · sent ${lastFlush.sent} · failed ${lastFlush.failed}`
              : `holding since ${timeShort.format(new Date(lastFlush.at))} · no sync attempted — offline`}
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
