/**
 * One thread of mail (proposal §2.3), opened by `?thread=<thread_key>`.
 *
 * Letters run oldest to newest, 50 a page; "Show earlier letters" reads the
 * page before the oldest one held. Each letter carries a quiet provenance line
 * in words (which door it came by, or how far an outbound letter got), and an
 * outbound letter that has not left wears its state — a draft never looks sent
 * (prc-02). A letter whose original was removed under the retention rule says
 * so; its facts stay.
 *
 * The reply act is the existing drafted reply and its sealed approve: an owner
 * or manager sees "Open the drafted reply" when this thread's order has one
 * waiting; staff and an unknown role see no composer act (ADR 0357 answer 3,
 * proposal F6).
 */

import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { EM, MONO, SANS, SERIF, failedReadWords, fmtWhen, heldBecause } from './cm-format';
import { letterAt, letterLook, type MailMessage } from './mail-format';
import { QueuedPullBack } from './QueuedPullBack';
import { useMailThread } from './useMailData';

const QUIET = { fontSize: 11, color: 'var(--ink-4, #665D50)' } as const;

/**
 * Why a letter was held or refused. GET /mail/thread does not carry these
 * (the gateway's MailMessage has no relayRefusalReason or constraintFlags),
 * so the page hands over what its conversation book already read, keyed by
 * the same procurement_conversations id. A letter outside the book's window
 * says the reason could not be read with the thread — never that none exists.
 */
export interface LetterFacts {
  relayRefusalReason: string | null;
  constraintFlags: { hard: readonly string[] } | null;
}

function Letter({ m, vendor, facts }: { m: MailMessage; vendor: string; facts: LetterFacts | undefined }) {
  const look = letterLook(m);
  const inbound = m.direction === 'inbound';
  const held = facts?.constraintFlags?.hard ?? [];
  return (
    <li
      data-testid="mail-letter"
      className="grid gap-1.5 rounded-lg px-3 py-2.5"
      style={{
        background: inbound ? 'var(--paper-1, #F3EFE6)' : 'var(--paper-0, #FAF7F1)',
        border: look.dashed ? '1px dashed var(--ink-3, #7C7365)' : '1px solid var(--paper-2, #EAE4D8)',
        marginLeft: inbound ? 0 : 'min(10%, 48px)',
        marginRight: inbound ? 'min(10%, 48px)' : 0,
      }}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
          {inbound ? vendor : 'The house'}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-4, #665D50)' }}>{fmtWhen(letterAt(m))}</span>
        {look.chip && (
          <span
            data-testid="letter-chip"
            style={{
              marginLeft: 'auto',
              fontFamily: MONO,
              fontSize: 8.5,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              padding: '2px 7px',
              borderRadius: 4,
              color: 'var(--ink-2, #4F473C)',
              border: look.dashed ? '1px dashed var(--ink-3, #7C7365)' : '1px solid var(--paper-2, #EAE4D8)',
              whiteSpace: 'nowrap',
            }}
          >
            {look.chip}
          </span>
        )}
      </div>
      {m.text ? (
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            lineHeight: 1.5,
            color: 'var(--ink-2, #4F473C)',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {m.text}
        </p>
      ) : (
        <p style={{ ...QUIET, margin: 0 }}>{look.removed ? '' : 'No text was recorded for this letter.'}</p>
      )}
      <p data-testid="letter-provenance" style={{ ...QUIET, margin: 0 }}>
        {look.line}
      </p>
      {!inbound && m.status === 'RELAY_REFUSED' && (
        // ADR 0099, founder 2026-09-21: the draft closed, not retried, and
        // the manager sees why — the gateway's own sentence, verbatim.
        <p
          data-testid="letter-refused"
          style={{ fontSize: 12, color: 'var(--alarm-deep, #8C3322)', margin: 0, overflowWrap: 'anywhere' }}
        >
          Not sent — it was refused on the way out:{' '}
          {facts
            ? facts.relayRefusalReason || 'no reason was recorded with this refusal.'
            : 'the reason could not be read with this thread.'}
        </p>
      )}
      {!inbound && held.length > 0 && (
        // COMMS-W22: why it was held, in words, never the rule code.
        <p data-testid="letter-held" style={{ ...QUIET, margin: 0 }}>
          {heldBecause(held)}
        </p>
      )}
      {look.removed && (
        <p data-testid="letter-removed" style={{ ...QUIET, margin: 0 }}>
          {look.removed}
        </p>
      )}
      {look.queued && <QueuedPullBack id={m.id} />}
    </li>
  );
}

