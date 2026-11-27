/**
 * The Mail tab of /communications (founder /goal 2026-11-07: "a little tab as
 * mail inside /communication to access all the convos with people"; sw-walk
 * mail proposal §2.1-2.3, Phase C L9 narrowed). A people page, so it stays
 * simple: one sentence of who is waiting, one row per person, their threads,
 * then the thread. The only dense surface is the intake sheet behind the one
 * line under the header.
 *
 * The address is the state (proposal F11): `?with=vendor:<id>` opens a
 * person's threads and `?thread=<thread_key>` opens a thread, so a refresh, a
 * shared link and Back all keep it. Opening one replaces the address in
 * place, as an opened draft does (COMMS-W35).
 *
 * Only vendor mail is stored (`storedKinds`), so there are no Team, Guests or
 * Strangers chips; a quiet line says what the list does not cover (F5).
 */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Mail, MessageCircle } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { EM, MONO, SANS, failedReadWords, fmtWhen, managesHouse } from './cm-format';
import { IntakeHealthSheet } from './IntakeHealthSheet';
import { MailThread, type LetterFacts } from './MailThread';
import {
  channelWords,
  emptyListWords,
  headerSentence,
  houseMailboxStatus,
  intakeLine,
  lastWriterWords,
  storedKindsLine,
  todayLine,
  type MailboxReader,
  type MailPersonRow,
} from './mail-format';
import { useMailPeople, useMailSender, useMailSummary, useMailThreads } from './useMailData';

const QUIET = { fontSize: 11.5, color: 'var(--ink-4, #665D50)' } as const;
const LINK_BUTTON = {
  background: 'none',
  border: 0,
  padding: 0,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--seal-deep, #14515C)',
} as const;

function Glyphs({ channels }: { channels: string[] }) {
  return (
    <span className="flex items-center gap-1" style={{ color: 'var(--ink-3, #7C7365)' }}>
      {channels.map((c) =>
        c.toLowerCase() === 'whatsapp' ? (
          <MessageCircle key={c} size={12} strokeWidth={1.75} aria-label={channelWords(c)} role="img" />
        ) : (
          <Mail key={c} size={12} strokeWidth={1.75} aria-label={channelWords(c)} role="img" />
        ),
      )}
    </span>
  );
}

function WaitingDot() {
  return (
    <span
      role="img"
      aria-label="waiting on you"
      style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--seal, #1A5E6B)', flex: 'none', alignSelf: 'center' }}
    />
  );
}

function PersonRow({ p, onOpen }: { p: MailPersonRow; onOpen: () => void }) {
  return (
    <li style={{ borderBottom: '1px solid var(--paper-2, #EAE4D8)' }}>
      <button
        type="button"
        data-testid="mail-person"
        onClick={onOpen}
        className="cm-row grid w-full gap-0.5 px-1 py-2.5 text-left"
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: SANS }}
      >
        <span className="flex flex-wrap items-baseline gap-2">
          {p.waiting && <WaitingDot />}
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink-1, #211C16)', overflowWrap: 'anywhere' }}>
            {p.name ?? 'A vendor with no name on file'}
          </span>
          <span style={QUIET}>vendor</span>
          <Glyphs channels={p.channels} />
          {p.newestOpenOrderNumber && (
            <span
              style={{
                fontFamily: MONO,
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 4,
                border: '1px solid var(--paper-2, #EAE4D8)',
                color: 'var(--ink-2, #4F473C)',
              }}
            >
              order {p.newestOpenOrderNumber}
            </span>
          )}
          {p.openThreads > 1 && <span style={QUIET}>{p.openThreads} open threads</span>}
          <span className="ml-auto" style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-4, #665D50)' }}>
            {fmtWhen(p.lastAt)}
          </span>
        </span>
        <span
          style={{
            fontSize: 12,
            color: 'var(--ink-2, #4F473C)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '100%',
          }}
        >
          {p.lastLine ?? EM}
        </span>
      </button>
    </li>
  );
}

