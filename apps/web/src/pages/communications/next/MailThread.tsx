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

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { EM, MONO, SANS, SERIF, failedReadWords, fmtWhen, heldBecause } from './cm-format';
import {
  addressLine,
  answerFor,
  personWords,
  letterAt,
  filedFromHeldWords,
  letterLook,
  letterDetails,
  ARRIVED_ONLY,
  STACK_AT,
  foldedLine,
  openLettersOf,
  AUTOMATIC_LETTER_WORDS,
  mailKindOf,
  noReplyFailWords,
  noReplyTarget,
  seenMarkFor,
  type MailAnswer,
  type MailMessage,
  type MailThreadsPage,
} from './mail-format';
import { LetterFiles } from './LetterFiles';
import { LetterText } from './LetterText';
import { FadeAway, MailMotionStyles, prefersReducedMotion, useArriveFocus } from './mail-motion';
import { QueuedPullBack } from './QueuedPullBack';
import { mailKeys, useHouse, useMailThread, useMarkThreadSeen, useNoReplyMark } from './useMailData';
import { hasModifier, inOverlay, isTypingTarget, nextWaiting, threadKey as threadKeyOf } from './mail-keys';
import { RetryRead, useReadAgain } from './MailRetry';

const QUIET = { fontSize: 12, color: 'var(--ink-4, #665D50)' } as const;

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
  house,
  unfolded,
}: {
  m: MailMessage;
  /** Opened from a fold by the reader: it fades in once (opacity only, none under reduced motion). */
  unfolded?: boolean;
  vendor: string;
  /** The house's Mudavym address and time zone, for the letter's Details (r108 mail-gap g8). */
  house: { address?: string | null; zone?: string | null };
  facts: LetterFacts | undefined;
  /** Set only on the newest marked letter, for an owner or manager. */
  onTakeBack?: () => void;
  takingBack?: boolean;
}) {
  const look = letterLook(m);
  const addresses = addressLine(m);
  const inbound = m.direction === 'inbound';
  const [open, setOpen] = useState(false);
  const detailsId = `letter-details-${m.id}`;
  const held = facts?.constraintFlags?.hard ?? [];
  return (
    <li
      data-testid="mail-letter"
      data-letter-id={m.id}
      tabIndex={-1}
      className={`grid gap-1.5 rounded-lg px-3 py-2.5${unfolded && !prefersReducedMotion() ? ' mail-fade-in' : ''}`}
      style={{
        background: inbound ? 'var(--paper-1, #F3EFE6)' : 'var(--paper-0, #FAF7F1)',
        border: look.dashed ? '1px dashed var(--ink-3, #7C7365)' : '1px solid var(--paper-2, #EAE4D8)',
        marginLeft: inbound ? 0 : 'min(10%, 48px)',
        marginRight: inbound ? 'min(10%, 48px)' : 0,
        outline: 'none',
      }}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span data-letter-name={m.id} tabIndex={-1} style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1, #211C16)', outline: 'none' }}>
          {inbound ? vendor : 'The house'}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--ink-4, #665D50)' }}>{fmtWhen(letterAt(m))}</span>
        {look.chip && (
          <span
            data-testid="letter-chip"
            style={{
              marginLeft: 'auto',
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.06em',
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
      {addresses && (
        <p data-testid="letter-addresses" style={{ ...QUIET, margin: 0, overflowWrap: 'anywhere' }}>
          {addresses}
        </p>
      )}
      {m.text ? (
        <LetterText text={m.text} />
      ) : (
        <p style={{ ...QUIET, margin: 0 }}>{look.removed ? '' : 'No text was recorded for this letter.'}</p>
      )}
      <LetterFiles files={m.attachments} />
      <div className="flex flex-wrap items-center gap-x-2">
        <p data-testid="letter-provenance" style={{ ...QUIET, margin: 0 }}>
          {look.line}
        </p>
        {inbound && (
          <button
            type="button"
            data-testid="letter-details-toggle"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center"
            // A 44 px hit area that does not make the line 44 px tall.
            style={{ minHeight: 44, margin: '-14px 0', background: 'none', border: 0, padding: '0 6px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}
          >
            Details
          </button>
        )}
      </div>
      {inbound && open && (
        // In place, under the provenance line: one 160 ms opacity fade in, no exit, no height animation (ADR 0112).
        <ul id={detailsId} data-testid="letter-details" className="mail-fade-in grid gap-0.5" style={{ ...QUIET, margin: 0, padding: 0, listStyle: 'none', overflowWrap: 'anywhere' }}>
          {letterDetails(m, house).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {inbound && m.filedFromHeld && (
        <p data-testid="letter-filed-from-held" style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', margin: 0 }}>
          {filedFromHeldWords(m.filedFromHeld, vendor)}
        </p>
      )}
      {m.automatic === true && (
        // r103 mail-6: the gateway names an out-of-office or a bounce; the letter says so too, so it is not read as
        // a person's answer. Static text, no motion, 11.5px like the lines around it.
        <p data-testid="letter-automatic" style={{ ...QUIET, margin: 0 }}>
          {AUTOMATIC_LETTER_WORDS}
        </p>
      )}
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
      <FadeAway block show={Boolean(inbound && m.noReplyMarkedAt)}>
        <p data-testid="letter-no-reply" className="flex flex-wrap items-baseline gap-2" style={{ ...QUIET, margin: 0 }}>
          <span>Marked as needing no reply, {fmtWhen(m.noReplyMarkedAt)}.</span>
          {onTakeBack && (
            <button
              type="button"
              data-testid="letter-no-reply-undo"
              onClick={onTakeBack}
              disabled={takingBack}
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}
            >
              {takingBack ? 'Taking it back…' : 'It needs a reply after all'}
            </button>
          )}
        </p>
      </FadeAway>
    </li>
  );
}

const FOLD_BUTTON = {
  height: 44,
  width: '100%',
  textAlign: 'left',
  background: 'none',
  border: 0,
  borderTop: '1px solid var(--paper-2, #EAE4D8)',
  cursor: 'pointer',
  fontFamily: SANS,
  fontSize: 12.5,
  color: 'var(--ink-2, #4F473C)',
} as const;

/** One earlier letter, folded to a single 44 px row. */
function FoldedLetter({ m, vendor, onOpen }: { m: MailMessage; vendor: string; onOpen: () => void }) {
  return (
    <li data-testid="mail-letter-folded" data-letter-id={m.id} style={{ listStyle: 'none' }}>
      <button type="button" aria-expanded={false} onClick={onOpen} className="flex items-baseline gap-2" style={FOLD_BUTTON}>
        <span style={{ fontWeight: 600, color: 'var(--ink-1, #211C16)', whiteSpace: 'nowrap' }}>
          {m.direction === 'inbound' ? vendor : 'The house'}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--ink-4, #665D50)', whiteSpace: 'nowrap' }}>{fmtWhen(letterAt(m))}</span>
        <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{foldedLine(m)}</span>
      </button>
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
  onAnswer,
  onOpenThread,
  bookFacts,
  houseAddress = null,
  houseZone = null,
}: {
  threadKey: string;
  /** The person the thread was opened from (`?with=`: `vendor:`, `team:` or `guest:`); null reads by key alone. */
  withKey?: string | null;
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
  /** Opens another thread of the same person (the `n` key). */
  onOpenThread?: (key: string) => void;
  bookFacts?: ReadonlyMap<string, LetterFacts>;
  /** The house's Mudavym address and time zone, from the summary, for each letter's Details (r108 mail-gap g8). */
  houseAddress?: string | null;
  houseZone?: string | null;
}) {
  const house = { address: houseAddress, zone: houseZone };
  const q = useMailThread(threadKey, withKey);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const again = useReadAgain(q, headingRef);
  const arrive = useArriveFocus();
  const pages = q.data?.pages ?? [];
  const head = pages[0] ?? null;
  // Pages are held newest-first; the reader joins them oldest-first.
  const letters = pages
    .slice()
    .reverse()
    .flatMap((p) => p.messages);
  const vendor = personWords(head?.person?.name, mailKindOf(head?.person));
  const order = head?.order ?? null;
  const replyOrder = canReply && order && draftedOrderIds.has(order.id) ? order.id : null;
  // Any thread with a vendor can be answered by hand, order or not; the
  // drafted reply, when there is one, stays the first act.
  const answer = canReply && onAnswer ? answerFor(head, letters) : null;
  // r108 mail-r108-8: `n` opens the next thread waiting on the house, `r` writes
  // a reply. They read the person's thread list the page already holds; with no
  // list held, or nothing else waiting, `n` does nothing. Typing, a dialog or a
  // modifier makes the key the reader's. No motion of its own: the view change
  // is the page's existing cross-fade, none under reduced motion.
  const qc = useQueryClient();
  const house = useHouse();
  const keyAct = useRef<(e: KeyboardEvent) => void>(() => {});
  // `g` then a letter is the app's go-to (the provider's own 1.2 s window): the
  // second key is its, not ours.
  const gAt = useRef(0);
  keyAct.current = (e) => {
    if (e.defaultPrevented || hasModifier(e) || isTypingTarget(e.target) || inOverlay(e.target) || inOverlay(document.activeElement)) return;
    const afterG = Date.now() - gAt.current < 1200;
    gAt.current = e.key === 'g' || e.key === 'G' ? Date.now() : 0;
    if (afterG) return;
    const act = threadKeyOf(e.key);
    if (act === 'reply' && answer && onAnswer) {
      e.preventDefault();
      onAnswer(answer);
    } else if (act === 'next' && withKey && onOpenThread) {
      const held = qc.getQueryData<InfiniteData<MailThreadsPage>>(mailKeys.threads(house, withKey));
      const next = nextWaiting(held?.pages.flatMap((p) => p.threads) ?? [], threadKey);
      if (!next) return;
      e.preventDefault();
      onOpenThread(next);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyAct.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const noReply = useNoReplyMark();
  // Earlier letters fold (r108 mail g9). The reader's unfolds are kept for this thread only.
  const [opened, setOpened] = useState<{ key: string; ids: ReadonlySet<string> }>({ key: threadKey, ids: new Set() });
  const unfoldedIds = opened.key === threadKey ? opened.ids : new Set<string>();
  const focusAfter = useRef<string | null>(null);
  // A letter that was drawn open stays open for as long as this thread is on screen: the
  // newest one folding when a newer one arrives would collapse the letter the reader is on.
  const shownOpen = useRef<{ key: string; ids: Set<string> }>({ key: threadKey, ids: new Set() });
  if (shownOpen.current.key !== threadKey) shownOpen.current = { key: threadKey, ids: new Set() };
  const open = new Set([...openLettersOf(letters, head), ...shownOpen.current.ids]);
  open.forEach((id) => shownOpen.current.ids.add(id));
  const unfold = (ids: string[]) => {
    focusAfter.current = ids[0] ?? null;
    setOpened({ key: threadKey, ids: new Set([...unfoldedIds, ...ids]) });
  };
  useLayoutEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    document.querySelector<HTMLElement>(`[data-letter-name="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }, [opened]);
  // Runs of folded letters; three or more in a row are one stack.
  const rows: Array<{ kind: 'open'; m: MailMessage } | { kind: 'fold'; m: MailMessage } | { kind: 'stack'; ms: MailMessage[] }> = [];
  for (let i = 0; i < letters.length; ) {
    const m = letters[i]!;
    if (open.has(m.id) || unfoldedIds.has(m.id)) {
      rows.push({ kind: 'open', m });
      i += 1;
      continue;
    }
    const run: MailMessage[] = [];
    while (i < letters.length && !open.has(letters[i]!.id) && !unfoldedIds.has(letters[i]!.id)) run.push(letters[i++]!);
    if (run.length >= STACK_AT) rows.push({ kind: 'stack', ms: run });
    else run.forEach((r) => rows.push({ kind: 'fold', m: r }));
  }
  const settleId = canReply ? noReplyTarget(head, letters) : null;
  // Only the newest marked letter offers to take its mark back: an older
  // mark is behind it in the thread, and taking it back changes nothing.
  const undoId = canReply
    ? (letters.filter((m) => m.direction === 'inbound' && m.noReplyMarkedAt).slice(-1)[0]?.id ?? null)
    : null;

  // "New to you" (r36 mail gap 6): a thread on screen is read by this person
  // through the newest vendor letter it shows. Once per letter (the effect
  // runs only when that letter changes): a poll that brings nothing new sends
  // nothing; a letter that arrives while the thread is open is marked when it
  // is drawn. Every member keeps their own mark. The mark is idempotent, so a
  // remount sending it again changes nothing.
  const seen = useMarkThreadSeen();
  const mark = seenMarkFor(head);
  const markId = mark ? `${mark.with}|${mark.key}|${mark.through}` : null;
  useEffect(() => {
    if (mark) seen.mutate(mark);
  }, [markId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section aria-label="Thread" className="grid gap-3" style={{ fontFamily: SANS }}>
      <MailMotionStyles />
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1"
        style={{ justifySelf: 'start', background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}
      >
        <ArrowLeft size={13} strokeWidth={1.75} aria-hidden />
        {backLabel}
      </button>

      {again.failed ? (
        <p role="alert" data-testid="thread-unread" style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
          This thread could not be read ({failedReadWords(again.error)}). That does not mean it is empty.{' '}
          <RetryRead testId="thread-read-again" busy={again.busy} onClick={again.onPress} onRetry={() => void q.refetch()} />
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
              ref={(el) => {
                headingRef.current = el;
                arrive(el);
              }}
              tabIndex={-1}
              style={{
                outline: 'none',
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
              <span data-testid="thread-kind" style={QUIET}>{mailKindOf(head.person)}</span>
              {order && (
                <Link to={`/orders/${order.id}`} style={{ fontFamily: MONO, fontSize: 11, color: 'var(--seal-deep, #14515C)' }}>
                  order {order.number ?? EM}
                </Link>
              )}
            </p>
          </header>
          {head.person && mailKindOf(head.person) !== 'vendor' && (
            <p data-testid="thread-arrived-only" style={{ ...QUIET, margin: 0 }}>
              {ARRIVED_ONLY}
            </p>
          )}

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

          {pages.some((p) => p.heldMarksRead === false) && (
            <p role="status" data-testid="thread-held-marks-unread" style={{ ...QUIET, margin: 0 }}>
              Whether a person filed any of these letters after it was held could not be read just now.
            </p>
          )}

          {pages.some((p) => p.attachmentsRead === false) && (
            <p role="status" data-testid="thread-files-unread" style={{ ...QUIET, margin: 0 }}>
              The files these letters carried could not be read just now. That does not mean there are none.
            </p>
          )}

          <ul className="grid gap-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((r) =>
              r.kind === 'open' ? (
                <Letter
                  key={r.m.id}
                  m={r.m}
                  vendor={vendor}
                  facts={bookFacts?.get(r.m.id)}
                  unfolded={unfoldedIds.has(r.m.id)}
                  onTakeBack={r.m.id === undoId ? () => noReply.mutate({ id: r.m.id, marked: false }) : undefined}
                  takingBack={noReply.isPending && noReply.variables?.marked === false}
                  house={house}
                />
              ) : r.kind === 'fold' ? (
                <FoldedLetter key={r.m.id} m={r.m} vendor={vendor} onOpen={() => unfold([r.m.id])} />
              ) : (
                <li key={`stack-${r.ms[0]!.id}`} data-testid="mail-letter-stack" style={{ listStyle: 'none' }}>
                  <button
                    type="button"
                    aria-expanded={false}
                    onClick={() => unfold(r.ms.map((x) => x.id))}
                    style={{ ...FOLD_BUTTON, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}
                  >
                    {r.ms.length} earlier letters
                  </button>
                </li>
              ),
            )}
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
