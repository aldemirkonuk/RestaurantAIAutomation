/**
 * Incomplete orders — the register under Documents & Reports (ADR 0207, round
 * 3; the founder's delegation of 2026-09-21).
 *
 * An order 30 days past its expected date and still not arrived leaves the
 * "Did it arrive?" question and the vendor scorecard's figures, and is listed
 * here until it is received (then it counts as late, with its true dates),
 * cancelled, or closed with a credit. `GET /procurement/incomplete-orders`.
 *
 * Honesty: a failed read says so; an empty register says what empty means;
 * the gateway's rule about who reads it (`forYou: false`) is printed as its
 * sentence, not as an empty list.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '@/services/api/client';
import { SealedRejectDie } from '@/components/orders/SealedRejectDie';
import { useAuth } from '../../../contexts/AuthContext';
import { MONO, SANS } from './so-format';

interface IncompleteOrder {
  orderId: string;
  orderNumber: string | null;
  providerId: string | null;
  providerName: string | null;
  expectedDate: string;
  daysPast: number;
  confirmed: boolean;
  choices: { key: string; route?: string }[];
}

interface IncompleteOrdersReadout {
  forYou: boolean;
  sentence: string | null;
  orders: IncompleteOrder[];
  afterDays: number;
}

function message(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof m === 'string' && m.trim() ? m : fallback;
}

const drawerStyle = {
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'var(--paper-1, #F3EFE6)',
  borderRadius: 12,
  padding: '12px 15px',
} as const;

/**
 * ADR 0207 round 4 — "It never arrived — cancel", in place, replacing the
 * link to Orders (the rebuilt page has no cancel act for a CONFIRMED/
 * IN_TRANSIT order at all). reasonCode is locked to never_arrived: an order
 * only reaches Incomplete orders once it is 30 days past a deadline it never
 * met, so that category is always the true one here.
 */
function IncompleteOrderRow({ o }: { o: IncompleteOrder }) {
  const receive = o.choices.find((c) => c.key === 'receive');
  const [cancelling, setCancelling] = useState(false);
  return (
    <li
      data-testid="incomplete-order"
      style={{ listStyle: 'none', padding: '7px 0', borderTop: '1px solid var(--paper-2, #EAE4D8)', fontSize: 12.5 }}
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <span style={{ fontWeight: 600 }}>{o.orderNumber ?? 'Order'}</span>
        <span style={{ color: 'var(--ink-3, #7C7365)', fontSize: 11.5 }}>
          {o.providerName ?? 'vendor not named'} · expected {o.expectedDate} · {o.daysPast} days ·{' '}
          {o.confirmed ? 'someone said not yet' : 'never answered'}
        </span>
        <span className="ml-auto" style={{ display: 'inline-flex', gap: 10 }}>
          {receive?.route && (
            <Link to={receive.route} className="so-link" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}>
              Receive it
            </Link>
          )}
          {!cancelling && (
            <button
              type="button"
              className="so-link"
              style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2, #4F473C)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              onClick={() => setCancelling(true)}
            >
              It never arrived — cancel
            </button>
          )}
        </span>
      </div>
      {cancelling && (
        <div style={{ marginTop: 8 }}>
          <SealedRejectDie
            orderId={o.orderId}
            reasonCode="never_arrived"
            label="Hold to cancel"
            onRejected={() => setCancelling(false)}
          />
        </div>
      )}
    </li>
  );
}

export function IncompleteOrders() {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: ['incomplete-orders', activeRestaurantId ?? ''],
    enabled: Boolean(activeRestaurantId),
    queryFn: async () => {
      const { data } = await apiClient.get<IncompleteOrdersReadout>('/procurement/incomplete-orders');
      return data;
    },
  });

  return (
    <section aria-label="Incomplete orders" data-testid="incomplete-orders" style={drawerStyle}>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-3, #7C7365)',
        }}
      >
        Incomplete orders
      </span>
      {q.isError ? (
        <p role="alert" style={{ margin: '6px 0 0', fontFamily: SANS, fontSize: 12, lineHeight: 1.45, color: 'var(--alarm, #A33A2B)' }}>
          {message(q.error, 'The incomplete orders could not be read.')} This register is unknown, not empty.
        </p>
      ) : !q.data ? (
        <p aria-busy="true" style={{ margin: '6px 0 0', fontFamily: SANS, fontSize: 12, color: 'var(--ink-3, #7C7365)' }}>
          Reading the orders that never arrived…
        </p>
      ) : !q.data.forYou ? (
        <p style={{ margin: '6px 0 0', fontFamily: SANS, fontSize: 12, color: 'var(--ink-3, #7C7365)' }}>{q.data.sentence}</p>
      ) : q.data.orders.length === 0 ? (
        <p data-testid="incomplete-empty" style={{ margin: '6px 0 0', fontFamily: SANS, fontSize: 12, lineHeight: 1.45, color: 'var(--ink-2, #4F473C)' }}>
          No order is more than {q.data.afterDays} days past its date without arriving.
        </p>
      ) : (
        <>
          <p style={{ margin: '4px 0 6px', fontFamily: SANS, fontSize: 11.5, lineHeight: 1.45, color: 'var(--ink-2, #4F473C)' }}>
            {q.data.afterDays} days or more past the expected date and not arrived. Out of the vendor scorecard until
            received — then counted late, with its true dates — cancelled, or closed with a credit.
          </p>
          <ul style={{ margin: 0, padding: 0 }}>
            {q.data.orders.map((o) => (
              <IncompleteOrderRow key={o.orderId} o={o} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default IncompleteOrders;
