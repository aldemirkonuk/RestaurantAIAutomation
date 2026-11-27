/**
 * The house email composer — sketch 100, built (ADR 0118).
 *
 * The founder, 2026-09-03: "include template for emails and inhouse email
 * creations to sending emails (editing the emails — creating data from our
 * insights), have it connected with the email account to connect with there."
 *
 * FOUR DECISIONS, ENFORCED BY THE STRUCTURE AND NOT BY COPY
 * --------------------------------------------------------
 * 1. THE SENDER IS FIRST. `SenderLine` is above To, Subject and Body, because
 *    which address a letter leaves from decides whether there is a letter at
 *    all. On today's tree it says "no house sender", and Send is disabled with
 *    that sentence on it rather than being a button that fails.
 * 2. THE RECIPIENT COMES FROM THE BOOK. There is no free-text To.
 *    `RecipientField` searches the book and, for an unknown address, creates
 *    the vendor contact FIRST — the letter cannot address a string.
 * 3. THE MERGE UNIT IS A SENTENCE. `InsightPicker` inserts what the engine
 *    computed, whole, with a provenance chip. There is no field for typing a
 *    figure, because that field is the hole every other product falls through.
 * 4. SEND COSTS WHAT THE SENDER IS WORTH. The house's own mailbox gets a plain
 *    button and an undo window (the AI reply path's shape, and its measured
 *    2-minute duration). A Mudavym subdomain address gets the seal, because one
 *    house's letter there affects every other house's deliverability. Neither
 *    is offered when nothing may be sent.
 *
 * A staff broadcast is NOT here (founder, 2026-09-04): this composer writes to
 * the vendor book, and crew messages stay on /team.
 *
 * WHAT IT NEVER CLAIMS
 * --------------------
 * It never says "Sent". The route returns 202 and the letter is QUEUED; the
 * conversation book says queued until the dispatcher has actually handed it to
 * Google. ADR 0083, pointed both ways: a page may not confirm a write it has not
 * had accepted, and it may not offer to undo something that already happened.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Info, Undo2 } from 'lucide-react';
import { HoldToApprove, Sheet } from '@/components/mudavym';
import { apiClient } from '../../../../services/api/client';
import { ink } from '../../../../lib/mudavym/motion';
import {
  MONO,
  SANS,
  SERIF,
  categoryLabel,
  fmtDay,
  fmtWindowLength,
  secondsLeft,
} from './compose-format';
import {
  guardrailsFrom,
  errText,
  useComposeData,
  type GuardrailHit,
  type InsightSentence,
  type LetterTemplate,
} from './useComposeData';
import type { AnsweredLetter } from '../mail-format';
import { RecipientField, type Recipient } from './RecipientField';
import { InsightPicker } from './InsightPicker';
import { MailMotionStyles } from '../mail-motion';
import { SenderLine } from './SenderLine';

const ICON = { size: 13, strokeWidth: 1.75 } as const;

/** "See it as it leaves": what the gateway says the send would write (r109 mail-gap g6). */
type AsItLeaves = {
  from: { name: string | null; address: string | null };
  to: string;
  replyTo: string | null;
  subject: string;
  inReplyTo: string | null;
  answersAt: string | null;
  body: string;
};
type SeeState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'shown'; letter: AsItLeaves }
  | { kind: 'failed'; message: string };

type SendState =
  | { kind: 'idle' }
  | { kind: 'queueing' }
  | {
      kind: 'queued';
      id: string;
      dispatchAt: string;
      says: string;
      undoMs: number | null;
      notices: GuardrailHit[];
    }
  | { kind: 'cancelled'; says: string }
  | { kind: 'asked'; says: string }
  | { kind: 'refused'; message: string; guardrails: GuardrailHit[] };

/**
 * The words a person left the composer with (COMMS-W34). The page holds them on
 * a stub where the sheet was opened (the house's Stub, sketch 103 · 1b) and
 * hands them back as `prefill` on Resume or Put it back.
 */
export interface HeldLetter {
  to: Recipient | null;
  subject: string;
  body: string;
  insights: InsightSentence[];
  templateId: string;
  /** The house's letter this one answers, when it was opened from Mail's "Write a reply". */
  answers?: string;
  /** Set on a reply to a team member or a guest, so a held letter comes back to the same fixed address. */
  person?: { address: string; name: string | null };
  /** The letter being answered, so a held reply comes back still showing it. */
  answerContext?: AnsweredLetter;
}

