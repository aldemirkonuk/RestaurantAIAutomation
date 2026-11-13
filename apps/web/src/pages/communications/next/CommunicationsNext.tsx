/**
 * CommunicationsNext — the Mudavym redesign of `/communications` (ADR 0045 §5
 * wave, MAKEOVER-VERDICTS: MERGE with a warning on both sides).
 *
 * The verdict, enforced: today's page won on at-a-glance completeness ("shows
 * basically everything"); the redesign lost on "too much text". So the page
 * leads with a three-figure glance strip (all derived from live queries, each
 * an em dash until its query answers), every letter in and out reads under the
 * Mail tab (2026-11-07; it replaced the conversation book's ledger) — and the
 * founder's two named additions are built in: the channels rail makes the
 * page's integrations visible, and the template builders open inside a sheet
 * whose header says exactly what is going on (TemplateSheet).
 *
 * Honesty rules: an AI draft can never look sent (prc-02) — draft rows wear
 * "AI draft · not sent"; unknown figures are em dashes; a gateway failure is
 * said in words.
 *
 * Motions (06-pages/communications.md §1b): hover = ink. The ledger row's
 * settle left with the book (2026-11-07). Nothing else moves.
 *
 * ── 2026-09-04, ADR 0118: the house writes its own mail ────────────────────
 * The two legacy template workshops are gone from this page. Where they were,
 * there is now the house composer (sketch 100) and the house's own letter
 * library. The builders themselves are untouched and the legacy
 * `/communications` still mounts them, so ADR 0042's byte-for-byte promise for
 * the flag-off page holds; what changed is that nothing under `next/` imports
 * them any more.
 */

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { PenLine, Library } from 'lucide-react';
import { Stub, Wordmark } from '@/components/mudavym';
import { ink } from '../../../lib/mudavym/motion';
import {
  EM,
  GE,
  MONO,
  SANS,
  SERIF,
  failedReadsSentence,
  fmtAsOf,
  readAgainFailed,
  type FailedRead,
} from './cm-format';
import { TemplateSheet, type HeldTemplate } from './TemplateSheet';
import { changedLine, heldLine, useHeldWords } from './held-words';
import { ComposeSheet, type HeldLetter } from './Compose/ComposeSheet';
import { DraftedReplyPanel, type DraftedReply } from './DraftedReplyPanel';
import { LetterRequestsPanel, PILL, useLetterRequests } from './LetterRequestsPanel';
import { useLetterSenderStanding } from './Compose/useComposeData';
import { HouseDrafts, useHouseDrafts, type HouseDraft } from './Compose/HouseDrafts';
import { COMMS_SERVER_WINDOWS, useCommsNextData } from './useCommsNextData';
import { MailTab } from './MailTab';
import WhoIsWriting from './WhoIsWriting';
import { mailTabLabel } from './mail-format';
import { useMailSummary } from './useMailData';

function GlanceFigure({
  label,
  value,
  floor = false,
  failed = false,
  floorNote,
  at = 0,
}: {
  label: string;
  value: number | null;
  /** When the figure's reads last answered (`dataUpdatedAt`); said when a later read failed. */
  at?: number;
  /** Says, on hover, WHY the figure is a floor — the cap and where it comes from. */
  floorNote?: string;
  /** True when the figure is a floor (its source window was truncated). */
  floor?: boolean;
  /**
   * True when this figure's query FAILED, as distinct from not having answered.
   * Both render the em dash — the figure is genuinely unknown either way — but
   * they must not be the same state to a reader (ADR 0051 clause 3), so a
   * failed figure carries its own accessible name and colour, and the banner
   * above names the source in words. The alternative, four failure sentences
   * inside a strip built to be scanned, would bury the distinction it exists
   * to draw.
   */
  failed?: boolean;
}) {
  const unknown = value === null;
  // COMMS-W33 (founder: "A: keep, say when"): a figure whose read failed after
  // answering keeps its number, and says when it is from. It used to show 4 in
  // red while its accessible name said only "could not be loaded" and the
  // banner said it showed an em dash.
  const said = failed
    ? unknown
      ? `${label}: could not be read`
      : `${label}: ${floor ? GE : ''}${value} as it was ${fmtAsOf(at)}. It could not be read again.`
    : unknown
      ? `${label}: has not answered yet`
      : undefined;
  return (
    <div style={{ minWidth: 96 }}>
      <span
        style={{
          display: 'block',
          fontFamily: MONO,
          fontSize: 9,
          fontWeight: 500,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: failed ? 'var(--alarm-deep, #8C3322)' : 'var(--ink-4, #665D50)',
        }}
      >
        {label}
      </span>
      <span
        data-state={failed ? 'failed' : unknown ? 'unanswered' : 'measured'}
        aria-label={said}
        title={failed ? said : floor ? floorNote : undefined}
        style={{
          fontFamily: MONO,
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          color: failed ? 'var(--alarm-deep, #8C3322)' : 'var(--ink-1, #211C16)',
        }}
      >
        {unknown ? EM : floor ? `${GE}${value}` : value}
      </span>
    </div>
  );
}

