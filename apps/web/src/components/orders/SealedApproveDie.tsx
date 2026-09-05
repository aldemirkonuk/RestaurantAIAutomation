/**
 * The approve ceremony, sealed — for every surface that is not `/orders`'s
 * rebuild.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * ADR 0116's addendum made an order approval a REDEEMED seal rather than an
 * asserted one: the gateway mints a one-time, 120-second token bound to
 * (this manager, this order, "approve", this order's own total and vendor)
 * when the hold BEGINS, and `POST /procurement/orders/:id/approve` spends it
 * exactly once. `pages/orders/next/{LedgerRow,BulkApproveBar}.tsx` were wired
 * that day; two call sites were not, and the founder's decision of 2026-09-04
 * was **"give both legacy call sites the hold gesture"** — approval stays
 * proven everywhere, and never becomes a one-click mint-and-approve.
 *
 * Those two sites are the legacy `pages/Orders.tsx` (what a house actually
 * sees: `mudavym_design_orders` is OFF in production) and
 * `pages/dashboard/next/WaitingOnYou.tsx`. They get ONE implementation, here,
 * rather than two more copies of the mint: a second implementation of "exactly
 * once" is how the two learn to disagree about what a seal is.
 *
 * ===========================================================================
 * THE RULES THIS CONTROL ENFORCES
 * ===========================================================================
 * 1. THE MINT HAPPENS WHEN THE GESTURE BEGINS. `HoldToApprove`'s `onChallenge`
 *    is the hook that guarantees the timing. A token fetched at the moment of
 *    approval is one more thing the same request asked for itself — the
 *    assertion model with extra steps.
 * 2. ONE SEAL PER ORDER, EVEN IN BULK (the `BulkApproveBar` rule). The dry
 *    emboss is one impression on the group, but that is a rule about ritual,
 *    not about authority: fourteen orders are fourteen commitments of the
 *    house's money, and a challenge is bound to one order's own figures.
 * 3. IF ANY MINT FAILS, NOTHING IS APPROVED. Approving the subset that
 *    happened to mint would make the count a lie about what was agreed to.
 *    `onChallenge` resolves null, `HoldToApprove` never calls `onApprove`, and
 *    the control says "The seal could not be issued — nothing sent."
 * 4. A 403 IS PRINTED AS ITSELF. Since ADR 0116 the refusal body IS the
 *    explanation — which rule fired, what the number was, who may sign — and
 *    `services/api/orders.ts` promotes it onto the error's `message`. Wrapping
 *    that in "The gateway refused (…)" would bury a sentence written to be
 *    read. Anything that is not a 403 keeps the generic framing, because a
 *    dropped connection explains nothing about this order.
 *
 * ===========================================================================
 * THE GROUND — MEASURED, NOT ASSUMED
 * ===========================================================================
 * The legacy page renders OUTSIDE the Mudavym shell: nothing on `/orders`
 * carries `.mudavym`, and `styles/mudavym.css` defines the house variables
 * under that class and NEVER on `:root` (it is the only file in
 * `apps/web/src` that defines `--paper-*`, `--ink-*` or `--seal*` at all). So
 * an unwrapped control falls back to the light values baked into
 * `HoldToApprove` and `Seal` as `var(--x, <light value>)`.
 *
 * A grep said `pages/Orders.tsx` carries zero `dark:` classes, and the
 * conclusion drawn from it — "the legacy page is permanently light, so the
 * fallbacks are always right" — was WRONG. Measured in the running app
 * (Playwright, the control's own inline styles injected into the live page and
 * the computed colours read back, `shots-legacy-hold/ground-probe*.json`):
 *
 *   html.light  bare #F3EFE6 ink #211C16   ·  inside .mudavym  identical
 *   html.dark   bare #F3EFE6 ink #211C16   ·  inside .mudavym  #1D1813 / #EFE7D9
 *
 * and the legacy page IS dark under `html.dark`, because `styles/globals.css`
 * repaints its Tailwind utilities wholesale (`.dark .bg-white → #1D1813`,
 * `.dark .bg-gray-50 → #15130F`, :163-177) — the same Warm Charcoal palette
 * ADR 0042 gave the house. An unwrapped die would therefore have been a cream
 * slab on a charcoal page.
 *
 * So the root carries `mudavym`: the tokens are scoped TO THE CONTROL, never
 * to `:root`, and `.dark .mudavym`'s `--paper-1` (#1D1813) is byte-identical
 * to the raised surface the legacy dark ground already uses. Inside the
 * Mudavym shell (the dashboard) the class is simply re-declared on a
 * descendant, which changes nothing.
 */

import { useRef, useState } from 'react';
import { HoldToApprove } from '@/components/mudavym';
import { useApproveOrder } from '@/hooks/queries/useOrderQueries';
import * as ordersApi from '@/services/api/orders';

export interface SealedApproveDieProps {
  /** Every order this one gesture commits. One seal will be minted for each. */
  orderIds: string[];
  /** Face of the die — normally the money being committed. */
  label: string;
  approvedLabel?: string;
  disabled?: boolean;
  className?: string;
  /** Ids the gateway actually approved. Never the ids that were attempted. */
  onApproved?: (approvedIds: string[]) => void;
  /** Called with `true` while the writes are in flight. */
  onRunningChange?: (running: boolean) => void;
}

