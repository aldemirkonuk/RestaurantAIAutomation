/**
 * The reject ceremony, sealed — the sibling of `SealedApproveDie`.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * ADR 0125. Until 2026-09-05 the two acts on an order were not symmetric in
 * proof. Approving one redeemed a one-time seal bound to (this manager, this
 * order, "approve", the order's total and vendor). Rejecting one was
 * `confirm('Are you sure?')` followed by `apiClient.delete()` — no seal, no
 * reason, no role, no paper. The legacy desk (what a house actually sees:
 * `mudavym_design_orders` is OFF in production) sent not even a reason.
 *
 * The consequence runs the other way from the one people expect. An approval
 * spends money; a cancellation ERASES money already spent. A cancelled order
 * leaves `ORDER_SPEND_STATUSES` and `ORDER_ARRIVED_STATUSES` on the gateway,
 * so its cost vanishes from every spend total, cashflow figure, bottles-
 * delivered count and vendor scorecard — while the wine stays on the shelf.
 * The gateway now refuses that particular move outright; this control is the
 * gesture for the ones it still allows.
 *
 * ===========================================================================
 * THE RULES THIS CONTROL ENFORCES
 * ===========================================================================
 * 1. A REASON FIRST, IN WORDS. The hold does not arm until one is typed. The
 *    gateway refuses a blank one with a 400 anyway; making the person discover
 *    that from a failed request would be a control that lies about its own
 *    preconditions.
 * 2. THE MINT HAPPENS WHEN THE GESTURE BEGINS, through `onChallenge` — never at
 *    the moment of the write, which is the assertion model with extra steps.
 * 3. A FAILED MINT CANCELS NOTHING. `onChallenge` resolves null and
 *    `HoldToApprove` never calls `onApprove`. The mint is also where a refusal
 *    with a REASON arrives first: the gateway will not mint for a cancellation
 *    it would not perform, so "the wine is already on the shelf" is said at the
 *    start of the hold rather than after it.
 * 4. A NON-MANAGER SEES IT DISABLED, WITH THE REASON (ADR 0083: a control that
 *    disappears teaches nothing). The founder, 2026-09-05, answering ADR 0125
 *    Q1: *"Manager or owner, like approval."* The gate is the endpoint's —
 *    `assertCanManageRestaurant` runs on the mint AND the write — and this is
 *    the courtesy in front of it. **An UNRESOLVED role disables too**: the role
 *    comes from `/auth/me/role` and is `null` while it is loading and `null`
 *    again when that read FAILED. Treating "I don't know" as "yes" is the
 *    house's [[absence-reported-as-health]] fault pointed at a destructive
 *    write, and the sentence says which of the two it is.
 * 5. A REFUSAL IS PRINTED AS ITSELF. 400 (no reason), 403 (the seal or the
 *    role) and 422 (the state) all carry a whole sentence written to be read;
 *    `services/api/orders.ts` promotes it onto `.message`. Wrapping those in
 *    "The gateway refused (…)" would bury them. Anything else keeps the generic
 *    framing, because a dropped connection explains nothing about this order.
 *
 * The GROUND is `SealedApproveDie`'s, for the same measured reason: the root
 * carries `mudavym` so the tokens are scoped TO THE CONTROL and never to
 * `:root`, and `.dark .mudavym`'s `--paper-1` is byte-identical to the raised
 * surface the legacy dark page already paints (see that file's header for the
 * measurement).
 */

import { useId, useRef, useState } from 'react';
import { HoldToApprove } from '@/components/mudavym';
import { useAuth } from '@/contexts/AuthContext';
import { useCancelOrder } from '@/hooks/queries/useOrderQueries';
import * as ordersApi from '@/services/api/orders';

/** Said before the request, because the gateway would say it after. */
export const REJECT_NEEDS_A_REASON_LEGACY =
  'Say why this order is being rejected. The reason is written onto the order ' +
  'and is the only account anyone will have of why this wine was not bought.';

/** Said to somebody whose role cannot end an order. Never hidden — ADR 0083. */
export const REJECT_NEEDS_A_MANAGER =
  'Cancelling an order is a manager\u2019s or an owner\u2019s act in this house, and your ' +
  'role here is not one of those. Nothing was changed. Ask a manager to reject it, or ' +
  'ask an owner to change your role.';

/**
 * Said while the role is unknown — which is BOTH "still loading" and "that read
 * failed", because `/auth/me/role` resolves `null` for each and the browser
 * cannot tell them apart. Either way it is not permission.
 */
export const REJECT_ROLE_UNKNOWN =
  'Your role at this restaurant has not been read yet, so whether you may cancel an ' +
  'order is unknown. It is not assumed. If this does not clear in a moment, reload \u2014 ' +
  'a role that cannot be read is not a role that allows this.';

/** Said when the seal could not be minted for a reason the gateway did not give. */
export const REJECT_SEAL_NOT_ISSUED =
  'The seal could not be issued, so nothing was cancelled and no reason was ' +
  'written. Begin the hold again.';

export function reasonIsGiven(reason: string): boolean {
  return reason.trim().length > 0;
}

export interface SealedRejectDieProps {
  orderId: string;
  label?: string;
  disabled?: boolean;
  className?: string;
  /** Called only after the gateway confirmed the cancellation. */
  onRejected?: (orderId: string) => void;
}

