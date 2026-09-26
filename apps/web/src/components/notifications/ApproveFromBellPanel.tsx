/**
 * "Approve from the bell" — the owed act on `/notifications`, and the founder's
 * ruling of 2026-09-04 made real:
 *
 *   *"a one-click approval from the bell opens the panel first."*
 *
 * WHY THE PANEL EXISTS AT ALL. The bell is a MENU. ADR 0112 rule 3 rations the
 * seal and forbids it in a Popover, and the reason is not decoration: a popover
 * is dismissed by clicking anywhere, so a commitment reached inside one is a
 * commitment one stray click away from being half-made. So the bell hands off:
 * the line offers *Approve it*, the popover closes, and a room that cannot be
 * dismissed by accident opens with the order's own figures in it.
 *
 * WHAT IT SHOWS, AND WHERE EVERY FIGURE COMES FROM. `GET /procurement/orders/:id`
 * (`procurement.controller.ts:224`), read when the panel opens. Nothing is
 * carried over from the notification except the ID — a bell line's title is a
 * sentence somebody wrote weeks ago and the order may have moved since, so the
 * figures a person seals over are read fresh, at the moment they are shown.
 *
 * THE SEAL IS THE HOUSE'S ONE IMPLEMENTATION. `components/orders/SealedApproveDie`
 * mints when the hold BEGINS, spends the token on the write, prints a 403 as
 * itself and returns to rest on a refusal. A second mint here is how two
 * surfaces learn to disagree about what a seal is (that file's own header says
 * so, and this is the third caller it anticipated).
 *
 * FOUR STATES, AND THE FOURTH IS THE POINT.
 *   reading      — the order is being read.
 *   unreadable   — it could not be. NOT "no such order": a failed read that
 *                  renders as an absent order sends somebody looking for a
 *                  deletion that never happened.
 *   settled      — it is not waiting for approval: approved, negotiating, on
 *                  its way, part-received, cancelled, and so on. The panel says
 *                  WHICH and offers no seal, rather than handing a manager a
 *                  hold that the gateway is going to refuse two seconds later.
 *                  The rule is the gateway's, inverted from a list of settled
 *                  states to the list of approvable ones: a hold is offered only
 *                  for `PENDING` and `APPROVAL_NEEDED` (`PENDING_APPROVAL_STATUSES`,
 *                  procurement.service.ts), so a state nobody listed is refused
 *                  rather than offered.
 *   ready        — the figures, in the order's own currency, and the hold.
 *
 * WHICH BELL LINES HAND OFF. Only an approval: a line of type `order_pending`
 * that names an order (`approvableOrderIdOf`). Other producers DO write an
 * order id — `order_delivered` (notifications.service.ts) and the receipt
 * verification and delivery discrepancy lines of `invoice_received`
 * (procurement.service.ts) — and those are not approvals, so they get no hand-off.
 * The one producer of `order_pending` today (communications/
 * scheduled-tasks.service.ts, recurring orders due) writes only a count, so
 * the hand-off is built and not yet reachable from a real line. Whether a
 * producer should name the order is filed for the founder (notifications.md §9).
 */

import { useCallback, useEffect, useState } from 'react';
import { Panel } from '@/components/mudavym';
import { SealedApproveDie } from '@/components/orders/SealedApproveDie';
import { apiClient, getErrorMessage } from '@/services/api/client';
import { formatMoney } from '@/lib/currency';

const EM = '—';

/** `OrderResponseDto`, as this panel needs it. */
export interface BellOrder {
  id: string;
  orderNumber?: string;
  quantity?: number;
  unitType?: string;
  wineName?: string;
  providerName?: string;
  finalPrice?: number;
  totalCost?: number;
  status?: string;
  requestedAt?: string;
  approvedAt?: string;
  deliveredAt?: string;
  expectedDeliveryDate?: string;
  /**
   * The currency the order was placed in. `null` when the order names none;
   * absent when the route did not read it (`GET /procurement/orders/:id`
   * selects the whole row, so it always reads it).
   */
  currency?: string | null;
}

