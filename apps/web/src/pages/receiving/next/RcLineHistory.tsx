/**
 * RcLineHistory — one line's full history on the receiving desk, opened on
 * demand from its row and paged ten at a time (sketch 107 Approach 1, founder
 * Q7 2026-09-22), drawn as the line sheet (ADR 0112 `Sheet`).
 *
 * What it reads: the door receipts already recorded (founder, 2026-09-25,
 * answer 2) — every count and refusal the door wrote, and every verification
 * the desk wrote (#436, ADR 0192) — through `GET
 * /procurement/receiving/orders/:id/history`. It is read-only. There is no
 * verdict ledger behind it and nothing here writes (the ledger was stripped on
 * the founder's 2026-09-21 ruling, 8ea44f527).
 *
 * Honesty (ADR 0020, ADR 0051): a failed read is said, and whether it was a
 * refusal or a breakage; an empty history is said as empty only when the read
 * answered; a count is the unit the person counted in, never re-multiplied
 * here; "shown of total" uses the server's exact count, or says the total is
 * unknown. The received block is the stock ledger's count (ADR 0192), never a
 * typed-in figure.
 */

import { Sheet } from '@/components/mudavym';
import type { LineHistoryEntry, LineReceived } from '@/services/api/receiving';
import { EM, MONO, SANS, capStyle } from './rc-format';
import { bottles, entryWords, fmtWhen } from './rc-history-words';
import { useLineHistory } from './useReceivingNextData';

function ReceivedBlock({ received }: { received: LineReceived }) {
  if (!received.readable) {
    return (
      <p style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', margin: '0 0 12px' }}>
        What this line received could not be read: {received.why ?? 'no reason was given'}.
      </p>
    );
  }
  const cell = (label: string, value: string) => (
    <div>
      <span style={capStyle}>{label}</span>
      <p
        style={{
          fontFamily: MONO,
          fontSize: 13,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--ink-1, #211C16)',
          margin: '2px 0 0',
        }}
      >
        {value}
      </p>
    </div>
  );
  return (
    <div
      data-testid="line-history-received"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
        gap: 10,
        margin: '0 0 14px',
        paddingBottom: 12,
        borderBottom: '1px solid var(--paper-2, #EAE4D8)',
      }}
    >
      {cell('Ordered', received.orderedBottles === null ? EM : bottles(received.orderedBottles))}
      {cell('On the shelf', received.words ?? EM)}
      {cell('Still owed', received.backorderBottles === null ? EM : bottles(received.backorderBottles))}
    </div>
  );
}

