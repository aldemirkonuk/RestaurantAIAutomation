/**
 * The responses sheet — the vendors' answers to one order, with the three acts
 * the rebuilt page did not have.
 *
 * =============================================================================
 * WHAT THIS REPLACES, AND WHY IT IS A SHEET RATHER THAN A REVIVED MODAL
 * =============================================================================
 * `components/orders/OrderApprovalModal.tsx` reviewed one vendor answer at a
 * time — vendor, quantity, agreed price, delivery estimate, the AI negotiation
 * summary — behind Confirm / Cancel / Edit order / Ask for more, with
 * Next/Previous across several answers. It had been unreachable since
 * `6778690b` (2026-07-05) and, measured on this tree, could not be reached even
 * in principle: `setAllProviderResponses` and `setOrderApprovalData` are called
 * ONLY from inside the modal's own handlers (`pages/Orders.tsx:3367, :3404,
 * :3449`), so `orderApprovalData` was permanently null and its render guard
 * permanently false.
 *
 * Three of its acts existed nowhere on the rebuilt page (orders.md §13.13):
 * rejecting an order, stepping through several answers, and reading the
 * negotiation summary — the `DraftRail` shows the raw thread, not the rolling
 * sentence. The founder's call of 2026-09-05 was to rebuild all three HERE, as
 * a responses sheet, and then delete the modal. This file is that sheet.
 *
 * Its other two buttons are not recreated and are not missing: Edit order ran
 * `openCreateOrderFlow()` on an empty form, and Ask for more `alert`ed and then
 * `setTimeout`'d a fabricated follow-up into the summary — a sentence no vendor
 * and no engine ever wrote. Recreating that would be inventing evidence.
 *
 * =============================================================================
 * THE SHAPE (ADR 0112)
 * =============================================================================
 * A right `Sheet`, not a `Panel`. ADR 0112 assigns the shape by what the
 * overlay is FOR: a Sheet is one object's detail, a Panel is an ask. This is
 * one order's correspondence — a record you read through — and the two acts at
 * the bottom are what you do having read it. `wide` because a summary and a
 * vendor's own paragraph are prose, and prose judged at 46 characters a line is
 * prose nobody can judge.
 *
 * =============================================================================
 * HONESTY (ADR 0020 / 0051 / 0083)
 * =============================================================================
 *  * The summary is the stored string or `NO_SUMMARY_WRITTEN` — never blank,
 *    and never assembled out of the order's own numbers.
 *  * A failed read says so (`responsesUnreadable`) and is never rendered as
 *    "no answers": supabase-js resolves `{ data, error }` rather than throwing,
 *    so an unread list and an empty one look identical unless one is forced to
 *    prove itself.
 *  * The agreed price is printed through `describeStatedPrice` — the same
 *    function the ledger row and the composer use — so one agreement cannot be
 *    described three ways. Where the pair is unstated or unread, the row's own
 *    refusal sentences are reused verbatim.
 *  * Confirm is the SAME sealed approve as the ledger row: `mintOrderSeal` at
 *    the moment the hold begins, the token carried back on the write. Reject is
 *    now the mirror of it (ADR 0125, 2026-09-05): `mintOrderCancelSeal` at the
 *    moment its hold begins, act `cancel`, the token carried back on the DELETE.
 *    The note that used to sit here saying the rejection recorded a decision
 *    rather than proving one is retired — it was true, and it is not any more.
 */