export function MailThread({
  threadKey,
  withKey = null,
  onBack,
  backLabel,
  onOpenPerson,
  canReply,
  draftedOrderIds,
  onOpenReply,
  bookFacts,
}: {
  threadKey: string;
  /** The person the thread was opened from (`?with=`); null reads by key alone. */
  withKey?: string | null;
  onBack: () => void;
  backLabel: string;
  onOpenPerson: (key: string) => void;
  /** Owner or manager of this house; staff and an unknown role are false. */
  canReply: boolean;
  /** Orders with a drafted reply waiting (useCommsNextData's drafts). */
  draftedOrderIds: ReadonlySet<string>;
  onOpenReply: (orderId: string) => void;
  bookFacts?: ReadonlyMap<string, LetterFacts>;
}) {
  const q = useMailThread(threadKey, withKey);
  const pages = q.data?.pages ?? [];
  const head = pages[0] ?? null;
  // Pages are held newest-first; the reader joins them oldest-first.
  const letters = pages
    .slice()
    .reverse()
    .flatMap((p) => p.messages);
  const vendor = head?.person?.name ?? 'The vendor';
  const order = head?.order ?? null;
  const replyOrder = canReply && order && draftedOrderIds.has(order.id) ? order.id : null;

  return (
    <section aria-label="Thread" className="grid gap-3" style={{ fontFamily: SANS }}>
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1"
        style={{ justifySelf: 'start', background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}
      >
        <ArrowLeft size={13} strokeWidth={1.75} aria-hidden />
        {backLabel}
      </button>

      {q.isError && !q.data ? (
        <p role="alert" data-testid="thread-unread" style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
          This thread could not be read ({failedReadWords(q.error)}). That does not mean it is empty.
        </p>
      ) : !q.data ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-4, #665D50)' }}>Reading the thread…</p>
      ) : !head || (!head.person && letters.length === 0) ? (
        <p role="status" data-testid="thread-missing" style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
          This thread is not in this house's mail.
        </p>
      ) : (
        <>
          <header className="grid gap-1">
            <h2
              style={{
                fontFamily: SERIF,
                fontSize: 20,
                fontWeight: 600,
                margin: 0,
                color: 'var(--ink-1, #211C16)',
                overflowWrap: 'anywhere',
              }}
            >
              {head.subject ?? 'No subject'}
            </h2>
            <p className="flex flex-wrap items-baseline gap-2" style={{ margin: 0, fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
              {head.person ? (
                <button
                  type="button"
                  onClick={() => onOpenPerson(head.person!.key)}
                  style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}
                >
                  {vendor}
                </button>
              ) : (
                <span>{EM}</span>
              )}
              <span style={QUIET}>vendor</span>
              {order && (
                <Link to={`/orders/${order.id}`} style={{ fontFamily: MONO, fontSize: 11, color: 'var(--seal-deep, #14515C)' }}>
                  order {order.number ?? EM}
                </Link>
              )}
            </p>
          </header>

          {/* The cursor to the earlier page is on the oldest page read, the last one held. */}
          {q.hasNextPage && (
            <div>
              <button
                type="button"
                onClick={() => void q.fetchNextPage()}
                disabled={q.isFetchingNextPage}
                style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}
              >
                {q.isFetchingNextPage ? 'Reading earlier letters…' : 'Show earlier letters'}
              </button>
            </div>
          )}
          {!q.hasNextPage && pages.length > 1 && (
            <p style={{ ...QUIET, margin: 0 }}>This is the first letter of the thread.</p>
          )}
          {q.isFetchNextPageError && (
            <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--alarm-deep, #8C3322)' }}>
              The earlier letters could not be read ({failedReadWords(q.error)}).
            </p>
          )}

          <ul className="grid gap-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {letters.map((m) => (
              <Letter key={m.id} m={m} vendor={vendor} facts={bookFacts?.get(m.id)} />
            ))}
          </ul>

          {q.isError && q.data && !q.isFetchNextPageError && (
            <p role="status" style={{ ...QUIET, margin: 0 }}>
              This thread could not be read again just now ({failedReadWords(q.error)}). It is as it was.
            </p>
          )}

          {replyOrder && (
            <div>
              <button
                type="button"
                data-testid="open-thread-reply"
                onClick={() => onOpenReply(replyOrder)}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                  background: 'var(--seal-tint, rgba(26,94,107,.1))',
                  color: 'var(--seal-deep, #14515C)',
                  cursor: 'pointer',
                }}
              >
                Open the drafted reply
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