export type OrderRegister =
  | { state: 'reading' }
  | { state: 'unreadable'; message: string; refused: boolean }
  | { state: 'ready'; order: BellOrder };

/**
 * The states a hold is offered in — the gateway's `PENDING_APPROVAL_STATUSES`
 * (procurement.service.ts), which `/orders` also buckets as its pending
 * station. Everything else is refused here, including a state added later.
 */
export const AWAITING_APPROVAL: ReadonlySet<string> = new Set(['PENDING', 'APPROVAL_NEEDED']);

/**
 * Every other `ProcurementOrderStatus` (procurement.dto.ts), each with its own
 * sentence, never a shrug.
 */
const NOT_AWAITING: Record<string, string> = {
  NEGOTIATING: 'This order is being negotiated with the vendor, not waiting for approval.',
  APPROVED: 'This order has already been approved.',
  CONFIRMED: 'The vendor has already confirmed this order.',
  IN_TRANSIT: 'This order is already on its way.',
  DELIVERED: 'This order has already been delivered.',
  PARTIALLY_RECEIVED: 'Part of this order has already been received.',
  COMPLETED: 'This order is complete.',
  CANCELLED: 'This order was cancelled.',
  REJECTED: 'This order was rejected.',
  FAILED: 'This order failed.',
};

/**
 * Why this order cannot be sealed from here, or null when it can.
 *
 * Read from the ORDER, not from the notification: a bell line saying "waiting
 * for you" is a sentence from the moment it was written, and the order is the
 * thing that is true now. The status decides, as it does at the gateway.
 */
export function settledWords(order: BellOrder): string | null {
  const status = (order.status ?? '').trim().toUpperCase();
  if (AWAITING_APPROVAL.has(status)) return null;
  if (NOT_AWAITING[status]) return NOT_AWAITING[status];
  if (status === '') {
    return 'The order came back without a state, so whether it is waiting for approval cannot be told.';
  }
  return `This order is ${status.toLowerCase().replace(/_/g, ' ')}, which is not a state waiting for approval.`;
}

/**
 * The id of the order a bell line names, or null.
 *
 * Both spellings are read because the gateway writes notification metadata in
 * two places and they do not agree on case. Naming an order is NOT asking for
 * an approval — a delivery line names its order too — so the bell asks
 * `approvableOrderIdOf`, never this.
 */
