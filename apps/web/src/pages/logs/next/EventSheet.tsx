/**
 * EventSheet — one entry of the ledger, as the register holds it.
 *
 * A Sheet (440, ADR 0112): the reader has left the list for ONE object. The
 * eyebrow says what kind of register wrote the row, the title is the row's
 * own summary, the facts say when (or "not recorded"), which register, which
 * row, and which thread — with the one act this page offers, following the
 * thread. Below the facts, the payload as key/value lines in mono, because a
 * row's detail is provenance and provenance is set in mono.
 *
 * The way out of the timeline is in the footer as words. When the register
 * has no page of its own the footer says so, in a sentence — never a dead
 * control, never a missing one.
 */

import { Link } from 'react-router-dom';
import { Sheet } from '@/components/mudavym';
import {
  EM,
  MONO,
  NOT_RECORDED,
  SANS,
  describeOf,
  fmtStamp,
  labelOf,
  linkOutFor,
  nameOf,
  noLinkReason,
  payloadLines,
  type LinkContext,
  type TimelineEvent,
} from './lg-format';

export interface EventSheetProps {
  event: TimelineEvent | null;
  onClose: () => void;
  /** Pivot the page onto this row's thread (closes the sheet). */
  onFollow: (correlationId: string) => void;
  link: LinkContext;
}

export function EventSheet({ event, onClose, onFollow, link }: EventSheetProps) {
  const e = event;
  const out = e ? linkOutFor(e, link) : null;
  const lines = e ? payloadLines(e.detail) : [];

  return (
    <Sheet
      open={!!e}
      onClose={onClose}
      label={e ? `${labelOf(e.source)} entry` : 'Entry'}
      eyebrow={e ? describeOf(e.source) : undefined}
      title={e ? e.summary : undefined}
      closeLabel="Close"
      footer={
        e ? (
          out ? (
            <span>
              <Link to={out.to} className="lg-out lg-ink" onClick={onClose}>
                {out.label}
              </Link>
              {e.source === 'inventory_transactions' ? (
                <span> — the ledger has no address for a single item yet.</span>
              ) : null}
            </span>
          ) : (
            <span>{noLinkReason(e, link)}</span>
          )
        ) : null
      }
    >
      {e ? (
        <div className="lg-sheet" style={{ fontFamily: SANS }}>
          <dl className="lg-facts">
            <dt>Recorded</dt>
            <dd>
              <span style={{ fontFamily: MONO }}>{fmtStamp(e.occurredAt)}</span>
              {!e.occurredAt ? (
                <span className="lg-facts__note"> — this row carries no timestamp.</span>
              ) : null}
            </dd>
            <dt>Register</dt>
            <dd>
              {nameOf(e.source)} <span style={{ fontFamily: MONO, color: 'var(--ink-4)' }}>{e.source}</span>
            </dd>
            <dt>Row</dt>
            <dd style={{ fontFamily: MONO }}>{e.id}</dd>
            <dt>Thread</dt>
            <dd>
              {e.correlationId ? (
                <>
                  <span style={{ fontFamily: MONO, wordBreak: 'break-all' }}>{e.correlationId}</span>
                  <button
                    type="button"
                    className="lg-follow lg-ink"
                    onClick={() => onFollow(e.correlationId as string)}
                  >
                    Follow this thread
                  </button>
                </>
              ) : (
                <span>
                  {EM} <span className="lg-facts__note">no correlation id, so this row cannot be followed.</span>
                </span>
              )}
            </dd>
          </dl>

          <p className="mdv-sect" style={{ padding: '14px 0 4px' }}>
            The row, as the register holds it
          </p>
          {lines.length ? (
            <dl className="lg-payload">
              {lines.map((l) => (
                <div key={l.key} className="lg-payload__line">
                  <dt>{l.key}</dt>
                  <dd>{l.value === NOT_RECORDED ? <span className="lg-facts__note">{NOT_RECORDED}</span> : l.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="lg-facts__note" style={{ margin: 0 }}>
              No further detail was returned for this row.
            </p>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}

export default EventSheet;
