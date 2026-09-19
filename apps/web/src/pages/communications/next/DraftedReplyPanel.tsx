/**
 * "The house's reply, drafted" — the owed act on `/communications`, with the
 * seal ADR 0118 requires.
 *
 * WHAT WAS OWED. The rebuilt page can COUNT drafts waiting — "drafts pending"
 * on the glance strip, from `GET /procurement/conversations/active` — and could
 * do nothing about one. The act lived on `/orders`, in
 * `components/orders/DraftEmailApprovalPanel.tsx:130`, and the census moves it
 * here because a letter to a vendor is this page's business.
 *
 * THE SEAL, AND WHY IT NEEDED TWO NEW ROUTES
 * ------------------------------------------
 * ADR 0118: *nothing reaches a vendor without a person's hold.* The legacy
 * panel's approve button posted `POST orders/:id/approve-draft` — one click,
 * and mail left the building on an unsealed request. Nothing in the gateway
 * could seal a SEND, so packet 2 built it:
 *
 *   POST /procurement/orders/:id/draft-seal-challenge   mint  (procurement.controller.ts)
 *   POST /procurement/orders/:id/send-drafted-reply     spend (procurement.controller.ts)
 *
 * The seal is minted when the HOLD BEGINS and bound to the LETTER — the words,
 * the recipient and the copies as the person read them (`draftSealArgs`). A
 * paragraph edited between the hold and the release is refused by the args
 * hash rather than quietly posted; a seal minted to approve the order's MONEY
 * cannot be spent to send its MAIL, because `send_draft` is its own act.
 *
 * The older unsealed route still exists and the legacy desk still calls it.
 * That is filed for the founder, not papered over here.
 *
 * A DRAFT NEVER LOOKS SENT (ADR 0112 rule 5). The engine's words are grey until
 * a person edits them; an edited letter says "edited by you" and the grey does
 * not come back. Nothing about opening this panel changes a draft.
 *
 * THE CONSTRAINT WARNINGS ARE THE ENGINE'S FLAGS AND NAME THEIR RULE. The
 * legacy panel printed them with a severity colour; here each names the rule it
 * tripped, in words, which is the house's own rule for a flag.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Panel, HoldToApprove } from '@/components/mudavym';
import { apiClient, getErrorMessage } from '@/services/api/client';
import { queryKeys } from '@/lib/query-keys';
import { MONO, SANS, SERIF } from './cm-format';

export interface ConstraintWarning {
  code: string;
  message: string;
  severity?: string;
}

/** `ActiveConversationDto`, as this panel needs it. */
export interface DraftedReply {
  id: string;
  orderId: string;
  orderNumber: string | null;
  wineName: string | null;
  providerName: string | null;
  providerEmail: string | null;
  emailType: string;
  roundCount: number;
  draftContent: string | null;
  constraintFlags?: unknown;
  createdAt: string;
}

/**
 * The engine's own vocabulary, in the house's words.
 *
 * A type the gateway grows and this map has not caught up with is shown AS
 * ITSELF, lower-cased and unpunctuated, rather than as "Email". The legacy
 * panel's fallback erased the distinction between a kind nobody has named and
 * a kind called "Email", and an operator could not tell which they had.
 */
const KINDS: Record<string, string> = {
  PRICE_INQUIRY: 'asking a price',
  DEMAND_OFFER: 'asking for an offer',
  PROMO_INQUIRY: 'asking about a promotion',
  WINE_INQUIRY: 'asking about a wine',
  COUNTER_OFFER: 'a counter-offer',
  CLARIFICATION: 'asking them to be clearer',
  ACCEPTANCE_CONFIRM_REQUEST: 'accepting, and asking them to confirm',
  ESCALATION: 'escalating',
  ORDER_CONFIRMATION: 'confirming the order',
  MANUAL_REPLY: 'a reply written by a person',
};

export function kindWords(emailType: string): string {
  return KINDS[emailType] ?? emailType.toLowerCase().replace(/_/g, ' ');
}