export interface ComposeSheetProps {
  open: boolean;
  onClose: () => void;
  /**
   * Called as the sheet leaves holding words nobody has sent (COMMS-W34) — by
   * Escape, a click outside, or Close. A letter that was queued, asked for or
   * discarded leaves nothing to hold.
   */
  onHold?: (held: HeldLetter) => void;
  /** The letter was queued (202): a reply held on its thread is let go (r109 mail-gap g2). */
  onQueued?: () => void;
  /** Prefill from a recommendation's "Write to the vendor", when there is one. */
  prefill?: {
    providerId?: string;
    subject?: string;
    body?: string;
    /**
     * The draft this letter is (ADR 0230) — a credit claim asked for leaves one.
     * Send turns THAT row into the queued letter; nothing leaves before it.
     */
    draftId?: string;
    /** The booked address the draft was written to, when it had one. */
    to?: string | null;
    /** Sentences and template a held letter carried (COMMS-W34), so Put it back loses neither. */
    insights?: InsightSentence[];
    templateId?: string;
    /**
     * What "unchanged" means. A drafted letter's own words, when the subject and
     * body above are a person's held changes to it; blank for a new letter.
     */
    baseline?: { subject: string; body: string; to: string | null };
    /**
     * The house's letter this one answers (Mail's "Write a reply", r28 gap 3).
     * The gateway files the reply in that letter's thread and sends it with
     * In-Reply-To. With no `to`, the vendor's own address in the book is chosen.
     */
    answers?: string;
    /**
     * A new letter to this vendor from its person page in Mail (r107 DD-r106-8):
     * the vendor's own address in the book is chosen, as a reply chooses it. The
     * server's recipient rule is unchanged.
     */
    writeToVendor?: boolean;
    /**
     * A reply to a team member or a guest who wrote to the house (ADR 0396): the
     * one address that wrote, fixed. There is no vendor and no book to choose from.
     */
    person?: { address: string; name: string | null };
    /**
     * The letter `answers` names, taken from the thread page Mail already read (r109 mail-gap g3):
     * who wrote it, when, and its words. Nothing is fetched for it.
     */
    answerContext?: AnsweredLetter;
  } | null;
  /** Called once a draft was discarded, so the page can drop it. */
  onDiscarded?: () => void;
  /**
   * `compress` lays the sheet beside the page instead of over it, on a desktop. Only Mail passes it
   * (r109 mail-gap g3); the primitive gives the page's width back on a phone.
   */
  layout?: 'overlay' | 'compress';
}

