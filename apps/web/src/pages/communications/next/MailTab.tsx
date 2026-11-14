/**
 * The Mail tab of /communications (founder /goal 2026-11-07: "a little tab as
 * mail inside /communication to access all the convos with people"; sw-walk
 * mail proposal §2.1-2.3, Phase C L9 narrowed). A people page, so it stays
 * simple: one sentence of who is waiting, one status line ("Connected · last
 * letter 4 min ago" or "Not connected"), one row per person, their threads,
 * then the thread. The only dense surface is the intake sheet behind the
 * status line.
 *
 * The address is the state (proposal F11): `?with=vendor:<id>` opens a
 * person's threads and `?thread=<thread_key>` opens a thread, so a refresh, a
 * shared link and Back all keep it. Opening one pushes a history entry, so
 * the browser's Back steps thread → person → everyone and stays on
 * /communications (QA round 16, N2). The in-app Back steps that history, or
 * replaces the address on a link opened cold, so it never leaves the page.
 *
 * `?setup=1` opens the mail setup (MailSetup.tsx): reached from the status
 * line, from an empty list, from "Not connected", and from Connections.
 *
 * Only vendor mail is stored as threads (`storedKinds`), so there are no Team,
 * Guests or Strangers chips; a quiet line says what the list does not cover
 * (F5). A stranger's letter and a letter held because its sender could not be
 * confirmed live in "Who is writing" (email_prospects), which the page hands
 * in as `whoIsWriting` and this tab draws under the people list (r21,
 * 2026-11-13): the tab is where every person who writes is reached.
 * `?senders=open` opens that register, which is where those notices link.
 */