/** The subject the send derives, shown so nobody is surprised by it. */
export function subjectFor(reply: DraftedReply): string {
  return `${reply.wineName ?? 'This order'} — ${kindWords(reply.emailType)}`;
}

/** The engine's flags on this letter, whatever shape they arrived in. */
export function warningsOf(flags: unknown): ConstraintWarning[] {
  const raw = Array.isArray(flags)
    ? flags
    : Array.isArray((flags as { warnings?: unknown })?.warnings)
      ? ((flags as { warnings: unknown[] }).warnings)
      : [];
  const out: ConstraintWarning[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const w = item as Record<string, unknown>;
    const message = typeof w.message === 'string' ? w.message : null;
    if (!message) continue;
    out.push({
      code: typeof w.code === 'string' ? w.code : 'unnamed rule',
      message,
      severity: typeof w.severity === 'string' ? w.severity : undefined,
    });
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const field: React.CSSProperties = {
  width: '100%',
  fontFamily: SANS,
  fontSize: 12.5,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'var(--paper-0, #FAF7F1)',
  color: 'var(--ink-1, #211C16)',
};

const legend: React.CSSProperties = {
  display: 'block',
  fontFamily: MONO,
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: '0.11em',
  textTransform: 'uppercase',
  color: 'var(--ink-3, #7C7365)',
  marginBottom: 3,
};

export interface DraftedReplyPanelProps {
  open: boolean;
  reply: DraftedReply | null;
  onClose: () => void;
  /** Called after the letter really went. */
  onSent?: () => void;
  /** Called after the draft was discarded. */
  onDiscarded?: () => void;
  /** Substituted into `[Manager Name]`, as the legacy panel did. */
  managerName?: string;
}

export function DraftedReplyPanel({
  open,
  reply,
  onClose,
  onSent,
  onDiscarded,
  managerName,
}: DraftedReplyPanelProps) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [notes, setNotes] = useState('');
  const [cc, setCc] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState('');
  const [ccProblem, setCcProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  /** Bumped after a refusal so the die returns to rest rather than staying sealed. */
  const [attempt, setAttempt] = useState(0);

  const engineWords = useMemo(() => {
    const raw = reply?.draftContent ?? '';
    return managerName ? raw.replace(/\[Manager Name\]/g, managerName) : raw;
  }, [reply?.draftContent, managerName]);

  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!reply) return;
    if (loadedFor.current === reply.id) return;
    loadedFor.current = reply.id;
    setBody(engineWords);
    setNotes('');
    setCc([]);
    setCcInput('');
    setCcProblem(null);
    setFailure(null);
    setSent(null);
  }, [reply, engineWords]);

  const warnings = useMemo(() => warningsOf(reply?.constraintFlags), [reply?.constraintFlags]);
  const edited = reply !== null && body !== engineWords;
  const empty = body.trim() === '';

  if (!reply) return null;

  const addCc = (raw: string) => {
    const email = raw.trim().toLowerCase();
    if (!email) return;
    if (!EMAIL_RE.test(email)) {
      setCcProblem(`“${raw.trim()}” is not an email address, so nobody was added.`);
      return;
    }
    if (cc.includes(email)) {
      setCcProblem(`${email} is already copied.`);
      return;
    }
    setCc((prev) => [...prev, email]);
    setCcInput('');
    setCcProblem(null);
  };

  /**
   * Mint the seal, at the moment the hold begins, over the letter AS IT STANDS.
   * A null answer stops the send — `HoldToApprove` will not approve without a
   * token, which is the whole point of minting at the start of the gesture.
   */
  const mint = async (): Promise<string | null> => {
    setFailure(null);
    try {
      const { data } = await apiClient.post<{ challenge?: string }>(
        `/procurement/orders/${reply.orderId}/draft-seal-challenge`,
        { content: body, to: reply.providerEmail, ccEmails: cc },
      );
      const challenge = data?.challenge ?? null;
      if (!challenge) {
        setFailure('The seal was not issued, so nothing was sent. Hold it again.');
        return null;
      }
      return challenge;
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setFailure(
        status === 404
          ? 'There is no draft waiting on this order any more, so nothing was sent. It may already have gone or been discarded.'
          : `The seal could not be issued (${getErrorMessage(e)}), so nothing was sent.`,
      );
      return null;
    }
  };

  const send = async (challenge?: string | null) => {
    setBusy(true);
    setFailure(null);
    try {
      const { data } = await apiClient.post<{ sentAt?: string }>(
        `/procurement/orders/${reply.orderId}/send-drafted-reply`,
        {
          modifiedContent: body,
          managerNotes: notes.trim() || undefined,
          ccEmails: cc.length > 0 ? cc : undefined,
          to: reply.providerEmail,
        },
        challenge ? { headers: { 'X-Seal-Challenge': challenge } } : undefined,
      );
      // Said only after the gateway accepted it, and from what it answered.
      setSent(
        data?.sentAt
          ? `Sent to ${reply.providerEmail ?? 'the vendor'} at ${new Date(data.sentAt).toLocaleString()}.`
          : `Sent to ${reply.providerEmail ?? 'the vendor'}. The gateway did not say when.`,
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      onSent?.();
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setFailure(
        status === 403
          ? `${getErrorMessage(e)} Nothing was sent.`
          : `The letter was not sent (${getErrorMessage(e)}). Nothing left the building and the draft is unchanged.`,
      );
      setAttempt((a) => a + 1);
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await apiClient.post(`/procurement/orders/${reply.orderId}/discard-draft`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      onDiscarded?.();
      onClose();
    } catch (e) {
      setFailure(
        `The draft was not discarded (${getErrorMessage(e)}). It is still waiting.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      open={open}
      onClose={onClose}
      /* The contract, as the accessible name. */
      label={`This asks whether to send the house's drafted reply to ${reply.providerName ?? 'this vendor'}. Holding the seal sends the letter to them. Leaving sends nothing and keeps the draft waiting.`}
      eyebrow={`Drafted · ${reply.orderNumber ?? 'this order'} · round ${reply.roundCount}`}
      title="The house's reply, drafted"
      closeLabel="Leave it waiting"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
            Nothing reaches a vendor without a person’s hold (ADR 0118).
          </span>
          <button
            type="button"
            onClick={() => void discard()}
            disabled={busy}
            data-testid="draft-discard"
            style={{
              fontFamily: SANS,
              fontSize: 12,
              padding: '6px 12px',
              borderRadius: 3,
              border: '1px solid var(--paper-2, #EAE4D8)',
              background: 'transparent',
              color: 'var(--ink-2, #4F473C)',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            Throw the draft away
          </button>
        </div>
      }
    >
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
        <p style={{ margin: 0 }}>
          <span style={{ fontFamily: SERIF, fontSize: 15, color: 'var(--ink-1, #211C16)' }}>
            {reply.wineName ?? 'This order'}
          </span>{' '}
          — the house is {kindWords(reply.emailType)}.
        </p>
        <p style={{ margin: '3px 0 0', fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }} data-testid="draft-to">
          To {reply.providerName ?? 'the vendor'}
          {reply.providerEmail ? ` · ${reply.providerEmail}` : ' · no address on file'}
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }} data-testid="draft-subject">
          Subject: {subjectFor(reply)}
        </p>

        {/* ── the engine's flags, each naming its rule ─────────────────── */}
        {warnings.length > 0 && (
          <ul
            data-testid="draft-warnings"
            style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}
          >
            {warnings.map((w) => (
              <li
                key={`${w.code}-${w.message}`}
                style={{
                  borderLeft: '2px solid var(--seal-ring, rgba(26,94,107,.32))',
                  paddingLeft: 8,
                  marginTop: 4,
                  fontSize: 11.5,
                }}
              >
                {w.message}{' '}
                <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--ink-3, #7C7365)' }}>
                  rule {w.code}
                  {w.severity ? ` · ${w.severity}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* ── the letter ───────────────────────────────────────────────── */}
        <label style={{ ...legend, marginTop: 12 }} htmlFor="draft-body">
          The letter {edited ? '· edited by you' : '· the engine’s words'}
        </label>
        <textarea
          id="draft-body"
          data-testid="draft-body"
          data-ink={edited ? 'person' : 'engine'}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          style={{
            ...field,
            minHeight: 150,
            lineHeight: 1.55,
            // Grey while they are the engine's words; ink once a person has
            // taken them. A draft never looks sent, and the hand that wrote it
            // stays visible until a person changes it.
            color: edited ? 'var(--ink-1, #211C16)' : 'var(--ink-3, #7C7365)',
          }}
        />
        {empty && (
          <p role="status" data-testid="draft-empty" style={{ margin: '3px 0 0', fontSize: 11 }}>
            An empty letter cannot be sent.
          </p>
        )}

        {/* ── copies ───────────────────────────────────────────────────── */}
        <label style={{ ...legend, marginTop: 12 }} htmlFor="draft-cc">
          Copy somebody
        </label>
        <div className="flex gap-2">
          <input
            id="draft-cc"
            style={field}
            value={ccInput}
            data-testid="draft-cc-input"
            onChange={(e) => setCcInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCc(ccInput);
              }
            }}
            placeholder="name@example.com"
          />
          <button
            type="button"
            onClick={() => addCc(ccInput)}
            data-testid="draft-cc-add"
            style={{
              fontFamily: SANS,
              fontSize: 12,
              padding: '6px 10px',
              borderRadius: 3,
              border: '1px solid var(--paper-2, #EAE4D8)',
              background: 'transparent',
              color: 'var(--ink-2, #4F473C)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Add
          </button>
        </div>
        {ccProblem && (
          <p role="status" data-testid="draft-cc-problem" style={{ margin: '3px 0 0', fontSize: 11 }}>
            {ccProblem}
          </p>
        )}
        {cc.length > 0 && (
          <ul data-testid="draft-cc-list" style={{ listStyle: 'none', margin: '5px 0 0', padding: 0 }} className="flex flex-wrap gap-1.5">
            {cc.map((email) => (
              <li key={email}>
                <button
                  type="button"
                  onClick={() => setCc((prev) => prev.filter((e) => e !== email))}
                  aria-label={`Stop copying ${email}`}
                  style={{
                    fontFamily: SANS,
                    fontSize: 11,
                    padding: '2px 7px',
                    borderRadius: 3,
                    border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                    background: 'transparent',
                    color: 'var(--seal-deep, #14515C)',
                    cursor: 'pointer',
                  }}
                >
                  {email} ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <label style={{ ...legend, marginTop: 12 }} htmlFor="draft-notes">
          A note for the book (optional)
        </label>
        <input
          id="draft-notes"
          style={field}
          value={notes}
          data-testid="draft-notes"
          onChange={(e) => setNotes(e.target.value)}
        />

        {/* ── the seal ─────────────────────────────────────────────────── */}
        <div className="mt-4" data-testid="draft-seal">
          <HoldToApprove
            key={attempt}
            label={`Hold to send it to ${reply.providerName ?? 'the vendor'}`}
            approvedLabel="Sent"
            disabled={busy || empty || !reply.providerEmail}
            onChallenge={mint}
            onApprove={(challenge) => void send(challenge)}
          />
          <p style={{ margin: '5px 0 0', fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
            {reply.providerEmail
              ? 'The seal is minted when the hold begins, over this letter, this recipient and these copies. Change any of them after the hold and the send is refused rather than posted.'
              : 'No address is on file for this vendor, so there is nowhere to send it. Nothing can be held.'}
          </p>
        </div>

        {sent && (
          <p role="status" data-testid="draft-sent" style={{ margin: '10px 0 0', fontSize: 11.5 }}>
            {sent}
          </p>
        )}
        {failure && (
          <p role="status" data-testid="draft-failure" style={{ margin: '10px 0 0', fontSize: 11.5 }}>
            {failure}
          </p>
        )}
      </div>
    </Panel>
  );
}

export default DraftedReplyPanel;