import { useEffect, useMemo, useState } from 'react';
import { HoldToApprove, Sheet } from '@/components/mudavym';
import { ink, settle } from '@/lib/mudavym/motion';
import { useApproveOrder, useCancelOrder } from '@/hooks/queries/useOrderQueries';
import { useDealProposal, useOrderConversations } from '@/hooks/queries/useDraftEmailQueries';
import * as ordersApi from '@/services/api/orders';
import { EM, MONO, SANS, SERIF, fmtDate, fmtMoney } from './format';
import {
  ROW_PRICE_UNIT_NOT_READ,
  ROW_UNSTATED_PRICE_UNIT,
  describeStatedPrice,
} from './price-unit';
import {
  NO_ANSWER_YET,
  NO_DELIVERY_ESTIMATE,
  NO_SUMMARY_WRITTEN,
  REJECT_NEEDS_A_REASON,
  VENDOR_DECLINED_NOTE,
  describeOrderedQuantity,
  readVendorResponses,
  reasonIsGiven,
  responsesUnreadable,
  stepLabel,
  summaryProvenance,
} from './responses';
import type { ApprovalGateRow, OrderRowVM } from './useOrdersNextData';

/**
 * What a rejection's hold proves — measured, and said.
 *
 * RETIRED AND REPLACED (ADR 0125, 2026-09-05). This constant used to read "the
 * cancel route redeems no seal, so this records a decision rather than proving
 * one", and the fork it named — sealing DELETE would refuse the legacy desk's
 * only Reject control — was put to the founder, who chose neither branch:
 * research the whole thing and build the shape that scales. The shape is that
 * an order changes state through a checked, sealed transition, and the legacy
 * desk got the hold in the same pass (`components/orders/SealedRejectDie.tsx`),
 * so nothing is left lying to keep it working.
 *
 * The sentence stays because the property is worth stating rather than implying
 * from the wax — and because it now names the thing that makes a cancellation
 * different from an approval: it is refused outright once the wine has arrived.
 */
export const REJECT_SEAL_NOTE =
  'The hold mints a one-time seal for this order, spent exactly once on the ' +
  'cancellation — the same proof an approval carries, for a different act. The ' +
  'reason is written to the order, and an order whose wine has already arrived ' +
  'cannot be cancelled at all.';

const label = (text: string) => (
  <span
    style={{
      fontFamily: MONO,
      fontSize: 9,
      fontWeight: 500,
      letterSpacing: '0.12em',
      textTransform: 'uppercase' as const,
      color: 'var(--ink-3, #7C7365)',
    }}
  >
    {text}
  </span>
);

function Field({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      {label(name)}
      <div
        style={{
          fontFamily: SANS,
          fontSize: 13,
          lineHeight: 1.5,
          color: 'var(--ink-1, #211C16)',
          marginTop: 3,
        }}
      >
        {children}
      </div>
    </div>
  );
}

const said: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 11.5,
  lineHeight: 1.5,
  color: 'var(--ink-2, #4F473C)',
  borderLeft: '2px solid var(--seal-ring, rgba(26,94,107,.32))',
  paddingLeft: 8,
  margin: '6px 0 0',
};

const quiet: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 11.5,
  lineHeight: 1.5,
  color: 'var(--ink-3, #7C7365)',
  margin: '6px 0 0',
};

export interface ResponsesSheetProps {
  open: boolean;
  onClose: () => void;
  row: OrderRowVM;
  /** This house's verdict on sealing THIS order. `undefined` = not answered. */
  approval?: ApprovalGateRow;
  approvalGateError?: string | null;
}