export function ComposeSheet({ open, onClose, onHold, onQueued, prefill, onDiscarded, layout = 'overlay' }: ComposeSheetProps) {
  const data = useComposeData(open);
  const person = prefill?.person ?? null;
  const [to, setTo] = useState<Recipient | null>(
    person ? { providerId: null, providerName: person.name ?? '', email: person.address } : null,
  );
  const draftId = prefill?.draftId;
  const [discarded, setDiscarded] = useState<string | null>(null);

  // A draft's recipient is the book entry it was written to, found once the
  // book answers. An address the book no longer holds is left unchosen rather
  // than typed in — the composer never addresses a string.
  const booked = prefill?.to && prefill.providerId ? { id: prefill.providerId, email: prefill.to } : null;
  useEffect(() => {
    if (to || !booked || !data.book) return;
    const hit = data.book.find(
      (e) => e.providerId === booked.id && e.email.toLowerCase() === booked.email.toLowerCase(),
    );
    if (hit) setTo({ providerId: hit.providerId, providerName: hit.providerName, email: hit.email });
  }, [to, booked?.id, booked?.email, data.book]); // eslint-disable-line react-hooks/exhaustive-deps
  // A reply opened from Mail names its vendor, not an address: the vendor's
  // own address in the book first, else its first contact. Chosen once, so
  // "Change" leaves the recipient free to choose.
  const answers = prefill?.answers;
  const replyVendor = (answers || prefill?.writeToVendor) && !prefill?.to ? prefill?.providerId ?? null : null;
  const replyChosen = useRef(false);
  useEffect(() => {
    if (replyChosen.current || to || !replyVendor || !data.book) return;
    const theirs = data.book.filter((e) => e.providerId === replyVendor);
    const hit = theirs.find((e) => e.source === 'provider') ?? theirs[0];
    if (!hit) return;
    replyChosen.current = true;
    setTo({ providerId: hit.providerId, providerName: hit.providerName, email: hit.email });
  }, [to, replyVendor, data.book]);
  const [subject, setSubject] = useState(prefill?.subject ?? '');
  const [body, setBody] = useState(prefill?.body ?? '');
  const [chosen, setChosen] = useState<InsightSentence[]>(prefill?.insights ?? []);
  const [templateId, setTemplateId] = useState<string>(prefill?.templateId ?? '');
  const [send, setSend] = useState<SendState>({ kind: 'idle' });
  const [tick, setTick] = useState(0);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const toRef = useRef<HTMLInputElement | null>(null);
  const [see, setSee] = useState<SeeState>({ kind: 'idle' });

  // The undo window is a real clock over a real row: the countdown re-reads the
  // server's `dispatchAt`, so a stalled tab shows 0 rather than a comforting
  // number the server never agreed to.
  useEffect(() => {
    if (send.kind !== 'queued') return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [send.kind]);

  const remaining = send.kind === 'queued' ? secondsLeft(send.dispatchAt) : null;
  void tick;

  // Memoised because `?? []` makes a new array on every render, and the
  // template option list downstream is a `useMemo` keyed on it.
  const templates = useMemo(() => data.templates ?? [], [data.templates]);
  const sender = data.sender;
  const ceremony = data.senderFailed ? 'none' : (sender?.ceremony ?? 'none');
  // WHO (ADR 0175 D10, 2026-09-21): the composer is a vendor send, so only an
  // owner, a manager or a grantee may send from it. Said before the hold.
  const standing = sender?.sendOrAsk ?? null;
  const maySend = Boolean(standing?.readable && standing.maySend);
  // A staff member's letter is KEPT and a manager is asked (founder answer 3,
  // 2026-09-21). The composer stays a click (answer 7), so the ask is a click
  // too; the manager's release is one hold.
  const mayAsk = Boolean(standing?.readable && !standing.maySend && standing.mode === 'ask');
  const canAsk =
    mayAsk &&
    to !== null &&
    subject.trim().length > 0 &&
    body.trim().length > 0 &&
    send.kind !== 'queueing' &&
    send.kind !== 'asked';
  const canSend =
    !data.senderFailed &&
    Boolean(sender?.sendable) &&
    maySend &&
    to !== null &&
    subject.trim().length > 0 &&
    body.trim().length > 0 &&
    send.kind !== 'queueing' &&
    // A draft that has been queued or discarded is not sent again from here.
    !(draftId && (send.kind === 'queued' || send.kind === 'cancelled' || discarded !== null));

  // COMMS-W34: what the person would lose by leaving. A drafted letter is kept
  // on the server as it was drafted, so only changes to it count; a new letter
  // counts whatever was written. Fixed when the sheet opens.
  const [base] = useState(
    () =>
      prefill?.baseline ??
      (draftId
        ? { subject: prefill?.subject ?? '', body: prefill?.body ?? '', to: prefill?.to ?? null }
        : { subject: '', body: '', to: null }),
  );
  const gone =
    send.kind === 'queueing' ||
    send.kind === 'queued' ||
    send.kind === 'asked' ||
    discarded !== null ||
    (!!draftId && send.kind === 'cancelled');
  // A reply opened from Mail starts from its own "Re:" subject and its
  // vendor, so closing it unwritten writes nothing and holds nothing (r31 walk:
  // the held "Re:" stub then came back as "Write a letter"). Its vendor is
  // compared by id: the address is only chosen once the book is read.
  const changed = person
    ? subject.trim() !== (prefill?.subject ?? '').trim() || body.trim() !== ''
    : replyVendor
    ? (to !== null && to.providerId !== replyVendor) ||
      subject.trim() !== (prefill?.subject ?? '').trim() ||
      body.trim() !== ''
    : (to !== null && to.email.toLowerCase() !== (base.to ?? '').toLowerCase()) ||
      subject.trim() !== base.subject.trim() ||
      body.trim() !== base.body.trim();
  const dirty = !gone && changed;
  const leave = () => {
    if (dirty) onHold?.({
        to,
        subject,
        body,
        insights: chosen,
        templateId,
        answers,
        ...(person ? { person } : {}),
        ...(answers && prefill?.answerContext ? { answerContext: prefill.answerContext } : {}),
      });
    onClose();
  };

  const applyTemplate = useCallback(
    (t: LetterTemplate | undefined) => {
      if (!t) return;
      setTemplateId(t.id);
      if (t.subject) setSubject(t.subject);
      setBody(t.body);
    },
    [],
  );

  const insertSentence = useCallback((insight: InsightSentence) => {
    setChosen((prev) =>
      prev.some((p) => p.candidateKey === insight.candidateKey) ? prev : [...prev, insight],
    );
    setBody((prev) => (prev.trim() ? `${prev.replace(/\s*$/, '')}\n\n${insight.sentence}` : insight.sentence));
  }, []);

  const removeSentence = useCallback((candidateKey: string) => {
    setChosen((prev) => prev.filter((p) => p.candidateKey !== candidateKey));
  }, []);

  /** The letter exactly as it will be queued — the seal is minted over this. */
  const letter = useMemo(
    () =>
      to
        ? {
            providerId: to.providerId ?? undefined,
            to: to.email,
            subject: subject.trim(),
            body,
            // The draft this letter sends, when it came from one (ADR 0230);
            // the gateway checks it is still this house's draft to this vendor.
            draftId: draftId || undefined,
            templateId: templateId || undefined,
            // A reply names the letter it answers, and only to that letter's vendor.
            answers: answers && (to.providerId ?? null) === (prefill?.providerId ?? null) ? answers : undefined,
            insights: chosen.map((c) => ({
              candidateKey: c.candidateKey,
              sentence: c.sentence,
            })),
          }
        : null,
    [to, subject, body, draftId, templateId, chosen, answers, prefill?.providerId],
  );

  // A preview is of THESE words: any change to the letter takes it down, so it
  // never shows a header block for a letter that is no longer the one held.
  const letterKey = letter ? JSON.stringify(letter) : '';
  useEffect(() => {
    setSee((prev) => (prev.kind === 'idle' ? prev : { kind: 'idle' }));
  }, [letterKey]);

  /** Ask the gateway for the header block and body the send would write. Queues nothing. */
  const seeIt = useCallback(async () => {
    if (!letter) return;
    setSee({ kind: 'loading' });
    try {
      const { data: shown } = await apiClient.post<AsItLeaves>('/communications/letters/preview', letter);
      setSee({ kind: 'shown', letter: shown });
    } catch (e) {
      setSee({ kind: 'failed', message: errText(e) });
    }
  }, [letter]);

  /**
   * Mint the seal over the letter (ADR 0175 D9, sealed 2026-09-21). On the seal
   * ceremony it is minted when the hold begins; on the house-mailbox ceremony
   * (a click and an undo window, ADR 0118 D2) it is minted on the click — the
   * gateway requires a seal on every composer letter either way.
   */
  const mint = useCallback(async (): Promise<string | null> => {
    if (!letter) return null;
    try {
      const { data: issued } = await apiClient.post<{ challenge?: string }>(
        '/communications/letters/seal-challenge',
        letter,
      );
      return issued?.challenge ?? null;
    } catch (e) {
      setSend({ kind: 'refused', message: `The seal could not be issued (${errText(e)}), so nothing was queued.`, guardrails: [] });
      return null;
    }
  }, [letter]);

  const queue = useCallback(async (held?: string | null) => {
    if (!to || !letter) return;
    setSend({ kind: 'queueing' });
    const challenge = held ?? (await mint());
    if (!challenge) {
      setSend((prev) =>
        prev.kind === 'refused'
          ? prev
          : { kind: 'refused', message: 'The seal was not issued, so nothing was queued.', guardrails: [] },
      );
      return;
    }
    try {
      const { data: result } = await apiClient.post<{
        id: string;
        dispatchAt: string;
        says: string;
        undoMs: number | null;
        notices: GuardrailHit[];
        insightsRecorded: number;
      }>('/communications/letters', letter, {
        headers: { 'X-Seal-Challenge': challenge },
      });
      setSend({
        kind: 'queued',
        id: result.id,
        dispatchAt: result.dispatchAt,
        says: result.says,
        undoMs: result.undoMs,
        notices: result.notices ?? [],
      });
      onQueued?.();
      data.refetchQueued();
    } catch (e) {
      setSend({
        kind: 'refused',
        message: errText(e),
        guardrails: guardrailsFrom(e),
      });
    }
  }, [to, letter, mint, data, onQueued]);

  /** Ask an owner or a manager to send this exact letter. Nothing is queued. */
  const ask = useCallback(async () => {
    if (!letter) return;
    setSend({ kind: 'queueing' });
    try {
      const { data: result } = await apiClient.post<{ says: string; requestId: string }>(
        '/communications/letters/requests',
        letter,
      );
      setSend({ kind: 'asked', says: result.says });
      data.refetchRequests?.();
    } catch (e) {
      setSend({ kind: 'refused', message: `Nothing was asked: ${errText(e)}`, guardrails: guardrailsFrom(e) });
    }
  }, [letter, data]);

  const discard = useCallback(async () => {
    if (!draftId) return;
    try {
      const { data: result } = await apiClient.post<{ says: string }>(
        `/communications/letters/${draftId}/discard`,
      );
      setDiscarded(result.says);
      onDiscarded?.();
    } catch (e) {
      setSend({ kind: 'refused', message: `It was NOT discarded — ${errText(e)}`, guardrails: [] });
    }
  }, [draftId, onDiscarded]);

  const cancel = useCallback(async () => {
    if (send.kind !== 'queued') return;
    try {
      const { data: result } = await apiClient.post<{ says: string }>(
        `/communications/letters/${send.id}/cancel`,
      );
      setSend({ kind: 'cancelled', says: result.says });
      data.refetchQueued();
    } catch (e) {
      // A failed cancel must never look like a successful one: the letter is
      // still on its way, and saying so is the only honest move.
      setSend({ kind: 'refused', message: `It was NOT pulled back — ${errText(e)}`, guardrails: [] });
    }
  }, [send, data]);

  const templateOptions = useMemo(
    () =>
      templates.map((t) => ({
        id: t.id,
        label: `${t.name} · ${categoryLabel(t.category)}`,
        lastUsed: t.lastUsedAt,
      })),
    [templates],
  );

  // A reply says whom it answers and which letter (r109 mail-gap g3).
  const isReply = !!answers && !draftId;
  const answered = prefill?.answerContext ?? null;
  const replyName = (answered?.name ?? person?.name ?? '').trim();
  const replyTitle = replyName ? `Reply to ${replyName}` : 'A reply';
  const replyLabel = replyName ? `Write a reply to ${replyName} from the house` : 'Write a reply from the house';
  const replyEyebrow = answered?.at ? `Answers the letter of ${fmtDay(answered.at)}` : 'Answers a letter of theirs';

  return (
    <Sheet
      open={open}
      onClose={leave}
      dirty={dirty}
      wide
      layout={layout}
      // A reply opens with the cursor in the letter, a new letter in To (r109 mail-gap g3).
      initialFocusRef={isReply ? bodyRef : toRef}
      label={draftId ? 'A drafted letter from the house, not sent' : isReply ? replyLabel : 'Write a letter from the house'}
      eyebrow={draftId ? 'Drafted · not sent' : isReply ? replyEyebrow : 'The house writes'}
      title={draftId ? 'A drafted letter' : isReply ? replyTitle : 'A letter from the house'}
    >
      <style>{`
        .cmp-pick { transition: background ${ink.ms}ms ${ink.easing}, border-color ${ink.ms}ms ${ink.easing} }
        .cmp-pick:hover { background: var(--paper-1, #F3EFE6); border-color: var(--paper-2, #EAE4D8) !important }
        @media (prefers-reduced-motion: reduce) { .cmp-pick { transition: none } }
      `}</style>

      <div className="grid gap-4" style={{ fontFamily: SANS }}>
        <SenderLine sender={sender} failed={data.senderFailed} error={data.senderError} />

        {isReply && answered && <AnsweredLetterRow letter={answered} />}

        <RecipientField
          inputRef={toRef}
          book={data.book}
          failed={data.bookFailed}
          error={data.bookError}
          value={to}
          onChange={setTo}
          onBookChanged={data.refetchQueued}
          fixed={person ?? undefined}
        />

        {/* the house's templates */}
        <div>
          <label
            htmlFor="cmp-template"
            style={{
              display: 'block',
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--ink-4, #665D50)',
              marginBottom: 4,
            }}
          >
            Start from
          </label>
          {data.templatesFailed ? (
            <p role="alert" style={{ fontSize: 11.5, color: 'var(--alarm-deep, #8C3322)', margin: 0 }}>
              {/* The server's own sentence, verbatim, then the consequence it
                  cannot know. Restating the failure here printed it twice,
                  nested inside itself, in the first browser capture. */}
              {data.templatesError} The library is unknown, not empty — write from a blank letter,
              or retry.
            </p>
          ) : (
            <>
              <select
                id="cmp-template"
                value={templateId}
                onChange={(e) => {
                  const next = e.target.value;
                  setTemplateId(next);
                  applyTemplate(templates.find((t) => t.id === next));
                }}
                style={{
                  width: '100%',
                  fontSize: 12.5,
                  padding: '6px 9px',
                  borderRadius: 8,
                  border: '1px solid var(--paper-2, #EAE4D8)',
                  background: 'var(--paper-0, #FAF7F1)',
                  color: 'var(--ink-1, #211C16)',
                }}
              >
                <option value="">A blank letter</option>
                {templateOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                    {t.lastUsed ? ` · last used ${fmtDay(t.lastUsed)}` : ' · never used'}
                  </option>
                ))}
              </select>
              {templates.length === 0 && (
                <p style={{ fontSize: 11, color: 'var(--ink-4, #665D50)', margin: '5px 0 0' }}>
                  This house has written no template yet. A template is a letter you have already
                  written twice — write the letter first.
                </p>
              )}
            </>
          )}
        </div>

        <div>
          <label
            htmlFor="cmp-subject"
            style={{
              display: 'block',
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--ink-4, #665D50)',
              marginBottom: 4,
            }}
          >
            Subject
          </label>
          <input
            id="cmp-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            style={{
              width: '100%',
              fontFamily: SERIF,
              fontSize: 15,
              padding: '7px 10px',
              borderRadius: 8,
              border: '1px solid var(--paper-2, #EAE4D8)',
              background: 'var(--paper-0, #FAF7F1)',
              color: 'var(--ink-1, #211C16)',
            }}
          />
        </div>

        <div>
          <label
            htmlFor="cmp-body"
            style={{
              display: 'block',
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--ink-4, #665D50)',
              marginBottom: 4,
            }}
          >
            The letter
          </label>
          <textarea
            id="cmp-body"
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            style={{
              width: '100%',
              fontSize: 13,
              lineHeight: 1.55,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--paper-2, #EAE4D8)',
              background: 'var(--paper-0, #FAF7F1)',
              color: 'var(--ink-1, #211C16)',
              resize: 'vertical',
            }}
          />
        </div>

        <InsightPicker
          insights={data.insights}
          failed={data.insightsFailed}
          error={data.insightsError}
          chosen={chosen}
          onInsert={insertSentence}
          onRemove={removeSentence}
        />

        {/* ── See it as it leaves (r109 mail-gap g6) ───────────────────────── */}
        <div className="grid gap-2">
          <button
            type="button"
            data-testid="letter-see"
            onClick={() => void seeIt()}
            disabled={!letter || see.kind === 'loading'}
            aria-expanded={see.kind === 'shown'}
            style={{
              justifySelf: 'start',
              background: 'none',
              border: 'none',
              padding: 0,
              fontSize: 12.5,
              fontWeight: 600,
              textDecoration: 'underline',
              textUnderlineOffset: 3,
              color: letter ? 'var(--seal-deep, #14515C)' : 'var(--ink-4, #665D50)',
              cursor: letter ? 'pointer' : 'not-allowed',
            }}
          >
            {see.kind === 'loading' ? 'Reading it…' : 'See it as it leaves'}
          </button>
          {see.kind === 'failed' && (
            <p role="alert" data-testid="letter-see-failed" style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--alarm-deep, #8C3322)' }}>
              It could not be shown as it leaves: {see.message}
            </p>
          )}
          {see.kind === 'shown' && (
            <div
              data-testid="letter-as-it-leaves"
              className="mail-fade-in rounded-xl px-3 py-2.5"
              style={{ border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)' }}
            >
              <MailMotionStyles />
              <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '3px 12px', fontSize: 12, lineHeight: 1.5 }}>
                <dt style={{ color: 'var(--ink-4, #665D50)' }}>From</dt>
                <dd style={{ margin: 0, color: 'var(--ink-1, #211C16)' }}>
                  {see.letter.from.address
                    ? see.letter.from.name
                      ? `${see.letter.from.name} <${see.letter.from.address}>`
                      : see.letter.from.address
                    : 'The mailbox this house sends from'}
                </dd>
                <dt style={{ color: 'var(--ink-4, #665D50)' }}>To</dt>
                <dd style={{ margin: 0, color: 'var(--ink-1, #211C16)' }}>{see.letter.to}</dd>
                <dt style={{ color: 'var(--ink-4, #665D50)' }}>Reply-To</dt>
                <dd style={{ margin: 0, color: 'var(--ink-1, #211C16)' }}>{see.letter.replyTo ?? 'The From address'}</dd>
                <dt style={{ color: 'var(--ink-4, #665D50)' }}>Subject</dt>
                <dd style={{ margin: 0, color: 'var(--ink-1, #211C16)' }}>{see.letter.subject}</dd>
                {see.letter.inReplyTo && (
                  <>
                    <dt style={{ color: 'var(--ink-4, #665D50)' }}>Threading</dt>
                    <dd style={{ margin: 0, color: 'var(--ink-1, #211C16)' }}>
                      {see.letter.answersAt
                        ? `Answers their letter of ${fmtDay(see.letter.answersAt)}`
                        : 'Answers their letter'}
                    </dd>
                  </>
                )}
              </dl>
              <pre
                data-testid="letter-as-sent-body"
                style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', fontFamily: SANS, fontSize: 12.5, lineHeight: 1.55, color: 'var(--ink-1, #211C16)' }}
              >
                {see.letter.body}
              </pre>
            </div>
          )}
        </div>

        {/* ── the outcome, in words ───────────────────────────────────────── */}
        {send.kind === 'refused' && (
          <div
            role="alert"
            data-testid="letter-refused"
            className="rounded-xl px-3 py-2.5"
            style={{
              border: '1px solid var(--alarm-ring, rgba(155,58,42,.3))',
              background: 'var(--alarm-tint, rgba(155,58,42,.08))',
            }}
          >
            <div className="flex items-baseline gap-2">
              <AlertTriangle {...ICON} aria-hidden style={{ color: 'var(--alarm-deep, #8C3322)' }} />
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--alarm-deep, #8C3322)' }}>
                {send.message}
              </p>
            </div>
            <p style={{ margin: '5px 0 0', fontSize: 11, color: 'var(--ink-2, #4F473C)' }}>
              Nothing was queued and nothing was sent.
            </p>
          </div>
        )}

        {send.kind === 'queued' && (
          <div
            role="status"
            data-testid="letter-queued"
            className="rounded-xl px-3 py-2.5"
            style={{ border: '1px solid var(--seal-ring, rgba(26,94,107,.32))', background: 'var(--seal-tint, rgba(26,94,107,.08))' }}
          >
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--seal-deep, #14515C)' }}>
              {send.says}
            </p>
            {send.notices.map((n) => (
              <p
                key={n.rule}
                style={{ margin: '5px 0 0', fontSize: 11, color: 'var(--ink-2, #4F473C)' }}
              >
                <Info {...ICON} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />
                {n.says}
              </p>
            ))}
            {remaining !== null && remaining > 0 && (
              <button
                type="button"
                onClick={cancel}
                className="mt-2 inline-flex items-center gap-1.5"
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  padding: '5px 11px',
                  borderRadius: 8,
                  border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                  background: 'var(--paper-0, #FAF7F1)',
                  color: 'var(--seal-deep, #14515C)',
                  cursor: 'pointer',
                }}
              >
                <Undo2 {...ICON} aria-hidden />
                Pull it back ({remaining}s)
              </button>
            )}
            {remaining === 0 && (
              <p style={{ margin: '5px 0 0', fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
                The window has closed. Whether it left is what the conversation book says, not this
                panel.
              </p>
            )}
          </div>
        )}

        {draftId && (
          <p data-testid="letter-draft-note" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.45, color: 'var(--ink-2, #4F473C)' }}>
            {discarded ??
              (prefill?.to
                ? 'Mudavym drafted this letter; it has not been sent. Read it, change what you want, and send it — sending is the approval.'
                : 'Mudavym drafted this letter; it has not been sent. The vendor had no address in the book when it was drafted — choose or add one below before it can go.')}
          </p>
        )}

        {send.kind === 'cancelled' && (
          <p role="status" style={{ margin: 0, fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
            {send.says}
          </p>
        )}

        {send.kind === 'asked' && (
          <p role="status" data-testid="letter-asked" style={{ margin: 0, fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
            {send.says}
          </p>
        )}

        {/* A vendor's answer that would not reach Mail is said before Send,
            never after (r36 mail audit, gap 1): the letter leaves from the
            house's own mailbox, the deployment has no Mudavym address to
            answer to, and nothing reads that mailbox. Send stays open: a
            day-1 owner may still write, knowing where the answer goes. */}
        {sender?.kind === 'house_mailbox' &&
          sender.sendable &&
          sender.conversation?.answerReachesMail === false && (
            <p
              data-testid="answer-unseen"
              role="note"
              className="flex items-start gap-1.5"
              style={{ margin: 0, fontSize: 11.5, lineHeight: 1.45, color: 'var(--ink-2, #4F473C)', maxWidth: '60ch' }}
            >
              <Info size={13} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                {`A vendor's answer to this letter goes back to ${
                  sender.address ?? 'the mailbox it leaves from'
                }. Nothing here reads that mailbox, so the answer will not show in Mail. `}
                <Link
                  to="/communications?tab=mail&setup=1"
                  onClick={leave}
                  data-testid="answer-unseen-setup"
                  style={{ color: 'var(--seal, #1A5E6B)', fontWeight: 600 }}
                >
                  See Mail setup
                </Link>
              </span>
            </p>
          )}

        {/* ── Send ────────────────────────────────────────────────────────── */}
        <div
          className="flex flex-wrap items-center gap-3 pt-1"
          style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}
        >
          {mayAsk ? (
            <button
              type="button"
              data-testid="letter-ask"
              onClick={() => void ask()}
              disabled={!canAsk}
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                padding: '7px 16px',
                borderRadius: 9,
                border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                background: canAsk ? 'var(--seal, #1A5E6B)' : 'transparent',
                color: canAsk ? 'var(--paper-0, #FAF7F1)' : 'var(--ink-4, #665D50)',
                cursor: canAsk ? 'pointer' : 'not-allowed',
                opacity: canAsk ? 1 : 0.7,
              }}
            >
              {send.kind === 'queueing' ? 'Asking…' : 'Ask a manager to send it'}
            </button>
          ) : ceremony === 'seal' ? (
            <HoldToApprove
              onChallenge={mint}
              onApprove={(challenge) => queue(challenge)}
              disabled={!canSend}
              label="Hold to send"
              approvedLabel="Queued"
            />
          ) : (
            <button
              type="button"
              data-testid="letter-send"
              onClick={() => void queue()}
              disabled={!canSend}
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                padding: '7px 16px',
                borderRadius: 9,
                border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                background: canSend ? 'var(--seal, #1A5E6B)' : 'transparent',
                color: canSend ? 'var(--paper-0, #FAF7F1)' : 'var(--ink-4, #665D50)',
                cursor: canSend ? 'pointer' : 'not-allowed',
                opacity: canSend ? 1 : 0.7,
              }}
            >
              {send.kind === 'queueing' ? 'Queueing…' : 'Send'}
            </button>
          )}
          {draftId && send.kind !== 'queued' && discarded === null && (
            <button
              type="button"
              data-testid="letter-discard"
              onClick={discard}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '7px 12px',
                borderRadius: 9,
                border: '1px solid var(--paper-2, #EAE4D8)',
                background: 'transparent',
                color: 'var(--ink-2, #4F473C)',
                cursor: 'pointer',
              }}
            >
              Discard the draft
            </button>
          )}
          <p style={{ margin: 0, fontSize: 11, lineHeight: 1.45, color: 'var(--ink-4, #665D50)', maxWidth: '52ch' }}>
            {data.senderFailed
              ? 'Send is disabled: which mailbox this house sends from could not be read, and a letter is never sent from a mailbox we cannot name.'
              : !sender
                ? 'Send is disabled until the sender line has answered.'
                : !sender.sendable
                  ? sender.kind === 'none'
                    ? 'Send is disabled until this house has a mailbox to send from.'
                    : `Send is disabled: ${sender.words}`
                  : !standing
                    ? 'Send is disabled: whether you may send letters to vendors has not been answered yet.'
                    : mayAsk
                      ? (standing.sentence ??
                        'Your letter will be kept exactly as you wrote it and a manager asked to send it.')
                    : !maySend
                      ? `Send is disabled: ${standing.sentence ?? 'whether you may send letters to vendors could not be read.'}`
                  : standing.basis === 'grant' && standing.grant
                    ? `You send under a grant from ${standing.grant.grantedBy.name ?? 'an owner'}. ${
                        ceremony === 'seal'
                          ? 'Held under the seal because a letter on the shared Mudavym domain affects every other house that sends from it.'
                          : `Sends after ${fmtWindowLength(sender.undoMs)}.`
                      }`
                  : ceremony === 'seal'
                    ? 'Held under the seal because a letter on the shared Mudavym domain affects every other house that sends from it.'
                    : `Sends after ${fmtWindowLength(sender.undoMs)}. Nothing is sent automatically, and nothing is sent to ${
                        person ? 'any address but the one that wrote' : 'an address the book does not hold'
                      }.`}
          </p>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * The letter a reply answers, one tap away (r109 mail-gap g3; Gmail keeps the quote a tap away,
 * Superhuman keeps the thread above the reply). A 44 px row that opens to the letter's words as
 * the thread page already read them. Nothing animates: the words are there or they are not.
 */
