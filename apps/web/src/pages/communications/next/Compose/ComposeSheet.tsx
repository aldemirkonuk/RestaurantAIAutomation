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
  | { kind: 'refused'; message: string; guardrails: GuardrailHit[] };

export interface ComposeSheetProps {
  open: boolean;
  onClose: () => void;
  /** Prefill from a recommendation's "Write to the vendor", when there is one. */
  prefill?: { providerId?: string; subject?: string; body?: string } | null;
}

export function ComposeSheet({ open, onClose, prefill }: ComposeSheetProps) {
  const data = useComposeData();
  const [to, setTo] = useState<Recipient | null>(null);
  const [subject, setSubject] = useState(prefill?.subject ?? '');
  const [body, setBody] = useState(prefill?.body ?? '');
  const [chosen, setChosen] = useState<InsightSentence[]>([]);
  const [templateId, setTemplateId] = useState<string>('');
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
  const canSend =
    !data.senderFailed &&
    Boolean(sender?.sendable) &&
    to !== null &&
    subject.trim().length > 0 &&
    body.trim().length > 0 &&
    send.kind !== 'queueing';

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

  const queue = useCallback(async () => {
    if (!to) return;
    setSend({ kind: 'queueing' });
    try {
      const { data: result } = await apiClient.post<{
        id: string;
        dispatchAt: string;
        says: string;
        undoMs: number | null;
        notices: GuardrailHit[];
        insightsRecorded: number;
      }>('/communications/letters', {
        providerId: to.providerId,
        to: to.email,
        subject: subject.trim(),
        body,
        templateId: templateId || undefined,
        insights: chosen.map((c) => ({
          candidateKey: c.candidateKey,
          sentence: c.sentence,
        })),
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
  }, [to, subject, body, templateId, chosen, data]);

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
      onClose={onClose}
      wide
      label="Write a letter from the house"
      eyebrow="The house writes"
      title="A letter from the house"
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
              color: 'var(--ink-3, #7C7365)',
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
                <p style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)', margin: '5px 0 0' }}>
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
              color: 'var(--ink-3, #7C7365)',
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
              color: 'var(--ink-3, #7C7365)',
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
              <p style={{ margin: '5px 0 0', fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
                The window has closed. Whether it left is what the conversation book says, not this
                panel.
              </p>
            )}
          </div>
        )}

        {send.kind === 'cancelled' && (
          <p role="status" style={{ margin: 0, fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
            {send.says}
          </p>
        )}

        {/* ── Send ────────────────────────────────────────────────────────── */}
        <div
          className="flex flex-wrap items-center gap-3 pt-1"
          style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}
        >
          {ceremony === 'seal' ? (
            <HoldToApprove
              onApprove={queue}
              disabled={!canSend}
              label="Hold to send"
              approvedLabel="Queued"
            />
          ) : (
            <button
              type="button"
              data-testid="letter-send"
              onClick={queue}
              disabled={!canSend}
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                padding: '7px 16px',
                borderRadius: 9,
                border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                background: canSend ? 'var(--seal, #1A5E6B)' : 'transparent',
                color: canSend ? 'var(--paper-0, #FAF7F1)' : 'var(--ink-3, #7C7365)',
                cursor: canSend ? 'pointer' : 'not-allowed',
                opacity: canSend ? 1 : 0.7,
              }}
            >
              {send.kind === 'queueing' ? 'Queueing…' : 'Send'}
            </button>
          )}
          <p style={{ margin: 0, fontSize: 11, lineHeight: 1.45, color: 'var(--ink-3, #7C7365)', maxWidth: '52ch' }}>
            {data.senderFailed
              ? 'Send is disabled: which mailbox this house sends from could not be read, and a letter is never sent from a mailbox we cannot name.'
              : !sender
                ? 'Send is disabled until the sender line has answered.'
                : !sender.sendable
                  ? `Send is disabled: ${sender.words}`
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