export default function CommunicationsNext() {
  const data = useCommsNextData();
  // Letters staff asked a manager to send (founder answer 3, 2026-09-21).
  const letterStanding = useLetterSenderStanding();
  const [compose, setCompose] = useState(false);
  const [library, setLibrary] = useState(false);
  /* Which drafted reply is open. One panel for the page, keyed off the row the
     page still holds, so a draft that vanishes under a refetch closes the panel
     rather than leaving it describing a letter that has gone. */
  const [draftOpen, setDraftOpen] = useState<string | null>(null);
  // Drafts Mudavym wrote (ADR 0230). `?draft=<id>` is the credit claim's link
  // to its letter; it opens that draft once the drafts list has answered.
  const houseDrafts = useHouseDrafts();
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState<HouseDraft | null>(null);
  // COMMS-W34: words a person left a sheet with stay on a stub where it was
  // opened — "new" for Write a letter, a drafted letter by its id, "t" for the
  // templates. Opening the sheet again hands them back and takes the stub away.
  const letters = useHeldWords<HeldLetter>();
  const templatesHeld = useHeldWords<HeldTemplate>();
  const [draftFrom, setDraftFrom] = useState<HeldLetter | null>(null);
  const [composeKey, setComposeKey] = useState(0);
  const [composeFrom, setComposeFrom] = useState<HeldLetter | null>(null);
  const [templateFrom, setTemplateFrom] = useState<HeldTemplate | null>(null);
  // Resume takes its own stub away, and the button with it. Focus moves to the
  // row's own opener first, so the sheet hands focus back there when it closes
  // instead of dropping it on the page (ADR 0112: focus returns to the opener).
  const writeRef = useRef<HTMLButtonElement>(null);
  const libraryRef = useRef<HTMLButtonElement>(null);
  const openDraft = (d: HouseDraft) => {
    setDraftFrom(letters.words(d.id));
    letters.drop(d.id);
    setDraft(d);
    // COMMS-W35 (founder: "A: page + queue back"): an opened letter is in the
    // address its links already use, so a refresh reopens it. In place, not a
    // new step back.
    if (params.get('draft') !== d.id) {
      params.set('draft', d.id);
      setParams(params, { replace: true });
    }
  };
  const openCompose = () => {
    // The composer stays mounted, so a held letter is still in it.
    letters.drop('new');
    setCompose(true);
  };
  const openLibrary = () => {
    setTemplateFrom(templatesHeld.words('t'));
    templatesHeld.drop('t');
    setLibrary(true);
  };
  const linked = params.get('draft');
  useEffect(() => {
    if (!linked || !houseDrafts.drafts) return;
    const hit = houseDrafts.drafts.find((d) => d.id === linked);
    if (hit && draft?.id !== hit.id) openDraft(hit);
  }, [linked, houseDrafts.drafts]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeDraft = () => {
    setDraft(null);
    houseDrafts.refetch();
    if (linked) {
      params.delete('draft');
      setParams(params, { replace: true });
    }
  };

  /* `?reply=<orderId>` is the house counter's "Replies waiting" link (COMMS-W19,
     shared batch 2 / DASH-W16e). Once the drafts read has answered it opens that
     order's drafted reply, as clicking its row does; when no draft matches, the
     page says so rather than opening nothing. The param goes when the panel or
     the note closes. */
  const replyLinked = params.get('reply');
  const replyHit = !!replyLinked && data.drafts.some((d) => d.orderId === replyLinked);
  // The draft the link already opened: once it is sent from the panel it leaves
  // the list, and that is not a link that found nothing.
  const [replyOpened, setReplyOpened] = useState<string | null>(null);
  useEffect(() => {
    if (!replyLinked || !replyHit) return;
    setDraftOpen(replyLinked);
    setReplyOpened(replyLinked);
  }, [replyLinked, replyHit]);
  const dropReply = () => {
    if (!params.has('reply')) return;
    params.delete('reply');
    setParams(params, { replace: true });
  };
  // A reply opened from its row writes the same link (COMMS-W35); the effect
  // above then counts it as opened here, so sending it is not later called a
  // link that found nothing.
  const openReply = (orderId: string) => {
    setDraftOpen(orderId);
    params.set('reply', orderId);
    setParams(params, { replace: true });
  };

  /* Everything not yet sent, from the three reads that list it: letters staff
     asked a manager to send, replies the house drafted on orders, and the
     house's own drafted letters. The count is null until all three have
     answered, so it can never undercount a list still in flight.
     2026-11-12: named "To send", not "Waiting on you". Mail says "waiting on
     you" for vendors owed a reply, and a staff member's own request waits on
     a manager, not on them; the same words never mean two things here. */
  const letterQ = useLetterRequests(letterStanding.restaurantId);
  const waitingParts = [
    letterStanding.restaurantId ? letterQ.data?.requests.length ?? null : 0,
    data.draftsKnown ? data.drafts.length : null,
    houseDrafts.drafts ? houseDrafts.drafts.length : null,
  ];
  const waitingCount = waitingParts.some((n) => n === null)
    ? null
    : waitingParts.reduce<number>((a, n) => a + (n ?? 0), 0);
  const waitingFailed = letterQ.isError || data.failed.drafts || houseDrafts.failed;
  // COMMS-W33: every read on the page that could not be read, for the banner.
  // Each part of the page says its own reason and when its rows are from.
  const failedReads: FailedRead[] = [
    ...(data.failed.history ? [{ name: 'the letter counts', stale: data.hasData, at: data.historyAt ?? 0 }] : []),
    ...(data.failed.drafts
      ? [{ name: 'the replies the house has written', stale: data.draftsKnown, at: data.draftsAt ?? 0 }]
      : []),
    ...(letterQ.isError
      ? [{ name: 'the letters waiting for a manager', stale: letterQ.data !== undefined, at: letterQ.dataUpdatedAt ?? 0 }]
      : []),
    ...(houseDrafts.failed
      ? [{ name: 'the drafted letters', stale: houseDrafts.drafts !== null, at: houseDrafts.at ?? 0 }]
      : []),
  ];
  const waitingAt = Math.min(
    ...failedReads.filter((r) => r.name !== 'the letter counts' && r.stale).map((r) => r.at),
  );
  // "Try again" re-reads everything on the page; it used to re-read two of six.
  const queryClient = useQueryClient();
  const readAgain = () => {
    data.refetch();
    void letterQ.refetch();
    houseDrafts.refetch();
    for (const key of ['comms-senders', 'comms-strangers', 'house-letter-queued'])
      void queryClient.invalidateQueries({ queryKey: [key] });
  };

  /* Mail and Letters (founder /goal 2026-11-07). The tab is in the address so
     a refresh, a shared link and Back keep it: `?tab=mail`, or a person
     (`?with=`) or thread (`?thread=`) link, opens Mail; `?draft=` and
     `?reply=` keep opening on Letters exactly as before. Switching tabs is a
     step Back can undo, so it pushes; opening inside Mail replaces. */
  const tabParam = params.get('tab');
  const tab: 'mail' | 'letters' =
    tabParam === 'letters'
      ? 'letters'
      : tabParam === 'mail' ||
          params.has('with') ||
          params.has('thread') ||
          params.has('setup') ||
          // "Who is writing" lives in Mail (r21): a notice's
          // `?senders=open` link lands on it, register open.
          params.has('senders')
        ? 'mail'
        : 'letters';
  // The label's waiting count: read once on Letters, polled only on Mail.
  const mailSummary = useMailSummary(tab === 'mail');
  const showTab = (next: 'mail' | 'letters') => {
    if (next === tab) return;
    const p = new URLSearchParams(params);
    if (next === 'mail') p.set('tab', 'mail');
    else for (const k of ['tab', 'with', 'thread', 'setup', 'senders']) p.delete(k);
    setParams(p);
  };
  const draftedOrderIds = new Set(data.drafts.map((d) => d.orderId));
  // What the book already read about why a letter was held or refused (ADR
  // 0099, COMMS-W22); the Mail thread shows it beside the letter it names.
  const bookFacts = new Map(
    data.rows.map((r) => [r.id, { relayRefusalReason: r.relayRefusalReason, constraintFlags: r.constraintFlags }]),
  );

  return (
    <div
      className="mudavym min-h-screen"
      style={{ background: 'var(--paper-0, #FAF7F1)', color: 'var(--ink-1, #211C16)' }}
    >
      <style>{`
        .cm-row { transition: background ${ink.ms}ms ${ink.easing} }
        .cm-row:hover { background: var(--paper-1, #F3EFE6) }
        .cm-row:focus-visible { outline: 2px solid var(--seal, #1A5E6B); outline-offset: -2px }
        /* the two template-workshop buttons rest on a card fill rather than
           transparent — the value lives here, not inline, so .cm-row:hover
           above still governs them instead of being dead-cascaded under a
           style attribute (2026-08-31 follow-up to the wave-polish pass). */
        .cm-card { background: var(--paper-0, #FAF7F1) }
        @media (prefers-reduced-motion: reduce) { .cm-row { transition: none !important } }
      `}</style>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Wordmark size={13} />
            <h1
              style={{
                fontFamily: SERIF,
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: '-0.015em',
                lineHeight: 1.1,
                margin: '4px 0 0',
                // COMMS-W36: its own ink, so the old Dark theme a browser may still
                // keep (`html.dark`; #576 took its control off /profile) cannot
                // turn it pale on the paper ground.
                color: 'var(--ink-1, #211C16)',
              }}
            >
              Communications
            </h1>
          </div>
          {/* the at-a-glance strip the old page earned its keep with — Letters' own
              figures, so it stands with Letters; Mail says its count in words. */}
          {tab === 'letters' && (
          <div className="flex flex-wrap gap-6">
            <GlanceFigure
              label="To send"
              value={waitingCount}
              failed={waitingFailed}
              at={Number.isFinite(waitingAt) ? waitingAt : 0}
            />
            <GlanceFigure
              label="Sent · 30 days"
              value={data.glance.sentLast30}
              floor={data.glance.sentLast30Truncated}
              floorNote={`At least this many: the book holds only the latest ${COMMS_SERVER_WINDOWS.HISTORY_ROWS} letters, and it is full.`}
              failed={data.failed.history}
              at={data.historyAt}
            />
            {/* Counted by the server with Mail's own rule (D6): a bounce, an
                auto-reply or a second copy of one letter is not a reply, so the
                two tabs give the same number for the same mail. Exact, no floor. */}
            <GlanceFigure
              label="Replies · 30 days"
              value={data.glance.repliesLast30}
              failed={data.failed.mail}
              at={data.mailAt}
            />
          </div>
          )}
        </header>

        {/* Mail and Letters. A tab is a place in the address, not a toggle. */}
        <nav aria-label="Mail and letters" data-tour="comms-tabs" className="mb-5 flex gap-1" style={{ fontFamily: SANS, borderBottom: '1px solid var(--paper-2, #EAE4D8)' }}>
          {(['mail', 'letters'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-current={tab === t ? 'page' : undefined}
              onClick={() => showTab(t)}
              style={{
                fontSize: 13,
                fontWeight: 600,
                padding: '8px 12px',
                marginBottom: -1,
                background: 'none',
                border: 0,
                borderBottom: tab === t ? '2px solid var(--seal, #1A5E6B)' : '2px solid transparent',
                color: tab === t ? 'var(--ink-1, #211C16)' : 'var(--ink-4, #665D50)',
                cursor: 'pointer',
              }}
            >
              {t === 'mail' ? mailTabLabel(mailSummary.data ?? null) : 'Letters'}
            </button>
          ))}
        </nav>

        {tab === 'mail' ? (
          <MailTab
            draftedOrderIds={draftedOrderIds}
            onOpenReply={openReply}
            bookFacts={bookFacts}
            // ADR 0160 §113, Open item 3 (founder, 2026-09-18): senders and
            // strangers are mail, not money. Drawn in the Mail tab since r21
            // (2026-11-13), so Mail reaches every person who writes.
            whoIsWriting={<WhoIsWriting />}
          />
        ) : (
        <>

        {/* The banner covers EVERY source this page owns, not just the
            letter counts. Before ADR 0083 it read `historyQ.isError`
            alone, so a failed thread index or drafts fetch rendered as a bare
            em dash — the mark ADR 0051 reserves for "has not answered".
            Extending the one banner rather than giving each figure its own
            sentence keeps the strip scannable AND puts every failure in words
            in one place; "Try again" refetches all of them.

            ADR 0083, amended 2026-09-25 (founder: "amend ADR 0083"): the page
            owns THREE sources — the book, the threads, the drafts. The report
            schedules and the Gmail watch status used to be named here too; the
            first reads a table no migration creates, so this banner fired for
            every house on every visit, and the second is deployment plumbing
            that now reads on the admin desk. A real failure of any of the
            three owned sources still raises this banner. */}
        {/* COMMS-W33: the banner now names every read on the page that failed
            and says when what is on screen is from (`failedReadsSentence`). It
            said "Request failed with status code 500" and "those figures show —
            because they failed, not because they are still in flight" over
            figures that showed 4, 3 and 3. */}
        {failedReads.length > 0 && (
          <div
            role="alert"
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
            style={{
              fontFamily: SANS,
              border: '1px solid var(--paper-2, #EAE4D8)',
              background: 'var(--paper-1, #F3EFE6)',
            }}
          >
            <span style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>{failedReadsSentence(failedReads)}</span>
            <button
              type="button"
              onClick={readAgain}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '5px 12px',
                borderRadius: 8,
                border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                background: 'transparent',
                color: 'var(--seal-deep, #14515C)',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        )}

        <section aria-label="To send" className="mb-6">
          <h2
            style={{
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-2, #4F473C)',
              margin: '0 0 10px',
            }}
          >
            To send · {waitingCount ?? EM}
          </h2>
          {replyLinked && !replyHit && replyOpened !== replyLinked && (data.draftsKnown || data.failed.drafts) && (
            <p
              role="status"
              data-testid="reply-link-missing"
              className="mb-3 flex flex-wrap items-baseline gap-2"
              style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2, #4F473C)', margin: '0 0 12px' }}
            >
              {data.draftsKnown && !data.failed.drafts
                ? 'That reply is no longer waiting.'
                : 'That reply could not be looked up: the replies the house has written could not be read.'}
              <button
                type="button"
                onClick={dropReply}
                style={{ fontSize: 12, color: 'var(--seal-deep, #14515C)', fontWeight: 600, background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
              >
                Dismiss
              </button>
            </p>
          )}
          {/* COMMS-W33: a zero from a read that then failed is not "nothing waiting"; the failed part says it. */}
          {waitingCount === 0 && !waitingFailed && (
            <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-4, #665D50)', margin: 0 }}>
              Nothing is waiting to be sent.
            </p>
          )}
          {letterStanding.restaurantId && (
            <LetterRequestsPanel
              restaurantId={letterStanding.restaurantId}
              canRelease={letterStanding.canRelease}
              noMailbox={letterStanding.noMailbox}
              mailbox={letterStanding}
            />
          )}

          {/* ── the drafts waiting, which the strip could only count ────
              The act the census calls owed: a letter the house drafted, read and
              sent by a person's hold (ADR 0118). The list and the strip's figure
              come from the SAME read, so they cannot disagree. */}
          {data.draftsKnown && data.drafts.length > 0 && (
            <section
              aria-label="Drafts waiting"
              className="mb-6 rounded-xl p-4"
              style={{ fontFamily: SANS, border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)' }}
            >
              {/* COMMS-W36: under "To send", so one level below it; the
                  line it had as an h2 is kept, so only its level changed. */}
              <h3
                style={{
                  fontFamily: MONO,
                  fontSize: 9.5,
                  fontWeight: 600,
                  lineHeight: '2rem',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-4, #665D50)',
                  margin: '0 0 8px',
                }}
              >
                The house has written · {data.drafts.length} waiting
              </h3>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {data.drafts.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1">
                    <span style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
                      {d.wineName ?? 'An order'}
                      {d.providerName ? ` · ${d.providerName}` : ''}
                      {d.orderNumber ? ` · ${d.orderNumber}` : ''}
                    </span>
                    {/* COMMS-W24: one row per order; the older drafts it stands in front of are said, not hidden. */}
                    {d.replaces > 0 && (
                      <span
                        data-testid="draft-replaces"
                        style={{ order: 3, flexBasis: '100%', fontSize: 11, color: 'var(--ink-4, #665D50)' }}
                      >
                        {d.replaces === 1
                          ? 'An earlier draft for this order was replaced by this one.'
                          : `${d.replaces} earlier drafts for this order were replaced by this one.`}
                      </span>
                    )}
                    {/* COMMS-W13: a draft in a house with no mailbox cannot leave. */}
                    {letterStanding.noMailbox && (
                      <span
                        data-testid="draft-row-blocked"
                        style={{
                          marginLeft: 'auto',
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 999,
                          whiteSpace: 'nowrap',
                          background: PILL.blocked.bg,
                          color: PILL.blocked.fg,
                        }}
                      >
                        {PILL.blocked.words}
                      </span>
                    )}
                    <button
                      type="button"
                      data-testid="open-drafted-reply"
                      onClick={() => openReply(d.orderId)}
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        padding: '4px 10px',
                        borderRadius: 3,
                        border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                        background: 'transparent',
                        color: 'var(--seal-deep, #14515C)',
                        cursor: 'pointer',
                      }}
                    >
                      Read it
                    </button>
                  </li>
                ))}
              </ul>
              <p style={{ fontSize: 11, color: 'var(--ink-4, #665D50)', margin: '8px 0 0' }}>
                Nothing here has been sent. A letter reaches a vendor only when a person holds the
                seal on it.
                {letterStanding.noMailbox &&
                  ' This house has no mailbox to send from yet, so none of these can leave.'}
              </p>
              {/* COMMS-W33: the rows above stay openable; this says when they are from. It used
                  to say "none can be opened from here" under rows that could be. */}
              {data.failed.drafts && (
                <p role="status" data-testid="drafts-stale" style={{ fontSize: 11, color: 'var(--ink-2, #4F473C)', margin: '6px 0 0' }}>
                  {readAgainFailed(data.draftsError ?? '', data.draftsAt ?? 0, false)}
                </p>
              )}
            </section>
          )}
          {data.failed.drafts && !(data.draftsKnown && data.drafts.length > 0) && (
            <p
              role="status"
              data-testid="drafts-unread"
              className="mb-6"
              style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-2, #4F473C)' }}
            >
              {data.draftsKnown
                ? readAgainFailed(data.draftsError ?? '', data.draftsAt ?? 0, true, 'the replies the house has written')
                : `The replies the house has written could not be read (${data.draftsError ?? ''}). That does not mean none are waiting.`}
            </p>
          )}
          {(houseDrafts.failed || (houseDrafts.drafts?.length ?? 0) > 0) && (
            <div
              className="rounded-xl p-4"
              style={{ fontFamily: SANS, border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)' }}
            >
              <HouseDrafts
                drafts={houseDrafts.drafts}
                failed={houseDrafts.failed}
                error={houseDrafts.error}
                at={houseDrafts.at}
                onOpen={openDraft}
                below={(d, focusRow) => {
                  const h = letters.get(d.id);
                  return h ? (
                    <Stub
                      key={h.n}
                      words={changedLine(h.words, { subject: d.subject ?? '', body: d.body })}
                      onResume={() => {
                        focusRow();
                        openDraft(d);
                      }}
                      onDiscard={() => letters.discard(d.id)}
                      onRestore={() => letters.restore(d.id)}
                      discardLabel="Discard my changes"
                      footer="The drafted letter itself stays as it was; only your changes are held here, until you leave this page."
                    />
                  ) : null;
                }}
              />
            </div>
          )}
          {/* Not while that letter is open here: one sent from its sheet leaves the
              list before the sheet closes, and the address goes with the sheet. */}
          {linked && draft?.id !== linked && houseDrafts.drafts && !houseDrafts.drafts.some((d) => d.id === linked) && (
            <p role="status" style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-2, #4F473C)', margin: '8px 0 0' }}>
              {/* COMMS-W31: for staff the letter may well still be a draft — it is just not theirs to open. */}
              {houseDrafts.withheld
                ? 'The letter this link points to is opened by an owner or manager of this house.'
                : 'The letter this link points to is no longer a draft — it was sent or discarded. Its thread under Mail says which.'}
            </p>
          )}
        </section>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* The book moved to Mail (founder /goal 2026-11-07); one line points there. */}
          <section aria-label="Every letter">
            <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2, #4F473C)', margin: 0 }}>
              Every letter in and out, by vendor and by thread, is under{' '}
              <button
                type="button"
                onClick={() => showTab('mail')}
                style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}
              >
                Mail
              </button>
              .
            </p>
          </section>

          {/* ── the channels rail: what this page is wired to ─────────── */}
          <aside className="flex flex-col gap-4" style={{ fontFamily: SANS }}>
            <div
              className="rounded-xl p-4"
              style={{ border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)' }}
            >
              <h2
                style={{
                  fontFamily: MONO,
                  fontSize: 9.5,
                  fontWeight: 600,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-4, #665D50)',
                  margin: '0 0 8px',
                }}
              >
                Write to a vendor
              </h2>
              {/* The Gmail inbound-watch line moved to the admin desk on
                  2026-09-25 (ADR 0083 amendment; ADR 0143 §2 made /admin the
                  one operations desk). It reports one deployment-wide Pub/Sub
                  credential, not this house's mail, and "NOT configured"
                  printed on every house page was an alarm no house could act on. */}
              {/* P5, and its close-out on 2026-09-04. This paragraph used to
                  explain why the SMS template WORKSHOP was kept even though no
                  SMS sender is reachable: Save genuinely stored a `type='sms'`
                  row. ADR 0118 retired both workshops from this page, so the
                  defence is no longer needed and the fact is. There is no raw
                  SMS route at all (ADR 0084 deleted it: zero callers, no
                  tenant, no ownership check on the destination number), every
                  recorded conversation is `channel='email'`, and the composer
                  writes email only. A free-text SMS composer would re-open
                  exactly what that deletion closed — it is a founder question,
                  filed in §13, not a gap to fill quietly. */}
              <div className="flex flex-col gap-2">
                <button type="button" ref={writeRef} data-tour="comms-write" onClick={openCompose} className="cm-row cm-card flex items-center gap-2 rounded-lg px-3 py-2 text-left"
                  style={{ border: '1px solid var(--seal-ring, rgba(26,94,107,.32))', fontSize: 12.5, fontWeight: 600, color: 'var(--seal-deep, #14515C)', cursor: 'pointer' }}>
                  <PenLine size={13} strokeWidth={1.75} aria-hidden />
                  Write a letter
                </button>
                {(() => {
                  const h = letters.get('new');
                  return h ? (
                    <Stub
                      key={`new-${h.n}`}
                      words={heldLine(h.words.subject, h.words.body)}
                      onResume={() => {
                        writeRef.current?.focus();
                        openCompose();
                      }}
                      onDiscard={() => {
                        // The composer is emptied by mounting a fresh one; Put it back mounts it with these words.
                        letters.discard('new');
                        setComposeFrom(null);
                        setComposeKey((k) => k + 1);
                      }}
                      onRestore={() => {
                        letters.restore('new');
                        setComposeFrom(h.words);
                        setComposeKey((k) => k + 1);
                      }}
                      footer={`${h.words.to ? `To ${h.words.to.providerName}. ` : ''}Not sent. Kept on this page until you leave it.`}
                    />
                  ) : null;
                })()}
                <button type="button" ref={libraryRef} onClick={openLibrary} className="cm-row cm-card flex items-center gap-2 rounded-lg px-3 py-2 text-left"
                  style={{ border: '1px solid var(--paper-2, #EAE4D8)', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1, #211C16)', cursor: 'pointer' }}>
                  <Library size={13} strokeWidth={1.75} aria-hidden />
                  The house's letter templates
                </button>
                {(() => {
                  const h = templatesHeld.get('t');
                  return h ? (
                    <Stub
                      key={`t-${h.n}`}
                      words={heldLine(h.words.draft.name || 'A new template', h.words.draft.body)}
                      onResume={() => {
                        libraryRef.current?.focus();
                        openLibrary();
                      }}
                      onDiscard={() => templatesHeld.discard('t')}
                      onRestore={() => templatesHeld.restore('t')}
                      footer="Not saved. Kept on this page until you leave it."
                    />
                  ) : null;
                })()}
              </div>
            </div>

            {/* The "Scheduled reports" card left this page on 2026-09-25 (ADR
                0083 amendment). `public.scheduled_reports` is created by no
                migration in supabase/migrations/, so the card could only ever
                say its list failed. It returns when a real table exists; until
                then v3.0-TECH-DEBT carries the dead feature and
                `scripts/check_queried_tables_exist.py` (KNOWN_MISSING) keeps
                the missing table in front of CI. */}
          </aside>
        </div>

        {/* "Who is writing" moved into the Mail tab on 2026-11-13 (r21);
            the page still mounts it, as MailTab's whoIsWriting. */}
        </>
        )}
      </div>

      <ComposeSheet
        key={composeKey}
        open={compose}
        onClose={() => setCompose(false)}
        onHold={(w) => letters.hold('new', w)}
        prefill={
          composeFrom
            ? {
                providerId: composeFrom.to?.providerId,
                to: composeFrom.to?.email ?? null,
                subject: composeFrom.subject,
                body: composeFrom.body,
                insights: composeFrom.insights,
                templateId: composeFrom.templateId,
              }
            : null
        }
      />
      {draft && (
        <ComposeSheet
          key={draft.id}
          open
          onClose={closeDraft}
          onHold={(w) => letters.hold(draft.id, w)}
          onDiscarded={houseDrafts.refetch}
          prefill={{
            draftId: draft.id,
            providerId: draftFrom?.to?.providerId ?? draft.providerId,
            to: draftFrom?.to?.email ?? draft.to,
            subject: draftFrom?.subject ?? draft.subject ?? '',
            body: draftFrom?.body ?? draft.body,
            insights: draftFrom?.insights,
            templateId: draftFrom?.templateId,
            baseline: { subject: draft.subject ?? '', body: draft.body, to: draft.to },
          }}
        />
      )}
      {library && (
        <TemplateSheet held={templateFrom} onHold={(h) => templatesHeld.hold('t', h)} onClose={() => setLibrary(false)} />
      )}

      <DraftedReplyPanel
        open={draftOpen !== null}
        reply={
          (data.drafts.find((d) => d.orderId === draftOpen) as DraftedReply | undefined) ?? null
        }
        onClose={() => {
          setDraftOpen(null);
          dropReply();
        }}
        onSent={() => data.refetch()}
        onDiscarded={() => data.refetch()}
      />
    </div>
  );
}