export function ResponsesSheet({
  open,
  onClose,
  row,
  approval,
  approvalGateError,
}: ResponsesSheetProps) {
  const orderId = open ? row.id : null;
  const convos = useOrderConversations(orderId);
  // The delivery estimate is not a per-message column; it is on the latest
  // unresolved deal proposal, which names the answer it was drawn from.
  const proposal = useDealProposal(orderId, open);

  const approve = useApproveOrder();
  const cancel = useCancelOrder();

  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [rejectAttempt, setRejectAttempt] = useState(0);
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const responses = useMemo(() => readVendorResponses(convos.data), [convos.data]);

  // A fresh order means a fresh reading position — and a reason typed about one
  // order must never be carried onto another.
  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setReason('');
    setReasonTouched(false);
    setApproveError(null);
    setRejectError(null);
  }, [open, row.id]);

  // The list can shrink under us (a refetch on the 15s interval). Clamping here
  // rather than at render keeps the step label and the shown answer in step.
  useEffect(() => {
    setIndex((i) => (responses.length === 0 ? 0 : Math.min(i, responses.length - 1)));
  }, [responses.length]);

  const current = responses[index] ?? null;
  const total = responses.length;

  /**
   * Left and right step. Deliberately NOT bound while the caret is in the
   * reason box: arrow keys are how a person edits a sentence, and stealing them
   * there would move the sheet under someone mid-word.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return;
    if (total < 2) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setIndex((i) => Math.min(total - 1, i + 1));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setIndex(total - 1);
    }
  };

  const readError = convos.isError
    ? ((convos.error as { message?: string } | null)?.message ?? 'request failed')
    : null;

  const isPending = row.stage === 'pending' && !row.recurring;
  const heldForApproval = approval ? !approval.mayApprove : false;

  const onChallenge = () => ordersApi.mintOrderSeal(row.id);

  const onApprove = (challenge?: string | null) => {
    setApproveError(null);
    approve.mutate(
      { orderId: row.id, challenge },
      {
        onError: (err) => {
          const status = (err as { response?: { status?: number } })?.response?.status;
          const msg = (err as { message?: string })?.message ?? 'request failed';
          setApproveError(
            status === 403
              ? msg
              : `The gateway refused (${msg}) — still pending, nothing approved.`,
          );
          setAttempt((a) => a + 1);
        },
        onSuccess: () => onClose(),
      },
    );
  };

  /**
   * Mint the cancellation seal, at the moment the reject hold BEGINS.
   *
   * Separate from `onChallenge` above because the ACT is different: a token
   * minted for `approve` is refused here by the gateway with "That seal was
   * issued for a different act on this order", and the mirror holds. Resolving
   * null stops the hold, which is how a refused mint cannot become a silent
   * cancellation on the way through the UI.
   *
   * A missing reason resolves null too. The gateway refuses a blank one with a
   * 400 in words, but making a person discover that from a failed request would
   * be a control lying about its own preconditions.
   */
  const onRejectChallenge = async (): Promise<string | null> => {
    if (!reasonIsGiven(reason)) {
      setReasonTouched(true);
      setRejectError(null);
      return null;
    }
    setRejectError(null);
    try {
      return await ordersApi.mintOrderCancelSeal(row.id);
    } catch (err) {
      // Where "the wine is already on the shelf" (422) and "this order is
      // already cancelled" (422) arrive — at the START of the hold.
      const status = (err as { response?: { status?: number } })?.response?.status;
      const msg = (err as { message?: string })?.message ?? 'request failed';
      setRejectError(
        status === 403 || status === 422
          ? msg
          : `The seal could not be issued (${msg}) — nothing was cancelled.`,
      );
      setRejectAttempt((a) => a + 1);
      return null;
    }
  };

  const onReject = (challenge?: string | null) => {
    if (!reasonIsGiven(reason)) {
      setReasonTouched(true);
      setRejectError(null);
      setRejectAttempt((a) => a + 1);
      return;
    }
    setRejectError(null);
    cancel.mutate(
      { orderId: row.id, reason: reason.trim(), challenge },
      {
        onError: (err) => {
          const status = (err as { response?: { status?: number } })?.response?.status;
          const msg = (err as { message?: string })?.message ?? 'request failed';
          // 400 (no reason), 403 (the seal) and 422 (the state) are whole
          // sentences written to be read; wrapping them buries them.
          setRejectError(
            status === 400 || status === 403 || status === 422
              ? msg
              : `The gateway refused (${msg}) — nothing was rejected, and no reason was written.`,
          );
          setRejectAttempt((a) => a + 1);
        },
        onSuccess: () => onClose(),
      },
    );
  };

  const priceLine = describeStatedPrice(row.unitPrice, row.priceUnit.stated);
  const orderedLine = describeOrderedQuantity({
    quantity: row.quantity,
    unitType: row.unitType,
    bottlesTotal: row.bottlesTotal,
  });

  /** The estimate belongs to ONE answer — the one the proposal was drawn from. */
  const deliveryFor = (responseId: string): string | null => {
    const p = proposal.data;
    if (!p || p.conversationId !== responseId) return null;
    const v = typeof p.deliveryEstimate === 'string' ? p.deliveryEstimate.trim() : '';
    return v === '' ? null : v;
  };

  const reasonMissing = reasonTouched && !reasonIsGiven(reason);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      label={`Vendor answers for ${row.wineName ?? 'this order'}`}
      eyebrow="Vendor answers"
      title={row.wineName ?? 'This order'}
      closeLabel="Leave it open"
      footer={
        isPending ? (
          <div style={{ display: 'grid', gap: 10 }} data-testid="responses-acts">
            <div className="flex flex-wrap items-start gap-4">
              {/* ── confirm: the same sealed approve as the ledger row ───── */}
              <div style={{ minWidth: 236, flex: '1 1 236px' }}>
                {label(
                  heldForApproval
                    ? `Waiting on ${approval?.requiredRole === 'owner' ? 'an owner' : 'a manager'}`
                    : 'Confirm',
                )}
                <div style={{ marginTop: 4 }}>
                  <HoldToApprove
                    key={`confirm-${row.id}-${attempt}`}
                    label={`Hold to confirm · ${fmtMoney(row.total)}`}
                    approvedLabel="Confirmed"
                    disabled={approve.isPending || cancel.isPending || heldForApproval}
                    onApprove={onApprove}
                    onChallenge={onChallenge}
                  />
                </div>
                {heldForApproval && approval?.sentence && (
                  <p style={said} role="status">
                    {approval.sentence}
                  </p>
                )}
                {approvalGateError && (
                  <p style={quiet} role="status">
                    This house&rsquo;s approval rules could not be read ({approvalGateError}), so
                    nothing here says whether you may seal this. The gateway still decides.
                  </p>
                )}
                {approveError && (
                  <p style={said} role="alert" data-testid="confirm-error">
                    {approveError}
                  </p>
                )}
              </div>

              {/* ── reject: a reason in words, then the same gesture ──────── */}
              <div style={{ minWidth: 236, flex: '1 1 236px' }}>
                {label('Reject — say why')}
                <textarea
                  data-testid="reject-reason"
                  aria-label="Why this order is rejected"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  onBlur={() => setReasonTouched(true)}
                  rows={2}
                  placeholder="In words: what is wrong with this answer"
                  style={{
                    width: '100%',
                    marginTop: 4,
                    fontFamily: SANS,
                    fontSize: 12.5,
                    lineHeight: 1.45,
                    padding: '7px 9px',
                    borderRadius: 8,
                    border: `1px solid ${reasonMissing ? 'var(--seal, #1A5E6B)' : 'var(--paper-2, #EAE4D8)'}`,
                    background: 'var(--paper-0, #FAF7F1)',
                    color: 'var(--ink-1, #211C16)',
                    resize: 'vertical',
                    transition: `border-color ${ink.ms}ms ${ink.easing}`,
                  }}
                />
                <div style={{ marginTop: 4 }}>
                  <HoldToApprove
                    key={`reject-${row.id}-${rejectAttempt}`}
                    label="Hold to reject"
                    approvedLabel="Rejected"
                    disabled={approve.isPending || cancel.isPending}
                    onApprove={onReject}
                    onChallenge={onRejectChallenge}
                  />
                </div>
                {reasonMissing && (
                  <p style={said} role="alert" data-testid="reject-needs-reason">
                    {REJECT_NEEDS_A_REASON}
                  </p>
                )}
                <p style={quiet} data-testid="reject-seal-note">
                  {REJECT_SEAL_NOTE}
                </p>
                {rejectError && (
                  <p style={said} role="alert" data-testid="reject-error">
                    {rejectError}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p style={{ ...quiet, margin: 0 }} data-testid="responses-no-acts">
            This order is {row.stage === 'cancelled' ? 'cancelled' : row.stage}, so there is
            nothing to confirm or reject here. The answers above stay readable.
          </p>
        )
      }
    >
      <div
        onKeyDown={onKeyDown}
        style={{ display: 'grid', gap: 14, padding: '10px 16px 14px' }}
      >
        {/* ── the order these answers are about ─────────────────────────── */}
        <div
          style={{
            display: 'grid',
            gap: 10,
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            paddingBottom: 12,
            borderBottom: '1px solid var(--paper-2, #EAE4D8)',
          }}
        >
          <Field name="Vendor">{row.providerName ?? EM}</Field>
          <Field name="Ordered">{orderedLine ?? EM}</Field>
          <Field name="Agreed price">
            <span data-testid="sheet-agreed-price" style={{ fontFamily: MONO, fontSize: 12.5 }}>
              {priceLine ?? EM}
            </span>
          </Field>
          <Field name="Order total">
            <span style={{ fontFamily: MONO, fontSize: 12.5 }}>{fmtMoney(row.total)}</span>
          </Field>
        </div>

        {/* The price's unit is the whole point of ADR 0119: the same two
            refusals the ledger row prints, in the same words, because the sheet
            and the row describe one agreement. */}
        {!row.priceUnit.read ? (
          <p style={quiet} data-testid="sheet-price-unit-unread">
            {ROW_PRICE_UNIT_NOT_READ}
          </p>
        ) : row.priceUnit.stated === null ? (
          <p style={said} data-testid="sheet-price-unit-unstated">
            {ROW_UNSTATED_PRICE_UNIT}
          </p>
        ) : null}

        {/* ── the answers ───────────────────────────────────────────────── */}
        {convos.isError ? (
          <p style={said} role="alert" data-testid="responses-unreadable">
            {responsesUnreadable(readError ?? 'request failed')}
          </p>
        ) : !convos.data ? (
          <p style={quiet} data-testid="responses-loading">
            Reading the correspondence…
          </p>
        ) : total === 0 ? (
          <p style={quiet} data-testid="responses-none">
            {NO_ANSWER_YET}
          </p>
        ) : (
          <>
            {/* the stepper — one section is shown, the rest are a keystroke away */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span
                data-testid="responses-step"
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.11em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-2, #4F473C)',
                }}
              >
                {stepLabel(index, total)}
              </span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1" aria-hidden>
                  {responses.map((r, i) => (
                    <span
                      key={r.id}
                      style={{
                        display: 'block',
                        height: 3,
                        width: i === index ? 16 : 6,
                        borderRadius: 2,
                        background:
                          i === index ? 'var(--seal, #1A5E6B)' : 'var(--paper-2, #EAE4D8)',
                        transition: `width ${settle.ms}ms ${settle.easing}, background ${ink.ms}ms ${ink.easing}`,
                      }}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  data-testid="responses-prev"
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  disabled={index === 0}
                  aria-label="Previous answer"
                  style={stepBtn(index === 0)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  data-testid="responses-next"
                  onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
                  disabled={index >= total - 1}
                  aria-label="Next answer"
                  style={stepBtn(index >= total - 1)}
                >
                  Next
                </button>
              </div>
            </div>
            {total > 1 && (
              <p style={{ ...quiet, marginTop: -8 }}>
                Left and right arrows step through the answers.
              </p>
            )}

            {current && (
              <section
                key={current.id}
                data-testid="response-section"
                aria-label={stepLabel(index, total)}
                style={{
                  display: 'grid',
                  gap: 12,
                  border: '1px solid var(--paper-2, #EAE4D8)',
                  borderRadius: 12,
                  padding: '12px 14px',
                  background: 'var(--paper-1, #F3EFE6)',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gap: 10,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  }}
                >
                  <Field name="Answered by">
                    {current.vendorName ?? row.providerName ?? EM}
                  </Field>
                  <Field name="Arrived">{fmtDate(current.arrivedAt)}</Field>
                  <Field name="Round">{current.round === null ? EM : current.round}</Field>
                </div>

                {/*
                  The decline, said where the answer is read (ADR 0125 Q3).
                  Placed directly under WHO answered and WHEN, because those two
                  plus the vendor's own words further down ARE the record of the
                  decline — the order carries no separate copy, deliberately.
                  The sentence exists because the order stays OPEN now: without
                  it a manager reads a refusal on a live order and cannot tell
                  whether anything happened.
                */}
                {current.declined && (
                  <div
                    data-testid="response-declined"
                    style={{
                      marginTop: 10,
                      padding: '8px 10px',
                      borderLeft: '2px solid var(--seal, #1A5E6B)',
                      background: 'var(--paper-2, #EAE4D8)',
                    }}
                  >
                    {label('The vendor declined')}
                    <p style={{ ...said, marginTop: 3 }}>{VENDOR_DECLINED_NOTE}</p>
                  </div>
                )}

                {/* Full width, not a fourth column: when there is no estimate
                    the field is a SENTENCE about the record, and a sentence
                    wrapped into a 150px column reads as a broken value. */}
                <Field name="Delivery estimate">
                  <span data-testid="response-delivery">
                    {deliveryFor(current.id) ?? (
                      <span style={{ color: 'var(--ink-3, #7C7365)', fontSize: 11.5 }}>
                        {NO_DELIVERY_ESTIMATE}
                      </span>
                    )}
                  </span>
                </Field>

                {current.specialConditions.length > 0 && (
                  <div>
                    {label('Conditions the reading flagged')}
                    <ul
                      data-testid="response-conditions"
                      style={{
                        margin: '4px 0 0',
                        paddingLeft: 16,
                        fontFamily: SANS,
                        fontSize: 12,
                        lineHeight: 1.55,
                        color: 'var(--ink-2, #4F473C)',
                      }}
                    >
                      {current.specialConditions.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* ── the negotiation summary ───────────────────────────── */}
                <div>
                  {label('Negotiation summary')}
                  {current.summary ? (
                    <>
                      <p
                        data-testid="response-summary"
                        style={{
                          fontFamily: SERIF,
                          fontSize: 14,
                          lineHeight: 1.6,
                          color: 'var(--ink-1, #211C16)',
                          whiteSpace: 'pre-line',
                          margin: '4px 0 0',
                        }}
                      >
                        {current.summary}
                      </p>
                      <p style={quiet} data-testid="response-summary-provenance">
                        {summaryProvenance(current, fmtDate)}
                      </p>
                    </>
                  ) : (
                    <p style={said} data-testid="response-no-summary">
                      {NO_SUMMARY_WRITTEN}
                    </p>
                  )}
                </div>

                {/* ── the vendor's own words ────────────────────────────── */}
                <div>
                  {label("The vendor's words")}
                  {current.body ? (
                    <p
                      data-testid="response-body"
                      style={{
                        fontFamily: SANS,
                        fontSize: 12.5,
                        lineHeight: 1.6,
                        color: 'var(--ink-2, #4F473C)',
                        whiteSpace: 'pre-line',
                        margin: '4px 0 0',
                        maxHeight: 190,
                        overflowY: 'auto',
                      }}
                    >
                      {current.body}
                    </p>
                  ) : (
                    <p style={quiet} data-testid="response-no-body">
                      This answer was recorded with no body at all — the row exists, the text
                      does not.
                    </p>
                  )}
                  {current.senderVerified === false && (
                    <p style={said} data-testid="response-sender-unverified">
                      The sender was not authenticated (DKIM/DMARC did not pass), so who sent
                      this is not established.
                    </p>
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

function stepBtn(disabled: boolean): React.CSSProperties {
  return {
    fontFamily: SANS,
    fontSize: 11.5,
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 8,
    border: '1px solid var(--paper-2, #EAE4D8)',
    background: 'transparent',
    color: disabled ? 'var(--ink-3, #7C7365)' : 'var(--seal-deep, #14515C)',
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: `color ${ink.ms}ms ${ink.easing}, border-color ${ink.ms}ms ${ink.easing}`,
  };
}

export default ResponsesSheet;