/**
 * What `onChallenge` resolves when EVERY order minted.
 *
 * The tokens themselves live in a ref, keyed by order id, because a bulk
 * gesture holds N of them and `HoldToApprove` carries one value. What the
 * control needs from this promise is only the yes/no — and null is the "no"
 * that stops the approval, which is the property that matters.
 */
const ALL_SEALED = 'all-sealed';

export function SealedApproveDie({
  orderIds,
  label,
  approvedLabel = 'Approved',
  disabled = false,
  className,
  onApproved,
  onRunningChange,
}: SealedApproveDieProps) {
  const approve = useApproveOrder();
  /** Bumped after any refusal so the die remounts armed rather than sealed. */
  const [attempt, setAttempt] = useState(0);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<{
    approved: number;
    refused: number;
    /** The distinct sentences the gateway gave, in the order first seen. */
    reasons: string[];
  } | null>(null);

  /** The seals for THIS gesture, keyed by order id. */
  const sealsRef = useRef<Map<string, string> | null>(null);

  /**
   * Mint the proof, once per gesture, one per order.
   *
   * Resolves null the moment any of them fails — and null is what stops the
   * approval, so a refused mint cannot become a silent approval on the way
   * through the UI. That is the one failure this whole mechanism exists to
   * prevent, and it must not arrive through the browser instead of the API.
   */
  const onChallenge = async (): Promise<string | null> => {
    sealsRef.current = null;
    if (orderIds.length === 0) return null;
    try {
      const tokens = await Promise.all(orderIds.map((id) => ordersApi.mintOrderSeal(id)));
      if (tokens.some((t) => !t)) return null;
      sealsRef.current = new Map(orderIds.map((id, i) => [id, tokens[i] as string]));
      return ALL_SEALED;
    } catch {
      sealsRef.current = null;
      return null;
    }
  };

  const onApprove = async () => {
    const seals = sealsRef.current;
    // Unreachable while `HoldToApprove` honours its own contract; kept because
    // a seal check that vanishes with its own dependency is the fault this
    // control exists to close.
    if (!seals) {
      setOutcome({ approved: 0, refused: orderIds.length, reasons: [] });
      setAttempt((a) => a + 1);
      return;
    }
    setRunning(true);
    onRunningChange?.(true);
    setOutcome(null);

    const approvedIds: string[] = [];
    const reasons: string[] = [];
    let refused = 0;
    for (const id of orderIds) {
      try {
        await approve.mutateAsync({ orderId: id, challenge: seals.get(id) ?? null });
        approvedIds.push(id);
      } catch (err) {
        refused += 1;
        const status = (err as { response?: { status?: number } })?.response?.status;
        const msg = (err as { message?: string })?.message ?? 'request failed';
        const sentence =
          status === 403 ? msg : `The gateway refused (${msg}) — nothing approved on that order.`;
        if (!reasons.includes(sentence)) reasons.push(sentence);
      }
    }
    // Spent or refused, every seal from this gesture is done.
    sealsRef.current = null;
    setRunning(false);
    onRunningChange?.(false);
    setOutcome({ approved: approvedIds.length, refused, reasons });
    // A refusal must not leave the die reading "Approved" over an order that
    // is still pending, so the ceremony is returned to rest.
    if (refused > 0) setAttempt((a) => a + 1);
    if (approvedIds.length > 0) onApproved?.(approvedIds);
  };

  const noun = orderIds.length === 1 ? 'order' : 'orders';

  return (
    <div className={className ? `mudavym ${className}` : 'mudavym'}>
      <HoldToApprove
        key={`die-${orderIds.join(',')}-${attempt}`}
        label={label}
        approvedLabel={approvedLabel}
        disabled={disabled || running || orderIds.length === 0}
        onApprove={onApprove}
        onChallenge={onChallenge}
      />
      {running && (
        <p
          role="status"
          style={{ marginTop: 4, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3, #7C7365)' }}
        >
          Sealing {orderIds.length} {noun}…
        </p>
      )}
      {outcome && outcome.refused > 0 && (
        <div role="alert" style={{ marginTop: 4 }}>
          <p style={{ fontSize: 11.5, lineHeight: 1.55, color: 'var(--ink-2, #4F473C)' }}>
            {outcome.approved > 0
              ? `${outcome.approved} sealed, ${outcome.refused} refused and still pending.`
              : `Nothing was approved — ${outcome.refused} refused and still pending.`}
          </p>
          {outcome.reasons.map((r) => (
            <p
              key={r}
              style={{
                marginTop: 3,
                fontSize: 11.5,
                lineHeight: 1.55,
                color: 'var(--ink-2, #4F473C)',
              }}
            >
              {r}
            </p>
          ))}
        </div>
      )}
      {outcome && outcome.refused === 0 && outcome.approved > 0 && (
        <p
          role="status"
          style={{ marginTop: 4, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3, #7C7365)' }}
        >
          {outcome.approved} {outcome.approved === 1 ? 'order' : 'orders'} sealed.
        </p>
      )}
    </div>
  );
}

export default SealedApproveDie;
