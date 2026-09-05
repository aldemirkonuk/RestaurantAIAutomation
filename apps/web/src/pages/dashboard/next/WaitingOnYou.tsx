/**
 * "Waiting on you" — the pending-approvals queue (Federation's panel, the
 * founder-liked block). Every order the gateway says needs approval, oldest
 * first; a row expands (settle 0fr→1fr) into the real hold ceremony, which
 * calls the real approve endpoint — no fabricated success: the seal only
 * stays if the server said yes.
 *
 * THE SEAL IS REDEEMED, NOT ASSERTED (founder, 2026-09-04; ADR 0116 addendum).
 * This card used to call `ordersApi.approveOrder(order.id)` with an id alone,
 * so from the day the gateway began demanding a seal it would have been
 * refused, in words, on every order. It now holds through the SAME control
 * and the SAME mint as the legacy `/orders` page — `SealedApproveDie` — which
 * mints when the gesture BEGINS and approves nothing at all if the mint
 * fails. One implementation, because two implementations of "exactly once"
 * is how the two learn to disagree.
 *
 * It also no longer flattens every failure into one sentence. A 403 from this
 * route carries the whole reason — which rule fired, what the number was, who
 * may sign — and the die prints it verbatim; "the approval didn't reach the
 * server" was a claim about the network that a refusal makes false.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Seal } from '@/components/mudavym';
import { SealedApproveDie } from '@/components/orders/SealedApproveDie';
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

  const onApproved = (ids: string[]) => {
    setSealedIds((s) => {
      const next = new Set(s);
      ids.forEach((id) => next.add(id));
      return next;
    });
    // Let the seal land before the queue refetches the row away.
    setTimeout(onChanged, 900);
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
                      <SealedApproveDie
                        orderIds={[o.id]}
                        label={`Hold to approve · ${formatMoney(o.totalPrice, 'full')}`}
                        onApproved={onApproved}
                      />
                    </div>
                  </div>
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