function AnsweredLetterRow({ letter }: { letter: AnsweredLetter }) {
  const [shown, setShown] = useState(false);
  const panel = useId();
  return (
    <div data-testid="answered-letter">
      <button
        type="button"
        aria-expanded={shown}
        aria-controls={panel}
        onClick={() => setShown((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
        style={{
          minHeight: 44,
          padding: '0 12px',
          borderRadius: 8,
          border: '1px solid var(--paper-2, #EAE4D8)',
          background: 'var(--paper-1, #F3EFE6)',
          color: 'var(--ink-2, #4F473C)',
          fontSize: 12.5,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <span>The letter you are answering</span>
        <span aria-hidden style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
          {shown ? 'Hide' : 'Show'}
        </span>
      </button>
      {shown && (
        <div
          id={panel}
          data-testid="answered-letter-text"
          tabIndex={0}
          style={{
            marginTop: 6,
            maxHeight: 220,
            overflowY: 'auto',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--paper-2, #EAE4D8)',
            background: 'var(--paper-0, #FAF7F1)',
            color: 'var(--ink-1, #211C16)',
            fontSize: 12.5,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {letter.text.trim() !== '' ? (
            letter.text
          ) : (
            <span style={{ color: 'var(--ink-4, #665D50)' }}>The words of this letter are no longer kept.</span>
          )}
        </div>
      )}
    </div>
  );
}

export default ComposeSheet;