function PersonThreads({
  withKey,
  onBack,
  onOpenThread,
}: {
  withKey: string;
  onBack: () => void;
  onOpenThread: (key: string) => void;
}) {
  const q = useMailThreads(withKey);
  const pages = q.data?.pages ?? [];
  const person = pages[0]?.person ?? null;
  const threads = pages.flatMap((p) => p.threads);
  return (
    <section aria-label="Threads" className="grid gap-3" style={{ fontFamily: SANS }}>
      <button type="button" onClick={onBack} style={{ ...LINK_BUTTON, justifySelf: 'start' }}>
        ← Everyone
      </button>
      {q.isError && !q.data ? (
        <p role="alert" data-testid="threads-unread" style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
          These threads could not be read ({failedReadWords(q.error)}). That does not mean there are none.
        </p>
      ) : !q.data ? (
        <p style={{ margin: 0, ...QUIET }}>Reading the threads…</p>
      ) : !person ? (
        <p role="status" data-testid="threads-missing" style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
          This house has no mail with that person.
        </p>
      ) : (
        <>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--ink-1, #211C16)', overflowWrap: 'anywhere' }}>
            {person.name ?? 'A vendor with no name on file'} <span style={QUIET}>vendor</span>
          </h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
            {threads.map((t) => (
              <li key={t.key} style={{ borderBottom: '1px solid var(--paper-2, #EAE4D8)' }}>
                <button
                  type="button"
                  data-testid="mail-thread-row"
                  onClick={() => onOpenThread(t.key)}
                  className="cm-row grid w-full gap-0.5 px-1 py-2.5 text-left"
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: SANS }}
                >
                  <span className="flex flex-wrap items-baseline gap-2">
                    {t.waiting && <WaitingDot />}
                    <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink-1, #211C16)', overflowWrap: 'anywhere' }}>
                      {t.subject ?? 'No subject'}
                    </span>
                    {t.orderNumber && (
                      <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-2, #4F473C)' }}>order {t.orderNumber}</span>
                    )}
                    <span className="ml-auto" style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-4, #665D50)' }}>
                      {fmtWhen(t.lastAt)}
                    </span>
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
                    {t.messageCount === 1 ? '1 letter' : `${t.messageCount} letters`} ·{' '}
                    {lastWriterWords(t.lastDirection, person.name)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {q.hasNextPage && (
            <button
              type="button"
              onClick={() => void q.fetchNextPage()}
              disabled={q.isFetchingNextPage}
              style={{ ...LINK_BUTTON, justifySelf: 'start' }}
            >
              {q.isFetchingNextPage ? 'Reading older threads…' : 'Show older threads'}
            </button>
          )}
          {q.isFetchNextPageError && (
            <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--alarm-deep, #8C3322)' }}>
              The older threads could not be read ({failedReadWords(q.error)}).
            </p>
          )}
        </>
      )}
    </section>
  );
}

function People({
  waitingOnly,
  reader,
  summary,
  onOpenPerson,
}: {
  waitingOnly: boolean;
  reader: MailboxReader | null;
  summary: Parameters<typeof emptyListWords>[1];
  onOpenPerson: (key: string) => void;
}) {
  const q = useMailPeople(waitingOnly);
  const pages = q.data?.pages ?? [];
  const people = pages.flatMap((p) => p.people);
  const storedKinds = pages[0]?.storedKinds ?? null;
  return (
    <section aria-label="People" className="grid gap-2" style={{ fontFamily: SANS }}>
      <p data-testid="stored-kinds" style={{ ...QUIET, margin: 0 }}>
        {storedKindsLine(storedKinds)}
      </p>
      {q.isError && !q.data ? (
        <p role="alert" data-testid="people-unread" style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
          The people this house has mail with could not be read ({failedReadWords(q.error)}). That does not mean there
          are none.
        </p>
      ) : !q.data ? (
        <p style={{ margin: 0, ...QUIET }}>Reading the mail…</p>
      ) : people.length === 0 ? (
        <p data-testid="people-empty" style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2, #4F473C)', maxWidth: '68ch' }}>
          {emptyListWords(reader, summary, { waitingOnly })}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
          {people.map((p) => (
            <PersonRow key={p.key} p={p} onOpen={() => onOpenPerson(p.key)} />
          ))}
        </ul>
      )}
      {q.isError && q.data && !q.isFetchNextPageError && (
        <p role="status" style={{ ...QUIET, margin: 0 }}>
          The list could not be read again just now ({failedReadWords(q.error)}). It is as it was.
        </p>
      )}
      {q.hasNextPage && (
        <button
          type="button"
          onClick={() => void q.fetchNextPage()}
          disabled={q.isFetchingNextPage}
          style={{ ...LINK_BUTTON, justifySelf: 'start' }}
        >
          {q.isFetchingNextPage ? 'Reading older people…' : 'Show older people'}
        </button>
      )}
      {q.isFetchNextPageError && (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--alarm-deep, #8C3322)' }}>
          The older people could not be read ({failedReadWords(q.error)}).
        </p>
      )}
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={{
        fontSize: 12,
        fontWeight: 600,
        padding: '4px 12px',
        borderRadius: 999,
        cursor: 'pointer',
        border: on ? '1px solid var(--seal-ring, rgba(26,94,107,.32))' : '1px solid var(--paper-2, #EAE4D8)',
        background: on ? 'var(--seal-tint, rgba(26,94,107,.1))' : 'transparent',
        color: on ? 'var(--seal-deep, #14515C)' : 'var(--ink-2, #4F473C)',
      }}
    >
      {children}
    </button>
  );
}

export function MailTab({
  draftedOrderIds,
  onOpenReply,
  bookFacts,
}: {
  /** Orders with a drafted reply waiting (useCommsNextData's drafts). */
  draftedOrderIds: ReadonlySet<string>;
  /** The page's own openReply: the drafted reply and its sealed approve, untouched. */
  onOpenReply: (orderId: string) => void;
  /** Why a recent letter was held or refused, by letter id, from the book (see MailThread). */
  bookFacts?: ReadonlyMap<string, LetterFacts>;
}) {
  // Owners and managers only; staff and an unknown role see no composer act
  // (ADR 0357 answer 3, proposal F6) — read as the rest of this page reads it.
  const { user, activeRole } = useAuth();
  const canReply = managesHouse(activeRole, user?.role);
  const [params, setParams] = useSearchParams();
  const [waitingOnly, setWaitingOnly] = useState(false);
  const [sheet, setSheet] = useState(false);
  const summaryQ = useMailSummary(true);
  const senderQ = useMailSender();
  const now = Date.now();

  const summary = summaryQ.data ?? null;
  const reader: MailboxReader | null = senderQ.data?.reader ?? null;
  const doorStatus = houseMailboxStatus(reader, { readFailed: senderQ.isError, now });
  const withKey = params.get('with');
  const threadKey = params.get('thread');

  // The address is the state; opening replaces it in place (COMMS-W35).
  const go = (set: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    next.set('tab', 'mail');
    for (const [k, v] of Object.entries(set)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const tone = doorStatus.tone === 'warn' ? 'var(--warn, #96601A)' : doorStatus.tone === 'alarm' ? 'var(--alarm, #A33A2B)' : 'var(--ink-2, #4F473C)';

  return (
    <div className="grid gap-4" data-testid="mail-tab" style={{ fontFamily: SANS }}>
      <header className="grid gap-1">
        <p data-testid="mail-header" style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
          {headerSentence(summary, {
            failed: summaryQ.isError,
            reason: summaryQ.isError ? failedReadWords(summaryQ.error) : undefined,
            now,
          })}
        </p>
        <p data-testid="mail-today" style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
          {todayLine(summary)}
        </p>
        <button
          type="button"
          data-testid="intake-line"
          onClick={() => setSheet(true)}
          style={{ ...LINK_BUTTON, justifySelf: 'start', fontWeight: 500, color: tone, textDecoration: 'underline', textUnderlineOffset: 3 }}
        >
          {intakeLine(doorStatus, reader, now)} · doors and addresses
        </button>
      </header>

      {threadKey ? (
        <MailThread
          threadKey={threadKey}
          backLabel={withKey ? 'Back to their threads' : 'Back to everyone'}
          onBack={() => go({ thread: null })}
          onOpenPerson={(key) => go({ with: key, thread: null })}
          canReply={canReply}
          draftedOrderIds={draftedOrderIds}
          onOpenReply={onOpenReply}
          bookFacts={bookFacts}
        />
      ) : withKey ? (
        <PersonThreads
          withKey={withKey}
          onBack={() => go({ with: null })}
          onOpenThread={(key) => go({ thread: key })}
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
            <Chip on={!waitingOnly} onClick={() => setWaitingOnly(false)}>
              All
            </Chip>
            <Chip on={waitingOnly} onClick={() => setWaitingOnly(true)}>
              Waiting on you
            </Chip>
          </div>
          <People
            waitingOnly={waitingOnly}
            reader={reader}
            summary={summary}
            onOpenPerson={(key) => go({ with: key })}
          />
        </>
      )}

      <IntakeHealthSheet
        open={sheet}
        onClose={() => setSheet(false)}
        summary={summary}
        summaryFailed={summaryQ.isError}
        reader={reader}
        readerFailed={senderQ.isError}
        senderAddress={senderQ.data?.address ?? null}
        senderWords={senderQ.data?.words ?? null}
        conversationWords={senderQ.data?.conversation?.words ?? null}
        now={now}
      />
    </div>
  );
}
