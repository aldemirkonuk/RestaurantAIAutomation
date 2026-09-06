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
 *   settled      — it is already approved, delivered or cancelled. The panel
 *                  says WHICH and offers no seal, rather than handing a manager
 *                  a hold that the gateway is going to refuse two seconds
 *                  later.
 *   ready        — the figures, and the hold.
 */

import { useCallback, useEffect, useState } from 'react';
import { Panel } from '@/components/mudavym';
import { SealedApproveDie } from '@/components/orders/SealedApproveDie';
import { apiClient, getErrorMessage } from '@/services/api/client';

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
}

export type OrderRegister =
  | { state: 'reading' }
  | { state: 'unreadable'; message: string; refused: boolean }
  | { state: 'ready'; order: BellOrder };

/** Statuses that are past approving. Each gets its own sentence, never a shrug. */
const SETTLED: Record<string, string> = {
  approved: 'This order has already been approved.',
  ordered: 'This order has already been placed with the vendor.',
  delivered: 'This order has already been delivered.',
  completed: 'This order is complete.',
  cancelled: 'This order was cancelled.',
  rejected: 'This order was rejected.',
};

/**
 * Why this order cannot be sealed from here, or null when it can.
 *
 * Read from the ORDER, not from the notification: a bell line saying "waiting
 * for you" is a sentence from the moment it was written, and the order is the
 * thing that is true now.
 */
export function settledWords(order: BellOrder): string | null {
  const status = (order.status ?? '').toLowerCase();
  if (SETTLED[status]) return SETTLED[status];
  if (order.approvedAt) return 'This order has already been approved.';
  return null;
}

/**
 * The id of the order a bell line is about, or null.
 *
 * Both spellings are read because the gateway writes notification metadata in
 * two places and they do not agree on case. A line that names no order gets no
 * approve control at all — see the panel's header and `notifications.md` §9:
 * no producer writes an order id onto an `order_pending` line today, so this
 * control is correct and rarely reachable, which is the truth rather than a
 * button that would open an empty room.
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

function money(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString() : EM;
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
                : `${money(order.finalPrice)} per ${order.unitType ?? 'unit'} · ${money(order.totalCost)} in all`,
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
          {settled} There is nothing to seal, so no hold is offered.
        </p>
      )}

      {order && !settled && (
        <div className="mt-4" data-testid="bell-approve-seal">
          <SealedApproveDie
            orderIds={[order.id]}
            label={
              order.totalCost == null
                ? 'Hold to approve'
                : `Hold to approve · ${money(order.totalCost)}`
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