export function SealedRejectDie({
  orderId,
  label = 'Hold to reject',
  disabled = false,
  className,
  onRejected,
}: SealedRejectDieProps) {
  const cancel = useCancelOrder();
  const { activeRole } = useAuth();
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  /** Bumped after any refusal so the die remounts armed rather than sealed. */
  const [attempt, setAttempt] = useState(0);
  const [running, setRunning] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  /** The seal for THIS gesture. One order, one token. */
  const sealRef = useRef<string | null>(null);

  /**
   * The role, as three states rather than two. `null` is not `staff`: one means
   * "this person may not", the other means "nobody has said yet", and a control
   * that collapsed them would either accuse a manager or admit a stranger.
   */
  const mayCancel = activeRole === 'owner' || activeRole === 'manager';
  const roleUnknown = activeRole === null || activeRole === undefined;
  const roleNote = roleUnknown
    ? REJECT_ROLE_UNKNOWN
    : mayCancel
      ? null
      : REJECT_NEEDS_A_MANAGER;

  const armed = reasonIsGiven(reason) && mayCancel;

  const onChallenge = async (): Promise<string | null> => {
    sealRef.current = null;
    setRefusal(null);
    if (!mayCancel) {
      // Unreachable while the die is disabled; kept because the ONLY thing
      // standing between a disabled control and a mint is this function.
      setRefusal(roleUnknown ? REJECT_ROLE_UNKNOWN : REJECT_NEEDS_A_MANAGER);
      return null;
    }
    if (!armed) {
      setReasonTouched(true);
      return null;
    }
    try {
      const token = await ordersApi.mintOrderCancelSeal(orderId);
      if (!token) {
        setRefusal(REJECT_SEAL_NOT_ISSUED);
        return null;
      }
      sealRef.current = token;
      return token;
    } catch (err) {
      // The gateway's own refusal, when it gave one — this is where "the wine
      // is already on the shelf" and "this order is already cancelled" arrive.
      const status = (err as { response?: { status?: number } })?.response?.status;
      const msg = (err as { message?: string })?.message ?? 'request failed';
      setRefusal(
        status === 403 || status === 422
          ? msg
          : `The seal could not be issued (${msg}) — nothing was cancelled.`,
      );
      return null;
    }
  };

  const onApprove = async () => {
    const seal = sealRef.current;
    if (!seal || !armed) {
      // Unreachable while `HoldToApprove` honours its own contract; kept
      // because a seal check that vanishes with its own dependency is the fault
      // this control exists to close.
      setRefusal(REJECT_SEAL_NOT_ISSUED);
      setAttempt((a) => a + 1);
      return;
    }
    setRunning(true);
    try {
      await cancel.mutateAsync({ orderId, reason: reason.trim(), challenge: seal });
      onRejected?.(orderId);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const msg = (err as { message?: string })?.message ?? 'request failed';
      setRefusal(
        status === 400 || status === 403 || status === 422
          ? msg
          : `The gateway refused (${msg}) — nothing was rejected, and no reason was written.`,
      );
      setAttempt((a) => a + 1);
    } finally {
      sealRef.current = null;
      setRunning(false);
    }
  };

  const said = {
    marginTop: 4,
    fontSize: 11.5,
    lineHeight: 1.55,
    color: 'var(--ink-2, #4F473C)',
  } as const;

  return (
    <div className={className ? `mudavym ${className}` : 'mudavym'}>
      <label
        htmlFor={reasonId}
        style={{
          display: 'block',
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--ink-3, #7C7365)',
        }}
      >
        Reject — say why
      </label>
      <textarea
        id={reasonId}
        data-testid="legacy-reject-reason"
        aria-label="Why this order is rejected"
        rows={2}
        value={reason}
        disabled={disabled || running || !mayCancel}
        onChange={(e) => {
          setReason(e.target.value);
          setRefusal(null);
        }}
        onBlur={() => setReasonTouched(true)}
        style={{
          width: '100%',
          marginTop: 4,
          padding: '6px 8px',
          fontSize: 12.5,
          lineHeight: 1.5,
          color: 'var(--ink-1, #211C16)',
          background: 'var(--paper-1, #FAF7F0)',
          border: '1px solid var(--rule, #DED5C6)',
          borderRadius: 2,
          resize: 'vertical',
        }}
      />
      <div style={{ marginTop: 6 }}>
        <HoldToApprove
          key={`reject-${orderId}-${attempt}`}
          label={label}
          approvedLabel="Rejected"
          disabled={disabled || running || !armed}
          onApprove={onApprove}
          onChallenge={onChallenge}
        />
      </div>
      {roleNote && (
        <p style={said} role="status" data-testid="legacy-reject-role-note">
          {roleNote}
        </p>
      )}
      {mayCancel && !armed && reasonTouched && (
        <p style={said} role="alert" data-testid="legacy-reject-needs-reason">
          {REJECT_NEEDS_A_REASON_LEGACY}
        </p>
      )}
      {running && (
        <p role="status" style={said}>
          Cancelling…
        </p>
      )}
      {refusal && (
        <p style={said} role="alert" data-testid="legacy-reject-refusal">
          {refusal}
        </p>
      )}
    </div>
  );
}

export default SealedRejectDie;
