/**
 * "Waiting on you" — the pending-approvals queue (Federation's panel, the
 * founder-liked block). Every order the gateway says needs approval, oldest
 * first; a row expands (settle 0fr→1fr) into the real HoldToApprove control,
 * which calls the real approve endpoint — no fabricated success: the seal
 * only stays if the server said yes.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HoldToApprove, Seal } from '@/components/mudavym';
import { ordersApi } from '@/services/api';
import type { Order } from '@/services/api/types';
import { formatMoney, formatNumber } from '@/lib/utils';
import { DASH, timeAgo } from './format';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

export interface WaitingOnYouProps {
  /** undefined = loading · null = unreachable · [] = genuinely nothing */
  pending: Order[] | null | undefined;
  onChanged: () => void;
}

export function WaitingOnYou({ pending, onChanged }: WaitingOnYouProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [sealedIds, setSealedIds] = useState<Set<string>>(new Set());
  const [failedId, setFailedId] = useState<string | null>(null);

  const approve = async (order: Order) => {
    setFailedId(null);
    try {
      await ordersApi.approveOrder(order.id);
      setSealedIds((s) => new Set(s).add(order.id));
      // Let the seal land before the queue refetches the row away.
      setTimeout(onChanged, 900);
    } catch {
      setFailedId(order.id);
    }
  };

  const rows = (pending ?? []).filter((o) => !sealedIds.has(o.id));

  return (
    <section className="rounded-lg border border-paper-2 bg-paper-0 p-4" aria-label="Waiting on you">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Seal size={18} />
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-inkm-1">
            Waiting on you
          </h2>
        </div>
        <span
          className="text-[13px] text-inkm-3"
          style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}
        >
          {pending === undefined ? '' : pending === null ? DASH : formatNumber(rows.length)}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {pending === undefined && (
          <>
            <div className="dn-skel h-11" aria-hidden />
            <div className="dn-skel h-11 w-5/6" aria-hidden />
          </>
        )}

        {pending === null && (
          <p className="text-[12px] italic text-inkm-3">
            {DASH} The approvals queue couldn’t be reached. Nothing has been approved or lost —
            it will reappear when the connection returns.
          </p>
        )}

        {pending !== undefined && pending !== null && rows.length === 0 && (
          <p className="text-[12px] italic text-inkm-3">
            Nothing is waiting on you. New orders land here the moment they need a decision.
          </p>
        )}

        {rows.map((o) => {
          const open = openId === o.id;
          return (
            <div key={o.id} className="dn-row dn-ink">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : o.id)}
                aria-expanded={open}
                className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-inkm-1">
                    {o.wineName ?? (o as Order & { wine_name?: string }).wine_name ?? 'Unnamed wine'}
                    <span className="text-inkm-3">
                      {' '}
                      · {o.providerName ?? (o as Order & { provider_name?: string }).provider_name ?? 'vendor'}
                    </span>
                  </span>
                  <span className="block text-[11px] text-inkm-3">
                    requested {timeAgo(o.requestedAt ?? o.createdAt)}
                  </span>
                </span>
                <span
                  className="shrink-0 text-[13px] text-inkm-1"
                  style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatMoney(o.totalPrice, 'full')}
                </span>
              </button>

              {/* settle 0fr→1fr into the real control */}
              <div className="dn-expand" data-open={open}>
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-paper-2 px-3 py-2.5">
                    <p
                      className="text-[12px] text-inkm-2"
                      style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatNumber(o.quantity)} × {formatMoney(o.unitPrice, 'full')}
                    </p>
                    <div className="flex items-center gap-3">
                      <Link
                        to={`/orders?highlight=${o.id}`}
                        className="text-[11px] uppercase tracking-[0.1em] text-inkm-3 underline-offset-2 hover:text-inkm-1 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
                      >
                        Review
                      </Link>
                      <HoldToApprove
                        onApprove={() => approve(o)}
                        label={`Hold to approve · ${formatMoney(o.totalPrice, 'full')}`}
                      />
                    </div>
                  </div>
                  {failedId === o.id && (
                    <p className="px-3 pb-2 text-[11px] italic text-inkm-3">
                      The approval didn’t reach the server — the order is still waiting.
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {pending && pending.length > 0 && (
        <Link
          to="/orders"
          className="mt-3 inline-block text-[11px] uppercase tracking-[0.1em] text-inkm-3 underline-offset-2 hover:text-inkm-1 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
        >
          The full queue on /orders
        </Link>
      )}
    </section>
  );
}

export default WaitingOnYou;
