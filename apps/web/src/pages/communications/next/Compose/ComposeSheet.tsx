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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { RecipientField, type Recipient } from './RecipientField';
import { InsightPicker } from './InsightPicker';
import { SenderLine } from './SenderLine';

const ICON = { size: 13, strokeWidth: 1.75 } as const;

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
  } | null;
  /** Called once a draft was discarded, so the page can drop it. */
  onDiscarded?: () => void;
}

export function ComposeSheet({ open, onClose, onHold, prefill, onDiscarded }: ComposeSheetProps) {
  const data = useComposeData();
  const [to, setTo] = useState<Recipient | null>(null);
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
  const [subject, setSubject] = useState(prefill?.subject ?? '');
  const [body, setBody] = useState(prefill?.body ?? '');
  const [chosen, setChosen] = useState<InsightSentence[]>(prefill?.insights ?? []);
  const [templateId, setTemplateId] = useState<string>(prefill?.templateId ?? '');
  const [send, setSend] = useState<SendState>({ kind: 'idle' });
  const [tick, setTick] = useState(0);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

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
  const changed =
    (to !== null && to.email.toLowerCase() !== (base.to ?? '').toLowerCase()) ||
    subject.trim() !== base.subject.trim() ||
    body.trim() !== base.body.trim();
  const dirty = !gone && changed;
  const leave = () => {
    if (dirty) onHold?.({ to, subject, body, insights: chosen, templateId });
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
            providerId: to.providerId,
            to: to.email,
            subject: subject.trim(),
            body,
            // The draft this letter sends, when it came from one (ADR 0230);
            // the gateway checks it is still this house's draft to this vendor.
            draftId: draftId || undefined,
            templateId: templateId || undefined,
            insights: chosen.map((c) => ({
              candidateKey: c.candidateKey,
              sentence: c.sentence,
            })),
          }
        : null,
    [to, subject, body, draftId, templateId, chosen],
  );

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
      data.refetchQueued();
    } catch (e) {
      setSend({
        kind: 'refused',
        message: errText(e),
        guardrails: guardrailsFrom(e),
      });
    }
  }, [to, letter, mint, data]);

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

  return (
    <Sheet
      open={open}
      onClose={leave}
      dirty={dirty}
      wide
      label={draftId ? 'A drafted letter from the house, not sent' : 'Write a letter from the house'}
      eyebrow={draftId ? 'Drafted · not sent' : 'The house writes'}
      title={draftId ? 'A drafted letter' : 'A letter from the house'}
    >
      <style>{`
        .cmp-pick { transition: background ${ink.ms}ms ${ink.easing}, border-color ${ink.ms}ms ${ink.easing} }
        .cmp-pick:hover { background: var(--paper-1, #F3EFE6); border-color: var(--paper-2, #EAE4D8) !important }
        @media (prefers-reduced-motion: reduce) { .cmp-pick { transition: none } }
      `}</style>

      <div className="grid gap-4" style={{ fontFamily: SANS }}>
        <SenderLine sender={sender} failed={data.senderFailed} error={data.senderError} />

        <RecipientField
          book={data.book}
          failed={data.bookFailed}
          error={data.bookError}
          value={to}
          onChange={setTo}
          onBookChanged={data.refetchQueued}
        />

        {/* the house's templates */}
        <div>
          <label
            htmlFor="cmp-template"
            style={{
              display: 'block',
              fontFamily: MONO,
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.14em',
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
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.14em',
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
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.14em',
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
                    : `Sends after ${fmtWindowLength(sender.undoMs)}. Nothing is sent automatically, and nothing is sent to an address the book does not hold.`}
          </p>
        </div>
      </div>
    </Sheet>
  );
}

export default ComposeSheet;