export function orderIdOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  for (const key of ['orderId', 'order_id']) {
    const v = m[key];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

/** The notification types that ask for an order's approval. */
export const APPROVAL_NOTIFICATION_TYPES: ReadonlySet<string> = new Set(['order_pending']);

/**
 * The order a bell line asks somebody to approve, or null.
 *
 * Null for every line that is not an approval, whatever its metadata names:
 * `order_delivered` and `invoice_received` lines carry an order id and are
 * about a delivery or an invoice, and an "Approve it" on them would offer a
 * seal nobody was asked for. See the header for why no real line reaches this
 * today.
 */
export function approvableOrderIdOf(n: { type?: string | null; metadata?: unknown }): string | null {
  if (!n.type || !APPROVAL_NOTIFICATION_TYPES.has(n.type)) return null;
  return orderIdOf(n.metadata);
}

/** Money in the order's own currency, or a dash; never a bare number. */
function money(v: number | null | undefined, currency: string | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? formatMoney(v, currency ?? null) : EM;
}

export interface ApproveFromBellPanelProps {
  open: boolean;
  /** The order the bell line named. Null closes the panel. */
  orderId: string | null;
  onClose: () => void;
  /** Called after the gateway approved it. */
  onApproved?: (orderId: string) => void;
}

export function ApproveFromBellPanel({
  open,
  orderId,
  onClose,
  onApproved,
}: ApproveFromBellPanelProps) {
  const [register, setRegister] = useState<OrderRegister>({ state: 'reading' });
  const [done, setDone] = useState<string | null>(null);

  const read = useCallback(async (id: string) => {
    setRegister({ state: 'reading' });
    setDone(null);
    try {
      const { data } = await apiClient.get<BellOrder>(`/procurement/orders/${id}`);
      setRegister({ state: 'ready', order: data });
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setRegister({
        state: 'unreadable',
        message: getErrorMessage(e),
        refused: status === 403 || status === 401,
      });
    }
  }, []);

  useEffect(() => {
    if (!open || !orderId) return;
    void read(orderId);
  }, [open, orderId, read]);

  if (!orderId) return null;

  const order = register.state === 'ready' ? register.order : null;
  const settled = order ? settledWords(order) : null;

  return (
    <Panel
      open={open}
      onClose={onClose}
      /* The contract, as the accessible name. */
      label="This asks whether to approve one order. Holding the seal commits this house's money to it. Leaving approves nothing."
      eyebrow={`From the bell${order?.orderNumber ? ` · ${order.orderNumber}` : ''}`}
      title={
        order?.wineName
          ? `Approve the ${order.providerName ?? 'vendor'} order?`
          : 'Approve this order?'
      }
      closeLabel="Not now"
      footer={
        <span className="text-[11.5px] text-inkm-4">
          The seal never sits in the bell. The bell hands off to this panel.
        </span>
      }
    >
      {register.state === 'reading' && (
        <p className="text-[12.5px] text-inkm-3" data-testid="bell-approve-reading">
          Reading the order…
        </p>
      )}

      {register.state === 'unreadable' && (
        <p role="status" className="text-[12.5px] text-inkm-2" data-testid="bell-approve-unreadable">
          {register.refused
            ? `This account may not read this order (${register.message}). Nothing is shown because nothing could be read — the order has not gone anywhere.`
            : `The order could not be read (${register.message}). Nothing is shown because nothing could be read — this is not a missing order.`}
        </p>
      )}

      {order && (
        <dl className="grid gap-2" data-testid="bell-approve-figures">
          {[
            [
              'Lines',
              `${order.quantity ?? EM} ${order.unitType ?? 'units'} ${order.wineName ?? EM}`,
            ],
            [
              'Agreed',
              order.finalPrice == null && order.totalCost == null
                ? `${EM} — no price is recorded on this order`
                : `${money(order.finalPrice, order.currency)} per ${order.unitType ?? 'unit'} · ${money(order.totalCost, order.currency)} in all`,
            ],
            [
              'Delivery',
              order.expectedDeliveryDate
                ? new Date(order.expectedDeliveryDate).toLocaleDateString()
                : `${EM} — no date is recorded`,
            ],
            ['Vendor', order.providerName ?? EM],
          ].map(([k, v]) => (
            <div key={String(k)} className="flex gap-2">
              <dt className="min-w-[72px] pt-0.5 text-[9px] font-semibold uppercase tracking-[0.11em] text-inkm-4">
                {k}
              </dt>
              <dd className="m-0 text-[12.5px] text-inkm-1">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {order && (
        <p className="mt-2 text-[11px] text-inkm-4" data-testid="bell-approve-provenance">
          Read from the order itself just now, not from the bell’s line — a notice is a sentence
          from the moment it was written.
          {order.requestedAt
            ? ` The order was raised ${new Date(order.requestedAt).toLocaleDateString()}.`
            : ' The order carries no raised date.'}
        </p>
      )}

      {settled && (
        <p role="status" className="mt-3 text-[12.5px] text-inkm-2" data-testid="bell-approve-settled">
          {settled} Only an order waiting for approval can be sealed, so no hold is offered.
        </p>
      )}

      {order && !settled && (
        <div className="mt-4" data-testid="bell-approve-seal">
          <SealedApproveDie
            orderIds={[order.id]}
            label={
              order.totalCost == null
                ? 'Hold to approve'
                : `Hold to approve · ${money(order.totalCost, order.currency)}`
            }
            approvedLabel="Approved"
            onApproved={(ids) => {
              if (ids.length === 0) return;
              setDone('Approved. The order is committed and the book has it.');
              onApproved?.(order.id);
              void read(order.id);
            }}
          />
        </div>
      )}

      {done && (
        <p role="status" className="mt-2 text-[11.5px] text-inkm-2" data-testid="bell-approve-done">
          {done}
        </p>
      )}
    </Panel>
  );
}

export default ApproveFromBellPanel;
