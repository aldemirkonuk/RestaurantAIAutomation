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
 *
 * AND IT IS NOT A DEAD END. Reading a log is "open one, it is not the one,
 * open the next", and that used to cost a close, a re-aim and a click for
 * every miss. Earlier / Later live in the header (`Sheet`'s `action` slot) and
 * step within the list the reader came from; `j`/`k` do the same from the
 * page's own handler. Neither ever walks past the loaded window in silence —
 * at an end the control is absent and the position line says which end it is,
 * and whether anything is known to lie beyond it.
 */

import { useRef } from 'react';
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

/**
 * Where this entry stands in the list the reader came from, and whether there
 * is one either side of it WITHIN THAT LIST. `earlier`/`later` are true only
 * when a step is possible; at an end the sheet says so in words rather than
 * offering a control that does nothing — and it says so about the LOADED page,
 * never about the registers, because that is all it can know.
 */
export interface SheetSteps {
  index: number;
  total: number;
  earlier: boolean;
  later: boolean;
  /** Why there is nothing further that way; null while both ways are open. */
  endNote: string | null;
}

export interface EventSheetProps {
  event: TimelineEvent | null;
  onClose: () => void;
  /** Pivot the page onto this row's thread (closes the sheet). */
  onFollow: (correlationId: string) => void;
  link: LinkContext;
  /** Step to the adjacent entry without leaving the sheet. */
  onStep?: (dir: 'earlier' | 'later') => void;
  steps?: SheetSteps | null;
}

export function EventSheet({ event, onClose, onFollow, link, onStep, steps }: EventSheetProps) {
  const e = event;
  const out = e ? linkOutFor(e, link) : null;
  const lines = e ? payloadLines(e.detail) : [];
  // Focus lands on the line that says where the reader now is, not on the
  // first control. The primitive's default is the first focusable, and with
  // Earlier/Later in the header that is a STEP: opening an entry and pressing
  // Space would move to a different one before it had been read.
  const placeRef = useRef<HTMLParagraphElement | null>(null);

  return (
    <Sheet
      open={!!e}
      onClose={onClose}
      initialFocusRef={placeRef}
      label={e ? `${labelOf(e.source)} entry` : 'Entry'}
      eyebrow={e ? describeOf(e.source) : undefined}
      title={e ? e.summary : undefined}
      closeLabel="Close"
      // THE SHEET IS NO LONGER A DEAD END. Reading a log is "open one, it is
      // not the one, open the next", and that used to cost a close, a re-aim
      // and a click for every miss. A control is drawn only where it can move:
      // at either end the words below say why, which is this page's rule for
      // every other absent control (`lg-noway`).
      action={
        e && steps && onStep ? (
          <span className="lg-step">
            {steps.earlier ? (
              <button type="button" className="lg-step__btn lg-ink" onClick={() => onStep('earlier')}>
                Earlier
              </button>
            ) : null}
            {steps.later ? (
              <button type="button" className="lg-step__btn lg-ink" onClick={() => onStep('later')}>
                Later
              </button>
            ) : null}
          </span>
        ) : undefined
      }
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
          <p className="lg-place" ref={placeRef} tabIndex={-1}>
            {steps ? `Entry ${steps.index} of the ${steps.total} on this page.` : 'One entry, as the register holds it.'}
            {steps?.endNote ? ` ${steps.endNote}` : ''}
          </p>
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
