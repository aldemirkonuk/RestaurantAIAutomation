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
 * The reply acts: an owner or manager sees "Open the drafted reply" when this
 * thread's order has one waiting (its sealed approve), and "Write a reply" on
 * any thread with a vendor, which opens the composer on an answer to the
 * thread's newest letter (r28 gap 3: it joins this thread and carries
 * In-Reply-To). Staff and an unknown role see no composer act (ADR 0357
 * answer 3, proposal F6).
 *
 * "No reply needed" (r28 gap 4): while the thread waits, an owner or manager
 * can say its newest received letter needs no answer — a "Thanks!", or a
 * reply given by phone or from Gmail. That letter and the earlier ones stop
 * waiting; a later letter waits again. The marked letter says so, and the
 * mark can be taken back from it. Staff see the mark, never the acts.
 *
 * Files (r28 gap 13): each letter lists the files it carried, and any reader
 * of the letter can open one (LetterFiles.tsx). When the files could not be
 * read with the page, it says so, never that the letters carried none.
 */

import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { EM, MONO, SANS, SERIF, failedReadWords, fmtWhen, heldBecause } from './cm-format';
import {
  answerFor,
  letterAt,
  letterLook,
  noReplyFailWords,
  noReplyTarget,
  seenMarkFor,
  type MailAnswer,
  type MailMessage,
} from './mail-format';
import { LetterFiles } from './LetterFiles';
import { QueuedPullBack } from './QueuedPullBack';
import { useMailThread, useMarkThreadSeen, useNoReplyMark } from './useMailData';

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

function Letter({
  m,
  vendor,
  facts,
  onTakeBack,
  takingBack,
}: {
  m: MailMessage;
  vendor: string;
  facts: LetterFacts | undefined;
  /** Set only on the newest marked letter, for an owner or manager. */
  onTakeBack?: () => void;
  takingBack?: boolean;
}) {
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
      <LetterFiles files={m.attachments} />
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
      {inbound && m.noReplyMarkedAt && (
        <p data-testid="letter-no-reply" className="flex flex-wrap items-baseline gap-2" style={{ ...QUIET, margin: 0 }}>
          <span>Marked as needing no reply, {fmtWhen(m.noReplyMarkedAt)}.</span>
          {onTakeBack && (
            <button
              type="button"
              data-testid="letter-no-reply-undo"
              onClick={onTakeBack}
              disabled={takingBack}
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}
            >
              {takingBack ? 'Taking it back…' : 'It needs a reply after all'}
            </button>
          )}
        </p>
      )}
    </li>
  );
}

export function MailThread({
  threadKey,
  onBack,
  backLabel,
  onOpenPerson,
  canReply,
  draftedOrderIds,
  onOpenReply,
  onAnswer,
  bookFacts,
}: {
  threadKey: string;
  onBack: () => void;
  backLabel: string;
  onOpenPerson: (key: string) => void;
  /** Owner or manager of this house; staff and an unknown role are false. */
  canReply: boolean;
  /** Orders with a drafted reply waiting (useCommsNextData's drafts). */
  draftedOrderIds: ReadonlySet<string>;
  onOpenReply: (orderId: string) => void;
  /** Opens the composer on a reply to this thread's newest letter (gap 3). */
  onAnswer?: (answer: MailAnswer) => void;
  bookFacts?: ReadonlyMap<string, LetterFacts>;
}) {
  const q = useMailThread(threadKey);
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
  // Any thread with a vendor can be answered by hand, order or not; the
  // drafted reply, when there is one, stays the first act.
  const answer = canReply && onAnswer ? answerFor(head, letters) : null;
  const noReply = useNoReplyMark();
  const settleId = canReply ? noReplyTarget(head, letters) : null;
  // Only the newest marked letter offers to take its mark back: an older
  // mark is behind it in the thread, and taking it back changes nothing.
  const undoId = canReply
    ? (letters.filter((m) => m.direction === 'inbound' && m.noReplyMarkedAt).slice(-1)[0]?.id ?? null)
    : null;

  // "New to you" (r36 mail gap 6): a thread on screen is read by this person
  // through the newest vendor letter it shows. Once per letter: a poll that
  // brings nothing new sends nothing; a letter that arrives while the thread
  // is open is marked when it is drawn. Every member keeps their own mark.
  const seen = useMarkThreadSeen();
  const mark = seenMarkFor(head);
  const markId = mark ? `${mark.with}|${mark.key}|${mark.through}` : null;
  const marked = useRef<string | null>(null);
  useEffect(() => {
    if (!mark || !markId || marked.current === markId) return;
    marked.current = markId;
    seen.mutate(mark);
  }, [markId]); // eslint-disable-line react-hooks/exhaustive-deps

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

          {pages.some((p) => p.attachmentsRead === false) && (
            <p role="status" data-testid="thread-files-unread" style={{ ...QUIET, margin: 0 }}>
              The files these letters carried could not be read just now. That does not mean there are none.
            </p>
          )}

          <ul className="grid gap-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {letters.map((m) => (
              <Letter
                key={m.id}
                m={m}
                vendor={vendor}
                facts={bookFacts?.get(m.id)}
                onTakeBack={m.id === undoId ? () => noReply.mutate({ id: m.id, marked: false }) : undefined}
                takingBack={noReply.isPending && noReply.variables?.marked === false}
              />
            ))}
          </ul>

          {q.isError && q.data && !q.isFetchNextPageError && (
            <p role="status" style={{ ...QUIET, margin: 0 }}>
              This thread could not be read again just now ({failedReadWords(q.error)}). It is as it was.
            </p>
          )}

          {noReply.isError && (
            <p role="alert" data-testid="no-reply-failed" style={{ margin: 0, fontSize: 12, color: 'var(--alarm-deep, #8C3322)' }}>
              {noReplyFailWords(noReply.error, noReply.variables?.marked !== false)}
            </p>
          )}

          {(replyOrder || answer || settleId) && (
            <div className="flex flex-wrap gap-2">
              {replyOrder && (
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
              )}
              {answer && (
                <button
                  type="button"
                  data-testid="write-thread-reply"
                  onClick={() => onAnswer?.(answer)}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--rule, rgba(33,28,22,.14))',
                    background: 'transparent',
                    color: 'var(--seal-deep, #14515C)',
                    cursor: 'pointer',
                  }}
                >
                  Write a reply
                </button>
              )}
              {settleId && (
                <button
                  type="button"
                  data-testid="thread-no-reply"
                  onClick={() => noReply.mutate({ id: settleId, marked: true })}
                  disabled={noReply.isPending}
                  title="The newest letter and the ones before it stop waiting. A later letter waits again."
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--rule, rgba(33,28,22,.14))',
                    background: 'transparent',
                    color: 'var(--ink-2, #4F473C)',
                    cursor: 'pointer',
                  }}
                >
                  {noReply.isPending && noReply.variables?.marked ? 'Saving…' : 'No reply needed'}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