import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, MessageCircle } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { EM, MONO, SANS, failedReadWords, fmtWhen, managesHouse } from './cm-format';
import { IntakeHealthSheet } from './IntakeHealthSheet';
import { MailSetup } from './MailSetup';
import { MailThread, type LetterFacts } from './MailThread';
import {
  channelWords,
  emptyListWords,
  headerSentence,
  lastWriterWords,
  houseMailboxStatus,
  mailStatusLine,
  storedKindsLine,
  todayLine,
  type MailAnswer,
  type MailboxReader,
  type MailPersonRow,
  type TestArrival,
} from './mail-format';
import { useMailIntake, useMailPeople, useMailSender, useMailSummary, useMailThreads } from './useMailData';
import { useMailSetup } from './useMailSetup';

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
                    {t.messageCount === 0 ? null : (
                      <>{t.messageCount === 1 ? '1 letter' : `${t.messageCount} letters`} · </>
                    )}
                    {lastWriterWords(t.lastDirection, person.name, t.messageCount)}
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
  onSetup,
}: {
  waitingOnly: boolean;
  reader: MailboxReader | null;
  summary: Parameters<typeof emptyListWords>[1];
  onOpenPerson: (key: string) => void;
  onSetup: () => void;
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
          {emptyListWords(reader, summary, { waitingOnly })}{' '}
          {!waitingOnly && (
            <button type="button" data-testid="empty-setup" onClick={onSetup} style={LINK_BUTTON}>
              Set up how mail reaches the house
            </button>
          )}
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

/** One address in a form two entries can be compared by, whatever the key order. */
function sameAddress(p: URLSearchParams): string {
  const q = new URLSearchParams(p);
  q.sort();
  return q.toString();
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
  onAnswer,
  bookFacts,
  whoIsWriting = null,
}: {
  /** Orders with a drafted reply waiting (useCommsNextData's drafts). */
  draftedOrderIds: ReadonlySet<string>;
  /** The page's own openReply: the drafted reply and its sealed approve, untouched. */
  onOpenReply: (orderId: string) => void;
  /** The page's composer, opened on a reply to a thread's newest letter (gap 3). */
  onAnswer?: (answer: MailAnswer) => void;
  /** Why a recent letter was held or refused, by letter id, from the book (see MailThread). */
  bookFacts?: ReadonlyMap<string, LetterFacts>;
  /**
   * The page's "Who is writing" section (strangers, trusted senders, held
   * letters), drawn under the people list only — never inside a person, a
   * thread or the setup.
   */
  whoIsWriting?: ReactNode;
}) {
  // Owners and managers only; staff and an unknown role see no composer act
  // (ADR 0357 answer 3, proposal F6) — read as the rest of this page reads it.
  const { user, activeRole } = useAuth();
  const canReply = managesHouse(activeRole, user?.role);
  const [params, setParams] = useSearchParams();
  const [waitingOnly, setWaitingOnly] = useState(false);
  const [sheet, setSheet] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const summaryQ = useMailSummary(true);
  const senderQ = useMailSender(true);
  const now = Date.now();
  const intake = useMailIntake(sheet);

  const summary = summaryQ.data ?? null;
  const reader: MailboxReader | null = senderQ.data?.reader ?? null;
  // A reply with no reader is as unread as a failed one (QA S5b).
  const readerFailed = senderQ.isError || (senderQ.data !== undefined && !senderQ.data.reader);
  // The test letter is the one proof that the Mudavym address works (QA
  // round 26, #977); the line reads it from the setup page's own read.
  const setupQ = useMailSetup();
  const test: TestArrival = setupQ.data
    ? setupQ.data.testLetter.failed
      ? { state: 'failed' }
      : {
          state: 'known',
          // Any arrived check proves the address, not only the newest one (QA round 26, #974).
          arrivedAt: setupQ.data.testLetter.lastArrival?.arrivedAt ?? setupQ.data.testLetter.latest?.arrivedAt ?? null,
        }
    : setupQ.isError
      ? { state: 'failed' }
      : { state: 'checking' };
  const status = mailStatusLine(reader, summary, { readerFailed, summaryFailed: summaryQ.isError, now, test });
  const withKey = params.get('with');
  const threadKey = params.get('thread');
  const setup = params.get('setup') === '1';

  const addressWith = (set: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    next.set('tab', 'mail');
    for (const [k, v] of Object.entries(set)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return next;
  };
  // The address is the state; opening pushes an entry that remembers the
  // address it was opened from.
  const go = (set: Record<string, string | null>, how: 'push' | 'replace' = 'push') => {
    const next = addressWith(set);
    setParams(next, how === 'push' ? { state: { mailFrom: sameAddress(addressWith({})) } } : { replace: true });
  };
  // In-app Back names a place ("Everyone", "their threads"), so it goes
  // there. It steps the history only when the entry behind is that very
  // place, so it piles up no entries; otherwise (a link opened cold, or a
  // person opened from inside a thread) it replaces the address and never
  // leaves the page.
  const back = (set: Record<string, string | null>) => {
    const from = (location.state as { mailFrom?: string } | null)?.mailFrom;
    if (from !== undefined && from === sameAddress(addressWith(set))) navigate(-1);
    else go(set, 'replace');
  };

  const openSetup = () => go({ setup: '1', with: null, thread: null });
  const tone = status.tone === 'warn' ? 'var(--warn, #96601A)' : status.tone === 'alarm' ? 'var(--alarm, #A33A2B)' : 'var(--ink-2, #4F473C)';

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
        <p data-tour="mail-status" className="flex flex-wrap items-baseline gap-x-3 gap-y-1" style={{ margin: 0 }}>
          <span data-testid="mail-status" data-state={status.state} role="status" style={{ fontSize: 12.5, fontWeight: 500, color: tone }}>
            {status.words}
          </span>
          <button
            type="button"
            data-testid="intake-line"
            onClick={() => setSheet(true)}
            style={{ ...LINK_BUTTON, fontWeight: 500, textDecoration: 'underline', textUnderlineOffset: 3 }}
          >
            How mail reaches the house
          </button>
          {!setup && (
            <button type="button" data-testid="setup-link" onClick={openSetup} style={{ ...LINK_BUTTON, fontWeight: 500 }}>
              Mail setup
            </button>
          )}
        </p>
        {!setup && (status.state === 'not_connected' || status.state === 'switched_off' || status.state === 'unproven') && (
          <button
            type="button"
            data-testid="status-setup"
            onClick={openSetup}
            style={{
              justifySelf: 'start',
              marginTop: 4,
              fontSize: 12,
              fontWeight: 600,
              padding: '5px 12px',
              borderRadius: 999,
              border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
              background: 'transparent',
              color: 'var(--seal-deep, #14515C)',
              cursor: 'pointer',
            }}
          >
            Set up how mail reaches the house
          </button>
        )}
      </header>

      {setup ? (
        <MailSetup
          status={status}
          sender={senderQ.data ?? null}
          senderFailed={senderQ.isError}
          conversationWords={senderQ.data?.conversation?.words ?? null}
          mailboxSwitchedOff={houseMailboxStatus(reader, { readFailed: readerFailed, now }).state === 'switched_off'}
          onBack={() => back({ setup: null })}
        />
      ) : threadKey ? (
        <MailThread
          threadKey={threadKey}
          backLabel={withKey ? 'Back to their threads' : 'Back to everyone'}
          onBack={() => back({ thread: null })}
          onOpenPerson={(key) => go({ with: key, thread: null })}
          canReply={canReply}
          draftedOrderIds={draftedOrderIds}
          onOpenReply={onOpenReply}
          onAnswer={onAnswer}
          bookFacts={bookFacts}
        />
      ) : withKey ? (
        <PersonThreads
          withKey={withKey}
          onBack={() => back({ with: null })}
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
            onSetup={openSetup}
          />
          {whoIsWriting}
        </>
      )}

      <IntakeHealthSheet
        open={sheet}
        onClose={() => setSheet(false)}
        summary={summary}
        summaryFailed={summaryQ.isError}
        reader={reader}
        readerFailed={readerFailed}
        sender={senderQ.data ?? null}
        senderFailed={senderQ.isError}
        conversationWords={senderQ.data?.conversation?.words ?? null}
        intake={intake}
        now={now}
      />
    </div>
  );
}
