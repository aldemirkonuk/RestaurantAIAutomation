/**
 * The email to the vendor for an order placed from the Order sheet (INV-W26).
 *
 * Founder, 2026-10-01: "Inline draft, then send". Placing an order already asks
 * the AI to draft its first email to the vendor (`createOrder` →
 * `provider_communication_agent._handle_order_created`); this panel waits for
 * that draft, shows it, lets the person edit it, and one hold approves the order
 * and sends the email. Nothing reaches the vendor unread from here.
 *
 * Why the approval rides on the SEND hold and not on the place hold: an order
 * seal is minted when the hold begins (`services/api/orders.ts` mintOrderSeal),
 * and the order does not exist until it is placed. Minting at the end of the
 * place hold would be the assertion model with extra steps, so the approval
 * waits for the next real gesture, which is also the moment the person has read
 * the email.
 *
 * Every state is read, never assumed:
 *  - the email from the order's conversation rows. A house can set a vendor to
 *    receive order emails without review (the orchestrator's three-gate
 *    auto-send); such a row is AUTO_SENT and is said as sent, never as a draft;
 *  - who may approve from the same house-wide gate /orders reads
 *    (`GET /procurement/order-approval-gate`, same query key, so one cache);
 *  - who may send from the draft's own standing (`useDraftStanding`).
 * Once this panel sends an email it stays on that email; a draft that appears
 * afterwards (approval may ask for another, `procurement.service.ts:4212`) is
 * named, never sent from here.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HoldToApprove } from '@/components/mudavym';
import { apiClient } from '../../../services/api/client';
import { approveOrder, mintOrderSeal } from '../../../services/api/orders';
import {
  draftKeys,
  issueDraftSendChallenge,
  orderConversationKeys,
  requestDraftSend,
  useApproveDraft,
  useDraftStanding,
  useOrderConversations,
  type OrderConversationDto,
} from '../../../hooks/queries/useDraftEmailQueries';
import { SendStandingNote, holdAct } from '../../../components/orders/SendStanding';
import type { ApprovalGate } from '../../orders/next/useOrdersNextData';
import { failureReason, writeFailure, type WriteWords } from './iv-failure';

/** How many times the panel looks again for the draft before saying it is not there. */
export const DRAFT_WAIT_TRIES = 20;
const DRAFT_WAIT_MS = 3_000;

const SENT = new Set(['SENT', 'SENDING', 'DELIVERED']);

/** " at 19:28" today, " on 1 Oct at 19:28" before — the minute, never the second. */
function at(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return ` at ${time}`;
  return ` on ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} at ${time}`;
}

function newest(rows: OrderConversationDto[]): OrderConversationDto | null {
  if (rows.length === 0) return null;
  return rows.reduce((a, b) => (new Date(b.createdAt).getTime() > new Date(a.createdAt).getTime() ? b : a));
}

/** Letters that are no longer the order's letter. F-106 (ADR 0266): where an
 *  order held two pending drafts, the first-written one is kept and the newer
 *  one is DISCARDED with its createdAt unchanged, so "newest" alone would pick
 *  the closed letter while approve-by-order sends the kept one. */
const CLOSED = new Set(['DISCARDED', 'CANCELLED']);

/** The order's letter (INV-W37): the newest email this house wrote to the
 *  vendor that is not closed. When every one is closed, the newest of them, so
 *  the panel can say so rather than wait for a draft that is not coming. */
function latestOutbound(rows: OrderConversationDto[] | undefined): OrderConversationDto | null {
  const outbound = (rows ?? []).filter((r) => r.direction === 'OUTBOUND');
  return newest(outbound.filter((r) => !CLOSED.has(r.status))) ?? newest(outbound);
}

function OnOrders({ children }: { children: string }) {
  return (
    <p className="iv-note">
      {children}{' '}
      <Link to="/orders" className="iv-linkish iv-focus">
        Open Orders
      </Link>
    </p>
  );
}