function EntryRow({ entry }: { entry: LineHistoryEntry }) {
  const who = [
    entry.recordedBy,
    entry.signedByInitials ? `signed ${entry.signedByInitials}` : null,
    entry.driverName ? `driver ${entry.driverName}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li
      data-testid={`line-history-entry-${entry.id}`}
      style={{ padding: '10px 0', borderBottom: '1px solid var(--paper-2, #EAE4D8)' }}
    >
      <p style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-4, #665D50)', margin: 0 }}>
        <time dateTime={entry.occurredAt}>{fmtWhen(entry.occurredAt)}</time>
        {who ? ` · ${who}` : ''}
      </p>
      <p style={{ fontSize: 13, color: 'var(--ink-1, #211C16)', margin: '3px 0 0', lineHeight: 1.45 }}>
        {entryWords(entry)}
      </p>
      {entry.notes && (
        <p style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--ink-2, #4F473C)', margin: '3px 0 0' }}>
          “{entry.notes}”
        </p>
      )}
    </li>
  );
}

const linkButton = {
  border: 'none',
  background: 'transparent',
  color: 'var(--seal-deep, #14515C)',
  cursor: 'pointer',
  fontSize: 12.5,
  fontWeight: 600,
  padding: '6px 0',
  textDecoration: 'underline',
} as const;

export function RcLineHistory({
  orderId,
  lineLabel,
  vendorName,
  onClose,
}: {
  /** The line to show; null keeps the sheet closed and reads nothing. */
  orderId: string | null;
  lineLabel: string;
  vendorName: string | null;
  onClose: () => void;
}) {
  const h = useLineHistory(orderId);
  const entries = h.entries ?? [];
  const shown = entries.length;
  const olderCount =
    h.total !== null ? Math.min(10, Math.max(0, h.total - shown)) : 10;
  // Full checks only: `matchVerifiedAt` is set by a full verification, never by the one-tap
  // "Counts match" (ADR 0192 fifth amendment), so a confirmation entry cannot stand in for it.
  const deskEntryShown = entries.some((e) => e.kind === 'desk_verified');

  return (
    <Sheet
      open={orderId !== null}
      onClose={onClose}
      label={`History — ${lineLabel}`}
      eyebrow="Line history · from the door receipts"
      title={lineLabel}
    >
      <div style={{ fontFamily: SANS, padding: '12px 16px 18px' }} aria-busy={h.isLoading || h.isFetchingOlder}>
        {vendorName && (
          <p style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)', margin: '0 0 10px' }}>{vendorName}</p>
        )}

        {h.received && <ReceivedBlock received={h.received} />}

        {h.isError && (
          <p role="alert" style={{ fontSize: 12.5, color: 'var(--ink-1, #211C16)' }}>
            {h.failure?.forbidden
              ? 'This account is not permitted to read the desk. Only an owner or a manager can.'
              : `The history could not be read (${h.failure?.message ?? 'request failed'}).`}{' '}
            {!h.failure?.forbidden && (
              <button type="button" onClick={h.refetch} style={linkButton}>
                Try again
              </button>
            )}
          </p>
        )}

        {!h.isError && h.isLoading && (
          <p role="status" style={{ fontSize: 12.5, color: 'var(--ink-4, #665D50)' }}>
            Reading the door receipts…
          </p>
        )}

        {h.hasData && shown === 0 && (
          <p data-testid="line-history-empty" style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
            Nothing has been recorded at the door or the desk for this line yet.
          </p>
        )}

        {shown > 0 && (
          <>
            <ol aria-label={`History of ${lineLabel}, newest first`} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {entries.map((e) => (
                <EntryRow key={e.id} entry={e} />
              ))}
            </ol>

            <p
              data-testid="line-history-count"
              style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-4, #665D50)', margin: '8px 0 0' }}
            >
              {h.total === null
                ? `${shown} shown · the total could not be read`
                : `${shown} of ${h.total} shown`}
            </p>

            {h.olderFailure && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--ink-1, #211C16)', margin: '6px 0 0' }}>
                Older entries could not be read ({h.olderFailure.message}). The entries above still stand.
              </p>
            )}

            {h.hasMore && (
              <button
                type="button"
                data-ux-key="receiving-next:history-older"
                onClick={h.fetchOlder}
                disabled={h.isFetchingOlder}
                style={linkButton}
              >
                {h.isFetchingOlder
                  ? 'Reading older entries…'
                  : h.olderFailure
                    ? 'Try the older entries again'
                    : `Show ${olderCount} older`}
              </button>
            )}
          </>
        )}

        {h.hasData && !h.hasMore && h.matchVerifiedAt && !deskEntryShown && (
          <p
            data-testid="line-history-unrecorded-check"
            style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', margin: '10px 0 0' }}
          >
            The desk checked this line on {fmtWhen(h.matchVerifiedAt)}, before a check was kept as an entry, so that
            check has no entry here.
          </p>
        )}

        {h.recordedByUnavailable && (
          <p style={{ fontSize: 11.5, color: 'var(--ink-4, #665D50)', margin: '8px 0 0' }}>
            Who recorded each entry could not be read.
          </p>
        )}
      </div>
    </Sheet>
  );
}
