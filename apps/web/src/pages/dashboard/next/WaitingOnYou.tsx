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
 *
 * WHO MAY SEAL IT (DASH-W21). `/orders` asks `GET
 * /procurement/order-approval-gate` and shows the die DISABLED, with the
 * house's own sentence, on an order the caller's role may not seal. This card
 * offered a live die to everyone and let the approve route refuse after the
 * hold. It now reads the same gate, once per queue, only while something is
 * waiting. The gate is a courtesy, not the lock: the approve route still
 * decides, so an unreadable gate leaves the die live and says so.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Seal } from '@/components/mudavym';
import { SealedApproveDie } from '@/components/orders/SealedApproveDie';
import type { Order } from '@/services/api/types';
import { apiClient } from '@/services/api/client';
import type { ApprovalGate, ApprovalGateRow } from '@/pages/orders/next/useOrdersNextData';
import { vendorLine } from '@/lib/mudavym/vendor';
import { formatNumber } from '@/lib/utils';
import { DASH, approveLabel, money, timeAgo } from './format';
import { TryAgain } from './TryAgain';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

export interface WaitingOnYouProps {
  /** undefined = loading · null = unreachable · [] = genuinely nothing */
  pending: Order[] | null | undefined;
  onChanged: () => void;
  /** DASH-W21: the active house, whose approval rules the gate reads. */
  restaurantId?: string | null;
  /** DASH-W22: false for a role that sees counts, not money (staff). */
  seesAmounts?: boolean;
}

type GateState =
  | { state: 'idle' }
  | { state: 'ready'; byId: Map<string, ApprovalGateRow> }
  | { state: 'unknown' };

/** One read of the house's approval rules for the orders now waiting. */
function useApprovalGate(restaurantId: string | null | undefined, waitingKey: string): GateState {
  const [gate, setGate] = useState<GateState>({ state: 'idle' });
  useEffect(() => {
    if (!restaurantId || !waitingKey) {
      setGate({ state: 'idle' });
      return;
    }
    let live = true;
    apiClient
      .get<ApprovalGate>('/procurement/order-approval-gate')
      .then(({ data }) => {
        if (!live) return;
        // Another house's verdicts, or rules that could not be read, are not
        // an answer about these orders.
        if (!data || data.restaurantId !== restaurantId || !data.readable || !Array.isArray(data.orders)) {
          setGate({ state: 'unknown' });
          return;
        }
        setGate({ state: 'ready', byId: new Map(data.orders.map((r) => [r.orderId, r])) });
      })
      .catch(() => {
        if (live) setGate({ state: 'unknown' });
      });
    return () => {
      live = false;
    };
  }, [restaurantId, waitingKey]);
  return gate;
}

export function WaitingOnYou({ pending, onChanged, restaurantId, seesAmounts = true }: WaitingOnYouProps) {
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
  const gate = useApprovalGate(
    restaurantId,
    (pending ?? []).map((o) => o.id).join(','),
  );

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
          className="text-[13px] text-inkm-4"
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
          <p className="text-[12px] italic text-inkm-4">
            {DASH} The approvals queue couldn’t be reached. Nothing has been approved or lost.
            <TryAgain onRetry={onChanged} />
          </p>
        )}

        {pending !== undefined && pending !== null && rows.length === 0 && (
          <p className="text-[12px] italic text-inkm-4">
            Nothing is waiting on you. New orders land here the moment they need a decision.
          </p>
        )}

        {rows.map((o) => {
          const open = openId === o.id;
          const verdict = gate.state === 'ready' ? gate.byId.get(o.id) : undefined;
          const held = verdict ? !verdict.mayApprove : false;
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
                    {o.wineName ?? 'Unnamed item'}
                  </span>
                  {/*
                    WHO IS BEING PAID. `GET /procurement/orders/pending` joins
                    `providers` since 2026-09-05; before that this row named the
                    wine and the total and never the vendor, on the one panel in
                    the house where a person approves money.

                    `null` is the join finding nothing and the key being ABSENT
                    is a route that does not join — `vendorLine` keeps them
                    apart so a screen never reports "no vendor" about a query
                    that did not ask.
                  */}
                  <span className="block truncate text-[11px] text-inkm-4">
                    {vendorLine(o)} · requested {timeAgo(o.requestedAt)}
                  </span>
                </span>
                <span
                  className="shrink-0 text-[13px] text-inkm-1"
                  style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}
                >
                  {seesAmounts
                    ? money(o.totalCost)
                    : `${formatNumber(o.quantity)}${o.unitType ? ` ${o.unitType}` : ''}`}
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
                      {formatNumber(o.quantity)}
                      {o.unitType ? ` ${o.unitType}` : ''}
                      {seesAmounts ? ` × ${money(o.finalPrice)}` : ''}
                    </p>
                    <div className="flex items-center gap-3">
                      <Link
                        to={`/orders?order=${o.id}`}
                        className="text-[11px] uppercase tracking-[0.1em] text-inkm-4 underline-offset-2 hover:text-inkm-1 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
                      >
                        Review
                      </Link>
                      {/* Disabled, never hidden: a shut control with the rule beside it teaches who to ask. */}
                      <SealedApproveDie
                        orderIds={[o.id]}
                        label={approveLabel(seesAmounts ? o.totalCost : undefined)}
                        disabled={held}
                        onApproved={onApproved}
                      />
                    </div>
                  </div>
                  {held && (
                    <p className="px-3 pb-2.5 text-[11px] leading-relaxed text-inkm-2" role="status">
                      Waiting on {verdict?.requiredRole === 'owner' ? 'an owner' : 'a manager'}.
                      {verdict?.sentence ? ` ${verdict.sentence}` : ''}
                    </p>
                  )}
                  {gate.state === 'unknown' && (
                    <p className="px-3 pb-2.5 text-[11px] leading-relaxed text-inkm-4" role="status">
                      The house’s approval rules couldn’t be read just now, so this card can’t say
                      whether you may seal it. The house still checks when you hold.
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
          className="mt-3 inline-block text-[11px] uppercase tracking-[0.1em] text-inkm-4 underline-offset-2 hover:text-inkm-1 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
        >
          The full queue on /orders
        </Link>
      )}
    </section>
  );
}

export default WaitingOnYou;