export default function OrderLetter({
  orderId,
  vendorName,
  needsApproval,
  restaurantId,
}: {
  orderId: string;
  vendorName: string;
  /** The order is still pending: approving it is part of the send. */
  needsApproval: boolean;
  restaurantId: string | null;
}) {
  const queryClient = useQueryClient();
  const conversations = useOrderConversations(orderId);
  const standing = useDraftStanding(orderId);
  const approveDraft = useApproveDraft();
  const gate = useQuery<ApprovalGate>({
    queryKey: ['procurement', 'order-approval-gate', restaurantId],
    enabled: !!restaurantId && needsApproval,
    retry: false,
    queryFn: async () => (await apiClient.get<ApprovalGate>('/procurement/order-approval-gate')).data,
  });
  const [tries, setTries] = useState(0);
  const [body, setBody] = useState<string | null>(null);
  const [approvedHere, setApprovedHere] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [said, setSaid] = useState<{ text: string; alarm?: boolean } | null>(null);
  const seals = useRef<{ order: string | null }>({ order: null });

  const outbound = (conversations.data ?? []).filter((r) => r.direction === 'OUTBOUND');
  const sentRow = sentId ? (outbound.find((r) => r.id === sentId) ?? null) : null;
  const row = sentRow ?? latestOutbound(outbound);
  const status = sentId && !sentRow ? 'SENDING' : (row?.status ?? null);
  const otherDrafts = outbound.filter((r) => r.id !== row?.id && r.status === 'PENDING_APPROVAL');
  const approving = needsApproval && !approvedHere;
  const gateRow = gate.data?.orders.find((o) => o.orderId === orderId) ?? null;
  const waiting = !conversations.isError && (conversations.isPending || row === null) && tries < DRAFT_WAIT_TRIES;
  const gateMissing = approving && !!gate.data && gateRow === null && tries < DRAFT_WAIT_TRIES;

  // The draft is written by the AI after the order lands, and the approval gate
  // is computed over the ledger it was read from; look again until both are there.
  useEffect(() => {
    if ((!waiting && !gateMissing) || conversations.isPending) return;
    const t = setTimeout(() => {
      setTries((n) => n + 1);
      if (waiting) {
        void queryClient.invalidateQueries({ queryKey: orderConversationKeys.byOrder(orderId) });
        void queryClient.invalidateQueries({ queryKey: draftKeys.all });
      }
      if (gateMissing) void queryClient.invalidateQueries({ queryKey: ['procurement', 'order-approval-gate', restaurantId] });
    }, DRAFT_WAIT_MS);
    return () => clearTimeout(t);
  }, [waiting, gateMissing, conversations.isPending, tries, orderId, restaurantId, queryClient]);

  // The person's edits start from the draft as written and are not overwritten by a re-read.
  useEffect(() => {
    if (status === 'PENDING_APPROVAL' && body === null && row?.draftContent != null) setBody(row.draftContent);
  }, [status, body, row?.draftContent]);

  // A 5xx or no answer may have landed (INV-W31): say so, and re-read the
  // order's messages so a sent email shows as sent rather than re-armed.
  const refused = (words: WriteWords) => (e: unknown) => {
    const f = writeFailure(e, words);
    if (f.unknown) {
      void queryClient.invalidateQueries({ queryKey: orderConversationKeys.byOrder(orderId) });
      void queryClient.invalidateQueries({ queryKey: draftKeys.all });
    }
    setSaid({ text: f.text, alarm: true });
    setAttempt((a) => a + 1);
  };

  let content: JSX.Element;
  if (conversations.isError) {
    content = <OnOrders>{`The email to ${vendorName} could not be read. The order waits on Orders.`}</OnOrders>;
  } else if (waiting) {
    content = (
      <p className="iv-said" role="status">
        The AI is drafting the email to {vendorName}…
      </p>
    );
  } else if (row === null) {
    content = (
      <OnOrders>{`No email to ${vendorName} has been drafted yet. The order waits on Orders, where its email can be written and sent.`}</OnOrders>
    );
  } else if (status === 'AUTO_SENT') {
    content = (
      <>
        <p className="iv-said" role="status">
          {vendorName} is set to receive this house’s order emails without review, so this email was sent automatically
          {at(row.sentAt ?? row.createdAt)}.
        </p>
        {row.draftContent ? <pre className="iv-letter-text">{row.draftContent}</pre> : null}
      </>
    );
  } else if (status !== null && SENT.has(status)) {
    content = (
      <p className="iv-said" role="status">
        Sent to {vendorName}
        {at(row.sentAt)}.
      </p>
    );
  } else if (status === 'SEND_REFUSED' || status === 'RELAY_REFUSED') {
    const why = row.refusalReason ?? row.relayRefusalReason ?? null;
    content = <OnOrders>{`The email to ${vendorName} was not sent${why ? `: ${why}` : ''}. It waits on Orders.`}</OnOrders>;
  } else if (status === 'PENDING_APPROVAL') {
    const act = holdAct(standing.data?.sendOrAsk);
    const text = body ?? '';
    const to = row.providerEmail ?? null;
    const empty = text.trim() === '';
    // Who may approve: read, never guessed. Unknown is said, and nothing is offered.
    const approval: 'not-needed' | 'reading' | 'may' | 'may-not' | 'unknown' = !approving
      ? 'not-needed'
      : gate.isPending || gateMissing
        ? 'reading'
        : gate.isError || !gate.data?.readable || gateRow === null
          ? 'unknown'
          : gateRow.mayApprove
            ? 'may'
            : 'may-not';
    const approveFirst = approval === 'may';

    let hold: JSX.Element | null = null;
    let why: string | null = null;
    const standingUnknown = standing.isError || (!standing.isPending && act === null);
    if (to === null) {
      // Said below, with the way to fix it.
    } else if (standingUnknown) {
      why = 'Who may send this email could not be read here, so it is sent on Orders.';
    } else if (act === null || approval === 'reading') {
      hold = (
        <HoldToApprove
          label={act === null ? 'Reading who may send it…' : 'Reading who may approve it…'}
          approvedLabel="Sent"
          disabled
          onApprove={() => undefined}
        />
      );
    } else if (approval === 'unknown') {
      why = 'Who may approve this order could not be read here, so it is approved and its email sent on Orders.';
    } else if (approval === 'may-not' || act === 'ask') {
      // A person who may not approve the order, or may not send, asks a manager
      // to send this email; the order itself is approved on Orders.
      if (approval === 'may-not') why = gateRow?.sentence ?? 'A manager approves this order on Orders.';
      hold = (
        <HoldToApprove
          key={`ask-${attempt}`}
          label={approveFirst ? 'Hold to approve it and ask a manager to send the email' : 'Hold to ask a manager to send this email'}
          approvedLabel="Asked — waiting for a manager"
          disabled={empty}
          onChallenge={
            approveFirst
              ? async () => {
                  try {
                    const order = await mintOrderSeal(orderId);
                    if (!order) throw new Error('the approval seal was not issued');
                    seals.current.order = order;
                    return order;
                  } catch (e) {
                    // No remount mid-gesture: the hold refuses on its own.
                    setSaid({ text: `Nothing was approved or asked — ${failureReason(e)}.`, alarm: true });
                    throw e;
                  }
                }
              : undefined
          }
          onApprove={async () => {
            setSaid(null);
            if (approveFirst) {
              try {
                await approveOrder(orderId, undefined, seals.current.order);
                setApprovedHere(true);
              } catch (e) {
                refused({
                  refused: 'Nothing was approved or asked',
                  act: 'the order was approved',
                  check: 'Nobody was asked to send the email. Look on Orders before trying again.',
                })(e);
                throw e;
              }
            }
            try {
              const out = await requestDraftSend({ orderId, content: text, ccEmails: [] });
              setSaid({ text: out?.says ?? 'Asked. Nothing has been sent.' });
              void queryClient.invalidateQueries({ queryKey: draftKeys.all });
            } catch (e) {
              refused({
                refused: approveFirst ? 'The order is approved, but nobody was asked to send the email' : 'Nobody was asked; nothing was sent',
                act: 'anyone was asked to send the email',
                check: `${approveFirst ? 'The order is approved and nothing was sent' : 'Nothing was sent'}. Look on Orders before asking again, so nobody is asked twice.`,
              })(e);
              throw e;
            }
          }}
        />
      );
    } else {
      hold = (
        <HoldToApprove
          key={`send-${attempt}`}
          label={approveFirst ? `Hold to approve and send to ${vendorName}` : `Hold to send to ${vendorName}`}
          approvedLabel={`Sent to ${vendorName}`}
          disabled={empty || approveDraft.isPending}
          onChallenge={async () => {
            // Both seals are minted as the hold begins, over these exact words.
            try {
              const [order, draft] = await Promise.all([
                approveFirst ? mintOrderSeal(orderId) : Promise.resolve(null),
                issueDraftSendChallenge({ orderId, body: text, to, ccEmails: [] }),
              ]);
              if (approveFirst && !order) throw new Error('the approval seal was not issued');
              seals.current.order = order;
              return draft;
            } catch (e) {
              setSaid({ text: `Nothing was approved or sent — ${failureReason(e)}.`, alarm: true });
              throw e;
            }
          }}
          onApprove={async (challenge) => {
            setSaid(null);
            if (!challenge) throw new Error('No send seal was issued.');
            if (approveFirst) {
              try {
                await approveOrder(orderId, undefined, seals.current.order);
                setApprovedHere(true);
              } catch (e) {
                refused({
                  refused: 'Nothing was approved or sent',
                  act: 'the order was approved',
                  check: 'The email was not sent. Look on Orders before trying again.',
                })(e);
                throw e;
              }
            }
            try {
              await approveDraft.mutateAsync({ orderId, modifiedContent: text, challenge });
              setSentId(row.id);
              setSaid({ text: `Sent to ${vendorName}.${approveFirst ? ' The order is approved on Orders.' : ''}` });
              void queryClient.invalidateQueries({ queryKey: orderConversationKeys.byOrder(orderId) });
            } catch (e) {
              refused({
                refused: approveFirst ? 'The order is approved, but the email was not sent' : 'The email was not sent',
                act: `the email reached ${vendorName}`,
                check: `${approveFirst ? 'The order is approved. ' : ''}Look at the order’s messages on Orders before sending again, so ${vendorName} is not written to twice.`,
              })(e);
              throw e;
            }
          }}
        />
      );
    }

    content = (
      <>
        <label className="iv-letter-label" htmlFor={`letter-${orderId}`}>
          Draft
        </label>
        <p className="iv-note iv-letter-hint" id={`letter-${orderId}-hint`}>
          Written by the AI{at(row.createdAt)}. Edit it before you send.
        </p>
        <textarea
          id={`letter-${orderId}`}
          aria-describedby={`letter-${orderId}-hint`}
          className="iv-letter-text iv-focus"
          value={text}
          onChange={(e) => setBody(e.target.value)}
          rows={9}
          disabled={approveDraft.isPending}
        />
        {to === null ? (
          <p className="iv-note">
            {vendorName} has no email address on file, so this email cannot be sent from here.{' '}
            <Link to="/vendors" className="iv-linkish iv-focus">
              Add it on Vendors
            </Link>
          </p>
        ) : null}
        {why ? (
          <p className="iv-note">
            {why}{' '}
            <Link to="/orders" className="iv-linkish iv-focus">
              Open Orders
            </Link>
          </p>
        ) : null}
        {hold ? <div style={{ marginTop: 10 }}>{hold}</div> : null}
        {to !== null ? (
          <SendStandingNote
            standing={standing.data?.sendOrAsk}
            request={standing.data?.draft?.send_request ?? null}
            loading={standing.isPending}
            error={standing.isError ? failureReason(standing.error) : null}
            testId="inv-letter-standing"
          />
        ) : null}
      </>
    );
  } else {
    content = <OnOrders>{`The email to ${vendorName} reads “${String(status).toLowerCase().replace(/_/g, ' ')}” on Orders.`}</OnOrders>;
  }

  return (
    <section className="iv-letter" aria-label={`The email to ${vendorName}`} data-testid="inv-order-letter">
      <h3 className="iv-sec">The email to {vendorName}</h3>
      {content}
      {otherDrafts.length > 0 ? (
        <OnOrders>{`${otherDrafts.length === 1 ? 'Another draft' : `${otherDrafts.length} other drafts`} to ${vendorName} ${otherDrafts.length === 1 ? 'is' : 'are'} waiting on this order. ${otherDrafts.length === 1 ? 'It was' : 'They were'} not sent from here.`}</OnOrders>
      ) : null}
      {said ? (
        <p role={said.alarm ? 'alert' : 'status'} className={said.alarm ? 'iv-said iv-said-alarm' : 'iv-said'} style={{ marginTop: 10 }}>
          {said.text}
        </p>
      ) : null}
    </section>
  );
}
